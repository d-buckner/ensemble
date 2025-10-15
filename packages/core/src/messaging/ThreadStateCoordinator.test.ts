import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Actor } from '../core/Actor';
import { action } from '../core/decorators';
import { ThreadContext } from '../core/ThreadContext';
import { ThreadStateCoordinator } from './ThreadStateCoordinator';

// Mock actor for testing
interface TestState {
  count: number;
  name: string;
}

class TestActor extends Actor<TestState> {
  static readonly initialState: TestState = { count: 0, name: 'test' };

  constructor() {
    super(TestActor.initialState);
  }

  @action
  increment(): void {
    this.setState(draft => {
      draft.count++;
    });
  }

  @action
  setName(name: string): void {
    this.setState(draft => {
      draft.name = name;
    });
  }

  @action
  incrementAndRename(name: string): void {
    this.setState(draft => {
      draft.count++;
    });
    this.setState(draft => {
      draft.name = name;
    });
  }

  @action
  setCount(count: number): void {
    this.setState(draft => {
      draft.count = count;
    });
  }

  @action
  multipleUpdates(count: number, name: string): void {
    this.setState(draft => { draft.count = count; });
    this.setState(draft => { draft.count++; });
    this.setState(draft => { draft.name = name; });
  }

  @action
  incrementTwice(): void {
    this.setState(draft => { draft.count++; });
    this.setState(draft => { draft.count++; });
  }
}

describe('ThreadStateCoordinator', () => {
  let coordinator: ThreadStateCoordinator;
  let actor1: TestActor;
  let actor2: TestActor;

  beforeEach(() => {
    ThreadContext.reset(); // Reset global beforeEach initialization
    coordinator = new ThreadStateCoordinator();
    ThreadContext.initialize(coordinator);

    // Create test actors
    actor1 = new TestActor();
    actor1.__init({ id: 'actor-1', name: 'TestActor', threadId: 'main', dependencies: [] });

    actor2 = new TestActor();
    actor2.__init({ id: 'actor-2', name: 'TestActor', threadId: 'main', dependencies: [] });
  });

  describe('scheduleFlush', () => {
    it('should register an actor for flushing', async () => {
      const applySpy = vi.spyOn(actor1 as any, '__applyPendingStateUpdates');

      coordinator.scheduleFlush(actor1);

      // Wait for microtask to execute
      await flushMicrotask();

      expect(applySpy).toHaveBeenCalledOnce();
    });

    it('should flush multiple actors in one microtask', async () => {
      const apply1Spy = vi.spyOn(actor1 as any, '__applyPendingStateUpdates');
      const apply2Spy = vi.spyOn(actor2 as any, '__applyPendingStateUpdates');

      // Schedule both actors
      coordinator.scheduleFlush(actor1);
      coordinator.scheduleFlush(actor2);

      // Should not flush yet (still in same tick)
      expect(apply1Spy).not.toHaveBeenCalled();
      expect(apply2Spy).not.toHaveBeenCalled();

      // Wait for microtask
      await flushMicrotask();

      // Both should flush
      expect(apply1Spy).toHaveBeenCalledOnce();
      expect(apply2Spy).toHaveBeenCalledOnce();
    });

    it('should deduplicate multiple schedules for the same actor', async () => {
      const applySpy = vi.spyOn(actor1 as any, '__applyPendingStateUpdates');

      // Schedule the same actor multiple times
      coordinator.scheduleFlush(actor1);
      coordinator.scheduleFlush(actor1);
      coordinator.scheduleFlush(actor1);

      await flushMicrotask();

      // Should only flush once (Set deduplication)
      expect(applySpy).toHaveBeenCalledOnce();
    });

    it('should schedule only one microtask for multiple scheduleFlush calls', async () => {
      const queueMicrotaskSpy = vi.spyOn(globalThis, 'queueMicrotask');

      coordinator.scheduleFlush(actor1);
      coordinator.scheduleFlush(actor2);
      coordinator.scheduleFlush(actor1);

      // Should only queue one microtask
      expect(queueMicrotaskSpy).toHaveBeenCalledOnce();

      await flushMicrotask();

      queueMicrotaskSpy.mockRestore();
    });

    it('should clear actors after flushing', async () => {
      const applySpy = vi.spyOn(actor1 as any, '__applyPendingStateUpdates');

      coordinator.scheduleFlush(actor1);
      await flushMicrotask();

      expect(applySpy).toHaveBeenCalledOnce();

      // Schedule again - should flush again
      applySpy.mockClear();
      coordinator.scheduleFlush(actor1);
      await flushMicrotask();

      expect(applySpy).toHaveBeenCalledOnce();
    });
  });

  describe('flush error handling', () => {
    it('should handle errors from individual actor flushes', async () => {
      const error = new Error('Flush failed');
      vi.spyOn(actor1 as any, '__applyPendingStateUpdates').mockImplementation(() => {
        throw error;
      });

      const apply2Spy = vi.spyOn(actor2 as any, '__applyPendingStateUpdates');

      coordinator.scheduleFlush(actor1);
      coordinator.scheduleFlush(actor2);

      await flushMicrotask();

      // Actor2 should still flush despite actor1 error
      expect(apply2Spy).toHaveBeenCalled();
    });

    it('should continue flushing other actors after one fails', async () => {
      const actor3 = new TestActor();
      actor3.__init({ id: 'actor-3', name: 'TestActor', threadId: 'main', dependencies: [] });

      // Make actor1 fail
      vi.spyOn(actor1 as any, '__applyPendingStateUpdates').mockImplementation(() => {
        throw new Error('Flush failed');
      });

      const apply2Spy = vi.spyOn(actor2 as any, '__applyPendingStateUpdates');
      const apply3Spy = vi.spyOn(actor3 as any, '__applyPendingStateUpdates');

      coordinator.scheduleFlush(actor1);
      coordinator.scheduleFlush(actor2);
      coordinator.scheduleFlush(actor3);

      await flushMicrotask();

      // Both actor2 and actor3 should flush
      expect(apply2Spy).toHaveBeenCalled();
      expect(apply3Spy).toHaveBeenCalled();
    });
  });

  describe('integration with Actor.setState()', () => {
    it('should batch multiple setState calls from one actor', async () => {
      const stateUpdates: TestState[] = [];

      // Subscribe to state changes
      (actor1 as any).internalEventEmitter.on('__state_partial', () => {
        stateUpdates.push({ ...actor1.state });
      });

      // Multiple setState calls via action
      actor1.multipleUpdates(1, 'updated');

      // Should not emit yet
      expect(stateUpdates.length).toBe(0);

      await flushMicrotask();

      // Should emit once with batched updates
      expect(stateUpdates.length).toBe(1);
      expect(stateUpdates[0].count).toBe(2); // 1 + 1 from increment
      expect(stateUpdates[0].name).toBe('updated');
    });

    it('should provide atomic visibility across multiple actors', async () => {
      const actor1States: number[] = [];
      const actor2States: number[] = [];

      // Track state changes
      (actor1 as any).internalEventEmitter.on('__state_partial', () => {
        actor1States.push(actor1.state.count);
      });

      (actor2 as any).internalEventEmitter.on('__state_partial', () => {
        actor2States.push(actor2.state.count);
      });

      // Both actors update state
      actor1.setCount(10);
      actor2.setCount(20);

      // No emissions yet
      expect(actor1States.length).toBe(0);
      expect(actor2States.length).toBe(0);

      await flushMicrotask();

      // Both should emit in same microtask
      expect(actor1States.length).toBe(1);
      expect(actor2States.length).toBe(1);
      expect(actor1States[0]).toBe(10);
      expect(actor2States[0]).toBe(20);
    });

    it('should handle actors updating state in rapid succession', async () => {
      const flushSpy = vi.spyOn(coordinator as any, 'flush');

      // Rapid updates
      actor1.incrementTwice();
      actor2.incrementTwice();

      await flushMicrotask();

      // Should only flush once despite multiple setState calls
      expect(flushSpy).toHaveBeenCalledOnce();
      expect(actor1.state.count).toBe(2);
      expect(actor2.state.count).toBe(2);
    });
  });

  describe('microtask scheduling', () => {
    it('should schedule flush as a microtask, not a macrotask', async () => {
      let flushed = false;
      vi.spyOn(actor1 as any, '__applyPendingStateUpdates').mockImplementation(() => {
        flushed = true;
        return null;
      });

      coordinator.scheduleFlush(actor1);

      // Should not flush synchronously
      expect(flushed).toBe(false);

      // Wait for microtasks only (not macrotasks)
      await Promise.resolve();

      // Flush should happen after microtask
      expect(flushed).toBe(true);
    });

    it('should flush before next event loop tick', async () => {
      const events: string[] = [];

      vi.spyOn(actor1 as any, '__applyPendingStateUpdates').mockImplementation(() => {
        events.push('flush');
        return null;
      });

      coordinator.scheduleFlush(actor1);
      events.push('schedule');

      setTimeout(() => {
        events.push('timeout');
      }, 0);

      await flushMacrotask();

      // Order: schedule, flush (microtask), timeout (macrotask)
      expect(events[0]).toBe('schedule');
      expect(events[1]).toBe('flush');
    });
  });

  describe('flush idempotency', () => {
    it('should allow scheduling after flush completes', async () => {
      const applySpy = vi.spyOn(actor1 as any, '__applyPendingStateUpdates');

      // First flush
      coordinator.scheduleFlush(actor1);
      await flushMicrotask();
      expect(applySpy).toHaveBeenCalledOnce();

      // Second flush
      applySpy.mockClear();
      coordinator.scheduleFlush(actor1);
      await flushMicrotask();
      expect(applySpy).toHaveBeenCalledOnce();
    });

    it('should reset flushScheduled flag after flush', async () => {
      coordinator.scheduleFlush(actor1);
      await flushMicrotask();

      // Should be able to schedule again
      const queueMicrotaskSpy = vi.spyOn(globalThis, 'queueMicrotask');
      coordinator.scheduleFlush(actor2);

      expect(queueMicrotaskSpy).toHaveBeenCalledOnce();

      await flushMicrotask();
      queueMicrotaskSpy.mockRestore();
    });
  });
});
