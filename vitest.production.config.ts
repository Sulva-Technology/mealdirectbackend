import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/production/**/*.spec.ts'],
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    restoreMocks: true,
    clearMocks: true
  }
});
