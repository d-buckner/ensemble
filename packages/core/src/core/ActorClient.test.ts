import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockBus } from '../testing/mocks/MockBus';
import { Actor } from './Actor';
import { ActorClient } from './ActorClient';
import { action } from './decorators';
import type { AllEvents } from '../messaging/types';


interface TestState extends Record<string, unknown> {
  count: number;
  name: string;
}

interface TestEvents extends Record<string, unknown> {
  increment: null;
  setName: [name: string];
  incremented: { oldValue: number; newValue: number };
}

class TestActor extends Actor<TestState, TestEvents> {
  static readonly initialState: TestState = {
    count: 0,
    name: 'test'
  };

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

  regularMethod(): void {
    // Not decorated
  }
}

describe('ActorClient', () => {
  let bus: MockBus<AllEvents<TestState, TestEvents>>;
  let client: ActorClient<TestActor>;

  beforeEach(() => {
    bus = new MockBus();
    client = new ActorClient(bus, { count: 5, name: 'initial' });
    // Simulate actor responding with its state
    bus.emit('__state', { count: 5, name: 'initial' });
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

  describe('dispose()', () => {
    it('should cleanup all listeners on dispose', () => {
      const countCallback = vi.fn();
      const nameCallback = vi.fn();
      const customCallback = vi.fn();

      client.on('count', countCallback);
      client.on('name', nameCallback);
      client.on('incremented', customCallback);

      client.dispose();

      // Emit events after disposal - none should trigger
      bus.emit('count', 42);
      bus.emit('name', 'updated');
      bus.emit('incremented', { oldValue: 0, newValue: 1 });

      expect(countCallback).not.toHaveBeenCalled();
      expect(nameCallback).not.toHaveBeenCalled();
      expect(customCallback).not.toHaveBeenCalled();
    });

    it('should cleanup state property subscriptions on dispose', () => {
      const countCallback = vi.fn();

      // State properties are auto-subscribed during hydration
      client.on('count', countCallback);

      client.dispose();

      // State update should not trigger after disposal
      bus.emit('count', 999);

      expect(countCallback).not.toHaveBeenCalled();
    });

    it('should allow multiple dispose calls without errors', () => {
      expect(() => {
        client.dispose();
        client.dispose();
        client.dispose();
      }).not.toThrow();
    });
  });

  describe('actions', () => {
    it('should create action proxies for @action decorated methods', () => {
      expect(client.actions.increment).toBeDefined();
      expect(client.actions.setName).toBeDefined();
      expect(typeof client.actions.increment).toBe('function');
      expect(typeof client.actions.setName).toBe('function');
    });

    it('should emit action event when action is called', () => {
      const actionCallback = vi.fn();
      bus.on('increment', actionCallback);

      client.actions.increment?.();

      expect(actionCallback).toHaveBeenCalledWith([]);
    });

    it('should pass arguments to action proxy', () => {
      const actionCallback = vi.fn();
      bus.on('setName', actionCallback);

      client.actions.setName?.('new-name');

      expect(actionCallback).toHaveBeenCalledWith(['new-name']);
    });

    it('should handle multiple arguments', () => {
      class MultiArgActor extends Actor {
        constructor() {
          super({});
        }

        @action
        multiArg(_a: number, _b: string, _c: boolean): void {}
      }

      const multiClient = new ActorClient<MultiArgActor>(bus, {});
      // Simulate state hydration
      bus.emit('__state', {});

      const actionCallback = vi.fn();
      bus.on('multiArg', actionCallback);

      multiClient.actions.multiArg?.(1, 'test', true);

      expect(actionCallback).toHaveBeenCalledWith([1, 'test', true]);
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

    it('should not miss state updates that arrive before hydration response', () => {
      // Create a new client (doesn't trigger __state response yet)
      const newBus = new MockBus<AllEvents<TestState, TestEvents>>();
      const newClient = new ActorClient<TestActor>(newBus, { count: 0, name: 'initial' });

      // Simulate state changes arriving BEFORE the __state response
      // This tests the race condition fix
      newBus.emit('count', 42);
      newBus.emit('name', 'updated');

      // Now the __state response arrives
      newBus.emit('__state', { count: 10, name: 'hydrated' });

      // State should be the hydrated state (from __state response)
      expect(newClient.state.count).toBe(10);
      expect(newClient.state.name).toBe('hydrated');

      // But subsequent updates should still work
      newBus.emit('count', 99);
      expect(newClient.state.count).toBe(99);
    });

    it('should handle rapid state changes during and after hydration', () => {
      const newBus = new MockBus<AllEvents<TestState, TestEvents>>();
      const newClient = new ActorClient<TestActor>(newBus, { count: 0, name: 'initial' });

      // Rapid changes before hydration
      newBus.emit('count', 1);
      newBus.emit('count', 2);
      newBus.emit('count', 3);

      // Hydration arrives
      newBus.emit('__state', { count: 100, name: 'hydrated' });

      // More rapid changes after hydration
      newBus.emit('count', 101);
      newBus.emit('count', 102);
      newBus.emit('name', 'final');

      // Should have the latest values
      expect(newClient.state.count).toBe(102);
      expect(newClient.state.name).toBe('final');
    });
  });
});
