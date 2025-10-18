import { ensemblePlugin } from '@d-buckner/ensemble-vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';


export default defineConfig({
  plugins: [
    react({
      babel: {
        parserOpts: {
          plugins: ['decorators-legacy']
        }
      }
    }),
    wasm(),
    topLevelAwait(),
    ensemblePlugin()
  ],
  server: {
    port: 3002,
  },
  esbuild: {
    target: 'es2022',
  },
});
