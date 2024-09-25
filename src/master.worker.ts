import { ofetch } from 'ofetch'
import { ChunkedUploader } from './index'
import { hexStringToBase64 } from './utils'

const workerSelf = self as unknown as DedicatedWorkerGlobalScope

let uploader: ChunkedUploader

workerSelf.addEventListener('message', async (e: MessageEvent<{
    buffer: ArrayBuffer
    name: string
    chunkSize: number
    limit?: number
    type: 'init'
} | {
    type: 'start'
    uploadedChunkIndexes?: number[]
} | {
    type: 'pause'
} | {
    type: 'resume'
}>) => {
    switch (e.data.type) {
        case 'init': {
            const { buffer, name, chunkSize, limit } = e.data
            const { id } = await ofetch('/chunked-upload', {
                method: 'POST',
                body: {
                    size: buffer.byteLength,
                    name,
                    chunkSize
                }
            })

            uploader = new ChunkedUploader({
                buffer,
                name,
                size: buffer.byteLength,
            }, async ({ buffer, index, start, end, digest }) => ofetch(`/chunked-upload/${id}/${index}`, {
                method: 'PUT',
                body: await buffer,
                headers: {
                    'Range': `bytes=${start}-${end - 1}`,
                    'Content-Digest': `md5=:${hexStringToBase64(await digest)}:`,
                },
                signal: uploader.options.abortController.signal, // pass an abort signal so that pause/abort works
                retry: 1,
            }), {
                chunkSize,
                createHasher,
                limit,
            })

            uploader.addEventListener('progress', (e) => {
                workerSelf.postMessage({ type: 'progress', progress: e.loaded / e.total })
            })
            uploader.addEventListener('success', () => {
                uploader.destroy()
                workerSelf.postMessage({ type: 'success' })
                workerSelf.close()
            })
            uploader.addEventListener('error', () => {
                console.error(uploader.error)
                uploader.destroy()
                workerSelf.postMessage({ type: 'error', error: { name: uploader.error?.name, message: uploader.error?.message } })
                workerSelf.close()
            })
            break
        }
        case 'start': {
            const { uploadedChunkIndexes } = e.data
            uploader!.start(uploadedChunkIndexes)
            break
        }
        case 'pause': {
            uploader!.pause()
            break
        }
        case 'resume': {
            uploader!.resume()
            break
        }
        default: {
            console.error('Unknown message:', e.data)
            break
        }
    }

})

/**
 * Create a web worker to calculate the md5 digest of a file.
 * @returns A object with three methods: `init`, `update`, `digest`.
 */
async function createHasher() {
    const worker = new Worker(new URL('hash.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('error', console.error)
    worker.addEventListener('messageerror', console.error)

    return {
        init() {
            worker.postMessage({ type: 'init' })
        },
        update(data: Uint8Array | Uint16Array | Uint32Array | string) {
            worker.postMessage({ type: 'update', data })
        },
        digest() {
            return new Promise<string>((resolve) => {
                function onMessage(e: MessageEvent) {
                    if (e.data.type === 'digest') {
                        worker.removeEventListener('message', onMessage)
                        worker.terminate()
                        resolve(e.data.digest)
                    }
                }
                worker.addEventListener('message', onMessage)
                worker.postMessage({ type: 'digest' })
            })
        }
    }
}
