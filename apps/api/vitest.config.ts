import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      // Avoid pino transport worker in tests; keep JSON logs predictable.
      LOG_PRETTY: 'false',
    },
    environment: 'node',
    globalSetup: './src/test/global-setup.ts',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: ['src/test/**', '**/*.test.ts', '**/*.integration.test.ts'],
    },
  },
})
