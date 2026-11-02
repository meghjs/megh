import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    // A fresh in-memory SQLite database per test file.
    env: { DB_FILE: ':memory:', NODE_ENV: 'test' },
  },
});
