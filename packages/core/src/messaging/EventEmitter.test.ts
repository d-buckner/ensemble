import { describe, it, expect, vi } from 'vitest';
import EventEmitter from './EventEmitter';

interface TestPayload {
  value: number;
}

interface TestEvents {
  test: number;
  event: string;
  event1: number;
  event2: number;
  incremented: { oldValue: number; newValue: number };
  payloadEvent: TestPayload;
  errorEvent: number;
}

describe('EventEmitter', () => {
  describe('on()', () => {
    it('should register a listener for an event', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('test', callback);
      emitter.emit('test', 42);

      expect(callback).toHaveBeenCalledWith(42);
    });

    it('should support multiple listeners for the same event', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('event', callback1);
      emitter.on('event', callback2);
      emitter.emit('event', 'hello');

      expect(callback1).toHaveBeenCalledWith('hello');
      expect(callback2).toHaveBeenCalledWith('hello');
    });

    it('should support multiple different events', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('event1', callback1);
      emitter.on('event2', callback2);

      emitter.emit('event1', 1);
      emitter.emit('event2', 2);

      expect(callback1).toHaveBeenCalledWith(1);
      expect(callback2).toHaveBeenCalledWith(2);
    });

    it('should not call the same callback multiple times when registered once', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('test', callback);
      emitter.on('test', callback);
      emitter.emit('test', 5);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('off()', () => {
    it('should unregister a listener', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('test', callback);
      emitter.off('test', callback);
      emitter.emit('test', 42);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should only remove the specific callback', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('event', callback1);
      emitter.on('event', callback2);
      emitter.off('event', callback1);
      emitter.emit('event', 'test');

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith('test');
    });

    it('should handle removing non-existent listener gracefully', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      expect(() => {
        emitter.off('nonexistent' as any, callback);
      }).not.toThrow();
    });

    it('should clean up empty listener sets', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('test', callback);
      emitter.off('test', callback);

      emitter.emit('test', 42);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('emit()', () => {
    it('should not throw when emitting event with no listeners', () => {
      const emitter = new EventEmitter<TestEvents>();

      expect(() => {
        emitter.emit('test', 42);
      }).not.toThrow();
    });

    it('should pass payload to all listeners', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const payload: TestPayload = { value: 42 };

      emitter.on('payloadEvent', callback1);
      emitter.on('payloadEvent', callback2);
      emitter.emit('payloadEvent', payload);

      expect(callback1).toHaveBeenCalledWith(payload);
      expect(callback2).toHaveBeenCalledWith(payload);
    });

    it('should handle errors in listeners gracefully', () => {
      const emitter = new EventEmitter<TestEvents>();
      const errorCallback = vi.fn(() => {
        throw new Error('Listener error');
      });
      const successCallback = vi.fn();

      emitter.on('errorEvent', errorCallback);
      emitter.on('errorEvent', successCallback);

      expect(() => {
        emitter.emit('errorEvent', 42);
      }).toThrow('Listener error');

      expect(errorCallback).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('should remove all listeners', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('event1', callback1);
      emitter.on('event2', callback2);

      emitter.dispose();

      emitter.emit('event1', 1);
      emitter.emit('event2', 2);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it('should allow reusing the emitter after disposal', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('event', callback1);
      emitter.dispose();
      emitter.on('event', callback2);
      emitter.emit('event', 'test');

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith('test');
    });
  });

  describe('forEachListener()', () => {
    it('should iterate over all listeners', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      emitter.on('event1', callback1);
      emitter.on('event1', callback2);
      emitter.on('event2', callback3);

      const iterateCallback = vi.fn();
      emitter.forEachListener(iterateCallback);

      expect(iterateCallback).toHaveBeenCalledTimes(3);
      expect(iterateCallback).toHaveBeenCalledWith('event1', callback1);
      expect(iterateCallback).toHaveBeenCalledWith('event1', callback2);
      expect(iterateCallback).toHaveBeenCalledWith('event2', callback3);
    });

    it('should handle empty emitter', () => {
      const emitter = new EventEmitter<TestEvents>();
      const iterateCallback = vi.fn();

      emitter.forEachListener(iterateCallback);

      expect(iterateCallback).not.toHaveBeenCalled();
    });

    it('should allow cleanup operations in iteration', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('event1', callback1);
      emitter.on('event2', callback2);

      emitter.forEachListener((eventName, listener) => {
        emitter.off(eventName as keyof TestEvents, listener as any);
      });

      emitter.emit('event1', 1);
      emitter.emit('event2', 2);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });
});
