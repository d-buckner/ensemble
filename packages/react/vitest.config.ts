import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      'virtual:ensemble-worker-manifest': new URL('./src/__mocks__/worker-manifest.ts', import.meta.url).pathname,
    },
  },
});
