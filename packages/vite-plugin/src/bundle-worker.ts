import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import { rollup } from 'rollup';
import esbuild from 'rollup-plugin-esbuild';


export interface BundleResult {
  code: string;
  watchFiles: string[];
}

/**
 * Bundles a virtual worker module into standalone JavaScript
 */
export async function bundleVirtualWorker(
  virtualModuleId: string,
  loadModule: (id: string) => string | undefined,
  projectRoot: string
): Promise<BundleResult> {
  const bundle = await rollup({
    input: virtualModuleId,
    external: [],
    plugins: [
      {
        name: 'virtual-module-loader',
        resolveId(id) {
          if (id === virtualModuleId) {
            return id;
          }
          // Let nodeResolve handle all other imports (including relative paths with extension resolution)
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

    return {
      code: chunk.code,
      watchFiles: bundle.watchFiles,
    };
  } finally {
    await bundle.close();
  }
}
