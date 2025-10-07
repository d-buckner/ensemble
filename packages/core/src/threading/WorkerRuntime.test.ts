import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Actor } from '../core/Actor';
import WorkerRuntime from './WorkerRuntime';
import WorkerBus from '../messaging/WorkerBus';

// Mock the global self object for worker environment
(globalThis as any).self = {
  postMessage: vi.fn(),
};

class TestActor extends Actor<{ count: number }, { getValue: { value: number } }> {
  constructor(options: {}) {
    super({ count: 0 });
  }

  increment() {
    this.setState(draft => {
      draft.count++;
    });
  }

  getValue() {
    this.emit('getValue', { value: this.state.count });
  }
}

class AnotherActor extends Actor<{ value: string }, {}> {
  constructor(options: {}) {
    super({ value: 'hello' });
  }
}

describe('WorkerRuntime', () => {
  let runtime: WorkerRuntime;
  let workerBus: WorkerBus;
  let actorRegistry: Record<string, new (...args: any[]) => Actor>;

  beforeEach(() => {
    workerBus = new WorkerBus();
    actorRegistry = {
      TestActor,
      AnotherActor,
    };
    runtime = new WorkerRuntime(workerBus, actorRegistry);
  });

  describe('instantiate', () => {
    it('should instantiate an actor from the registry', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        options: {},
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
      });

      const actor = runtime.getActor('test-1');
      expect(actor).toBeInstanceOf(TestActor);
    });

    it('should initialize actor with bus and metadata', async () => {
      const initSpy = vi.spyOn(TestActor.prototype, '__init');

      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        options: {},
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
      });

      expect(initSpy).toHaveBeenCalledWith(
        expect.any(Object), // ActorBus
        expect.objectContaining({
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
        })
      );
    });

    it('should throw error if className not found in registry', async () => {
      await expect(
        runtime.instantiate({
        type: 'instantiate',
          actorId: 'test-1',
          className: 'UnknownActor',
          options: {},
          metadata: {
            id: 'test-1',
            name: 'UnknownActor',
            threadId: 'worker-1',
            dependencies: [],
          },
        })
      ).rejects.toThrow('Actor class not found in registry: UnknownActor');
    });

    it('should store instantiated actors by actorId', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        options: {},
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
      });

      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-2',
        className: 'AnotherActor',
        options: {},
        metadata: {
          id: 'test-2',
          name: 'AnotherActor',
          threadId: 'worker-1',
          dependencies: [],
        },
      });

      expect(runtime.getActor('test-1')).toBeInstanceOf(TestActor);
      expect(runtime.getActor('test-2')).toBeInstanceOf(AnotherActor);
    });

    it('should not instantiate the same actor twice', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        options: {},
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
      });

      await expect(
        runtime.instantiate({
        type: 'instantiate',
          actorId: 'test-1',
          className: 'TestActor',
          options: {},
          metadata: {
            id: 'test-1',
            name: 'TestActor',
            threadId: 'worker-1',
            dependencies: [],
          },
        })
      ).rejects.toThrow('Actor already instantiated: test-1');
    });
  });

  describe('message routing', () => {
    beforeEach(async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        options: {},
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
      });
    });

    it('should route actions to the correct actor instance', () => {
      const actor = runtime.getActor('test-1') as TestActor;
      expect(actor.state.count).toBe(0);

      runtime.handleEvent('test-1', 'increment', []);

      expect(actor.state.count).toBe(1);
    });

    it('should handle actions for multiple actors', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-2',
        className: 'TestActor',
        options: {},
        metadata: {
          id: 'test-2',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
      });

      const actor1 = runtime.getActor('test-1') as TestActor;
      const actor2 = runtime.getActor('test-2') as TestActor;

      runtime.handleEvent('test-1', 'increment', []);
      runtime.handleEvent('test-2', 'increment', []);
      runtime.handleEvent('test-2', 'increment', []);

      expect(actor1.state.count).toBe(1);
      expect(actor2.state.count).toBe(2);
    });

    it('should throw error if actor not found when routing action', () => {
      expect(() => {
        runtime.handleEvent('unknown-actor', 'someAction', []);
      }).toThrow('Actor not found: unknown-actor');
    });
  });
});
