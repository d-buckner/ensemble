import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Actor, type ActorConstructor } from '../core/Actor';
import { action, effect } from '../core/decorators';
import { ThreadContext } from '../core/ThreadContext';
import WorkerBus from '../messaging/WorkerBus';
import WorkerRuntime from './WorkerRuntime';
import type { ActorClient } from '../core/ActorClient';

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

// Test actors for effect functionality
interface SourceActorEvents {
  dataEmitted: { value: number };
}

class SourceActor extends Actor<{ count: number }, SourceActorEvents> {
  static readonly initialState = { count: 0 };

  constructor(_options: {}) {
    super(SourceActor.initialState);
  }

  @action
  emitData(value: number) {
    this.emit('dataEmitted', { value });
  }
}

interface ConsumerDeps {
  source: ActorClient<SourceActor>;
}

class ConsumerActor extends Actor<{ receivedValues: number[] }> {
  static readonly initialState = { receivedValues: [] };

  protected declare deps: ConsumerDeps;

  constructor(_options: {}) {
    super(ConsumerActor.initialState);
  }

  @effect('source.dataEmitted')
  handleDataEmitted(data: { value: number }) {
    this.setState(draft => {
      draft.receivedValues.push(data.value);
    });
  }
}

describe('WorkerRuntime', () => {
  let runtime: WorkerRuntime;
  let workerBus: WorkerBus;
  let actorRegistry: Record<string, ActorConstructor<any>>;

  beforeEach(() => {
    ThreadContext.reset(); // Reset global beforeEach initialization
    workerBus = new WorkerBus();
    actorRegistry = {
      TestActor,
      AnotherActor,
      SourceActor,
      ConsumerActor,
    };
    const actorMetadata = {
      TestActor: { count: 0 },
      AnotherActor: { value: 'hello' },
      SourceActor: { count: 0 },
      ConsumerActor: { receivedValues: [] },
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
        expect.objectContaining({
          id: 'test-1',
          name: 'TestActor',
          threadId: 'worker-1',
        }),
        expect.any(Object) // ActorBus
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

    it('should route actions to the correct actor instance', async () => {
      expect(TestActor.initialState.count).toBe(0);

      const countEvents: number[] = [];
      workerBus.on('test-1', '__state_partial', (payload: unknown) => {
        const partial = payload as { count?: number };
        if (partial.count !== undefined) {
          countEvents.push(partial.count);
        }
      });

      runtime.handleEvent('test-1', 'increment', []);

      await flushMicrotask();
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
      workerBus.on('test-1', '__state_partial', (payload: unknown) => {
        const partial = payload as { count?: number };
        if (partial.count !== undefined) {
          actor1CountEvents.push(partial.count);
        }
      });
      workerBus.on('test-2', '__state_partial', (payload: unknown) => {
        const partial = payload as { count?: number };
        if (partial.count !== undefined) {
          actor2CountEvents.push(partial.count);
        }
      });

      runtime.handleEvent('test-1', 'increment', []);
      runtime.handleEvent('test-2', 'increment', []);
      runtime.handleEvent('test-2', 'increment', []);

      await flushMicrotask();
      expect(actor1CountEvents[0]).toBe(1);
      // Both increments on test-2 are batched into one emission
      expect(actor2CountEvents[0]).toBe(2);
    });

    it('should throw error if actor not found when routing action', () => {
      expect(() => {
        runtime.handleEvent('unknown-actor', 'someAction', []);
      }).toThrow('Actor not found: unknown-actor');
    });
  });

  describe('effect setup', () => {
    it('should trigger effects when dependency emits custom events', async () => {
      // Instantiate source actor first
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'source-1',
        className: 'SourceActor',
        metadata: {
          id: 'source-1',
          name: 'SourceActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
      });

      // Instantiate consumer actor with source as dependency
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'consumer-1',
        className: 'ConsumerActor',
        metadata: {
          id: 'consumer-1',
          name: 'ConsumerActor',
          threadId: 'worker-1',
          dependencies: ['source-1'],
        },
        dependencies: {
          source: {
            actorId: 'source-1',
            className: 'SourceActor',
          },
        },
      });

      // Track state changes on consumer
      const receivedValuesUpdates: number[][] = [];
      workerBus.on('consumer-1', '__state_partial', (payload: unknown) => {
        const partial = payload as { receivedValues?: number[] };
        if (partial.receivedValues !== undefined) {
          receivedValuesUpdates.push([...partial.receivedValues]);
        }
      });

      // Emit events from source actor
      runtime.handleEvent('source-1', 'emitData', [42]);
      runtime.handleEvent('source-1', 'emitData', [100]);

      await flushMicrotask();
      // Verify consumer effect was triggered and state updated
      // Both effects are batched into one state emission
      expect(receivedValuesUpdates.length).toBeGreaterThanOrEqual(1);
      expect(receivedValuesUpdates[0]).toEqual([42, 100]);
    });

    it('should trigger effects when dependency state changes', async () => {
      // Instantiate source actor first
      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'test-source',
        className: 'TestActor',
        metadata: {
          id: 'test-source',
          name: 'TestActor',
          threadId: 'worker-1',
          dependencies: [],
        },
        dependencies: {},
      });

      // Create a consumer that reacts to state changes
      interface StateConsumerDeps {
        source: ActorClient<TestActor>;
      }

      class StateConsumerActor extends Actor<{ lastCount: number }> {
        static readonly initialState = { lastCount: -1 };

        protected declare deps: StateConsumerDeps;

        constructor(_options: {}) {
          super(StateConsumerActor.initialState);
        }

        @effect('source.count')
        handleCountChange(count: number) {
          this.setState(draft => {
            draft.lastCount = count;
          });
        }
      }

      // Register the new actor type
      actorRegistry.StateConsumerActor = StateConsumerActor;
      (runtime as any).actorMetadata.StateConsumerActor = { lastCount: -1 };

      await runtime.instantiate({
        type: 'instantiate',
        actorId: 'state-consumer',
        className: 'StateConsumerActor',
        metadata: {
          id: 'state-consumer',
          name: 'StateConsumerActor',
          threadId: 'worker-1',
          dependencies: ['test-source'],
        },
        dependencies: {
          source: {
            actorId: 'test-source',
            className: 'TestActor',
          },
        },
      });

      // Track state changes on consumer
      const lastCountUpdates: number[] = [];
      workerBus.on('state-consumer', '__state_partial', (payload: unknown) => {
        const partial = payload as { lastCount?: number };
        if (partial.lastCount !== undefined) {
          lastCountUpdates.push(partial.lastCount);
        }
      });

      // Trigger state changes on source
      runtime.handleEvent('test-source', 'increment', []);
      runtime.handleEvent('test-source', 'increment', []);

      await flushEffects();
      // Verify consumer effect was triggered by state changes
      // Both effects are batched into one state emission
      expect(lastCountUpdates.length).toBeGreaterThanOrEqual(1);
      expect(lastCountUpdates[0]).toBe(2);
    });
  });
});
