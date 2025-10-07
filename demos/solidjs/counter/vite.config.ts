import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid({
    babel: {
      parserOpts: {
        plugins: ['decorators-legacy']
      }
    }
  })],
  server: {
    port: 3000,
  },
  esbuild: {
    target: 'es2022',
  },
});
