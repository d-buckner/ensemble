/**
 * Test setup for collaboration package
 * Defines global test helpers for flushing event loop
 */

/**
 * Flush microtasks only (e.g., queueMicrotask, Promise callbacks)
 * Use this when testing state batching
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
 * Flush effects - waits for cascading state updates to propagate
 */
async function flushEffects(): Promise<void> {
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

// Export to make this a module (required for global augmentation)
export {};
