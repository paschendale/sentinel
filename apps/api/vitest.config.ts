import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      // Avoid pino transport worker in tests; keep JSON logs predictable.
      LOG_PRETTY: 'false',
      // Satisfy requireEnv() guards in config.ts so unit tests can import
      // any module without a .env file. Tests that touch the DB or auth
      // use their own mocks and never connect with these values.
      DATABASE_URL: 'postgresql://sentinel:sentinel@localhost:5432/sentinel_test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin',
      JWT_SECRET: 'vitest-test-secret',
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
