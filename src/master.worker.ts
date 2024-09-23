import { ofetch } from 'ofetch'
import { ChunkedUploader } from './index'
import { hexStringToBase64 } from './utils'

const workerSelf = self as unknown as DedicatedWorkerGlobalScope

workerSelf.addEventListener('message', async (e: MessageEvent<{
    buffer: ArrayBuffer
    name: string
    chunkSize: number
    uploadedChunkIndexes?: number[]
}>) => {
    const { buffer, name, chunkSize, uploadedChunkIndexes } = e.data
    const { id } = await ofetch('/chunked-upload', {
        method: 'POST'
    })

    const uploader = new ChunkedUploader({
        buffer: buffer,
        name,
        size: buffer.byteLength,
    }, async ({ buffer, index, start, end, hash }) => ofetch(`/chunked-upload/${id}/${index}`, {
        method: 'PUT',
        body: await buffer,
        headers: {
            'Content-Range': `bytes:${start}-${end - 1}`,
            'Content-MD5': `md5:${hexStringToBase64(await hash)}:`,
        }
    }), {
        chunkSize
    })

    uploader.addEventListener('progress', (e) => {
        postMessage({ type: 'progress', progress: e.loaded / e.total })
    })
    uploader.addEventListener('success', () => {
        postMessage({ type: 'success' })
        workerSelf.close()
    })
    uploader.addEventListener('error', () => {
        console.error(uploader.error)
        postMessage({ type: 'error', error: { name: uploader.error?.name, message: uploader.error?.message } })
        workerSelf.close()
    })

    uploader.start(uploadedChunkIndexes)
})
