import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Playwright owns e2e/*.spec.ts; Vitest runs only pure unit tests.
    include: ['src/**/*.test.ts'],
  },
})
