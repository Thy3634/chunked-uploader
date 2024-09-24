import { createMD5 } from 'hash-wasm'

const workerSelf = self as unknown as DedicatedWorkerGlobalScope

const hasherPromise = createMD5()

workerSelf.addEventListener('message', async (event: MessageEvent<{ type: 'update', data: ArrayBuffer | Uint8Array } | { type: 'digest' } | { type: 'init' }>) => {
    const data = event.data
    const hasher = await hasherPromise
    switch (data.type) {
        case 'init': {
            hasher.init()
            break
        }
        case 'update': {
            hasher.update(data.data as Uint8Array)
            break
        }
        case 'digest': {
            const digest = hasher.digest()
            postMessage({ type: data.type, digest })
            break
        }
        default: {
            throw new Error('Unknown type')
        }
    }
})
