import { defineConfig } from 'vitest/config';

// Tests of the Node workspaces. The Angular app runs its own tests through the Angular CLI.
export default defineConfig({
  test: {
    include: ['{packages,bench,scripts}/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['{packages,bench,scripts}/**/*.ts'],
      // Test helpers under a `test` folder are not product code.
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/dist/**', '**/test/**'],
      reporter: ['text-summary', 'lcov'],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
        // The server's logic: its core and its adapters. `bin.ts` only wires them, in a child
        // process that coverage cannot see. Each figure sits a little under what the tests reach,
        // and none under 80%.
        'packages/wcag-evidence-mcp/src/core/**': {
          lines: 95,
          branches: 90,
          functions: 95,
          statements: 95,
        },
        'packages/wcag-evidence-mcp/src/adapters/**': {
          lines: 95,
          branches: 84,
          functions: 85,
          statements: 90,
        },
      },
    },
  },
});
