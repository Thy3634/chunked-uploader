import { createMD5 } from 'hash-wasm'

const hasherPromise = createMD5()
let count = 0

onmessage = async (event: MessageEvent<{ type: 'update', data: ArrayBuffer | Uint8Array } | { type: 'digest' } | { type: 'init' }>) => {
    postMessage({ type: 'log', time: performance.now() })
    const data = event.data
    const hasher = await hasherPromise
    switch (data.type) {
        case 'init': {
            hasher.init()
            postMessage({ type: data.type })
            break
        }
        case 'update': {
            hasher.update(data.data as Uint8Array)
            postMessage({ type: data.type, count })
            count++
            break
        }
        case 'digest': {
            const hash = hasher.digest()
            postMessage({ type: data.type, hash, count })
            break
        }
        default: {
            throw new Error('Unknown type')
        }
    }
}