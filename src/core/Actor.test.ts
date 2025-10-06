import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Actor } from './Actor';
import type { IActorBus } from '../messaging/ActorBus';
import type { AllEvents } from '../messaging/types';
import { action } from './decorators';

// Mock bus implementation
class MockBus<TEventMap extends Record<string, unknown>> implements IActorBus<TEventMap> {
  private listeners = new Map<string | number, Set<(payload: unknown) => void>>();

  on<K extends keyof TEventMap>(eventName: K, callback: (payload: TEventMap[K]) => void): void {
    const key = eventName as string | number;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback as (payload: unknown) => void);
  }

  off<K extends keyof TEventMap>(eventName: K, callback: (payload: TEventMap[K]) => void): void {
    const key = eventName as string | number;
    this.listeners.get(key)?.delete(callback as (payload: unknown) => void);
  }

  emit(eventName: string | number, payload: unknown): void {
    this.listeners.get(eventName)?.forEach(cb => cb(payload));
  }
}

interface TestState extends Record<string, unknown> {
  count: number;
  name: string;
  items: Array<{ id: string; value: number }>;
}

interface TestEvents extends Record<string, unknown> {
  customEvent: { message: string };
}

class TestActor extends Actor<TestState, TestEvents> {
  constructor(initialState?: TestState) {
    super(initialState ?? { count: 0, name: 'test', items: [] });
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
  addItem(id: string, value: number): void {
    this.setState(draft => {
      draft.items.push({ id, value });
    });
  }

  @action
  updateItemValue(id: string, value: number): void {
    this.setState(draft => {
      const item = draft.items.find(i => i.id === id);
      if (item) {
        item.value = value;
      }
    });
  }

  triggerCustomEvent(message: string): void {
    this.emit('customEvent', { message });
  }

  triggerError(message: string): void {
    this.throw(message, { extra: 'details' });
  }

  callSetState(updater: (draft: TestState) => void): void {
    this.setState(updater);
  }
}

describe('Actor', () => {
  let actor: TestActor;
  let bus: MockBus<AllEvents<TestState, TestEvents>>;

  beforeEach(() => {
    actor = new TestActor();
    bus = new MockBus();
    actor.__init(bus, {
      id: 'test-actor',
      name: 'TestActor',
      threadId: 'main',
      dependencies: [],
    });
  });

  describe('initialization', () => {
    it('should initialize with provided state', () => {
      const customActor = new TestActor({ count: 10, name: 'custom', items: [] });

      expect(customActor.state.count).toBe(10);
      expect(customActor.state.name).toBe('custom');
    });

    it('should expose metadata after initialization', () => {
      expect(actor.metadata.id).toBe('test-actor');
      expect(actor.metadata.name).toBe('TestActor');
      expect(actor.metadata.threadId).toBe('main');
      expect(actor.metadata.dependencies).toEqual([]);
    });
  });

  describe('state management', () => {
    it('should provide read-only access to state', () => {
      expect(actor.state.count).toBe(0);
      expect(actor.state.name).toBe('test');
    });

    it('should update state with setState', () => {
      actor.callSetState(draft => {
        draft.count = 5;
      });

      expect(actor.state.count).toBe(5);
    });

    it('should emit events only for changed top-level properties', () => {
      const countCallback = vi.fn();
      const nameCallback = vi.fn();

      bus.on('count', countCallback);
      bus.on('name', nameCallback);

      actor.callSetState(draft => {
        draft.count = 10;
      });

      expect(countCallback).toHaveBeenCalledWith(10);
      expect(nameCallback).not.toHaveBeenCalled();
    });

    it('should emit events for multiple changed properties', () => {
      const countCallback = vi.fn();
      const nameCallback = vi.fn();

      bus.on('count', countCallback);
      bus.on('name', nameCallback);

      actor.callSetState(draft => {
        draft.count = 10;
        draft.name = 'updated';
      });

      expect(countCallback).toHaveBeenCalledWith(10);
      expect(nameCallback).toHaveBeenCalledWith('updated');
    });

    it('should not emit events if state unchanged', () => {
      const countCallback = vi.fn();

      bus.on('count', countCallback);

      actor.callSetState(draft => {
        draft.count = 0; // Same value
      });

      expect(countCallback).not.toHaveBeenCalled();
    });

    it('should emit events for nested property changes', () => {
      const itemsCallback = vi.fn();

      bus.on('items', itemsCallback);

      actor.addItem('item-1', 100);

      expect(itemsCallback).toHaveBeenCalledWith([{ id: 'item-1', value: 100 }]);
    });

    it('should track changes to nested objects correctly', () => {
      const itemsCallback = vi.fn();

      actor.addItem('item-1', 100);

      bus.on('items', itemsCallback);

      actor.updateItemValue('item-1', 200);

      expect(itemsCallback).toHaveBeenCalledWith([{ id: 'item-1', value: 200 }]);
    });

    it('should handle no-op setState calls', () => {
      const countCallback = vi.fn();

      bus.on('count', countCallback);

      actor.callSetState(() => {
        // No changes
      });

      expect(countCallback).not.toHaveBeenCalled();
    });
  });

  describe('action handling', () => {
    it('should execute actions via __action event', () => {
      bus.emit('__action', { method: 'increment', args: [] });

      expect(actor.state.count).toBe(1);
    });

    it('should execute actions with arguments', () => {
      bus.emit('__action', { method: 'setName', args: ['new-name'] });

      expect(actor.state.name).toBe('new-name');
    });

    it('should execute actions with multiple arguments', () => {
      bus.emit('__action', { method: 'addItem', args: ['item-1', 42] });

      expect(actor.state.items).toHaveLength(1);
      expect(actor.state.items[0]).toEqual({ id: 'item-1', value: 42 });
    });

    it('should handle unknown action method gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bus.emit('__action', { method: 'nonexistent', args: [] });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Actor test-actor: Action method "nonexistent" not found'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('custom events', () => {
    it('should emit custom events', () => {
      const customCallback = vi.fn();

      bus.on('customEvent', customCallback);

      actor.triggerCustomEvent('hello');

      expect(customCallback).toHaveBeenCalledWith({ message: 'hello' });
    });

    it('should support multiple custom event subscriptions', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.on('customEvent', callback1);
      bus.on('customEvent', callback2);

      actor.triggerCustomEvent('test');

      expect(callback1).toHaveBeenCalledWith({ message: 'test' });
      expect(callback2).toHaveBeenCalledWith({ message: 'test' });
    });
  });

  describe('error handling', () => {
    it('should emit error events with throw()', () => {
      const errorCallback = vi.fn();

      bus.on('error', errorCallback);

      actor.triggerError('Something went wrong');

      expect(errorCallback).toHaveBeenCalledWith({
        source: 'action',
        method: 'unknown',
        error: expect.any(Error),
        details: { extra: 'details' },
        timestamp: expect.any(Number),
      });
    });

    it('should track error context when set', () => {
      const errorCallback = vi.fn();

      bus.on('error', errorCallback);

      actor.__setContext('effect', 'testMethod');
      actor.triggerError('Context error');
      actor.__clearContext();

      expect(errorCallback).toHaveBeenCalledWith({
        source: 'effect',
        method: 'testMethod',
        error: expect.any(Error),
        details: { extra: 'details' },
        timestamp: expect.any(Number),
      });
    });
  });

  describe('lifecycle hooks', () => {
    it('should call onInit hook if defined', async () => {
      const initSpy = vi.fn();

      class LifecycleActor extends Actor {
        constructor() {
          super({});
        }

        protected onInit(): void {
          initSpy();
        }
      }

      const lifecycleActor = new LifecycleActor();
      lifecycleActor.__init(bus, {
        id: 'lifecycle-actor',
        name: 'LifecycleActor',
        threadId: 'main',
        dependencies: [],
      });

      // onInit is called by ActorSystem, not by __init
      // Access via any to bypass protected access for testing
      const anyActor = lifecycleActor as unknown as { onInit?: () => void | Promise<void> };
      if (anyActor.onInit) {
        await anyActor.onInit();
      }

      expect(initSpy).toHaveBeenCalled();
    });

    it('should support async onInit hook', async () => {
      const initSpy = vi.fn();

      class AsyncLifecycleActor extends Actor {
        constructor() {
          super({});
        }

        protected async onInit(): Promise<void> {
          await new Promise(resolve => setTimeout(resolve, 10));
          initSpy();
        }
      }

      const lifecycleActor = new AsyncLifecycleActor();
      lifecycleActor.__init(bus, {
        id: 'async-actor',
        name: 'AsyncLifecycleActor',
        threadId: 'main',
        dependencies: [],
      });

      // Access via any to bypass protected access for testing
      const anyActor = lifecycleActor as unknown as { onInit?: () => void | Promise<void> };
      if (anyActor.onInit) {
        await anyActor.onInit();
      }

      expect(initSpy).toHaveBeenCalled();
    });
  });

  describe('context management', () => {
    it('should allow setting and clearing context', () => {
      actor.__setContext('effect', 'testMethod');

      // Context should be stored internally
      const errorCallback = vi.fn();
      bus.on('error', errorCallback);
      actor.triggerError('test');

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'effect',
          method: 'testMethod',
        })
      );

      actor.__clearContext();

      // After clearing, should default to 'action' and 'unknown'
      errorCallback.mockClear();
      actor.triggerError('test');

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'action',
          method: 'unknown',
        })
      );
    });
  });
});
