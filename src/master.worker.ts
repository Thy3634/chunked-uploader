import { ofetch } from 'ofetch'
import { ChunkedUploader } from './index'
import { hexStringToBase64 } from './utils'

const workerSelf = self as unknown as DedicatedWorkerGlobalScope

let uploader: ChunkedUploader

workerSelf.addEventListener('message', async (e: MessageEvent<{
    buffer: ArrayBuffer
    name: string
    chunkSize: number
    uploadedChunkIndexes?: number[]
    limit?: number
    type: 'init' | 'start'
}>) => {
    if (e.data.type === 'init') {
        const { buffer, name, chunkSize, limit } = e.data
        const { id } = await ofetch('/chunked-upload', {
            method: 'POST',
            body: {
                fileSize: buffer.byteLength,
                filename: name
            }
        })

        uploader = new ChunkedUploader({
            buffer: buffer,
            name,
            size: buffer.byteLength,
        }, async ({ buffer, index, start, end, hash }) => ofetch(`/chunked-upload/${id}/${index}`, {
            method: 'PUT',
            body: await buffer,
            headers: {
                'Range': `bytes=${start}-${end - 1}`,
                'Content-Digest': `md5=:${hexStringToBase64(await hash)}:`,
            }
        }), {
            chunkSize,
            hashCreater,
            limit,
        })

        uploader.addEventListener('progress', (e) => {
            workerSelf.postMessage({ type: 'progress', progress: e.loaded / e.total })
        })
        uploader.addEventListener('success', () => {
            workerSelf.postMessage({ type: 'success' })
            workerSelf.close()
        })
        uploader.addEventListener('error', () => {
            console.error(uploader.error)
            workerSelf.postMessage({ type: 'error', error: { name: uploader.error?.name, message: uploader.error?.message } })
            workerSelf.close()
        })
    }
    else if (e.data.type === 'start') {
        const { uploadedChunkIndexes } = e.data
        uploader!.start(uploadedChunkIndexes)
    }
})

/**
 * Create a web worker to calculate the md5 hash of a file.
 * @returns A object with three methods: `init`, `update`, `digest`.
 */
function hashCreater() {
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
        async digest() {
            return new Promise<string>((resolve) => {
                worker.postMessage({ type: 'digest' })
                function onMessage(e: MessageEvent) {
                    if (e.data.type === 'digest') {
                        worker.removeEventListener('message', onMessage)
                        worker.terminate()
                        resolve(e.data.hash)
                    }
                }
                worker.addEventListener('message', onMessage)
            })
        }
    }
}
