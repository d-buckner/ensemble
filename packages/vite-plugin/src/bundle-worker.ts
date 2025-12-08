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
 * Bundles a worker module (real or virtual) into standalone JavaScript
 * @param entryPath - Path to worker entry file (real file path or virtual module ID)
 * @param loadModule - Optional loader for virtual modules. If omitted, entry must be a real file.
 * @param projectRoot - Project root directory for module resolution
 */
export async function bundleVirtualWorker(
  entryPath: string,
  loadModule: ((id: string) => string | undefined) | undefined,
  projectRoot: string
): Promise<BundleResult> {
  const plugins: any[] = [];

  // Custom resolver to handle relative imports from virtual modules
  plugins.push({
    name: 'virtual-module-resolver',
    resolveId(source: string, importer: string | undefined) {
      // Virtual module entry
      if (source === entryPath) {
        return source;
      }

      // Resolve relative imports from virtual module relative to projectRoot
      if (importer === entryPath && source.startsWith('./')) {
        const { resolve: pathResolve } = require('path');
        return pathResolve(projectRoot, source);
      }

      return null; // Let other plugins handle it
    },
    load(id: string) {
      // Load virtual module content
      if (id === entryPath && loadModule) {
        return loadModule(id);
      }
      return null;
    },
  });

  plugins.push(
    nodeResolve({
      extensions: ['.js', '.ts', '.tsx'],
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
    commonjs()
  );

  const bundle = await rollup({
    input: entryPath,
    external: [],
    plugins,
  });

  try {
    const { output } = await bundle.generate({
      format: 'es',
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
