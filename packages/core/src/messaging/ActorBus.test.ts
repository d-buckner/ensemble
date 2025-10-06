import { describe, it, expect, vi } from 'vitest';
import { ActorBus } from './ActorBus';
import { ThreadBus } from './ThreadBus';

// Mock ThreadBus implementation for testing
class MockThreadBus extends ThreadBus {
  public onSpy = vi.fn();
  public offSpy = vi.fn();
  public emitSpy = vi.fn();

  on(actorId: string, eventName: string, callback: (payload: unknown) => void): void {
    this.onSpy(actorId, eventName, callback);
    super.on(actorId, eventName, callback);
  }

  off(actorId: string, eventName: string, callback: (payload: unknown) => void): void {
    this.offSpy(actorId, eventName, callback);
    super.off(actorId, eventName, callback);
  }

  emit(actorId: string, eventName: string, payload: unknown): void {
    this.emitSpy(actorId, eventName, payload);
    super.emit(actorId, eventName, payload);
  }

  protected post(): void {
    // No-op for testing
  }
}

interface TestEvents {
  testEvent: string;
  numberEvent: number;
  objectEvent: { id: string; value: number };
}

describe('ActorBus', () => {
  it('should delegate on() to ThreadBus with actorId', () => {
    const threadBus = new MockThreadBus();
    const actorBus = new ActorBus<TestEvents>(threadBus, 'test-actor');
    const callback = vi.fn();

    actorBus.on('testEvent', callback);

    expect(threadBus.onSpy).toHaveBeenCalledWith('test-actor', 'testEvent', callback);
  });

  it('should delegate off() to ThreadBus with actorId', () => {
    const threadBus = new MockThreadBus();
    const actorBus = new ActorBus<TestEvents>(threadBus, 'test-actor');
    const callback = vi.fn();

    actorBus.off('testEvent', callback);

    expect(threadBus.offSpy).toHaveBeenCalledWith('test-actor', 'testEvent', callback);
  });

  it('should delegate emit() to ThreadBus with actorId', () => {
    const threadBus = new MockThreadBus();
    const actorBus = new ActorBus<TestEvents>(threadBus, 'test-actor');

    actorBus.emit('testEvent', 'test-value');

    expect(threadBus.emitSpy).toHaveBeenCalledWith('test-actor', 'testEvent', 'test-value');
  });

  it('should support multiple event types', () => {
    const threadBus = new MockThreadBus();
    const actorBus = new ActorBus<TestEvents>(threadBus, 'test-actor');

    actorBus.emit('testEvent', 'string-value');
    actorBus.emit('numberEvent', 42);
    actorBus.emit('objectEvent', { id: 'test', value: 100 });

    expect(threadBus.emitSpy).toHaveBeenCalledWith('test-actor', 'testEvent', 'string-value');
    expect(threadBus.emitSpy).toHaveBeenCalledWith('test-actor', 'numberEvent', 42);
    expect(threadBus.emitSpy).toHaveBeenCalledWith('test-actor', 'objectEvent', { id: 'test', value: 100 });
  });

  it('should invoke callbacks registered with on()', () => {
    const threadBus = new MockThreadBus();
    const actorBus = new ActorBus<TestEvents>(threadBus, 'test-actor');
    const callback = vi.fn();

    actorBus.on('testEvent', callback);
    actorBus.emit('testEvent', 'hello');

    expect(callback).toHaveBeenCalledWith('hello');
  });

  it('should not invoke callbacks after off()', () => {
    const threadBus = new MockThreadBus();
    const actorBus = new ActorBus<TestEvents>(threadBus, 'test-actor');
    const callback = vi.fn();

    actorBus.on('testEvent', callback);
    actorBus.emit('testEvent', 'first');
    expect(callback).toHaveBeenCalledTimes(1);

    actorBus.off('testEvent', callback);
    actorBus.emit('testEvent', 'second');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should support multiple callbacks for same event', () => {
    const threadBus = new MockThreadBus();
    const actorBus = new ActorBus<TestEvents>(threadBus, 'test-actor');
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    actorBus.on('testEvent', callback1);
    actorBus.on('testEvent', callback2);
    actorBus.emit('testEvent', 'value');

    expect(callback1).toHaveBeenCalledWith('value');
    expect(callback2).toHaveBeenCalledWith('value');
  });

  it('should isolate events by actorId', () => {
    const threadBus = new MockThreadBus();
    const actorBus1 = new ActorBus<TestEvents>(threadBus, 'actor-1');
    const actorBus2 = new ActorBus<TestEvents>(threadBus, 'actor-2');

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    actorBus1.on('testEvent', callback1);
    actorBus2.on('testEvent', callback2);

    actorBus1.emit('testEvent', 'value-1');

    expect(callback1).toHaveBeenCalledWith('value-1');
    expect(callback2).not.toHaveBeenCalled();
  });
});
