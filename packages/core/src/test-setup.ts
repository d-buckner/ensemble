import { vi, beforeEach, afterEach } from 'vitest';
import { Logger } from './utils/Logger';
import { ThreadContext } from './core/ThreadContext';
import { ThreadStateCoordinator } from './messaging/ThreadStateCoordinator';

// Mock all Logger methods to be no-ops during tests
vi.spyOn(Logger, 'debug').mockImplementation(() => {});
vi.spyOn(Logger, 'info').mockImplementation(() => {});
vi.spyOn(Logger, 'warn').mockImplementation(() => {});
vi.spyOn(Logger, 'error').mockImplementation(() => {});

// Auto-initialize ThreadContext for tests that don't use ActorSystem
// Tests that create an ActorSystem should reset ThreadContext in their beforeEach
// before calling system.start(), which will initialize its own coordinator
beforeEach(() => {
  // Only initialize if not already initialized
  // This handles standalone actor tests that don't use ActorSystem
  if (!ThreadContext.isInitialized) {
    const coordinator = new ThreadStateCoordinator();
    ThreadContext.initialize(coordinator);
  }
});

// Reset ThreadContext after each test to ensure clean state
afterEach(() => {
  ThreadContext.reset();
});

// Test helpers for flushing event loop at different levels

/**
 * Flush microtasks only (e.g., queueMicrotask, Promise callbacks)
 * Use this when testing state batching via ThreadStateCoordinator
 */
async function flushMicrotask(): Promise<void> {
  await Promise.resolve();
}

/**
 * Flush macrotasks (e.g., setTimeout, setInterval)
 * Use this when testing async operations that involve timers
 */
async function flushMacrotask(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Flush effects - waits for cascading state updates to propagate through effect chains
 * When an actor's state changes, it may trigger effects on dependent actors,
 * which then schedule their own state updates. This helper waits for the event
 * loop to fully process all pending microtasks and one macrotask cycle.
 *
 * Use this when testing cross-actor effects and derived state updates.
 */
async function flushEffects(): Promise<void> {
  // Use a small timeout to ensure all microtasks and one macrotask cycle complete
  // This allows BFS propagation of state changes through effect chains
  await new Promise(resolve => setTimeout(resolve, 0));
}

// Make helpers globally available
declare global {
  var flushMicrotask: () => Promise<void>;
  var flushMacrotask: () => Promise<void>;
  var flushEffects: () => Promise<void>;
}

globalThis.flushMicrotask = flushMicrotask;
globalThis.flushMacrotask = flushMacrotask;
globalThis.flushEffects = flushEffects;
