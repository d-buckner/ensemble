import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Actor, type ActorConstructor } from '../core/Actor';
import { action } from '../core/decorators';
import WorkerRuntime from './WorkerRuntime';
import WorkerBus from '../messaging/WorkerBus';

// Mock the global self object for worker environment
(globalThis as any).self = {
  postMessage: vi.fn(),
};

interface TestActorEvents {
  increment: null;
  getValue: { value: number };
}

class TestActor extends Actor<{ count: number }, TestActorEvents> {
  static readonly initialState = { count: 0 };

  constructor(_options: {}) {
    super(TestActor.initialState);
  }

  @action
  increment() {
    this.setState(draft => {
      draft.count++;
    });
  }

  @action
  getValue() {
    let value: number;
    this.setState(draft => {
      value = draft.count;
    });
    this.emit('getValue', { value: value! });
  }
}

interface AnotherActorEvents {}

class AnotherActor extends Actor<{ value: string }, AnotherActorEvents> {
  static readonly initialState = { value: 'hello' };

  constructor(_options: {}) {
    super(AnotherActor.initialState);
  }
}

describe('WorkerRuntime', () => {
  let runtime: WorkerRuntime;
  let workerBus: WorkerBus;
  let actorRegistry: Record<string, ActorConstructor>;

  beforeEach(() => {
    workerBus = new WorkerBus();
    actorRegistry = {
      TestActor,
      AnotherActor,
    };
    const actorMetadata = {
      TestActor: { count: 0 },
      AnotherActor: { value: 'hello' },
    };
    runtime = new WorkerRuntime(workerBus, actorRegistry, actorMetadata);
  });

  describe('instantiate', () => {
    it('should instantiate an actor from the registry', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
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
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
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
          metadata: {
            id: 'test-1',
            name: 'UnknownActor',
            threadId: 'worker-1',
            dependencies: [],
          },
          dependencies: {},
        })
      ).rejects.toThrow('Actor class not found in registry: UnknownActor');
    });

    it('should store instantiated actors by actorId', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
      });

      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-2',
        className: 'AnotherActor',
        metadata: {
          id: 'test-2',
          name: 'AnotherActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
      });

      expect(runtime.getActor('test-1')).toBeInstanceOf(TestActor);
      expect(runtime.getActor('test-2')).toBeInstanceOf(AnotherActor);
    });

    it('should not instantiate the same actor twice', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-1',
        className: 'TestActor',
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
      });

      await expect(
        runtime.instantiate({
        type: 'instantiate',
          actorId: 'test-1',
          className: 'TestActor',
          metadata: {
            id: 'test-1',
            name: 'TestActor',
            threadId: 'worker-1',
            dependencies: [],
          },
          dependencies: {},
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
        metadata: {
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
      });
    });

    it('should route actions to the correct actor instance', () => {
      expect(TestActor.initialState.count).toBe(0);

      const countEvents: number[] = [];
      workerBus.on('test-1', 'count', (payload: unknown) => { countEvents.push(payload as number); });

      runtime.handleEvent('test-1', 'increment', []);

      expect(countEvents[0]).toBe(1);
    });

    it('should handle actions for multiple actors', async () => {
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-2',
        className: 'TestActor',
        metadata: {
          id: 'test-2',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
      });

      const actor1CountEvents: number[] = [];
      const actor2CountEvents: number[] = [];
      workerBus.on('test-1', 'count', (payload: unknown) => { actor1CountEvents.push(payload as number); });
      workerBus.on('test-2', 'count', (payload: unknown) => { actor2CountEvents.push(payload as number); });

      runtime.handleEvent('test-1', 'increment', []);
      runtime.handleEvent('test-2', 'increment', []);
      runtime.handleEvent('test-2', 'increment', []);

      expect(actor1CountEvents[0]).toBe(1);
      expect(actor2CountEvents[1]).toBe(2);
    });

    it('should throw error if actor not found when routing action', () => {
      expect(() => {
        runtime.handleEvent('unknown-actor', 'someAction', []);
      }).toThrow('Actor not found: unknown-actor');
    });
  });
});
