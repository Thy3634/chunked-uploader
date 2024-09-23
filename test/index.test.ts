import { describe, beforeAll, afterAll, it, expect, vi } from "vitest"
import { listen, Listener } from "listhen"
import { joinURL } from "ufo"
import {
    createApp,
    toNodeListener,
} from "h3"
import { rm } from "node:fs/promises"
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from "node:path"

import { ofetch } from "ofetch"
import { ChunkedUploader } from '../src'
import { md5 } from "hash-wasm"
import { openAsBlob } from "node:fs"
import { router } from "../app"
import { hexStringToBase64 } from "../src/utils"

const listeners = new Map<string, Set<EventListener>>()

vi.stubGlobal('navigator', {
    onLine: true,
    hardwareConcurrency: 4,
})

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
    const getURL = (url: string) => joinURL(listener.url, url)
    function getRequester(id: string) {
        return async ({ index, buffer, start, end }) => ofetch(getURL(joinURL('chunked-upload', id, index.toString())), {
            method: 'POST',
            body: await buffer,
            headers: {
                'Range': `bytes=${start}-${end - 1}`,
                'Content-Digest': `md5=:${hexStringToBase64(await md5(new Uint8Array(await buffer)))}:`
            }
        })
    }

    const __root = dirname(resolve(fileURLToPath(import.meta.url), '../'))
    let file: File

    beforeAll(async () => {
        const app = createApp()
        app.use(router)
        listener = await listen(toNodeListener(app))

        file = new File([await openAsBlob(resolve(__root, './test/test.jpg'))], 'test.jpg')
    })

    afterAll(async () => {
        listener.close().catch(console.error)
        try {
            await rm(resolve(__root, '.temp'), { recursive: true, force: true })
        } catch (error) {
            console.error(error)
        }
    })

    it('ok', async () => {
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))
        function onEnd() { '' }
        uploader.addEventListener('end', onEnd)
        uploader.removeEventListener('end', onEnd)

        await uploader.start()
        expect(uploader.status).toBe('success')
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('offline', async () => {
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))

        uploader.onLine = false

        const response = await uploader.start()
        expect(response).toBeFalsy()
    })

    it('offline & reconnect', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))

        uploader.start()
        if (listeners.has('offline'))
            for (const listener of listeners.get('offline')!) {
                listener.call(navigator, new Event('offline'))
            }
        expect(uploader.status).toBe('paused')

        if (listeners.has('online'))
            for (const listener of listeners.get('online')!) {
                listener.call(navigator, new Event('online'))
            }
        await new Promise((resolve) => uploader.addEventListener('success', resolve))

        expect(uploader.status).toBe('success')
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('manual pause & resume', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))

        uploader.start()
        expect(uploader.status).toBe('pending')
        uploader.pause()
        expect(uploader.status).toBe('paused')

        uploader.resume()
        await new Promise((resolve) => uploader.addEventListener('success', resolve))
        expect(uploader.status).toBe('success')
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('store & restore', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))
        await getRequester(id)(uploader.chunks[0])
        const uploader2 = new ChunkedUploader(await uploader.store(), getRequester(id))
        uploader2.start([0])
        expect(uploader2.chunks[0].status).toBe('success')
        await new Promise((resolve) => uploader2.onsuccess = resolve)
        expect(await uploader2.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })
})
