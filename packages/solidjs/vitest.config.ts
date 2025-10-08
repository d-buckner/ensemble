import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

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
  },
});
