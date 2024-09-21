import { describe, beforeAll, afterAll, it, expect, vi } from "vitest"
import { listen, Listener } from "listhen"
import { joinURL } from "ufo"
import {
    createApp,
    createError,
    eventHandler,
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
    const getURL = (url: string) => joinURL(listener.url, url);

    const location = dirname(resolve(fileURLToPath(import.meta.url), '../'))
    let file: File

    beforeAll(async () => {
        const app = createApp()
        router.post('/timeout',
            eventHandler(() => {
                throw createError({ status: 408 })
            })
        )
        app.use(router)
        listener = await listen(toNodeListener(app))

        file = new File([await openAsBlob(resolve(location, './test/test.jpg'))], 'test.jpg')
    })

    afterAll(async () => {
        listener.close().catch(console.error);
        await rm(resolve(location, '.temp'), { recursive: true })
    })

    it('ok', async () => {
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
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
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(location, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('offline', async () => {
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
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
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))

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
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(location, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('timeout', async () => {
        const uploader = new ChunkedUploader(file, getURL('timeout'))
        const response = await uploader.start()
        expect(response).toBeFalsy()
    })

    it('manual pause & resume', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))

        uploader.start()
        expect(uploader.status).toBe('pending')
        uploader.pause()
        expect(uploader.status).toBe('paused')

        uploader.resume()
        await new Promise((resolve) => uploader.addEventListener('success', resolve))
        expect(uploader.status).toBe('success')
        expect(await uploader.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(location, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('store & restore', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))
        await ofetch(getURL(joinURL('chunked-upload', id, '0')), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Range': `bytes=${uploader.chunks[0].start}-${uploader.chunks[0].end - 1}`,
                'Content-Digest': `md5=:${hexStringToBase64(await uploader.chunks[0].blob.arrayBuffer().then(buffer => md5(new Uint8Array(buffer))))}:`
            },
            body: uploader.chunks[0].blob,
            retry: 3
        })
        const uploader2 = new ChunkedUploader(uploader.store(), ({ index }) => getURL(joinURL('chunked-upload', id, index.toString())))
        uploader2.start([0])
        expect(uploader2.chunks[0].status).toBe('success')
        await new Promise((resolve) => uploader2.onsuccess = resolve)
        expect(await uploader2.hash).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(location, '.temp', `${id}.jpg`))).arrayBuffer())))
    })
})

function hexStringToBase64(hexString: string) {
    return btoa(hexString.match(/\w{2}/g)!.map(byte => String.fromCodePoint(Number.parseInt(byte, 16))).join(''))
}

