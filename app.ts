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
    fileSize: number,
    filename: string
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

const storage = createStorage<Conf>({
    driver: fsDriver({ base: "./.temp/storage" }),
})

export const router = createRouter()
    .post(
        "/chunked-upload",
        eventHandler(async (event) => {
            const body = await readBody<Conf>(event)
            console.assert(typeof body.fileSize === 'number', 'fileSize')
            console.assert(typeof body.filename === 'string', 'filename')
            const id = crypto.randomUUID()
            setHeader(event, 'ETag', id)
            await storage.set(id, body)
            return { id }
        })
    )
    .put(
        "/chunked-upload/:id/:i",
        eventHandler(async (event) => {
            const { id, i } = getRouterParams(event)
            const conf = await storage.get(id) as Conf | null
            if (!conf)
                throw createError({ status: 400 })

            const { filename } = conf
            const range = getHeader(event, 'Range')
            const contentDigest = getHeader(event, 'Content-Digest')
            const rangeExp = /^bytes=(\d+)-(\d+)$/
            const contentDigestExp = /^md5=:(.+):$/
            const [_, start] = rangeExp.exec(range!)!.map((it) => Number.parseInt(it))
            const chunk = getHeader(event, 'Content-Type')?.includes('multipart/form-data') ? new Uint8Array(await ((await readFormData(event)).get('file') as File).arrayBuffer()) : await readRawBody(event, false) as Buffer
            console.assert(hexStringToBase64(await md5(chunk)) === contentDigestExp.exec(contentDigest!)![1], 'hash mismatch')

            const path = resolve('.temp', `${id}${extname(filename)}`)
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
            return { index: i }
        })
    )

app.use(router)

