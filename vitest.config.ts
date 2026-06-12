import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    exclude: ['test/production/**/*.spec.ts'],
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/common/**/*.ts',
        'src/config/**/*.ts',
        'src/domain/**/*.ts',
        'src/health/**/*.ts'
      ],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        statements: 80,
        branches: 60,
        functions: 75,
        lines: 80
      }
    }
  }
});
