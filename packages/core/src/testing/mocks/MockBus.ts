import EventEmitter from '../../messaging/EventEmitter';
import type { IActorBus } from '../../messaging/ActorBus';

/**
 * Mock implementation of IActorBus for testing purposes.
 * Provides a simple in-memory event bus without any cross-thread communication.
 */
export class MockBus<TEventMap> implements IActorBus<TEventMap> {
  private emitter = new EventEmitter<TEventMap>();

  on<K extends keyof TEventMap>(eventName: K, callback: (payload: TEventMap[K]) => void): void {
    this.emitter.on(eventName, callback);
  }

  off<K extends keyof TEventMap>(eventName: K, callback: (payload: TEventMap[K]) => void): void {
    this.emitter.off(eventName, callback);
  }

  emit(eventName: string | number, payload: unknown): void {
    this.emitter.emit(eventName as keyof TEventMap, payload as any);
  }

  /**
   * Test helper: Check if an event has listeners
   */
  hasListeners(eventName: string | number): boolean {
    return this.getListenerCount(eventName) > 0;
  }

  /**
   * Test helper: Get listener count for an event
   */
  getListenerCount(eventName: string | number): number {
    let count = 0;
    this.emitter.forEachListener((name) => {
      if (name === String(eventName)) {
        count++;
      }
    });
    return count;
  }

  /**
   * Test helper: Clear all listeners
   */
  clear(): void {
    this.emitter.dispose();
  }
}
