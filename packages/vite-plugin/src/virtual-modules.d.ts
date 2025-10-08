/**
 * TypeScript declarations for Ensemble virtual modules
 */

declare module 'virtual:worker-manifest' {
  /**
   * Maps thread IDs to their worker bundle paths (with content hashes in production)
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
