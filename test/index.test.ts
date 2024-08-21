import { describe, beforeAll, afterAll, it, expect } from "vitest"
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
import { existsSync, openAsBlob, createWriteStream, WriteStream } from "node:fs"

import { ofetch } from "ofetch"
import { ChunkedUploader } from '../src'
import { md5 } from "hash-wasm"

describe('chunked uploader', { timeout: 20_000 }, () => {
    let listener: Listener;
    const getURL = (url: string) => joinURL(listener.url, url);

    const location = dirname(fileURLToPath(import.meta.url))

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
                    const { id, i } = getRouterParams(event)
                    const confPath = resolve(location, '.temp', `${id}.json`)
                    if (!existsSync(confPath))
                        throw createError({ status: 400 })

                    const { chunkSize, filename, fileSize } = JSON.parse(await readFile(confPath, 'utf8'))
                    const range = getHeader(event, 'Range')
                    const contentDigest = getHeader(event, 'Content-Digest')
                    const rangeExp = /^bytes=(\d+)-(\d+)$/
                    const contentDigestExp = /^md5=:(.+):$/
                    const [_, start, end] = rangeExp.exec(range!)!.map((it) => Number.parseInt(it))
                    const chunk = (await readRawBody(event, false))!
                    console.assert(hexStringToBase64(await md5(chunk)) === contentDigestExp.exec(contentDigest!)![1], 'hash mismatch')

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
            )
        app.use(router)
        listener = await listen(toNodeListener(app))
    })

    afterAll(async () => {
        listener.close().catch(console.error);
        await rm(resolve(location, '.temp'), { recursive: true })
    })

    it('ok', async () => {
        const file = new File([await openAsBlob(resolve(location, 'test.jpg'))], 'test.jpg')
        // init
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
                chunkSize: 1024 * 1024 * 5,
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))

        uploader.onerror = (event) => console.error(event.target.error)

        const responseList = await uploader.start()
        expect(responseList?.length === Math.ceil(file.size / 1024 / 1024 / 5)).toBeTruthy()
        expect(await uploader.hash === await md5(new Uint8Array(await file.arrayBuffer())))
    })
})

function hexStringToBase64(hexString: string) {
    return btoa(hexString.match(/\w{2}/g)!.map(byte => String.fromCodePoint(Number.parseInt(byte, 16))).join(''))
}

