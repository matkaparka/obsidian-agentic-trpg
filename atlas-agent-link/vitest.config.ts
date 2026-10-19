import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The npm `obsidian` package is types-only; tests get a stub with the few runtime values.
      obsidian: fileURLToPath(new URL('./test/stubs/obsidian.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
