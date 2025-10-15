import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadContext } from './ThreadContext';
import { ThreadStateCoordinator } from '../messaging/ThreadStateCoordinator';

describe('ThreadContext', () => {
  // Reset before each test (test-setup.ts initializes it globally)
  beforeEach(() => {
    ThreadContext.reset();
  });

  // Clean up after each test
  afterEach(() => {
    ThreadContext.reset();
  });

  describe('initialization', () => {
    it('should start uninitialized', () => {
      expect(ThreadContext.isInitialized).toBe(false);
    });

    it('should initialize with a coordinator', () => {
      const coordinator = new ThreadStateCoordinator();
      ThreadContext.initialize(coordinator);

      expect(ThreadContext.isInitialized).toBe(true);
    });

    it('should return the same coordinator instance', () => {
      const coordinator = new ThreadStateCoordinator();
      ThreadContext.initialize(coordinator);

      const retrieved1 = ThreadContext.current;
      const retrieved2 = ThreadContext.current;

      expect(retrieved1).toBe(coordinator);
      expect(retrieved2).toBe(coordinator);
      expect(retrieved1).toBe(retrieved2);
    });

    it('should throw on double initialization', () => {
      const coordinator1 = new ThreadStateCoordinator();
      const coordinator2 = new ThreadStateCoordinator();

      ThreadContext.initialize(coordinator1);

      expect(() => ThreadContext.initialize(coordinator2)).toThrow(
        '[ThreadContext] Already initialized'
      );
    });

    it('should allow re-initialization after reset', () => {
      const coordinator1 = new ThreadStateCoordinator();
      ThreadContext.initialize(coordinator1);

      ThreadContext.reset();

      const coordinator2 = new ThreadStateCoordinator();
      expect(() => ThreadContext.initialize(coordinator2)).not.toThrow();
      expect(ThreadContext.current).toBe(coordinator2);
    });
  });

  describe('current accessor', () => {
    it('should throw when accessing uninitialized context', () => {
      ThreadContext.reset();

      expect(() => ThreadContext.current).toThrow(
        '[ThreadContext] Context not initialized. ThreadContext must be initialized by WorkerRuntime or ActorSystem before actors can call setState().'
      );
    });

    it('should return coordinator after initialization', () => {
      const coordinator = new ThreadStateCoordinator();
      ThreadContext.initialize(coordinator);

      expect(ThreadContext.current).toBe(coordinator);
    });

    it('should throw after reset', () => {
      const coordinator = new ThreadStateCoordinator();
      ThreadContext.initialize(coordinator);

      ThreadContext.reset();

      expect(() => ThreadContext.current).toThrow(
        '[ThreadContext] Context not initialized'
      );
    });
  });

  describe('reset', () => {
    it('should reset to uninitialized state', () => {
      const coordinator = new ThreadStateCoordinator();
      ThreadContext.initialize(coordinator);

      expect(ThreadContext.isInitialized).toBe(true);

      ThreadContext.reset();

      expect(ThreadContext.isInitialized).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      ThreadContext.reset();
      ThreadContext.reset();
      ThreadContext.reset();

      expect(ThreadContext.isInitialized).toBe(false);
    });

    it('should be safe to call when already uninitialized', () => {
      expect(ThreadContext.isInitialized).toBe(false);
      expect(() => ThreadContext.reset()).not.toThrow();
      expect(ThreadContext.isInitialized).toBe(false);
    });
  });

  describe('static-only class enforcement', () => {
    it('should have private constructor (compile-time check)', () => {
      // TypeScript enforces this at compile-time with the private constructor
      // At runtime, JavaScript doesn't prevent instantiation, but TypeScript will error:
      // @ts-expect-error - Constructor of class 'ThreadContext' is private
      const _ = new ThreadContext();

      // This test verifies the pattern is documented and compiler-enforced
      expect(ThreadContext.isInitialized).toBe(false);
    });
  });

  describe('thread isolation (conceptual)', () => {
    it('should support independent coordinators for different "threads"', () => {
      // Simulate main thread
      const mainCoordinator = new ThreadStateCoordinator();
      ThreadContext.initialize(mainCoordinator);
      expect(ThreadContext.current).toBe(mainCoordinator);

      // In a real web worker, each worker would have its own ThreadContext static state
      // This test verifies the pattern works for a single thread
      ThreadContext.reset();

      // Simulate worker thread (in reality, this would be a separate global scope)
      const workerCoordinator = new ThreadStateCoordinator();
      ThreadContext.initialize(workerCoordinator);
      expect(ThreadContext.current).toBe(workerCoordinator);
      expect(ThreadContext.current).not.toBe(mainCoordinator);
    });
  });
});
