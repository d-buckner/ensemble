import { Logger } from '../utils/Logger';
import type { Actor } from '../core/Actor';

/**
 * Coordinates state update batching for all actors on a single thread.
 *
 * Purpose:
 * - Ensures all state updates in the same synchronous execution context
 *   are flushed together in a single microtask
 * - Provides atomic visibility: observers see all derived state updates
 *   simultaneously without intermediate states
 * - Optimizes postMessage batching for worker threads
 *
 * Architecture (Two-Level Batching):
 * 1. **Per-Actor Batching**: Each actor maintains its own stateUpdateQueue
 *    - Multiple setState() calls within one actor → batched into single Mutative transaction
 *    - Example: actor.setState(...); actor.setState(...); → one state update
 *
 * 2. **Per-Thread Coordination**: ThreadStateCoordinator ensures atomic flushing
 *    - Multiple actors call setState() → all register with coordinator
 *    - Single queueMicrotask flushes ALL actors together
 *    - Example: ActorA.setState(); ActorB.setState(); → both flush in same microtask
 *
 * Benefits:
 * - Per-actor batching: Efficient state updates within each actor
 * - Per-thread coordination: Atomic visibility across actors (no intermediate states)
 * - Insertion order in Set provides natural topological ordering (due to synchronous effect execution)
 *
 * @internal Framework internal - not exported to users
 */
export class ThreadStateCoordinator {
  private actorsWithPendingUpdates = new Set<Actor<any, any, any>>();
  private flushScheduled = false;

  /**
   * Schedule an actor's pending state updates to be flushed.
   * Multiple calls for the same actor are automatically deduplicated by Set.
   *
   * @param actor - Actor with pending state updates
   */
  scheduleFlush(actor: Actor<any, any, any>): void {
    this.actorsWithPendingUpdates.add(actor);

    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  /**
   * Flush all pending state updates for all actors in this batch.
   *
   * Two-phase flushing ensures atomic visibility:
   * - Phase 1: Apply all state updates (update internal state for all actors)
   * - Phase 2: Emit all state change events (observers see all updates at once)
   *
   * This prevents observers from seeing intermediate states where some actors
   * have updated but others haven't yet.
   *
   * Errors in individual actor flushes are isolated and logged to prevent
   * one actor's failure from blocking others.
   *
   * Note: Effects triggered during Phase 2 may call setState(), adding more actors
   * to actorsWithPendingUpdates. Those will be flushed in the next microtask.
   *
   * @private Called automatically via queueMicrotask
   */
  private flush(): void {
    this.flushScheduled = false;

    // Capture actors to flush in this batch, then clear the Set
    // This prevents effects (triggered in Phase 2) from interfering with this flush
    // Effects that call setState() will add actors to the Set and schedule a new flush
    const actorsToFlush = new Set(this.actorsWithPendingUpdates);
    this.actorsWithPendingUpdates.clear();

    // Phase 1: Apply all state updates without emitting events
    // Store partial states for emission in phase 2
    const partialStates = new Map<Actor<any, any>, Partial<any>>();

    for (const actor of actorsToFlush) {
      try {
        const partial = actor.__applyPendingStateUpdates();
        if (partial) {
          partialStates.set(actor, partial);
        }
      } catch (error) {
        Logger.error('[ThreadStateCoordinator] Error applying actor state updates:', error);
      }
    }

    // Phase 2: Emit all state change events
    // At this point, all actors have their updated state, so observers
    // see a consistent snapshot across all actors
    // Effects triggered here may call setState(), which will schedule a new flush
    for (const [actor, partial] of partialStates) {
      try {
        actor.__emitStateChanges(partial);
      } catch (error) {
        Logger.error('[ThreadStateCoordinator] Error emitting actor state changes:', error);
      }
    }
  }
}
