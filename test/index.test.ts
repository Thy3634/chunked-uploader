import { describe, beforeAll, afterAll, it, expect } from "vitest"
import { listen, Listener } from "listhen"
import { joinURL } from "ufo"
import {
    assertMethod,
    createApp,
    createError,
    eventHandler,
    getHeaders,
    getRouterParams,
    readBody,
    readRawBody,
    setHeader,
    toNodeListener,
} from "h3"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from 'node:url'
import { resolve, dirname, extname } from "node:path"
import { randomUUID } from "node:crypto"
import { existsSync, openAsBlob, createWriteStream, WriteStream } from "node:fs"

import { ofetch } from "ofetch"
import { ChunkedUploader } from '../src'
import { md5 } from "hash-wasm"

describe('chunked uploader', { timeout: 20_000 }, () => {
    let listener: Listener;
    const getURL = (url: string) => joinURL(listener.url, url);

    const location = dirname(fileURLToPath(import.meta.url))

    beforeAll(async () => {
        const writeStreamPool = new Map<string, WriteStream>()

        const app = createApp()
            .use(
                "/chunked-upload",
                eventHandler(async (event) => {
                    assertMethod(event, 'POST')
                    const body = await readBody(event)
                    console.assert(body?.chunkSize === 1024 * 1024 * 5)
                    console.assert(typeof body?.fileSize === 'number')
                    console.assert(typeof body?.filename === 'string')
                    const id = randomUUID()
                    setHeader(event, 'ETag', id)
                    if (!existsSync(resolve(location, '.temp', id)))
                        await mkdir(resolve(location, '.temp', id), { recursive: true })
                    const confPath = resolve(location, '.temp', id, 'conf.json')
                    await writeFile(confPath, JSON.stringify(body), { encoding: 'utf8', flag: 'w' })
                    return { id }
                })
            )
            .use(
                "/chunked-upload-existed",
                eventHandler(async (event) => {
                    assertMethod(event, 'POST')
                    const body = await readBody(event)
                    console.assert(body?.chunkSize === 1024 * 1024 * 5)
                    console.assert(typeof body?.fileSize === 'number')
                    console.assert(typeof body?.hash === 'string')
                    const id = randomUUID()
                    setHeader(event, 'ETag', id)
                    const chunkLength = Math.ceil(body.fileSize / body.chunkSize)
                    return { id, chunkLength, chunkLoaded: chunkLength }
                })
            )
            .use(
                "/chunked-upload/[id]/[i]",
                eventHandler(async (event) => {
                    const { id } = getRouterParams(event)
                    const confPath = resolve(location, '.temp', id, 'conf.json')
                    console.log(id)
                    if (existsSync(confPath)) {
                        const { chunkSize, filename, fileSize } = JSON.parse(await readFile(confPath, 'utf8'))
                        const { range, "Content-Digest": contentDigest } = getHeaders(event)
                        const rangeExp = /^bytes=(\d+)-(\d+)$/
                        expect(range).toMatch(rangeExp)
                        const contentDigestExp = /^md5=:(\s+)$/
                        expect(contentDigest).toMatch(contentDigestExp)
                        const [start, end] = rangeExp.exec(range!)!.map((it) => Number.parseInt(it))
                        const chunk = (await readRawBody(event, false))!
                        expect(chunkSize).toBe(end + 1 - start)
                        expect(md5(chunk)).toBe(contentDigestExp.exec(contentDigest!)![1])

                        const ws = writeStreamPool.get(id) ?? createWriteStream(resolve(location, '.temp', `${id}${extname(filename)}`), {
                            start,
                            flags: 'w',
                            encoding: 'binary'
                        })
                        writeStreamPool.set(id, ws)
                        console.log(ws)
                        if (ws.writableNeedDrain)
                            await new Promise((resolve) => ws.once('drain', resolve))
                        await new Promise<void>((resolve, reject) => {
                            ws.write(chunk, (error) => {
                                if (error) reject(error)
                                else resolve()
                            })
                        })
                        if (ws.bytesWritten >= fileSize) {
                            await new Promise<void>((resolve, reject) => {
                                ws.end(() => ws.close((err) => {
                                    if (err) reject(err)
                                    else resolve()
                                }))
                            })
                            writeStreamPool.delete(id)
                        }
                    } else {
                        createError({ status: 404 })
                    }
                })
            )
            .use(
                "/chunked-upload-timeout/[id]/[i]",
                eventHandler(() => {
                    createError({ status: 408 })
                })
            )

        listener = await listen(toNodeListener(app))
    })

    afterAll(() => {
        listener.close().catch(console.error);
    })

    it('ok', async () => {
        const file = new File([await openAsBlob(resolve(location, 'test.jpg'))], 'test.jpg')
        // init
        const { id } = await ofetch(getURL('/chunked-upload'), {
            method: 'POST',
            body: {
                chunkSize: 1024 * 1024 * 5,
                fileSize: file.size,
                filename: file.name
            }
        })
        const uploader = new ChunkedUploader(file, ({ index }) => getURL(`/chunked-upload/${id}/${index}`))

        uploader.onerror = console.error

        const responseList = await uploader.start()
        expect(responseList?.length === Math.ceil(file.size / 1024 / 1024 / 5)).toBeTruthy()
    })
})
