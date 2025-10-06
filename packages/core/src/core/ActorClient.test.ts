import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActorClient } from './ActorClient';
import { Actor } from './Actor';
import { action } from './decorators';
import type { IActorBus } from '../messaging/ActorBus';
import type { AllEvents } from '../messaging/types';

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
}

interface TestEvents extends Record<string, unknown> {
  incremented: { oldValue: number; newValue: number };
}

class TestActor extends Actor<TestState, TestEvents> {
  constructor() {
    super({ count: 0, name: 'test' });
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

  regularMethod(): void {
    // Not decorated
  }
}

describe('ActorClient', () => {
  let bus: MockBus<AllEvents<TestState, TestEvents>>;
  let client: ActorClient<TestActor>;

  beforeEach(() => {
    bus = new MockBus();
    client = new ActorClient(bus, { count: 5, name: 'initial' }, TestActor);
  });

  describe('state', () => {
    it('should provide access to initial state', () => {
      expect(client.state.count).toBe(5);
      expect(client.state.name).toBe('initial');
    });

    it('should update state when receiving state property events', () => {
      bus.emit('count', 10);
      expect(client.state.count).toBe(10);
    });

    it('should update multiple state properties independently', () => {
      bus.emit('count', 20);
      bus.emit('name', 'updated');

      expect(client.state.count).toBe(20);
      expect(client.state.name).toBe('updated');
    });
  });

  describe('on()', () => {
    it('should subscribe to events', () => {
      const callback = vi.fn();
      client.on('count', callback);

      bus.emit('count', 42);

      expect(callback).toHaveBeenCalledWith(42);
    });

    it('should support custom events', () => {
      const callback = vi.fn();
      client.on('incremented', callback);

      bus.emit('incremented', { oldValue: 1, newValue: 2 });

      expect(callback).toHaveBeenCalledWith({ oldValue: 1, newValue: 2 });
    });

    it('should support base events', () => {
      const callback = vi.fn();
      client.on('error', callback);

      const errorPayload = {
        source: 'action' as const,
        method: 'test',
        error: new Error('test'),
        timestamp: Date.now(),
      };

      bus.emit('error', errorPayload);

      expect(callback).toHaveBeenCalledWith(errorPayload);
    });
  });

  describe('off()', () => {
    it('should unsubscribe from events', () => {
      const callback = vi.fn();
      client.on('count', callback);
      client.off('count', callback);

      bus.emit('count', 42);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('actions', () => {
    it('should create action proxies for @action decorated methods', () => {
      expect(client.actions.increment).toBeDefined();
      expect(client.actions.setName).toBeDefined();
      expect(typeof client.actions.increment).toBe('function');
      expect(typeof client.actions.setName).toBe('function');
    });

    it('should not create proxies for non-decorated methods', () => {
      expect((client.actions as Record<string, unknown>).regularMethod).toBeUndefined();
    });

    it('should emit __action event when action is called', () => {
      const actionCallback = vi.fn();
      bus.on('__action', actionCallback);

      client.actions.increment?.();

      expect(actionCallback).toHaveBeenCalledWith({
        method: 'increment',
        args: [],
      });
    });

    it('should pass arguments to action proxy', () => {
      const actionCallback = vi.fn();
      bus.on('__action', actionCallback);

      client.actions.setName?.('new-name');

      expect(actionCallback).toHaveBeenCalledWith({
        method: 'setName',
        args: ['new-name'],
      });
    });

    it('should handle multiple arguments', () => {
      class MultiArgActor extends Actor {
        constructor() {
          super({});
        }

        @action
        multiArg(_a: number, _b: string, _c: boolean): void {}
      }

      const multiClient = new ActorClient(bus, {}, MultiArgActor);
      const actionCallback = vi.fn();
      bus.on('__action', actionCallback);

      multiClient.actions.multiArg?.(1, 'test', true);

      expect(actionCallback).toHaveBeenCalledWith({
        method: 'multiArg',
        args: [1, 'test', true],
      });
    });
  });

  describe('state synchronization', () => {
    it('should automatically subscribe to all state properties', () => {
      // Client subscribes during construction
      expect(client.state.count).toBe(5);
      expect(client.state.name).toBe('initial');

      // Emit updates
      bus.emit('count', 100);
      bus.emit('name', 'synchronized');

      // State should be updated
      expect(client.state.count).toBe(100);
      expect(client.state.name).toBe('synchronized');
    });
  });
});
