import type { ThreadBus } from './ThreadBus';
import type { TypedListener } from './types';

/**
 * The actor bus is a logical wrapper around the thread bus to provide
 * consumers with a bus specific to a given actor
 */

/**
 * Actor bus interface - Transport layer for actor events
 *
 * DESIGN NOTE: This interface uses `unknown` for emit payloads because:
 * 1. The bus routes events from heterogeneous sources (state, custom events, base events)
 * 2. TypeScript's type system has limitations with intersection types (AllEvents)
 * 3. Type safety is enforced at Actor method boundaries (setState, emit, throw)
 *
 * Consumers (on/off) get full type safety. Producers (emit) are trusted to provide
 * correct types, which is enforced by the Actor class methods.
 */
export interface IActorBus<TEventMap> {
  on<K extends keyof TEventMap>(
    eventName: K,
    callback: TypedListener<TEventMap[K]>
  ): void;

  off<K extends keyof TEventMap>(
    eventName: K,
    callback: TypedListener<TEventMap[K]>
  ): void;

  /**
   * Emit an event. Type safety enforced at Actor method level.
   */
  emit(eventName: string | number, payload: unknown): void;
}

/**
 * Concrete implementation of IActorBus that wraps ThreadBus
 * and provides type safety for a specific actor's events
 */
export class ActorBus<TEventMap> implements IActorBus<TEventMap> {
  private threadBus: ThreadBus;
  private actorId: string;

  constructor(
    threadBus: ThreadBus,
    actorId: string
  ) {
    this.threadBus = threadBus;
    this.actorId = actorId;
  }

  on<K extends keyof TEventMap>(
    eventName: K,
    callback: TypedListener<TEventMap[K]>
  ): void {
    this.threadBus.on(this.actorId, eventName as string, callback as (payload: unknown) => void);
  }

  off<K extends keyof TEventMap>(
    eventName: K,
    callback: TypedListener<TEventMap[K]>
  ): void {
    this.threadBus.off(this.actorId, eventName as string, callback as (payload: unknown) => void);
  }

  emit(eventName: string | number, payload: unknown): void {
    this.threadBus.emit(this.actorId, eventName as string, payload);
  }
}
