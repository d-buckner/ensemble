import { createHash } from 'crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { bundleVirtualWorker } from './bundle-worker';
import { generateWorkerEntryCode } from './generate-worker-code';
import type { EnsemblePluginOptions } from './types';
import type { Plugin, ResolvedConfig } from 'vite';
import type { EnsembleConfig } from '@d-buckner/ensemble-core';


const VIRTUAL_MODULE_PREFIX = 'virtual:ensemble-worker-';
const RESOLVED_VIRTUAL_PREFIX = '\0' + VIRTUAL_MODULE_PREFIX;
const MANIFEST_MODULE_ID = 'virtual:worker-manifest';
const RESOLVED_MANIFEST_ID = '\0' + MANIFEST_MODULE_ID;

export function ensemblePlugin(options: EnsemblePluginOptions = {}): Plugin {
  const { workerOutput = 'workers' } = options;

  let config: ResolvedConfig;
  let ensembleConfig: EnsembleConfig | null = null;
  const workerBundles: Map<string, string> = new Map();
  let workerPaths: Record<string, string> = {};

  const plugin: Plugin & { _test?: { workerBundles: Map<string, string>; workerPaths: Record<string, string> } } = {
    name: 'ensemble-vite-plugin',

    async configResolved(resolvedConfig) {
      config = resolvedConfig;

      // Load ensemble.json configuration
      const configPath = resolve(config.root, 'ensemble.json');
      if (!existsSync(configPath)) {
        // No configuration file - no worker threads defined
        return;
      }

      try {
        const configContent = readFileSync(configPath, 'utf-8');
        ensembleConfig = JSON.parse(configContent) as EnsembleConfig;
      } catch (error) {
        throw new Error(`Failed to load ensemble.json: ${error}`);
      }
    },

    resolveId(id) {
      if (id === MANIFEST_MODULE_ID) {
        return RESOLVED_MANIFEST_ID;
      }
    },

    load(id) {
      if (id === RESOLVED_MANIFEST_ID) {
        // Return worker paths (with hashes in production, simple paths in dev)
        return `export const WORKER_PATHS = ${JSON.stringify(workerPaths, null, 2)};`;
      }
    },

    async buildStart() {
      if (!ensembleConfig) {
        // No worker threads configured
        return;
      }

      // Only bundle during build mode - dev mode doesn't pre-bundle workers
      if (config.command === 'build') {
        // Build mode: Bundle workers with dependencies
        for (const [threadId, threadConfig] of Object.entries(ensembleConfig.threads)) {
          const virtualModuleId = `\0virtual:ensemble-worker-${threadId}`;
          const workerCode = generateWorkerEntryCode(threadConfig, config.root);

          try {
            const bundleResult = await bundleVirtualWorker(
              virtualModuleId,
              (id) => id === virtualModuleId ? workerCode : undefined,
              config.root
            );

            const bundledCode = bundleResult.code;
            workerBundles.set(threadId, bundledCode);

            // Compute content hash for cache busting
            const hash = createHash('sha256').update(bundledCode).digest('hex').substring(0, 8);
            const fileName = `${workerOutput}/${threadId}-${hash}.js`;
            workerPaths[threadId] = `./${fileName}`;
          } catch (error) {
            this.error(`Failed to bundle worker for thread "${threadId}": ${error}`);
          }
        }
      }
    },

    generateBundle() {
      // Only emit if there are workers
      if (workerBundles.size === 0) {
        return;
      }

      // Emit worker bundles as assets using pre-computed hashed paths
      for (const [threadId, bundledCode] of workerBundles.entries()) {
        const workerPath = workerPaths[threadId];
        // Remove leading './' to get the fileName
        const fileName = workerPath.startsWith('./') ? workerPath.slice(2) : workerPath;

        this.emitFile({
          type: 'asset',
          fileName,
          source: bundledCode,
        });
      }

      // Emit worker manifest for reference (though virtual module is inlined)
      const manifestCode = `export const WORKER_PATHS = ${JSON.stringify(workerPaths, null, 2)};`;

      this.emitFile({
        type: 'asset',
        fileName: `${workerOutput}/manifest.js`,
        source: manifestCode,
      });
    },

    configureServer(server) {
      // Dev mode: Workers are served via middleware (bundled on-demand)
      if (ensembleConfig) {
        const { createWorkerMiddleware } = require('./dev-server');
        server.middlewares.use(
          createWorkerMiddleware(
            workerOutput,
            ensembleConfig,
            config.root,
            server,
            generateWorkerEntryCode
          )
        );

        // Set worker paths for virtual manifest module
        for (const threadId of Object.keys(ensembleConfig.threads)) {
          workerPaths[threadId] = `/${workerOutput}/${threadId}.js`;
        }
      }
    },
  };

  // Expose internal state for testing
  plugin._test = { workerBundles, workerPaths };

  return plugin;
}
