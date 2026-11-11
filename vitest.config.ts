import { defineConfig } from 'vitest/config';

// Tests of the Node workspaces. The Angular app runs its own tests through the Angular CLI.
export default defineConfig({
  test: {
    include: ['{packages,bench,scripts}/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['{packages,bench,scripts}/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/dist/**'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 },
    },
  },
});
