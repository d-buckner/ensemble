/**
 * Thread bus is the core bus local to each thread. The thread bus will receive messages
 * from the main thread and route to the respective actor running on the thread.
 *
 * It's also responsible for emitting messages to
 *  1. Other actors local to the thread
 *  2. The main thread which will route the message to consumers on the main thread or other workers.
 *
 * ThreadBus handles heterogeneous events from multiple actors, so it doesn't have
 * compile-time type safety. Type safety is enforced at the IActorBus level.
 */

interface Listeners {
  [actorId: string]: {
    [eventName: string]: Set<(payload: unknown) => void>
  }
}

export abstract class ThreadBus {
  private listeners: Listeners = {};

  on(
    actorId: string,
    eventName: string,
    callback: (payload: unknown) => void
  ): void {
    if (!this.listeners[actorId]) {
      this.listeners[actorId] = {};
    }

    const actorListeners = this.listeners[actorId];
    if (!actorListeners[eventName]) {
      actorListeners[eventName] = new Set();
    }

    actorListeners[eventName].add(callback);
  }

  off(
    actorId: string,
    eventName: string,
    callback: (payload: unknown) => void
  ): void {
    this.listeners[actorId]?.[eventName]?.delete(callback);
  }

  emit(
    actorId: string,
    eventName: string,
    payload: unknown
  ): void {
    this.listeners[actorId]?.[eventName]?.forEach(callback => {
      callback(payload);
    });
    this.post(actorId, eventName, payload);
  }

  /**
   * Receive and handle an incoming message from another thread
   * Notifies local listeners without posting back (avoids infinite loop)
   */
  receive(
    actorId: string,
    eventName: string,
    payload: unknown
  ): void {
    this.listeners[actorId]?.[eventName]?.forEach(callback => callback(payload));
  }

  protected abstract post(
    actorId: string,
    eventName: string,
    payload: unknown
  ): void
}