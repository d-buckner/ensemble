import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThreadBus } from './ThreadBus';

// Concrete implementation for testing
class TestThreadBus extends ThreadBus {
  public postCalls: Array<{ actorId: string; eventName: string; payload: unknown }> = [];

  protected post(actorId: string, eventName: string, payload: unknown): void {
    this.postCalls.push({ actorId, eventName, payload });
  }

  // Helper to reset post calls between tests
  reset(): void {
    this.postCalls = [];
  }
}

describe('ThreadBus', () => {
  let bus: TestThreadBus;

  beforeEach(() => {
    bus = new TestThreadBus();
  });

  describe('on', () => {
    it('should register a listener for an event', () => {
      const callback = vi.fn();
      bus.on('actor1', 'event1', callback);

      bus.emit('actor1', 'event1', { data: 'test' });

      expect(callback).toHaveBeenCalledWith({ data: 'test' });
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should register multiple listeners for the same event', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.on('actor1', 'event1', callback1);
      bus.on('actor1', 'event1', callback2);

      bus.emit('actor1', 'event1', { data: 'test' });

      expect(callback1).toHaveBeenCalledWith({ data: 'test' });
      expect(callback2).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should register listeners for different events on the same actor', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.on('actor1', 'event1', callback1);
      bus.on('actor1', 'event2', callback2);

      bus.emit('actor1', 'event1', { data: 'test1' });
      bus.emit('actor1', 'event2', { data: 'test2' });

      expect(callback1).toHaveBeenCalledWith({ data: 'test1' });
      expect(callback2).toHaveBeenCalledWith({ data: 'test2' });
    });

    it('should register listeners for different actors', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.on('actor1', 'event1', callback1);
      bus.on('actor2', 'event1', callback2);

      bus.emit('actor1', 'event1', { data: 'test1' });
      bus.emit('actor2', 'event1', { data: 'test2' });

      expect(callback1).toHaveBeenCalledWith({ data: 'test1' });
      expect(callback2).toHaveBeenCalledWith({ data: 'test2' });
    });
  });

  describe('off', () => {
    it('should remove a registered listener', () => {
      const callback = vi.fn();

      bus.on('actor1', 'event1', callback);
      bus.off('actor1', 'event1', callback);
      bus.emit('actor1', 'event1', { data: 'test' });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should only remove the specific listener', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.on('actor1', 'event1', callback1);
      bus.on('actor1', 'event1', callback2);

      bus.off('actor1', 'event1', callback1);
      bus.emit('actor1', 'event1', { data: 'test' });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should handle removing a non-existent listener gracefully', () => {
      const callback = vi.fn();

      // Should not throw
      expect(() => bus.off('actor1', 'event1', callback)).not.toThrow();
    });
  });

  describe('emit', () => {
    it('should call all registered listeners for an event', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.on('actor1', 'event1', callback1);
      bus.on('actor1', 'event1', callback2);

      bus.emit('actor1', 'event1', { data: 'test' });

      expect(callback1).toHaveBeenCalledWith({ data: 'test' });
      expect(callback2).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should call the post method', () => {
      bus.emit('actor1', 'event1', { data: 'test' });

      expect(bus.postCalls).toHaveLength(1);
      expect(bus.postCalls[0]).toEqual({
        actorId: 'actor1',
        eventName: 'event1',
        payload: { data: 'test' },
      });
    });

    it('should not throw when emitting to an actor with no listeners', () => {
      expect(() => bus.emit('actor1', 'event1', { data: 'test' })).not.toThrow();
    });

    it('should not throw when emitting to a non-existent event', () => {
      bus.on('actor1', 'event1', vi.fn());

      expect(() => bus.emit('actor1', 'event2', { data: 'test' })).not.toThrow();
    });

    it('should pass the correct payload to listeners', () => {
      const callback = vi.fn();
      const payload = { count: 42, message: 'hello' };

      bus.on('actor1', 'event1', callback);
      bus.emit('actor1', 'event1', payload);

      expect(callback).toHaveBeenCalledWith(payload);
    });
  });

  describe('integration', () => {
    it('should handle multiple actors with multiple events and listeners', () => {
      const actor1Event1 = vi.fn();
      const actor1Event2 = vi.fn();
      const actor2Event1 = vi.fn();

      bus.on('actor1', 'event1', actor1Event1);
      bus.on('actor1', 'event2', actor1Event2);
      bus.on('actor2', 'event1', actor2Event1);

      bus.emit('actor1', 'event1', { value: 1 });
      bus.emit('actor1', 'event2', { value: 2 });
      bus.emit('actor2', 'event1', { value: 3 });

      expect(actor1Event1).toHaveBeenCalledWith({ value: 1 });
      expect(actor1Event2).toHaveBeenCalledWith({ value: 2 });
      expect(actor2Event1).toHaveBeenCalledWith({ value: 3 });
    });
  });
});
