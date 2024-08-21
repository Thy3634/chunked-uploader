import { ofetch } from 'ofetch'
import type { FetchOptions, $Fetch, ResponseType } from 'ofetch'
import { defu } from 'defu'
import { md5, createMD5 } from 'hash-wasm'

/**
 * ChunkedUploader is a class that facilitates uploading files in chunks.
 * It provides methods to start, pause, resume, and abort the upload.
 * The class also emits events to notify the progress and status of the upload.
 *
 * @template T - The type of the response data of chunk. https://github.com/unjs/ofetch?tab=readme-ov-file#%EF%B8%8F-type-friendly
 */
export class ChunkedUploader<T = any, R extends ResponseType = 'json'> extends EventTarget {
    #fileInfo: FileInfo

    #requestInfo: RequestInfo | ((chunk: Chunk, fileInfo: FileInfo) => RequestInfo)
    #abortController: AbortController = new AbortController()
    #requestOptions

    #total: number = 1
    /** The number of chunks */
    get total() { return this.#total }
    #loaded: number = 0
    /** The number of chunks that have been uploaded */
    get loaded() { return this.#loaded }

    #chunks: Chunk[]
    /** An array of chunks that make up the file */
    get chunks() { return this.#chunks }

    #hash: Promise<string>
    /** A promise that resolves to the MD5 hash (hex) of the file's data */
    get hash() { return this.#hash }

    #status: 'pending' | 'success' | 'idle' | 'error' | 'paused' = 'idle'
    /** The current status of the upload */
    get status() { return this.#status }
    #error?: Error
    /** The error that occurred while uploading */
    get error() { return this.#error }

    #onLine: boolean
    /** Is network online. 
     * - When it is set to `false`, the upload will be paused. When it is set to `true`, the upload will be resumed. 
     * - If `window` is available, automatically update, and pause/resume the upload.
     * @default If `navigator` is available, use the value of `navigator.onLine`, otherwise  `true`.
     */
    get onLine() { return this.#onLine }
    set onLine(value) {
        this.#onLine = value
        if (value && this.#status === 'paused') {
            this.resume()
        } else if (!value && this.#status === 'pending') {
            this.pause()
        }
    }

    /**
     * @param file 
     * @param requestInfo 
     * @param options 
     */
    constructor(file: File, requestInfo: RequestInfo | ((chunk: Chunk, fileInfo: FileInfo) => RequestInfo), requestOptions?: RequestOptions<R>) {
        super()
        this.#fileInfo = { name: file.name, size: file.size, lastModified: file.lastModified }
        Object.defineProperties(this.#fileInfo, {
            name: { writable: false, enumerable: true },
            size: { writable: false, enumerable: true },
            lastModified: { writable: false, enumerable: true }
        })
        this.#requestInfo = requestInfo
        this.#requestOptions = defu(requestOptions, {
            method: 'POST',
            signal: this.#abortController.signal,
            chunkSize: 1024 * 1024 * 5,
            instance: ofetch,
            retry: 3,
            retryDelay: 3000,
            body: (chunk: Chunk) => chunk.blob,
            headers: async (chunk: Chunk) => ({
                'Range': `bytes=${chunk.start}-${chunk.end - 1}`,
                'Content-Digest': `md5=:${hexStringToBase64(await chunk.blob.arrayBuffer().then(buffer => md5(new Uint8Array(buffer))))}:`
            }) as HeadersInit
        })

        this.#total = Math.ceil(file.size / this.#requestOptions.chunkSize)
        this.#chunks = Array.from({ length: this.#total }, (_, index) => {
            const start = index * this.#requestOptions.chunkSize
            const end = Math.min(start + this.#requestOptions.chunkSize, file.size)
            const blob = file.slice(start, end)
            return { index, blob, start, end, status: 'idle' }
        })

        this.#hash = createMD5().then(async (hasher) => {
            for (const chunk of this.#chunks) {
                hasher = hasher.update(new Uint8Array(await chunk.blob.arrayBuffer()))
            }
            return hasher.digest()
        })

        this.#onLine = typeof navigator === 'undefined' ? true : navigator.onLine

        if (typeof window !== 'undefined') {
            window.addEventListener('online', this.#ononline)
            window.addEventListener('offline', this.#onoffline)
        }
    }

    static fromChunks<T = any, R extends ResponseType = 'json'>(chunks: Chunk[], fileInfo: FileInfo, requestInfo: RequestInfo | ((chunk: Chunk, fileInfo: FileInfo) => RequestInfo), requestOptions?: RequestOptions<R>) {
        const uploader = new ChunkedUploader<T, R>(new File(chunks.map(chunk => chunk.blob), fileInfo.name, fileInfo), requestInfo, requestOptions)
        uploader.#chunks = chunks
        return uploader
    }

    /**
     * abort the upload, if it is not uploading, do nothing
     * - property `status` will be set to 'error'
     * - event `abort` will be dispatched
     * - property `error` will be set to an `Error` named 'AbortError'
     */
    abort() {
        if (this.#status !== 'pending') return
        this.#abortController.abort()
    }

    /**
     * start the upload, if the upload is already started, do nothing
     * - property `status` will be set to 'pending'
     * - event `start` will be dispatched
     * - if `onLine` is false, pause
     */
    async start() {
        if (this.#status !== 'idle') return
        return await this.#uploadChunks()
    }

    async #uploadChunks() {
        if (this.onLine === false) {
            this.#error = new Error('offline')
            this.#error.name = 'OfflineError'
            this.#status = 'paused'
            this.#dispatchEventByType('pause')
            return
        }
        try {
            this.#status = 'pending'
            const response = await Promise.all(this.#chunks.map(chunk => this.#uploadChunk(chunk)))
            this.#status = 'success'
            this.#dispatchEventByType('success')
            return response
        } catch (error_) {
            if (this.#status === 'paused') return
            this.#error = (error_ instanceof Error) ? error_ : new Error('Unknown error', { cause: error_ })
            this.#status = 'error'
            if (error_ instanceof Error && error_.name === 'AbortError') {
                this.#dispatchEventByType('abort')
            } else {
                this.#dispatchEventByType('error')
            }
        } finally {
            if (this.#status !== 'paused')
                this.#dispatchEventByType('end')
        }
    }

    async #uploadChunk(chunk: Chunk) {
        if (chunk.status !== 'idle') return
        chunk.status = 'pending'
        try {
            const response = this.#requestOptions.instance<T, R>(this.#requestInfo instanceof Function ? this.#requestInfo(chunk, this.#fileInfo) : this.#requestInfo, {
                ...this.#requestOptions,
                body: await this.#requestOptions.body(chunk, this.#fileInfo),
                headers: this.#requestOptions.headers instanceof Function ? await this.#requestOptions.headers(chunk, this.#fileInfo) : this.#requestOptions.headers
            })
            chunk.status = 'seccess'
            this.#loaded++
            this.#dispatchEventByType('progress')
            return response
        } catch (error) {
            chunk.status = 'idle'
            throw error
        }
    }

    /**
     * pause the upload, if it is not uploading, do nothing, otherwise:
     * - property `status` will be set to 'paused'
     * - method `abort` will be called
     * - event `pause` will be dispatched
     * @returns if the upload is paused
     */
    pause() {
        if (this.#status !== 'pending') return false
        this.#status = 'paused'
        this.#dispatchEventByType('pause')
        this.abort()
        return true
    }

    /**
     * resume the upload, if it is not paused, do nothing, otherwise:
     * - property `status` will be set to 'pending'
     * - event `resume` will be dispatched
     * @returns if the upload is paused, return the response array of chunks upload, otherwise return false
     */
    async resume() {
        if (this.#status !== 'paused') return false
        this.#dispatchEventByType('resume')
        return await this.#uploadChunks()
    }

    #ononline(_e: Event) {
        this.onLine = true
    }

    #onoffline(_e: Event) {
        this.onLine = false
    }

    addEventListener(type: ChunkedUploaderEventType, callback: ChunkedUploaderEventListener | { handleEvent: ChunkedUploaderEventListener } | null, options?: AddEventListenerOptions | boolean): void {
        super.addEventListener(type, callback as EventListenerOrEventListenerObject, options)
    }

    removeEventListener(type: ChunkedUploaderEventType, callback: ChunkedUploaderEventListener | { handleEvent: ChunkedUploaderEventListener } | null, options?: EventListenerOptions | boolean): void {
        super.removeEventListener(type, callback as EventListenerOrEventListenerObject, options)
    }

    /** Fired when the upload has started */
    onstart?: ChunkedUploaderEventListener = undefined
    /** Fired when an error occurs during the upload */
    onerror?: ChunkedUploaderEventListener = undefined
    /** Fired periodically as any chunk uploaded */
    onprogress?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has been aborted: for instance because the program called `ChunkedUploader.abort()`. */
    onabort?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has been successfully completed */
    onsuccess?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has completed, successfully or not. */
    onend?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has been paused: for instance because the program called `ChunkedUploader.pause()` */
    onpause?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has been resumed: for instance because the program called `ChunkedUploader.resume()` */
    onresume?: ChunkedUploaderEventListener = undefined

    dispatchEvent(event: ChunkedUploaderEvent<T, R>): boolean {
        const method = `on${event.type}` as `on${ChunkedUploaderEventType}`
        if (typeof this[method] === 'function')
            this[method](event)
        return super.dispatchEvent(event)
    }

    #dispatchEventByType(type: ChunkedUploaderEventType) {
        const event = new ChunkedUploaderEvent<T, R>(type, this)
        this.dispatchEvent(event)
    }
}

class ChunkedUploaderEvent<T = any, R extends ResponseType = 'json'> extends Event {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/lengthComputable) */
    readonly lengthComputable: boolean = true
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/loaded) */
    readonly loaded: number
    readonly target: ChunkedUploader<T, R>
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/total) */
    readonly total: number

    constructor(type: ChunkedUploaderEventType, target: ChunkedUploader<T, R>, eventInitDict?: EventInit) {
        super(type, eventInitDict)
        this.target = target
        this.total = target.total
        this.loaded = target.loaded
    }
}

interface ChunkedUploaderEventListener<T = any, R extends ResponseType = ResponseType> {
    (event: ChunkedUploaderEvent<T, R>): void
}

type ChunkedUploaderEventType = 'progress' | 'success' | 'error' | 'abort' | 'start' | 'end' | 'pause' | 'resume'

/**
 * Based on the {@link FetchOptions} type from the `ofetch` library, with some additional properties.
 * @see https://github.com/unjs/ofetch
 * @template R - The expected response type.
 */
type RequestOptions<R extends ResponseType = ResponseType> = Omit<FetchOptions<R>, 'body'> & {
    /** A string to set request's method.
     * @default 'POST'
     */
    method?: string;
    /**
     * 
     * @param chunk chunk, including index, blob, start, end, status, hash
     * @param fileInfo file info, including name, size, lastModified
     * @returns 
     * @default (chunk) => chunk.blob
     */
    body?: (chunk: Chunk, fileInfo: FileInfo) => RequestInit["body"] | Record<string, any> | Promise<RequestInit["body"] | Record<string, any>>
    /** The size of each chunk in bytes.
     * @default 1024 * 1024 * 5
     */
    chunkSize?: number
    /**
     * The ofetch instance to use for making requests.
     * @default ofetch
     */
    instance?: $Fetch
    /**
     * The number of times to retry a request if it fails.
     * @default 3
     */
    retry?: number
    /**
     * The delay in milliseconds between retries.
     * @default 3000
     */
    retryDelay?: number
    /**
     * @link [Range](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range) [Content-Digest](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Digest)
     * @default (chunk) => { 'Range': `bytes=${chunk.start}-${chunk.end - 1}`, 'Content-Digest': `md5=:${base64md5hash}:` }
     * 
     */
    headers?: HeadersInit | ((chunk: Chunk, fileInfo: FileInfo) => HeadersInit | Promise<HeadersInit>)
}

/**
 * Represents a chunk of a file that is being uploaded.
 *
 * @remarks
 * A chunk is a subset of the file data, identified by its index, start and end positions.
 */
interface Chunk {
    /** The index of the chunk in the sequence of chunks that make up the file. */
    index: number
    /** A new `Blob` object which contains data from a subset of the file */
    blob: Blob
    /** An index into the file indicating the first byte to include in the blob. */
    start: number
    /** An index into the file indicating the first byte that will not be included in the blob (i.e. the byte exactly at this index is not included). */
    end: number
    /** The uploading status of this chunk. when error occurred, reset to 'idle' */
    status: 'pending' | 'seccess' | 'idle'
}

type FileInfo = Pick<File, 'name' | 'size' | 'lastModified'>

function hexStringToBase64(hexString: string) {
    return btoa(hexString.match(/\w{2}/g)!.map(byte => String.fromCodePoint(Number.parseInt(byte, 16))).join(''))
}
