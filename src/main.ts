/**
 * A Master-Worker pattern to upload a file in chunks. A master worker to process file, split it into chunks and upload, Using several workers to calculate MD5 of chunk.
 */
const form = document.querySelector('#form') as HTMLFormElement
const chunkSizeInput = document.querySelector('#chunk-size-input') as HTMLInputElement
const concurrencyLimitInfinityInput = document.querySelector('#concurrency-limit-infinity-input') as HTMLInputElement
const concurrencyLimitInput = document.querySelector('#concurrency-limit-input') as HTMLInputElement
concurrencyLimitInput.disabled = concurrencyLimitInfinityInput.checked
const fileInput = document.querySelector('#file-input') as HTMLInputElement
const calculateDigestButton = document.querySelector('#calculate-digest-button') as HTMLButtonElement
const digestP = document.querySelector('#digest') as HTMLParagraphElement
const progress = document.querySelector('#progress') as HTMLProgressElement
const submitButton = document.querySelector('#submit-button') as HTMLButtonElement
const pauseButton = document.querySelector('#pause-button') as HTMLButtonElement
const resumeButton = document.querySelector('#resume-button') as HTMLButtonElement

const worker = new Worker(new URL('master.worker.ts', import.meta.url), { type: 'module' })

let file = fileInput.files?.[0]
async function init() {
    if (file) {
        digestP.textContent = ''
        submitButton.disabled = true
        calculateDigestButton.disabled = true
        pauseButton.disabled = resumeButton.disabled = true
        worker.postMessage({
            type: 'init',
            buffer: await file.arrayBuffer(),
            name: file.name,
            chunkSize: Number.parseInt(chunkSizeInput.value) * 1024 * 1024,
            limit: concurrencyLimitInfinityInput.checked ? Infinity : Number.parseInt(concurrencyLimitInput.value)
        })
        worker.addEventListener('message', (e) => {
            switch (e.data.type) {
                case 'ready': {
                    submitButton.disabled = false
                    calculateDigestButton.disabled = false
                    break
                }
                case 'digestprogress': {
                    digestP.textContent = `${e.data.progress * 100}%`
                    break
                }
                case 'progress': {
                    progress.value = e.data.progress * 100
                    break
                }
                case 'success': {
                    submitButton.disabled = true
                    pauseButton.disabled = true
                    resumeButton.disabled = true
                    alert('Upload complete')
                    break
                }
                case 'digest': {
                    digestP.textContent = e.data.digest
                    break
                }
                default: {
                    console.error(e.data.error)
                    submitButton.disabled = true
                    resumeButton.disabled = true
                    alert('Upload failed')
                    break
                }
            }
        })
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            worker.postMessage({ type: 'start' })
            pauseButton.disabled = concurrencyLimitInfinityInput.checked
        })
    }
}

// eslint-disable-next-line unicorn/prefer-top-level-await
init()

fileInput.addEventListener('change', () => {
    file = fileInput.files?.[0]
    init()
})

pauseButton.addEventListener('click', () => {
    worker.postMessage({ type: 'pause' })
    pauseButton.disabled = true
    resumeButton.disabled = false
})

resumeButton.addEventListener('click', () => {
    worker.postMessage({ type: 'resume' })
    pauseButton.disabled = false
    resumeButton.disabled = true
})

concurrencyLimitInfinityInput.addEventListener('change', () => {
    concurrencyLimitInput.disabled = concurrencyLimitInfinityInput.checked
    worker.postMessage({ type: 'setLimit', value: concurrencyLimitInfinityInput.checked ? Infinity : concurrencyLimitInput.value })
})

concurrencyLimitInput.addEventListener('change', () => {
    worker.postMessage({ type: 'setLimit', value: concurrencyLimitInfinityInput.checked ? Infinity : concurrencyLimitInput.value })
})

calculateDigestButton.addEventListener('click', () => {
    worker.postMessage({ type: 'digest' })
})
