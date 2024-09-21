import { ofetch } from 'ofetch'
import type { FetchOptions, $Fetch, ResponseType, MappedResponseType } from 'ofetch'
import { defu } from 'defu'
import { createMD5 } from 'hash-wasm'
import pLimit from 'p-limit'

/**
 * ChunkedUploader is a class that facilitates uploading files in chunks.
 * It provides methods to start, pause, resume, and abort the upload.
 * The class also emits events to notify the progress and status of the upload.
 *
 * @template T - The type of the response data of chunk. https://github.com/unjs/ofetch?tab=readme-ov-file#%EF%B8%8F-type-friendly
 */
export class ChunkedUploader<T = any, R extends ResponseType = 'json'> extends EventTarget {
    #fileInfo: FileInfo

    #requestInfo: RequestInfo | ((chunk: Chunk<T, R>, fileInfo: FileInfo) => RequestInfo)
    #abortController: AbortController = new AbortController()
    #requestOptions

    #total: number = 1
    /** The number of chunks */
    get total() { return this.#total }
    #loaded: number = 0
    /** The number of chunks that have been uploaded */
    get loaded() { return this.#loaded }

    #chunks: Chunk<T, R>[]
    /** An array of chunks that make up the file */
    get chunks() { return this.#chunks }

    #hash: Promise<string>
    /** A promise that resolves to the hash (hex) of the file's data */
    get hash() { return this.#hash }
    #hashLimit

    #status: 'pending' | 'success' | 'idle' | 'error' | 'paused' = 'idle'
    /** The current status of the upload process. */
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
     * @param file The file to upload, or an object containing the file's information and an array of chunks
     * @param requestInfo Request information, or a function that returns request information based on the chunk and file information
     * @param options Based on the FetchOptions type from the ofetch library, with some additional properties.
     */
    constructor(file: File | FileInfo & { chunks: Chunk<T, R>[] } | FileInfo & { arrayBuffer: ArrayBuffer | SharedArrayBuffer }, requestInfo: RequestInfo | ((chunk: Chunk<T, R>, fileInfo: FileInfo) => RequestInfo), requestOptions?: RequestOptions<T, R>) {
        super()
        this.#fileInfo = { name: file.name, size: file.size, lastModified: file.lastModified, type: file.type }
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
            hashCreater: function md5() { return createMD5() },
            body: (chunk: Chunk<T, R>) => chunk.blob,
            headers: async (chunk: Chunk<T, R>) => {
                const headers = new Headers()
                if (!requestOptions?.body)
                    headers.set('Content-Type', 'application/octet-stream')
                headers.set('Range', `bytes=${chunk.start}-${chunk.end - 1}`)
                if (this.#requestOptions.hashCreater?.name && await chunk.hash) {
                    headers.set('Content-Digest', `${this.#requestOptions.hashCreater.name}=:${hexStringToBase64(await chunk.hash!)}:`)
                }
                return headers
            },
            limit: Infinity,
            hashConcurrency: typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency
        })
        this.#hashLimit = pLimit(this.#requestOptions.hashConcurrency)

        this.#total = Math.ceil(file.size / this.#requestOptions.chunkSize)
        if (file instanceof File) {
            this.#chunks = Array.from({ length: this.#total }, (_, index) => {
                const start = index * this.#requestOptions.chunkSize
                const end = Math.min(start + this.#requestOptions.chunkSize, file.size)
                const blob = file.slice(start, end)
                return {
                    index, blob, start, end, status: 'idle', response: undefined, hash: this.#requestOptions.hashCreater ? this.#hashLimit(async () => {
                        const buffer = await blob.arrayBuffer()
                        const hasher = await this.#requestOptions.hashCreater!()
                        await hasher.init?.()
                        await hasher.update(new Uint8Array(buffer))
                        return await hasher.digest()
                    }) : undefined
                }
            })
        } else if ('arrayBuffer' in file) {
            this.#chunks = Array.from({ length: this.#total }, (_, index) => {
                const start = index * this.#requestOptions.chunkSize
                const end = Math.min(start + this.#requestOptions.chunkSize, file.size)
                const buffer = file.arrayBuffer.slice(start, end)
                const blob = new Blob([buffer], { type: file.type })
                let hash: Promise<string> | undefined
                if (this.#requestOptions.hashCreater) {
                    hash = this.#hashLimit(async () => {
                        const hasher = await this.#requestOptions.hashCreater()
                        await hasher.init?.()
                        await hasher.update(new Uint8Array(buffer))
                        return await hasher.digest()
                    })
                }
                return {
                    index, blob, start, end, status: 'idle', response: undefined, hash
                }
            })
        } else {
            this.#chunks = file.chunks
            this.#total = file.chunks.length
            this.#loaded = file.chunks.filter(chunk => chunk.status === 'success').length
        }

        this.#hash = this.#requestOptions.hashCreater ? this.#hashLimit(async () => {
            const hasher = await this.#requestOptions.hashCreater()
            if (hasher.init) {
                await hasher.init()
                hasher.init = undefined
            }
            // @ts-ignore
            for (const chunk of this.#chunks) {
                await hasher.update(new Uint8Array(await chunk.blob.arrayBuffer()))
            }
            return await hasher.digest()
        }) : undefined as never

        this.#onLine = typeof navigator === 'undefined' ? true : navigator.onLine

        if (typeof window !== 'undefined') {
            window.addEventListener('online', this.#ononline)
            window.addEventListener('offline', this.#onoffline)
        }
    }

    /**
     * Abort the upload, if it is not uploading, do nothing, otherwise:
     * - property `status` will be set to 'error'
     * - event `abort` will be dispatched
     * - property `error` will be set to an `Error`
     * @returns if the upload is aborted
     */
    abort() {
        if (this.#status !== 'pending') return false
        this.#abortController.abort()
        if (typeof window !== 'undefined') {
            window.removeEventListener('online', this.#ononline)
            window.removeEventListener('offline', this.#onoffline)
        }
        return true
    }

    /**
     * Start the upload, if the upload is already started, do nothing, otherwise:
     * - property `status` will be set to 'pending'
     * - event `start` will be dispatched
     * - if `onLine` is false, pause
     * @param skipIndexes indexes of chunks to skip
     */
    async start(skipIndexes?: Iterable<number>) {
        if (this.#status !== 'idle') return
        for (const i of new Set(skipIndexes)) {
            if (this.#chunks[i]) this.#chunks[i].status = 'success'
        }
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
            let response
            if (Number.isFinite(this.#requestOptions.limit)) {
                const limit = pLimit(this.#requestOptions.limit)
                response = await Promise.all(this.#chunks.map(chunk => limit(() => this.#uploadChunk(chunk))))
            }
            response = await Promise.all(this.#chunks.map(chunk => this.#uploadChunk(chunk)))
            this.#status = 'success'
            this.#dispatchEventByType('success')
            return response
        } catch (error_) {
            if (this.#status === 'paused') return
            this.#error = (error_ instanceof Error) ? error_ : new Error('Unknown error', { cause: error_ })
            this.#status = 'error'
            this.#dispatchEventByType('error')
        } finally {
            if (this.#status !== 'paused')
                this.#dispatchEventByType('end')
        }
    }

    async #uploadChunk(chunk: Chunk<T, R>) {
        if (chunk.status === 'success') {
            this.#loaded++
            this.#dispatchEventByType('progress')
            return chunk.response
        }
        chunk.status = 'pending'
        try {
            const response = this.#requestOptions.instance<T, R>(this.#requestInfo instanceof Function ? this.#requestInfo(chunk, this.#fileInfo) : this.#requestInfo, {
                ...this.#requestOptions,
                body: await this.#requestOptions.body(chunk, this.#fileInfo),
                headers: this.#requestOptions.headers instanceof Function ? await this.#requestOptions.headers(chunk, this.#fileInfo) : this.#requestOptions.headers
            })
            chunk.status = 'success'
            chunk.response = response
            this.#loaded++
            this.#dispatchEventByType('progress')
            return response
        } catch (error) {
            chunk.status = 'idle'
            throw error
        }
    }

    /**
     * Pause the upload, if it is not uploading, do nothing, otherwise:
     * - property `status` will be set to 'paused'
     * - method `abort` will be called
     * - event `pause` will be dispatched
     * @returns if the upload is paused
     */
    pause() {
        if (this.#status !== 'pending') return false
        this.#status = 'paused'
        this.abort()
        this.#dispatchEventByType('pause')
        return true
    }

    /**
     * Resume the upload, if it is not paused, do nothing, otherwise:
     * - property `status` will be set to 'pending'
     * - event `resume` will be dispatched
     * @returns if the upload is paused, return the response array of chunks upload, otherwise return false
     */
    async resume() {
        if (this.#status !== 'paused') return false
        this.#error = undefined
        this.#dispatchEventByType('resume')
        return await this.#uploadChunks()
    }

    #ononline = (_e: Event) => { this.onLine = true }

    #onoffline = (_e: Event) => { this.onLine = false }

    addEventListener(type: ChunkedUploaderEventType, callback: ChunkedUploaderEventListener<T, R> | { handleEvent: ChunkedUploaderEventListener<T, R> } | null, options?: AddEventListenerOptions | boolean): void {
        super.addEventListener(type, callback as EventListenerOrEventListenerObject, options)
    }

    removeEventListener(type: ChunkedUploaderEventType, callback: ChunkedUploaderEventListener<T, R> | { handleEvent: ChunkedUploaderEventListener<T, R> } | null, options?: EventListenerOptions | boolean): void {
        super.removeEventListener(type, callback as EventListenerOrEventListenerObject, options)
    }

    /** Fired when the upload has started */
    onstart?: ChunkedUploaderEventListener<T, R> = undefined
    /** Fired when an error occurs during the upload */
    onerror?: ChunkedUploaderEventListener<T, R> = undefined
    /** Fired periodically as any chunk uploaded */
    onprogress?: ChunkedUploaderEventListener<T, R> = undefined
    /** Fired when the upload has been successfully completed */
    onsuccess?: ChunkedUploaderEventListener<T, R> = undefined
    /** Fired when the upload has completed, successfully or not. */
    onend?: ChunkedUploaderEventListener<T, R> = undefined
    /** Fired when the upload has been paused: for instance because the program called `ChunkedUploader.pause()` */
    onpause?: ChunkedUploaderEventListener<T, R> = undefined
    /** Fired when the upload has been resumed: for instance because the program called `ChunkedUploader.resume()` */
    onresume?: ChunkedUploaderEventListener<T, R> = undefined

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

    /**
     * Get the file information and chunks so that you can store them and reconstruct the uploader later.
     */
    store() {
        return {
            ...this.#fileInfo,
            chunks: this.#chunks.map<Chunk>(chunk => ({ ...chunk, status: chunk.status === 'success' ? 'success' : 'idle', response: undefined })),
        }
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

type ChunkedUploaderEventType = 'progress' | 'success' | 'error' | 'start' | 'end' | 'pause' | 'resume'

/**
 * Based on the {@link FetchOptions} type from the `ofetch` library, with some additional properties.
 * @see https://github.com/unjs/ofetch
 * @template R - The expected response type.
 */
type RequestOptions<T = any, R extends ResponseType = ResponseType> = Omit<FetchOptions<R>, 'body' | 'headers'> & {
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
    body?: (chunk: Chunk<T, R>, fileInfo: FileInfo) => RequestInit["body"] | Record<string, any> | Promise<RequestInit["body"] | Record<string, any>>
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
     * @default (chunk) => { 'Content-Type': 'application/octet-stream', 'Range': `bytes=${chunk.start}-${chunk.end - 1}`, 'Content-Digest': `md5=:${base64md5(chunk.blob)}:` }
     */
    headers?: HeadersInit | ((chunk: Chunk<T, R>, fileInfo: FileInfo) => HeadersInit | Promise<HeadersInit>)
    /** 
     * The hasher to use for calculating the hash of the file's data.
     * @link [hash-wasm](https://github.com/Daninet/hash-wasm)
     * @default `createMD5`
     */
    hashCreater?: HasherCreater | null
    /** The number of request concurrency limit. */
    limit?: number
    /**
     * @experimental
     * The number of concurrency limit for hash calculation.
     * @default typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency
     */
    hashConcurrency?: number
}

/**
 * Represents a chunk of a file that is being uploaded.
 *
 * @remarks
 * A chunk is a subset of the file data, identified by its index, start and end positions.
 */
interface Chunk<T = any, R extends ResponseType = 'json'> {
    /** The index of the chunk in the sequence of chunks that make up the file. */
    index: number
    /** A new `Blob` object which contains data from a subset of the file */
    blob: Blob
    /** An index into the file indicating the first byte to include in the blob. */
    start: number
    /** An index into the file indicating the first byte that will not be included in the blob (i.e. the byte exactly at this index is not included). */
    end: number
    /** The uploading status of this chunk. when error occurred, reset to 'idle' */
    status: 'pending' | 'success' | 'idle'
    /** Response of chunk upload */
    response?: Promise<MappedResponseType<R, T>>
    /** hash as a hexadecimal string */
    hash?: Promise<string>
}

type FileInfo = Pick<File, 'name' | 'size' | 'lastModified' | 'type'>

interface Hasher {
    init?: () => void | Promise<void>
    update: (data: Uint8Array | Uint16Array | Uint32Array | string) => void | Promise<void>
    digest: (outputType?: any) => string | Promise<string>
}

interface HasherCreater {
    name?: string
    (): Promise<Hasher> | Hasher
}

function hexStringToBase64(hexString: string) {
    return btoa(hexString.match(/\w{2}/g)!.map(byte => String.fromCodePoint(Number.parseInt(byte, 16))).join(''))
}