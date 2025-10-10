import EventEmitter from './EventEmitter';

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

export interface MessageEvent {
  actorId: string;
  eventName: string;
  timestamp: number;
}

export type MessageMonitor = (event: MessageEvent) => void;

export abstract class ThreadBus {
  private listeners = new Map<string, EventEmitter<Record<string, unknown>>>();
  private messageMonitor?: MessageMonitor;

  on(
    actorId: string,
    eventName: string,
    callback: (payload: unknown) => void
  ): void {
    if (!this.listeners.has(actorId)) {
      this.listeners.set(actorId, new EventEmitter<Record<string, unknown>>());
    }

    this.listeners.get(actorId)!.on(eventName, callback);
  }

  off(
    actorId: string,
    eventName: string,
    callback: (payload: unknown) => void
  ): void {
    this.listeners.get(actorId)?.off(eventName, callback);
  }

  setMessageMonitor(monitor: MessageMonitor | undefined): void {
    this.messageMonitor = monitor;
  }

  emit(
    actorId: string,
    eventName: string,
    payload: unknown
  ): void {
    // Notify monitor if present (for visualization/debugging)
    if (this.messageMonitor) {
      this.messageMonitor({
        actorId,
        eventName,
        timestamp: Date.now()
      });
    }

    this.listeners.get(actorId)?.emit(eventName, payload);
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
    this.listeners.get(actorId)?.emit(eventName, payload);
  }

  protected abstract post(
    actorId: string,
    eventName: string,
    payload: unknown
  ): void
}
