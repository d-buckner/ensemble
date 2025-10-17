/**
 * TypeScript declarations for Ensemble virtual modules
 *
 * Note: This module is OPTIONAL. It's only required if you use @thread decorators.
 *
 * To use worker threads:
 * 1. Configure @d-buckner/ensemble-vite-plugin in your vite.config.ts
 * 2. Use @thread('threadId') decorator on actor classes
 *
 * For main-thread only applications, the plugin is not needed.
 */

declare module 'virtual:worker-manifest' {
  /**
   * Maps thread IDs to their worker bundle paths (with content hashes in production)
   *
   * This module is provided by @d-buckner/ensemble-vite-plugin and is only
   * loaded when actually spawning workers (lazy-loaded via dynamic import).
   *
   * @example
   * ```typescript
   * {
   *   'worker-1': './assets/worker-1-a1b2c3d4.js',
   *   'worker-2': './assets/worker-2-e5f6g7h8.js'
   * }
   * ```
   */
  export const WORKER_PATHS: Record<string, string>;
}
