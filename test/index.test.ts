import { describe, beforeAll, afterAll, it, expect, vi } from "vitest"
import { listen, Listener } from "listhen"
import { joinURL } from "ufo"
import {
    assertMethod,
    createApp,
    createError,
    eventHandler,
    getHeader,
    getRouterParams,
    readBody,
    readRawBody,
    setHeader,
    toNodeListener,
    createRouter,
} from "h3"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from 'node:url'
import { resolve, dirname, extname } from "node:path"
import { randomUUID } from "node:crypto"
import { existsSync, openAsBlob, createWriteStream } from "node:fs"

import { ofetch } from "ofetch"
import { ChunkedUploader } from '../src'
import { md5 } from "hash-wasm"

const listeners = new Map<string, Set<EventListener>>()

vi.stubGlobal('navigator', new Proxy({
    onLine: true
}, {
    set(target, p, v) {
        switch (p) {
            case 'onLine':
                {
                    const type = v ? 'online' : 'offline'
                    if (listeners.has(type))
                        for (const listener of listeners.get(type)!) {
                            listener.call(target, new Event(type))
                        }
                    break
                }
        }
        target[p] = v
        return true
    }
}))

vi.stubGlobal('window', {
    addEventListener(type: string, listener: EventListener) {
        if (listeners.has(type)) listeners.get(type)!.add(listener)
        else listeners.set(type, new Set([listener]))
    },
    removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener)
    }
})

describe('chunked uploader', { timeout: 20_000 }, () => {
    let listener: Listener;
    const getURL = (url: string) => joinURL(listener.url, url);

    const location = dirname(fileURLToPath(import.meta.url))
    let failed = 0
    let file: File

    beforeAll(async () => {
        const app = createApp()
        const router = createRouter()
            .post(
                "/chunked-upload",
                eventHandler(async (event) => {
                    assertMethod(event, 'POST')
                    const body = await readBody(event)
                    console.assert(body?.chunkSize === 1024 * 1024 * 5, 'chunkSize')
                    console.assert(typeof body?.fileSize === 'number', 'fileSize')
                    console.assert(typeof body?.filename === 'string', 'filename')
                    const id = randomUUID()
                    setHeader(event, 'ETag', id)
                    if (!existsSync(resolve(location, '.temp')))
                        await mkdir(resolve(location, '.temp'))
                    await writeFile(resolve(location, '.temp', `${id}.json`), JSON.stringify(body), { encoding: 'utf8', flag: 'w' })
                    return { id }
                })
            ).post(
                "/chunked-upload/:id/:i",
                eventHandler(async (event) => {
                    const { id } = getRouterParams(event)
                    const confPath = resolve(location, '.temp', `${id}.json`)
                    if (!existsSync(confPath))
                        throw createError({ status: 400 })

                    const { filename } = JSON.parse(await readFile(confPath, 'utf8'))
                    const range = getHeader(event, 'Range')
                    const contentDigest = getHeader(event, 'Content-Digest')
                    const rangeExp = /^bytes=(\d+)-(\d+)$/
                    const contentDigestExp = /^md5=:(.+):$/
                    const [_, start] = rangeExp.exec(range!)!.map((it) => Number.parseInt(it))
                    const chunk = (await readRawBody(event, false))!
                    console.assert(hexStringToBase64(await md5(chunk)) === contentDigestExp.exec(contentDigest!)![1], 'hash mismatch')

                    // make a chunk upload failed
                    if (failed < 1) {
                        failed++
                        throw createError({ status: 408 })
                    }

                    const path = resolve(location, '.temp', `${id}${extname(filename)}`)
                    if (!existsSync(path))
                        await writeFile(path, [])
                    const ws = createWriteStream(path, {
                        start,
                        flags: 'r+',
                        encoding: 'binary'
                    })
                    await new Promise<void>((resolve, reject) => {
                        ws.write(chunk, (error) => {
                            if (error) reject(error)
                            else resolve()
                        })
                    })
                    await new Promise<void>((resolve, reject) => {
                        ws.close((err) => {
                            if (err) reject(err)
                            else resolve()
                        })
                    })
                    return ''
                })
            ).post('/timeout',
                eventHandler(() => {
                    throw createError({ status: 408 })
                })
            )
        app.use(router)
        listener = await listen(toNodeListener(app))

        file = new File([await openAsBlob(resolve(location, 'test.jpg'))], 'test.jpg')
    })

    afterAll(async () => {
        listener.close().catch(console.error);
        await rm(resolve(location, '.temp'), { recursive: true })
    })

    it('ok', async () => {
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
                chunkSize: 1024 * 1024 * 5,
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))
        function onEnd() { '' }
        uploader.addEventListener('end', onEnd)
        uploader.removeEventListener('end', onEnd)

        await uploader.start()
        expect(uploader.status).toBe('success')
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(location, 'test.jpg'))).arrayBuffer())))
    })

    it('offline', async () => {
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
                chunkSize: 1024 * 1024 * 5,
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))

        uploader.onLine = false

        const response = await uploader.start()
        expect(response).toBeFalsy()
    })

    it('offline & reconnect', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                chunkSize: 1024 * 1024 * 5,
                fileSize: file.size,
                filename: file.name
            }
        })
        // @ts-ignore
        navigator.onLine = false
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))

        const response = await uploader.start()
        expect(response).toBeFalsy()
        expect(uploader.status).toBe('paused')

        // @ts-ignore
        navigator.onLine = true
        if (uploader.status === 'pending')
            await new Promise((resolve) => uploader.addEventListener('success', resolve))

        expect(uploader.status).toBe('success')
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(location, 'test.jpg'))).arrayBuffer())))
    })

    it('timeout', async () => {
        const uploader = new ChunkedUploader(file, getURL('timeout'))
        const response = await uploader.start()
        expect(response).toBeFalsy()
    })
})

function hexStringToBase64(hexString: string) {
    return btoa(hexString.match(/\w{2}/g)!.map(byte => String.fromCodePoint(Number.parseInt(byte, 16))).join(''))
}

