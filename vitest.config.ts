import { defineConfig, coverageConfigDefaults } from 'vitest/config'

export default defineConfig({
    test: {
        coverage: {
            exclude: [...coverageConfigDefaults.exclude, 'src/main.ts', 'src/hash.worker.ts', 'app.ts'],
        }
    },
})