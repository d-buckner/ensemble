import type { Actor, StateOf, ActionsOf, EventsOf } from './Actor';
import type { AllEvents, TypedListener } from '../messaging/types';

/**
 * Helper type combining state property events and custom events
 */
export type ClientAllEvents<TActor> = AllEvents<StateOf<TActor>, EventsOf<TActor>>;

/**
 * Unified interface for both synchronous (main-thread) and asynchronous (worker-thread) actor clients.
 *
 * This interface provides:
 * - Type-safe state access via the `state` property
 * - Type-safe event subscriptions via `on()` and `off()`
 * - Type-safe action invocations via the `actions` property
 * - Resource cleanup via `dispose()`
 *
 * Implementations:
 * - SyncActorClient: For main-thread actors, provides direct synchronous access
 * - AsyncActorClient: For worker-thread actors, maintains a hydrated state cache
 */
export interface IActorClient<TActor extends Actor<any, any, any>> {
  /**
   * Current state of the actor.
   *
   * For SyncActorClient: Direct reference to actor's internal state
   * For AsyncActorClient: Local cache kept in sync via message passing
   */
  readonly state: StateOf<TActor>;

  /**
   * Subscribe to state property changes or custom events
   *
   * @param eventName - State property name or custom event name
   * @param callback - Function called when event fires
   */
  on<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void;

  /**
   * Unsubscribe from state property changes or custom events
   *
   * @param eventName - State property name or custom event name
   * @param callback - Function to remove from subscribers
   */
  off<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void;

  /**
   * Cleanup all subscriptions and resources
   * Should be called when the client is no longer needed
   */
  dispose(): void;

  /**
   * Proxy object for invoking actor actions.
   *
   * For SyncActorClient: Direct method calls on actor instance
   * For AsyncActorClient: Emits action events to worker thread
   */
  readonly actions: ActionsOf<TActor>;
}
