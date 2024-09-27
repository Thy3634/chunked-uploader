# Changelog


## v0.0.6

[compare changes](https://github.com/Thy3634/chunked-uploader/compare/v0.0.5...v0.0.6)

## v0.0.5

[compare changes](https://github.com/Thy3634/chunked-uploader/compare/v0.0.4...v0.0.5)

### 🚀 Enhancements

- Fully custom requester ([d98f138](https://github.com/Thy3634/chunked-uploader/commit/d98f138))
- Change example into master-workers ([5cbbcc5](https://github.com/Thy3634/chunked-uploader/commit/5cbbcc5))
- Add method destroy, add option abortController ([dd53d07](https://github.com/Thy3634/chunked-uploader/commit/dd53d07))
- Make get digest lazy ([0e7a396](https://github.com/Thy3634/chunked-uploader/commit/0e7a396))

### 🩹 Fixes

- Upload twice ([4afa8a2](https://github.com/Thy3634/chunked-uploader/commit/4afa8a2))
- Chunk status ([88f82d0](https://github.com/Thy3634/chunked-uploader/commit/88f82d0))
- Pause not work. when pause resume, loaded not correct ([6e30a6d](https://github.com/Thy3634/chunked-uploader/commit/6e30a6d))

### 💅 Refactors

- Expose some properties ([2dd0811](https://github.com/Thy3634/chunked-uploader/commit/2dd0811))

### 📖 Documentation

- README ([81e9c55](https://github.com/Thy3634/chunked-uploader/commit/81e9c55))

### ✅ Tests

- Use EventTarget as window ([3a0ae01](https://github.com/Thy3634/chunked-uploader/commit/3a0ae01))
- Exclude other ([e7ddc63](https://github.com/Thy3634/chunked-uploader/commit/e7ddc63))

### ❤️ Contributors

- Thy3634 <thy3634@qq.com>

## v0.0.4

[compare changes](https://github.com/Thy3634/chunked-uploader/compare/v0.0.3...v0.0.4)

### 🏡 Chore

- **release:** V0.0.3 ([d63d05f](https://github.com/Thy3634/chunked-uploader/commit/d63d05f))
- Update package.json, remove engine ([e6dd695](https://github.com/Thy3634/chunked-uploader/commit/e6dd695))

### ❤️ Contributors

- Thy <thy3634@qq.com>

## v0.0.3

[compare changes](https://github.com/Thy3634/chunked-uploader/compare/v0.0.2...v0.0.3)

### 🩹 Fixes

- Remove jiti and vite dependencies ([a41b297](https://github.com/Thy3634/chunked-uploader/commit/a41b297))

### 🏡 Chore

- **release:** V0.0.2 ([87f391a](https://github.com/Thy3634/chunked-uploader/commit/87f391a))

### ✅ Tests

- Avoid error ([6aa9a4d](https://github.com/Thy3634/chunked-uploader/commit/6aa9a4d))

### ❤️ Contributors

- Thy <thy3634@qq.com>

## v0.0.2

[compare changes](https://github.com/Thy3634/chunked-uploader/compare/v0.0.1...v0.0.2)

### 🚀 Enhancements

- Could set hash algorithm ([7e7bd95](https://github.com/Thy3634/chunked-uploader/commit/7e7bd95))
- Add hash slgorithm ([17dbf92](https://github.com/Thy3634/chunked-uploader/commit/17dbf92))
- Add options.hashCreater for hasher ([b4aa77d](https://github.com/Thy3634/chunked-uploader/commit/b4aa77d))
- An example of using ChunkedUploader to upload a file, using multiple web workers to calc chunk's md5 in parallel. ([cc54106](https://github.com/Thy3634/chunked-uploader/commit/cc54106))
- Remove hashLimit ([a9fb526](https://github.com/Thy3634/chunked-uploader/commit/a9fb526))

### 🩹 Fixes

- Progress ([9716894](https://github.com/Thy3634/chunked-uploader/commit/9716894))

### 📖 Documentation

- README automd ([c253414](https://github.com/Thy3634/chunked-uploader/commit/c253414))
- Update import statement ([54a7b6b](https://github.com/Thy3634/chunked-uploader/commit/54a7b6b))

### 🏡 Chore

- **release:** V0.0.1 ([10e73f4](https://github.com/Thy3634/chunked-uploader/commit/10e73f4))

### ✅ Tests

- Remove timeout case, add coverage exclude ([e8045aa](https://github.com/Thy3634/chunked-uploader/commit/e8045aa))

### ❤️ Contributors

- Thy <thy3634@qq.com>
- Thy3634 <thy3634@qq.com>

## v0.0.1


### 🚀 Enhancements

- Project setup ([5574e5e](https://github.com/Thy3634/chunked-uploader/commit/5574e5e))
- Add test ([b409402](https://github.com/Thy3634/chunked-uploader/commit/b409402))
- Default request method is 'POST'; complete test ([30d2b00](https://github.com/Thy3634/chunked-uploader/commit/30d2b00))
- Update ChunkedUploader event listener types ([4a7adfc](https://github.com/Thy3634/chunked-uploader/commit/4a7adfc))
- Add test case ([f8de4c7](https://github.com/Thy3634/chunked-uploader/commit/f8de4c7))
- Store and restore ([c880bae](https://github.com/Thy3634/chunked-uploader/commit/c880bae))
- Add skipIndexes for start() ([d29b40c](https://github.com/Thy3634/chunked-uploader/commit/d29b40c))

### 🩹 Fixes

- Online listener not work; expose chunk response ([5b11fa8](https://github.com/Thy3634/chunked-uploader/commit/5b11fa8))

### 📖 Documentation

- Reset version ([fd367ec](https://github.com/Thy3634/chunked-uploader/commit/fd367ec))
- README add API usage ([e55c373](https://github.com/Thy3634/chunked-uploader/commit/e55c373))

### 🏡 Chore

- Add network status tracking and auto pause/resume ([fac3a68](https://github.com/Thy3634/chunked-uploader/commit/fac3a68))
- Add test case of network ([242afa4](https://github.com/Thy3634/chunked-uploader/commit/242afa4))
- Add launch.json for debugging tests ([89b0f98](https://github.com/Thy3634/chunked-uploader/commit/89b0f98))
- Update package name to "@thy3634/chunked-uploader" ([0b93d71](https://github.com/Thy3634/chunked-uploader/commit/0b93d71))

### ❤️ Contributors

- Thy ([@Thy3634](http://github.com/Thy3634))
- Thy3634 <thy3634@qq.com>
- Yingyiyang <thy3634@qq.com>

