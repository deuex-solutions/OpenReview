import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['tests/**/*.test.ts', 'cli/**/*.test.ts', 'action/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['core/src/**', 'cli/src/**', 'action/src/**'],
      exclude: ['**/node_modules/**', '**/dist/**'],
    },
  },
});
