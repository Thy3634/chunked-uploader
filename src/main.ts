const form = document.querySelector('#form') as HTMLFormElement
const fileInput = document.querySelector('#file-input') as HTMLInputElement
const progress = document.querySelector('#progress') as HTMLProgressElement
const chunkSizeInput = document.querySelector('#chunk-size-input') as HTMLInputElement
const submitButton = document.querySelector('#submit-button') as HTMLButtonElement

fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (file) {
        chunkSizeInput.disabled = true
        const worker = new Worker(new URL('master.worker.ts', import.meta.url), { type: 'module' })

        worker.postMessage({
            type: 'init',
            buffer: await file.arrayBuffer(),
            name: file.name,
            chunkSize: Number.parseInt(chunkSizeInput.value) * 1024 * 1024
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
                    alert('Upload complete')
                    break
                }
                default: {
                    console.error(e.data.error)
                    submitButton.disabled = true
                    alert('Upload failed')
                    break
                }
            }
        })
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            worker.postMessage({ type: 'start' })
        })
    }
})

form.addEventListener('reset', () => {
    progress.value = 0
    submitButton.disabled = true
    chunkSizeInput.disabled = false
})
