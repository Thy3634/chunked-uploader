import { defu } from 'defu'
import { createMD5 } from 'hash-wasm'
import pLimit from 'p-limit'

/**
 * ChunkedUploader is a class that facilitates uploading files in chunks.
 * It provides methods to start, pause, resume, and abort the upload.
 * The class also emits events to notify the progress and status of the upload.
 */
export class ChunkedUploader extends EventTarget {
    fileInfo: FileInfo

    requester: Requester
    options

    #total: number = 1
    /** The number of chunks */
    get total() { return this.#total }
    #loaded: number = 0
    /** The number of chunks that have been uploaded */
    get loaded() { return this.#loaded }

    #chunks: Chunk[]
    /** An array of chunks that make up the file */
    get chunks() { return this.#chunks }

    #digest: Promise<string>
    /** A promise that resolves to the digest (hex) of the file's data */
    get digest() { return this.#digest }
    #hashLoaded = 0
    get hashProgress() {
        return this.#hashLoaded / this.#total
    }

    #status: 'pending' | 'success' | 'idle' | 'error' | 'paused' = 'idle'
    /** The current status of the upload process. */
    get status() { return this.#status }
    #error?: Error
    /** The error that occurred while uploading */
    get error() { return this.#error }

    #onLine: boolean
    /** Is network online. 
     * - When it is set to `false`, the upload will be paused. When it is set to `true`, the upload will be resumed. 
     * - If `addEventListener` is available, automatically update, and pause/resume the upload.
     * @default If `navigator` is available, use the value of `navigator.onLine`, otherwise `true`.
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
     * @param requester A function that returns response based on each chunk and file information
     * @param options Optional parameters to customize the uploader
     */
    constructor(file: File | FileInfo & { chunks: Array<Chunk> } | FileInfo & { buffer: ArrayBuffer | SharedArrayBuffer }, requester: Requester, options?: ChunkedUploaderOptions) {
        super()
        this.fileInfo = { name: file.name, size: file.size }
        this.requester = requester
        this.options = defu(options, {
            chunkSize: 1024 * 1024 * 5,
            createHasher: createMD5,
            limit: Infinity,
            abortController: new AbortController()
        })

        this.#total = Math.ceil(file.size / this.options.chunkSize)
        if (file instanceof File) {
            this.#chunks = Array.from({ length: this.#total }, (_, index) => {
                const start = index * this.options.chunkSize
                const end = Math.min(start + this.options.chunkSize, file.size)
                const buffer = file.slice(start, end).arrayBuffer()
                return {
                    index, buffer, start, end, status: 'idle', response: undefined,
                    digest: Promise.resolve(this.options.createHasher())
                        .then(async hasher => {
                            await hasher.init?.()
                            await hasher.update(new Uint8Array(await buffer))
                            return await hasher.digest()
                        })
                }
            })
        } else if ('buffer' in file) {
            this.#chunks = Array.from({ length: this.#total }, (_, index) => {
                const start = index * this.options.chunkSize
                const end = Math.min(start + this.options.chunkSize, file.size)
                const buffer = file.buffer.slice(start, end)
                return {
                    index, buffer, start, end, status: 'idle', response: undefined,
                    digest: new Promise((resolve) => {
                        const hasher = this.options.createHasher() as Hasher
                        hasher.init?.()
                        hasher.update(new Uint8Array(buffer))
                        resolve(hasher.digest())
                    })
                    // digest: Promise.resolve(this.options.createHasher())
                    //     .then(async hasher => {
                    //         await hasher.init?.()
                    //         await hasher.update(new Uint8Array(buffer))
                    //         return await hasher.digest()
                    //     })
                }
            })
        } else {
            this.#chunks = file.chunks
            this.#total = file.chunks.length
            this.#loaded = file.chunks.filter(chunk => chunk.status === 'success').length
        }

        this.#digest = Promise.resolve(this.options.createHasher()).then(async hasher => {
            if (hasher.init) {
                await hasher.init()
                hasher.init = undefined
            }
            for (const chunk of this.#chunks) {
                await hasher.update(new Uint8Array(await chunk.buffer))
                this.#hashLoaded++
            }
            return await hasher.digest()
        })

        this.#onLine = typeof navigator === 'undefined' ? true : navigator.onLine

        if (typeof addEventListener === 'function') {
            addEventListener('online', this.#ononline)
            addEventListener('offline', this.#onoffline)
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
        this.options.abortController.abort()
        if (typeof removeEventListener !== 'undefined') {
            removeEventListener('online', this.#ononline)
            removeEventListener('offline', this.#onoffline)
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
            if (Number.isFinite(this.options.limit)) {
                const limit = pLimit(this.options.limit)
                response = await Promise.all(this.#chunks.map(chunk => limit(() => this.#uploadChunk(chunk))))
            } else {
                response = await Promise.all(this.#chunks.map(chunk => this.#uploadChunk(chunk)))
            }
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

    async #uploadChunk(chunk: Chunk) {
        if (chunk.status === 'success') {
            this.#loaded++
            this.#dispatchEventByType('progress')
            return chunk.response
        }
        chunk.status = 'pending'
        try {
            chunk.response = await this.requester(chunk, this.fileInfo)
            chunk.status = 'success'
            this.#loaded++
            this.#dispatchEventByType('progress')
            return chunk.response
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
    /** Fired when the upload has been successfully completed */
    onsuccess?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has completed, successfully or not. */
    onend?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has been paused: for instance because the program called `ChunkedUploader.pause()` */
    onpause?: ChunkedUploaderEventListener = undefined
    /** Fired when the upload has been resumed: for instance because the program called `ChunkedUploader.resume()` */
    onresume?: ChunkedUploaderEventListener = undefined

    dispatchEvent(event: ChunkedUploaderEvent): boolean {
        const method = `on${event.type}` as `on${ChunkedUploaderEventType}`
        if (typeof this[method] === 'function')
            this[method](event)
        return super.dispatchEvent(event)
    }

    #dispatchEventByType(type: ChunkedUploaderEventType) {
        const event = new ChunkedUploaderEvent(type, this)
        this.dispatchEvent(event)
    }

    /**
     * Get the file information and chunks so that you can store them and reconstruct the uploader later.
     */
    async store() {
        return {
            ...this.fileInfo,
            chunks: await Promise.all<Chunk>(this.#chunks.map(async chunk => ({
                ...chunk,
                buffer: await chunk.buffer,
                status: chunk.status === 'success' ? 'success' : 'idle',
                digest: await chunk.digest
            }))),
        }
    }

    /**
     * remove online/offline event listeners
     */
    destroy() {
        if (typeof removeEventListener === 'function') {
            removeEventListener('online', this.#ononline)
            removeEventListener('offline', this.#onoffline)
        }
    }
}

class ChunkedUploaderEvent extends Event {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/lengthComputable) */
    readonly lengthComputable: boolean = true
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/loaded) */
    readonly loaded: number
    readonly target: ChunkedUploader
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/total) */
    readonly total: number

    constructor(type: ChunkedUploaderEventType, target: ChunkedUploader, eventInitDict?: EventInit) {
        super(type, eventInitDict)
        this.target = target
        this.total = target.total
        this.loaded = target.loaded
    }
}

interface ChunkedUploaderEventListener {
    (event: ChunkedUploaderEvent): void
}

type ChunkedUploaderEventType = 'progress' | 'success' | 'error' | 'start' | 'end' | 'pause' | 'resume'

type ChunkedUploaderOptions = {
    /** The size of each chunk in bytes.
     * @default 5 * 1024 * 1024 (5MB)
     */
    chunkSize?: number
    /** 
     * The hasher to use for calculating the hash of the file's data.
     * @link [hash-wasm](https://github.com/Daninet/hash-wasm)
     * @default `createMD5`
     */
    createHasher?: CreateHasher | null
    /** The number of request concurrency limit. */
    limit?: number
    /** @default `new AbortController()` */
    abortController?: AbortController
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
    /** The data from a subset of the file as an `ArrayBuffer`. */
    buffer: Promise<ArrayBuffer> | ArrayBuffer
    /** An index into the file indicating the first byte to include in the buffer. */
    start: number
    /** An index into the file indicating the first byte that will not be included in the buffer (i.e. the byte exactly at this index is not included). */
    end: number
    /** The uploading status of this chunk. when error occurred, reset to 'idle' */
    status: 'pending' | 'success' | 'idle'
    /** Response of chunk upload */
    response?: unknown
    /** Digest as a hexadecimal string */
    digest: Promise<string> | string
}

type FileInfo = Pick<File, 'name' | 'size'>

interface Hasher {
    init?: () => any
    update: (data: Uint8Array | Uint16Array | Uint32Array | string) => any
    digest: (outputType?: any) => string | Promise<string>
}

interface CreateHasher {
    (): Promise<Hasher> | Hasher
}

type Requester = (chunk: Chunk, fileInfo: FileInfo) => Promise<unknown>
