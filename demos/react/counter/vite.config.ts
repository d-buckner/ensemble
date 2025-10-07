import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ensemblePlugin } from '@d-buckner/ensemble-vite-plugin';

export default defineConfig({
  plugins: [
    react({
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
