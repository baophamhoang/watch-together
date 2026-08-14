import {defineConfig} from 'vitest/config'
import {resolve} from 'node:path'

export default defineConfig({
  test: {environment: 'node', include: ['lib/**/*.test.ts', 'app/**/*.test.ts']},
  resolve: {alias: {'@': resolve(__dirname, '.')}},
})
