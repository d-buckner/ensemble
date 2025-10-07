import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import esbuild from 'rollup-plugin-esbuild';
import { resolve } from 'path';

/**
 * Bundles a virtual worker module into standalone JavaScript
 */
export async function bundleVirtualWorker(
  virtualModuleId: string,
  loadModule: (id: string) => string | undefined,
  projectRoot: string
): Promise<string> {
  const bundle = await rollup({
    input: virtualModuleId,
    external: [],
    plugins: [
      {
        name: 'virtual-module-loader',
        resolveId(id, importer) {
          if (id === virtualModuleId) {
            return id;
          }
          // Only resolve relative imports if they're from the virtual module
          if (importer === virtualModuleId && (id.startsWith('./') || id.startsWith('../'))) {
            return resolve(projectRoot, id);
          }
          // Let other plugins handle everything else
          return null;
        },
        load(id) {
          if (id === virtualModuleId) {
            return loadModule(id);
          }
        },
      },
      nodeResolve({
        extensions: ['.js', '.ts', '.tsx'],
        rootDir: projectRoot,
        exportConditions: ['browser', 'module', 'import', 'default'],
        browser: true,
      }),
      replace({
        'process.env.NODE_ENV': '"production"',
        preventAssignment: true,
      }),
      esbuild({
        target: 'es2022',
        minify: false,
      }),
      commonjs(),
    ],
  });

  try {
    const { output } = await bundle.generate({
      format: 'iife',
      name: 'EnsembleWorker',
    });

    const chunk = output.find(item => item.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') {
      throw new Error('No chunk generated from worker bundle');
    }

    return chunk.code;
  } finally {
    await bundle.close();
  }
}
