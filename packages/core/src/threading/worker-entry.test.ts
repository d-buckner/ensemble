import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pack } from 'msgpackr';

describe('worker-entry', () => {
  let messageListeners: Array<(event: any) => void> = [];
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset listeners
    messageListeners = [];
    mockPostMessage = vi.fn();

    // Mock worker global environment
    (globalThis as any).self = {
      addEventListener: vi.fn((event: string, callback: any) => {
        if (event === 'message') {
          messageListeners.push(callback);
        }
      }),
      postMessage: mockPostMessage,
    };

    // Clear module cache and reimport to set up fresh listeners
    vi.resetModules();
  });

  describe('message handling', () => {
    it('should set up a message listener on initialization', async () => {
      await import('./worker-entry');

      expect((globalThis as any).self.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should unpack and emit messages to the workerBus', async () => {
      const { workerBus } = await import('./worker-entry');

      // Set up a listener on the workerBus
      const listener = vi.fn();
      workerBus.on('test-actor', 'testEvent', listener);

      // Create a packed message
      const payload = { count: 42, message: 'hello' };
      const packedData = pack({
        actorId: 'test-actor',
        eventName: 'testEvent',
        payload,
      });

      // Simulate a message event from main thread
      const messageEvent = {
        data: packedData,
      };

      // Trigger the message listener
      messageListeners.forEach(listener => listener(messageEvent));

      // Verify the workerBus emitted the event to local listeners
      expect(listener).toHaveBeenCalledWith(payload);
    });

    it('should handle messages with different actors and events', async () => {
      const { workerBus } = await import('./worker-entry');

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      workerBus.on('actor1', 'event1', listener1);
      workerBus.on('actor2', 'event2', listener2);

      // Send message to actor1
      const message1 = pack({
        actorId: 'actor1',
        eventName: 'event1',
        payload: { value: 1 },
      });

      messageListeners.forEach(listener => listener({ data: message1 }));

      expect(listener1).toHaveBeenCalledWith({ value: 1 });
      expect(listener2).not.toHaveBeenCalled();

      listener1.mockClear();

      // Send message to actor2
      const message2 = pack({
        actorId: 'actor2',
        eventName: 'event2',
        payload: { value: 2 },
      });

      messageListeners.forEach(listener => listener({ data: message2 }));

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith({ value: 2 });
    });

    it('should handle complex payloads', async () => {
      const { workerBus } = await import('./worker-entry');

      const listener = vi.fn();
      workerBus.on('actor', 'event', listener);

      const complexPayload = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        string: 'test',
        boolean: true,
        null: null,
      };

      const message = pack({
        actorId: 'actor',
        eventName: 'event',
        payload: complexPayload,
      });

      messageListeners.forEach(listener => listener({ data: message }));

      expect(listener).toHaveBeenCalledWith(complexPayload);
    });

    it('should handle malformed messages gracefully', async () => {
      await import('./worker-entry');

      // Send invalid data that can't be unpacked
      const invalidMessage = {
        data: new Uint8Array([0, 1, 2, 3]), // Invalid msgpack data
      };

      // Should not throw
      expect(() => {
        messageListeners.forEach(listener => listener(invalidMessage));
      }).not.toThrow();
    });

    it('should handle messages with missing fields gracefully', async () => {
      await import('./worker-entry');

      // Send a message with missing fields
      const incompleteMessage = pack({
        actorId: 'actor',
        // Missing eventName and payload
      });

      // Should not throw
      expect(() => {
        messageListeners.forEach(listener => listener({ data: incompleteMessage }));
      }).not.toThrow();
    });
  });

  describe('workerBus export', () => {
    it('should export a workerBus instance', async () => {
      const { workerBus } = await import('./worker-entry');

      expect(workerBus).toBeDefined();
      expect(typeof workerBus.on).toBe('function');
      expect(typeof workerBus.off).toBe('function');
      expect(typeof workerBus.emit).toBe('function');
    });
  });
});
