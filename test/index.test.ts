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

const navigator = {
    onLine: true,
    hardwareConcurrency: 4,
}

class MWindow extends EventTarget {
    dispatchEvent(event: Event): boolean {
        // switch (event.type) {
        //     case 'online': {
        //         navigator.onLine = true
        //         break;
        //     }
        //     case 'offline': {
        //         navigator.onLine = false
        //         break;
        //     }
        //     default: {
        //         break
        //     }
        // }
        return super.dispatchEvent(event)
    }
}
const window = new MWindow() as Window

vi.stubGlobal('navigator', navigator)

vi.stubGlobal('window', window)

describe('chunked uploader', { timeout: 20_000 }, () => {
    let listener: Listener;
    const getURL = (url: string) => joinURL(listener.url, url)
    function getRequester(id: string) {
        return async ({ index, buffer, start, end }) => ofetch(getURL(joinURL('chunked-upload', id, index.toString())), {
            method: 'PUT',
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
                size: file.size,
                name: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))
        function onEnd() { '' }
        uploader.addEventListener('end', onEnd)
        uploader.removeEventListener('end', onEnd)

        await uploader.start()
        expect(uploader.status).toBe('success')
        expect(await uploader.digest).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('offline', async () => {
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
                size: file.size,
                name: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))

        uploader.onLine = false

        const response = await uploader.start()
        expect(uploader.status).toBe('paused')
        expect(response).toBeFalsy()
    })

    it('offline & reconnect', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                size: file.size,
                name: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))

        window.dispatchEvent(new Event('offline'))
        uploader.start()
        expect(uploader.status).toBe('paused')

        window.dispatchEvent(new Event('online'))
        await new Promise((resolve) => uploader.addEventListener('success', resolve))

        expect(uploader.status).toBe('success')
        expect(await uploader.digest).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('manual pause & resume', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                size: file.size,
                name: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id), { limit: 8 })

        uploader.start()
        expect(uploader.status).toBe('pending')
        uploader.pause()
        expect(uploader.status).toBe('paused')

        uploader.resume()
        await new Promise((resolve) => uploader.addEventListener('success', resolve))
        expect(uploader.status).toBe('success')
        expect(await uploader.digest).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })

    it('store & restore', async () => {
        const { id } = await ofetch(getURL('chunked-upload'), {
            method: 'POST',
            body: {
                size: file.size,
                name: file.name
            }
        })
        const uploader = new ChunkedUploader(file, getRequester(id))
        await getRequester(id)(uploader.chunks[0])
        const uploader2 = new ChunkedUploader(await uploader.store(), getRequester(id))
        await uploader2.start([0])
        expect(await uploader2.digest).toBe(await md5(new Uint8Array(await (await openAsBlob(resolve(__root, '.temp', `${id}.jpg`))).arrayBuffer())))
    })
})
