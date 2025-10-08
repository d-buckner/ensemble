import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';


export default defineConfig({
  plugins: [
    solid({
      babel: {
        plugins: [['@babel/plugin-proposal-decorators', { version: 'legacy' }]],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    conditions: ['browser', 'development'],
    alias: {
      'virtual:worker-manifest': new URL('./src/__mocks__/worker-manifest.ts', import.meta.url).pathname,
    },
  },
});
