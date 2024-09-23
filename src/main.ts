/**
 * An example of using ChunkedUploader to upload a file, using multiple web workers to calc chunk's md5 in parallel.
 */
import { ofetch } from "ofetch"
import { ChunkedUploader } from "."
import { hexStringToBase64 } from "./utils"
import { md5 } from "hash-wasm"

const form = document.querySelector('#form') as HTMLFormElement
const fileInput = document.querySelector('#file-input') as HTMLInputElement
const progress = document.querySelector('#progress') as HTMLProgressElement
const chunkSizeInput = document.querySelector('#chunk-size-input') as HTMLInputElement
const uploadButton = document.querySelector('#upload-button') as HTMLButtonElement

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
                        resolve(e.data.hash)
                    }
                }
                worker.addEventListener('message', onMessage)
            })
        }
    }
}


fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (file) {
        chunkSizeInput.disabled = true
        uploadButton.disabled = false
        const { id } = await ofetch<{ id: string }>('/chunked-upload', {
            method: 'POST',
            body: {
                fileSize: file.size,
                filename: file.name
            }
        })

        const uploader = new ChunkedUploader(file, async ({ index, blob, start, end }) => {
            const formData = new FormData()
            formData.append('file', blob)
            return ofetch(`/chunked-upload/${id}/${index}`, {
                method: 'POST',
                body: formData,
                headers: {
                    'Range': `bytes=${start}-${end - 1}`,
                    'Content-Digest': `md5=:${hexStringToBase64(await md5(new Uint8Array(await blob.arrayBuffer())))}:`
                }
            })
        }, {
            hashCreater,
            chunkSize: Number.parseInt(chunkSizeInput.value) * 1024 * 1024,
            // Set `options.limit` to limit the number of upload requests. 
            // limit: navigator.hardwareConcurrency, // The number of CPU cores.
        })

        requestIdleCallback(() => uploadButton.disabled = false)

        form.addEventListener('submit', (e) => {
            e.preventDefault()
            uploader.start()
            uploadButton.disabled = true
            chunkSizeInput.disabled = false
        })
        uploader.addEventListener('progress', () => {
            progress.value = uploader.loaded / uploader.total * 100
        })
        uploader.addEventListener('success', () => {
            alert('Upload complete')
        })
        uploader.addEventListener('error', (error) => {
            console.error(error)
            alert('Upload failed')
        })
    }
})

form.addEventListener('reset', () => {
    progress.value = 0
    uploadButton.disabled = true
    chunkSizeInput.disabled = false
})
