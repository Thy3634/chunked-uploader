/**
 * A Master-Worker pattern to upload a file in chunks. A master worker to process file, split it into chunks and upload, Using several workers to calculate MD5 of chunk.
 */
const form = document.querySelector('#form') as HTMLFormElement
const chunkSizeInput = document.querySelector('#chunk-size-input') as HTMLInputElement
const concurrencyLimitInfinityInput = document.querySelector('#concurrency-limit-infinity-input') as HTMLInputElement
const concurrencyLimitInput = document.querySelector('#concurrency-limit-input') as HTMLInputElement
const concurrencyLimit = document.querySelector('#concurrency-limit') as HTMLLabelElement
const fileInput = document.querySelector('#file-input') as HTMLInputElement
const progress = document.querySelector('#progress') as HTMLProgressElement
const submitButton = document.querySelector('#submit-button') as HTMLButtonElement
const pauseButton = document.querySelector('#pause-button') as HTMLButtonElement
const resumeButton = document.querySelector('#resume-button') as HTMLButtonElement

const worker = new Worker(new URL('master.worker.ts', import.meta.url), { type: 'module' })

fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (file) {
        chunkSizeInput.disabled = true

        worker.postMessage({
            type: 'init',
            buffer: await file.arrayBuffer(),
            name: file.name,
            chunkSize: Number.parseInt(chunkSizeInput.value) * 1024 * 1024,
            limit: concurrencyLimitInfinityInput.checked ? Infinity : Number.parseInt(concurrencyLimitInput.value)
        })
        submitButton.disabled = false
        worker.addEventListener('message', (e) => {
            switch (e.data.type) {
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
            pauseButton.disabled = false
        })
    }
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
    concurrencyLimit.style.display = concurrencyLimitInfinityInput.checked ? 'none' : 'inline-block'
})
