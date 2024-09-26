import {
    createApp, createError, createRouter, eventHandler, fromNodeMiddleware,
    getHeader,
    getRouterParams,
    readBody,
    readFormData,
    readRawBody,
    setHeader,
} from 'h3'
import { createServer } from 'vite'
import { createStorage } from "unstorage"
import fsDriver from "unstorage/drivers/fs"
import { md5 } from 'hash-wasm'
import { writeFile } from 'node:fs/promises'
import { webcrypto as crypto } from 'node:crypto'
import { extname, resolve } from 'node:path'
import { createWriteStream, existsSync } from 'node:fs'
import { hexStringToBase64 } from './src/utils'

interface Conf {
    size: number
    name: string
    chunkSize?: number
}

export const app = createApp({
    debug: true,
})

async function useVite() {
    const vite = await createServer({
        server: { middlewareMode: true }
    })
    app.use(fromNodeMiddleware(vite.middlewares))
}
// eslint-disable-next-line unicorn/prefer-top-level-await
useVite()

const uploadSessionStorage = createStorage<Conf>({
    driver: fsDriver({ base: "./.temp/upload-session" }),
})

export const router = createRouter()
    .post(
        "/chunked-upload",
        eventHandler(async (event) => {
            const { size, name, chunkSize } = await readBody<Conf>(event)
            if (typeof size !== 'number') return createError({ status: 400, message: 'file size is not number' })
            // if (typeof chunkSize !== 'number') return createError({ status: 400, message: 'chunk size is not number' })

            const id = crypto.randomUUID()
            setHeader(event, 'ETag', id)
            await uploadSessionStorage.set(id, {
                size: size,
                name: name,
                chunkSize,
            })
            return { id }
        })
    )
    .put(
        "/chunked-upload/:id/:i",
        eventHandler(async (event) => {
            const { id, i } = getRouterParams(event)
            const index = Number.parseInt(i)
            const conf = await uploadSessionStorage.get<Conf>(id)
            if (!conf)
                throw createError({ status: 404, message: 'The upload session ID not found' })

            const range = getHeader(event, 'Range')!
            const contentDigest = getHeader(event, 'Content-Digest')!
            const rangeExp = /^bytes=(\d+)-(\d+)$/
            const contentDigestExp = /^md5=:(.+):$/
            const [_, start] = rangeExp.exec(range!)!.map((it) => Number.parseInt(it))
            const chunk = getHeader(event, 'Content-Type')?.includes('multipart/form-data') ? new Uint8Array(await ((await readFormData(event)).get('file') as File).arrayBuffer()) : await readRawBody(event, false) as Buffer
            console.assert(hexStringToBase64(await md5(chunk)) === contentDigestExp.exec(contentDigest!)![1], 'digest mismatch')

            const path = resolve('.temp', `${id}${extname(conf.name)}`)
            if (!existsSync(path))
                await writeFile(path, [])
            const ws = createWriteStream(path, {
                start,
                flags: 'r+',
                encoding: 'binary'
            })
            await new Promise<void>((resolve, reject) => {
                ws.write(chunk, (error) => {
                    if (error) reject(error)
                    else resolve()
                })
            })
            await new Promise<void>((resolve, reject) => {
                ws.close((err) => {
                    if (err) reject(err)
                    else resolve()
                })
            })

            return { index }
        })
    )

app.use(router)

