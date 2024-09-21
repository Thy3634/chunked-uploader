import { createMD5 } from 'hash-wasm'

const hasherPromise = createMD5()

onmessage = async (event: MessageEvent<{ type: 'update', data: ArrayBuffer | Uint8Array } | { type: 'digest' } | { type: 'init' }>) => {
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
            const hash = hasher.digest()
            postMessage({ type: data.type, hash })
            break
        }
        default: {
            throw new Error('Unknown type')
        }
    }
}