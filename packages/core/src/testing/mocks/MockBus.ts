import type { IActorBus } from '../../messaging/ActorBus';

/**
 * Mock implementation of IActorBus for testing purposes.
 * Provides a simple in-memory event bus without any cross-thread communication.
 */
export class MockBus<TEventMap extends Record<string, unknown>> implements IActorBus<TEventMap> {
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

  /**
   * Test helper: Check if an event has listeners
   */
  hasListeners(eventName: string | number): boolean {
    return (this.listeners.get(eventName)?.size ?? 0) > 0;
  }

  /**
   * Test helper: Get listener count for an event
   */
  getListenerCount(eventName: string | number): number {
    return this.listeners.get(eventName)?.size ?? 0;
  }

  /**
   * Test helper: Clear all listeners
   */
  clear(): void {
    this.listeners.clear();
  }
}
