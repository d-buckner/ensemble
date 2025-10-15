import type { ThreadStateCoordinator } from '../messaging/ThreadStateCoordinator';

/**
 * ThreadContext provides access to thread-local resources and services.
 *
 * Each thread (main or worker) has its own isolated ThreadContext.
 * This is safe because web workers don't share memory with the main thread.
 *
 * Purpose:
 * - Avoid prop-drilling thread-local services through actor initialization
 * - Provide extensible location for thread-scoped state (metrics, debugging, etc.)
 * - Maintain clean separation between actor instance state and thread infrastructure
 *
 * Usage:
 * ```typescript
 * class MyActor extends Actor {
 *   someMethod() {
 *     const coordinator = ThreadContext.current;
 *     coordinator.scheduleFlush(this);
 *   }
 * }
 * ```
 *
 * @internal Framework internal - not exported to users
 */
export class ThreadContext {
  private static coordinator?: ThreadStateCoordinator;

  // Prevent instantiation - this is a static-only utility class
  private constructor() {}

  /**
   * Get the current thread's state coordinator.
   * @returns The ThreadStateCoordinator for this thread
   * @throws Error if not initialized (indicates framework setup issue)
   */
  static get current(): ThreadStateCoordinator {
    if (!ThreadContext.coordinator) {
      throw new Error(
        '[ThreadContext] Context not initialized. ThreadContext must be initialized by WorkerRuntime or ActorSystem before actors can call setState().'
      );
    }
    return ThreadContext.coordinator;
  }

  /**
   * Check if thread context has been initialized.
   * Useful for testing setup validation.
   */
  static get isInitialized(): boolean {
    return ThreadContext.coordinator !== undefined;
  }

  /**
   * Initialize the thread context.
   * Should be called once per thread at startup.
   *
   * @param coordinator - State update coordinator for this thread
   * @throws Error if already initialized
   * @internal Called by WorkerRuntime or ActorSystem
   */
  static initialize(coordinator: ThreadStateCoordinator): void {
    if (ThreadContext.coordinator) {
      throw new Error('[ThreadContext] Already initialized');
    }
    ThreadContext.coordinator = coordinator;
  }

  /**
   * Reset the thread context (for testing).
   * @internal
   */
  static reset(): void {
    ThreadContext.coordinator = undefined;
  }
}
