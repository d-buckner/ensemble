import { ensemblePlugin } from '@d-buckner/ensemble-vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';


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
