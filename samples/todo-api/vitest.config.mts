import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits the decorator metadata that Megh's dependency injection
  // and validation rely on; Vitest's default transform (esbuild) does not.
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      reportsDirectory: 'coverage',
    },
  },
});
