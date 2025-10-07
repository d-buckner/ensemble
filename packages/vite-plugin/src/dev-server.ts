import type { Connect } from 'vite';
import type { ActorInfo } from './scan-actors';
import { generateWorkerEntry } from './generate-worker-entry';
import { bundleVirtualWorker } from './bundle-worker';

const RESOLVED_VIRTUAL_PREFIX = '\0virtual:ensemble-worker-';

/**
 * Creates a middleware to serve virtual worker bundles in development mode
 * @param workerOutput The output directory for the worker (e.g., 'workers')
 * @param actorsByThread Map of threadId to ActorInfo[]
 * @param projectRoot The project root directory
 * @returns Connect middleware function
 */
export function createWorkerMiddleware(
  workerOutput: string,
  actorsByThread: Map<string, ActorInfo[]>,
  projectRoot: string
): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = req.url || '';
    const workerPathPrefix = `/${workerOutput}/`;

    if (!url.startsWith(workerPathPrefix)) {
      next();
      return;
    }

    // Extract threadId from URL: /workers/worker-1.js -> worker-1
    const threadId = url.slice(workerPathPrefix.length).replace(/\.js$/, '');

    // Check if thread exists
    const actors = actorsByThread.get(threadId);
    if (!actors) {
      res.statusCode = 404;
      res.end(`Thread not found: ${threadId}`);
      return;
    }

    // Always rebuild worker in dev mode (no caching for faster development)
    try {
      const virtualModuleId = RESOLVED_VIRTUAL_PREFIX + threadId;
      const bundledCode = await bundleVirtualWorker(
        virtualModuleId,
        (id) => {
          if (id === virtualModuleId) {
            return generateWorkerEntry(threadId, actors);
          }
        },
        projectRoot
      );

      res.setHeader('Content-Type', 'application/javascript');
      res.end(bundledCode);
    } catch (error) {
      res.statusCode = 500;
      res.end(`Failed to bundle worker for thread "${threadId}": ${error}`);
    }
  };
}
