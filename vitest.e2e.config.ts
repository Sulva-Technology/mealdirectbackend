import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.spec.ts'],
    setupFiles: ['test/e2e/setup-e2e.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
    restoreMocks: true,
    clearMocks: true
  }
});
