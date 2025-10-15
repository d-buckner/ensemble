import { defineConfig } from 'vitest/config';


export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['../core/src/test-setup.ts'],
  },
  resolve: {
    alias: {
      'virtual:worker-manifest': new URL('./src/__mocks__/worker-manifest.ts', import.meta.url).pathname,
    },
  },
});
