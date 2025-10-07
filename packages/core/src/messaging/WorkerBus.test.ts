import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unpack } from 'msgpackr';
import WorkerBus from './WorkerBus';

// Mock self.postMessage for worker environment
const mockPostMessage = vi.fn();
(globalThis as any).self = { postMessage: mockPostMessage };

describe('WorkerBus', () => {
  let bus: WorkerBus;

  beforeEach(() => {
    bus = new WorkerBus();
    mockPostMessage.mockClear();
  });

  describe('emit', () => {
    it('should call self.postMessage with packed data when emitting', () => {
      const actorId = 'test-actor';
      const eventName = 'testEvent';
      const payload = { count: 42, message: 'hello' };

      bus.emit(actorId, eventName, payload);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);

      // Verify the data was packed correctly
      const packedData = mockPostMessage.mock.calls[0][0];
      const unpackedData = unpack(packedData);

      expect(unpackedData).toEqual({
        actorId,
        eventName,
        payload,
      });
    });

    it('should send multiple messages when emitting multiple times', () => {
      bus.emit('actor1', 'event1', { value: 1 });
      bus.emit('actor2', 'event2', { value: 2 });

      expect(mockPostMessage).toHaveBeenCalledTimes(2);

      const data1 = unpack(mockPostMessage.mock.calls[0][0]);
      const data2 = unpack(mockPostMessage.mock.calls[1][0]);

      expect(data1).toEqual({
        actorId: 'actor1',
        eventName: 'event1',
        payload: { value: 1 },
      });

      expect(data2).toEqual({
        actorId: 'actor2',
        eventName: 'event2',
        payload: { value: 2 },
      });
    });

    it('should pack complex payloads correctly', () => {
      const complexPayload = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        string: 'test',
        boolean: true,
        null: null,
      };

      bus.emit('actor', 'event', complexPayload);

      const packedData = mockPostMessage.mock.calls[0][0];
      const unpackedData = unpack(packedData);

      expect(unpackedData.payload).toEqual(complexPayload);
    });

    it('should call local listeners and post to main thread', () => {
      const callback = vi.fn();

      bus.on('actor1', 'event1', callback);
      bus.emit('actor1', 'event1', { data: 'test' });

      // Verify local listener was called
      expect(callback).toHaveBeenCalledWith({ data: 'test' });

      // Verify message was posted to main thread
      expect(mockPostMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('integration with ThreadBus functionality', () => {
    it('should support on/off listener management', () => {
      const callback = vi.fn();

      bus.on('actor1', 'event1', callback);
      bus.emit('actor1', 'event1', { value: 1 });

      expect(callback).toHaveBeenCalledTimes(1);

      bus.off('actor1', 'event1', callback);
      bus.emit('actor1', 'event1', { value: 2 });

      // Should not have been called again
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
