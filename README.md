# chunked-uploader

<!-- automd:badges color=yellow packagephobia -->

[![npm version](https://img.shields.io/npm/v/@thy3634/chunked-uploader?color=yellow)](https://npmjs.com/package/@thy3634/chunked-uploader)
[![npm downloads](https://img.shields.io/npm/dm/@thy3634/chunked-uploader?color=yellow)](https://npmjs.com/package/@thy3634/chunked-uploader)

<!-- /automd -->

Split file into chunks and upload. resumable, offline aware. Works on node, browser, and workers.

## Demo

A Master-Worker pattern to upload a file in chunks. A master worker to process file, split it into chunks and upload, Using several workers to calculate MD5 of chunk.

Include both backend and frontend.

[![StackBlitz](https://img.shields.io/badge/StackBlitz-Open%20Demo-blue?logo=stackblitz)](https://stackblitz.com/~/github.com/Thy3634/chunked-uploader)

Or git clone this repository and run `pnpm dev` to see the demo.

## Usage

Install package:

<!-- automd:pm-install -->

```sh
# ✨ Auto-detect
npx nypm install @thy3634/chunked-uploader

# npm
npm install @thy3634/chunked-uploader

# yarn
yarn add @thy3634/chunked-uploader

# pnpm
pnpm install @thy3634/chunked-uploader

# bun
bun install @thy3634/chunked-uploader
```

<!-- /automd -->

Import:

<!-- automd:jsimport cjs cdn imports="ChunkedUploader" -->

**ESM** (Node.js, Bun)

```js
import { ChunkedUploader } from "@thy3634/chunked-uploader";
```

**CommonJS** (Legacy Node.js)

```js
const { ChunkedUploader } = require("@thy3634/chunked-uploader");
```
> [conditional exports](https://nodejs.org/api/packages.html#packages_conditional_exports)

**CDN** (Deno, Bun and Browsers)

```js
import { ChunkedUploader } from "https://esm.sh/@thy3634/chunked-uploader";
```

<!-- /automd -->

1. Create a new instance of `ChunkedUploader`:

```js
// usually you need to get a upload ID from server
const { id } = await ofetch('/api/chunked-upload', {
    method: 'POST',
    body: {
        fileSize: file.size,
        filename: file.name
    }
})
// create a new instance of ChunkedUploader
const uploader = new ChunkedUploader(file, async ({ buffer, index, start, end, digest }) => ofetch(`/chunked-upload/${id}/${index}`, {
                method: 'PUT',
                body: await buffer,
                headers: {
                    'Range': `bytes=${start}-${end - 1}`,
                    'Content-Digest': `md5=:${hexStringToBase64(await digest)}:`,
                },
                retry: 1,
            }))
```

2. Listen to events:

```js
uploader.addEventListener('progress', ({ loaded, total }) => {
    console.log(`progress: ${loaded}/${total}`)
})
uploader.addEventListener('error', (event) => {
    console.error(uploader.error)
})
uploader.addEventListener('success', (event) => {
    console.log('success')
})
```

3. Start uploading:

```js
uploader.start()
// or await for completion, which will return the response list, or throw error
await uploader.start()
```

## API

### Class `ChunkedUploader`

> Extends [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)

#### Constructor

| Property | Type | Description |
| --- | --- | --- |
| file | [`File`](https://developer.mozilla.org/zh-CN/docs/Web/API/File) \| `FileInfo & { chunks: Chunk[] }` | The file to upload, or an object containing the file's information and an array of chunks |
| requester | `(chunk: Chunk) => Promise<unknown>` | A function that returns response based on each chunk and file information |
| options | [`ChunkedUploaderOptions`](#ChunkedUploaderOptions) | Optional parameters to customize the uploader |

#### Methods and Properties

##### `start(): Promise<unknown[]>`
Start the upload, if the upload is already started, do nothing, otherwise:
- property `status` will be set to 'pending'
- event `start` will be dispatched
- if `onLine` is false, pause
###### Parameters
| Name | Type | Description |
| --- | --- | --- |
| skipIndexes | `number[] \| undefined` | indexes of chunks to skip |

##### `pause(): boolean`
Pause the upload, if it is not uploading, do nothing, otherwise:
- property `status` will be set to 'paused'
- method `abort` will be called
- event `pause` will be dispatched

##### `resume(): Promise<unknown[]> | false`
Resume the upload, if it is not paused, do nothing, otherwise:
- property `status` will be set to 'pending'
- event `resume` will be dispatched

##### `store(): FileInfo & { chunks: Chunk[] }`
Get the file information and chunks so that you can store them and reconstruct the uploader later.

##### `status: 'idle' \| 'pending' \| 'paused' \| 'error' \| 'success'`
The current status of the upload process. read-only.

##### `error: Error | undefined`
The error that occurred during the upload.

##### `total: number`
The total number of chunks. read-only.

##### `loaded: number`
The number of chunks that have been uploaded. read-only.

##### `hash: string`
A promise that resolves to the MD5 hash (hex) of the file's data. read-only.

##### `chunks: Chunk[]`
The chunks array. read-only.

##### `onLine: boolean`
Is network online. If `navigator` is available, use the value of `navigator.onLine` as the default value, otherwise `true`.
- When it is set to `false`, the upload will be paused. When it is set to `true`, the upload will be resumed. 
- If `window` is available, automatically update, and pause/resume the upload.

##### `abort(): boolean`
Abort the upload, if it is not uploading, do nothing, otherwise:
- property `status` will be set to 'error'
- event 'abort' will be dispatched
- property `error` will be set to an `Error`

#### Events

- `start`: dispatched when the upload has started.
- `progress`: dispatched periodically as any chunk uploaded.
- `pause`: dispatched when the upload pauses.
- `resume`: dispatched when the upload resumes.
- `error`: dispatched when an error occurs during the upload.
- `success`: dispatched when the upload completes successfully.
- `end`: dispatched when the upload has completed, successfully or not.
- `digestprogress`: Fired periodically as file digesting

```js
// you can listen to these events using the `on${EventType}` method:
uploader.onpregress = (event) => {
    console.log('progress', event.loaded / event.total)
}
// or using the `addEventListener` method:
uploader.addEventListener('digestprogress', (event) => {
    console.log('digestprogress', event.loaded / event.total)
})
```

### Types

#### `ChunkedUploaderOptions`

| Property | Type | Description | Default |
| --- | --- | --- | --- |
| chunkSize | `number` | The size of each chunk in bytes. | 1024 * 1024 * 5 |
| limit | `number` | The maximum number of concurrent requests. | Infinity |
| createHasher | `() => Promise<Hasher> \| Hasher` | The hasher to use for calculating the hash of the file's data. | [hash-wasm](https://github.com/Daninet/hash-wasm)`createMD5` |
| abortController | `AbortController` |  The controller to use for aborting the upload. | `new AbortController()` |

> Http headers suggestions:
> - [Range](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range)
> - [Content-Digest](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Digest)

#### `Chunk`

| Property | Type | Description |
| --- | --- | --- |
| index | `number` | The index of the chunk in the sequence of chunks that make up the file. |
| start | `number` | An index into the file indicating the first byte to include in the buffer. |
| end | `number` | An index into the file indicating the first byte that will not be included in the buffer (i.e. the byte exactly at this index is not included). |
| buffer | [`ArrayBuffer \| Promise<ArrayBuffer>`](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBuffer) | The data. |
| status | `'idle' \| 'pending' \| 'success'` | The status of the chunk |
| response | `unknown` | The response of the chunk's upload request |
| digest | `Promise<string> \| string` | A digest as a hexadecimal string |

#### `FileInfo`

| Property | Type | Description |
| --- | --- | --- |
| name | `string \| undefined` | The name of the file |
| size | `number` | The size of the file in bytes |

#### `Hasher`

| Property | Type | Description |
| --- | --- | --- |
| init | `(() => any) \| undefined` | Initiate |
| update | `(data: Uint8Array \| Uint16Array \| Uint32Array \| string) => any` | Update the hasher with a chunk of data. |
| digest | `() => Promise<string>` | Get the hash as a hexadecimal string. |

## Development

<details>

<summary>local development</summary>

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

</details>

## License

<!-- automd:contributors license=MIT -->

Published under the [MIT](https://github.com/Thy3634/chunked-uploader/blob/main/LICENSE) license.
Made by [community](https://github.com/Thy3634/chunked-uploader/graphs/contributors) 💛
<br><br>
<a href="https://github.com/Thy3634/chunked-uploader/graphs/contributors">
<img src="https://contrib.rocks/image?repo=Thy3634/chunked-uploader" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
