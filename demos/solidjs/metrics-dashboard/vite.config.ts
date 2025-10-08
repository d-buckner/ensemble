import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { ensemblePlugin } from '@d-buckner/ensemble-vite-plugin';

export default defineConfig({
  plugins: [
    solid({
      babel: {
        parserOpts: {
          plugins: ['decorators-legacy']
        }
      }
    }),
    ensemblePlugin({
      workerOutput: 'assets'
    })
  ],
  server: {
    port: 3001,
  },
  esbuild: {
    target: 'es2022',
  },
});
