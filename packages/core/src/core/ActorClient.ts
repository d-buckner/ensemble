import { create, type Draft } from 'mutative';
import EventEmitter from '../messaging/EventEmitter';
import { PROTOCOL_EVENTS } from '../messaging/protocol-events';
import type { Actor, StateOf } from './Actor';
import type { IActorClient, ActionsOf, ClientAllEvents } from './types';
import type { IActorBus } from '../messaging/ActorBus';
import type { TypedListener } from '../messaging/types';

// Re-export shared types for backward compatibility
export type { IActorClient, ActionsOf } from './types';

// Export AsyncActorClient as ActorClient for backward compatibility
export { AsyncActorClient as ActorClient };

/**
 * Type guard to check if a client is an AsyncActorClient
 * Useful for distinguishing between SyncActorClient and AsyncActorClient at runtime
 */
export function isAsyncActorClient<TActor extends Actor<any, any>>(
  client: IActorClient<TActor>
): client is AsyncActorClient<TActor> {
  return client instanceof AsyncActorClient;
}

/**
 * AsyncActorClient provides asynchronous access to actors running on worker threads.
 *
 * This client maintains a local state cache that stays synchronized with the worker thread
 * via message passing. All actions are asynchronous and communicate through a bus.
 *
 * Key characteristics:
 * - State is a cached copy, kept in sync via __state_partial protocol events
 * - Actions are proxied through bus.emit() calls
 * - Custom events are subscribed via bus
 * - Requires state hydration on initialization
 */
export class AsyncActorClient<TActor extends Actor<any, any>> implements IActorClient<TActor> {
  private _state: StateOf<TActor>;
  private bus: IActorBus<ClientAllEvents<TActor>>;
  private stateListeners: EventEmitter<StateOf<TActor>> = new EventEmitter();
  private eventListeners: EventEmitter<ClientAllEvents<TActor>> = new EventEmitter();
  public readonly actions: ActionsOf<TActor>;
  private stateHydrationCallback?: TypedListener<StateOf<TActor>>;

  constructor(
    bus: IActorBus<ClientAllEvents<TActor>>,
    initialState: StateOf<TActor>
  ) {
    this.bus = bus;
    this._state = initialState;
    this.actions = this.createActionProxy();
    this.onStatePartial = this.onStatePartial.bind(this);
    this.requestStateHydration();
  }

  get state(): StateOf<TActor> {
    return this._state;
  }

  on<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void {
    // State property subscriptions: store for dispatching when __state_partial arrives
    if (eventName in this._state) {
      this.stateListeners.on(eventName, callback);
      return;
    }

    // Custom/protocol event subscriptions: subscribe to bus and track for cleanup
    this.bus.on(eventName, callback);
    this.eventListeners.on(eventName, callback);
  }

  off<K extends keyof ClientAllEvents<TActor>>(
    eventName: K,
    callback: TypedListener<ClientAllEvents<TActor>[K]>
  ): void {
    // State property listener: remove from state listeners map
    if (eventName in this._state) {
      this.stateListeners.off(eventName, callback);
      return;
    }

    // Custom/protocol event listener: unsubscribe from bus and remove from event listeners map
    this.bus.off(eventName, callback);
    this.eventListeners.off(eventName, callback);
  }

  /**
   * Dispose of this client and cleanup all event listeners
   */
  dispose(): void {
    // Unsubscribe custom/protocol event listeners from bus
    this.eventListeners.forEachListener((eventName, callback) => {
      this.bus.off(eventName as keyof ClientAllEvents<TActor>, callback);
    });

    // Clear all listener maps
    this.stateListeners.dispose();
    this.eventListeners.dispose();

    // Unsubscribe protocol event listeners
    if (this.stateHydrationCallback) {
      this.bus.off(PROTOCOL_EVENTS.STATE as keyof ClientAllEvents<TActor>, this.stateHydrationCallback);
      this.stateHydrationCallback = undefined;
    }

    this.bus.off(PROTOCOL_EVENTS.STATE_PARTIAL as keyof ClientAllEvents<TActor>, this.onStatePartial);
  }

  private onStatePartial(partial: Partial<StateOf<TActor>>): void {
    // Update local state cache with all changed properties using Mutative
    this._state = create(this._state, (draft: Draft<StateOf<TActor>>) => {
      Object.assign(draft, partial);
    }) as StateOf<TActor>;

    // Dispatch to individual property listeners
    for (const key in partial) {
      this.stateListeners.emit(key, partial[key]);
    }
  }

  /**
   * Subscribe to batched state updates to keep local cache updated
   */
  private subscribeToStateUpdates(): void {
    this.bus.on(PROTOCOL_EVENTS.STATE_PARTIAL as keyof ClientAllEvents<TActor>, this.onStatePartial);
  }

  /**
   * Request initial state hydration from the actor
   */
  private requestStateHydration(): void {
    // Subscribe to state property updates BEFORE requesting state
    // This prevents race condition where state changes arrive before subscription
    this.subscribeToStateUpdates();

    // Subscribe to __state responses
    this.stateHydrationCallback = (state: StateOf<TActor>) => {
      this.hydrateState(state);
    };
    this.bus.on(PROTOCOL_EVENTS.STATE as keyof ClientAllEvents<TActor>, this.stateHydrationCallback);

    // Request state from actor
    this.bus.emit(PROTOCOL_EVENTS.STATE_REQUEST as keyof ClientAllEvents<TActor>, undefined);
  }

  /**
   * Hydrate the local state cache with the full state from the actor
   * Called when receiving state response from actor
   */
  hydrateState(state: StateOf<TActor>): void {
    this._state = state;

    // Emit __hydrated event to notify consumers (like React hooks) that state is ready
    this.bus.emit(PROTOCOL_EVENTS.HYDRATED as keyof ClientAllEvents<TActor>, state);
  }

  /**
   * Create a proxy object that dynamically handles all action calls
   * Any property access returns a function that emits an action event
   */
  private createActionProxy(): ActionsOf<TActor> {
    return new Proxy({} as ActionsOf<TActor>, {
      get: (_target, prop: string) => {
        return (...args: unknown[]) => {
          // Emit action event with method name as eventName and args as payload
          this.bus.emit(prop, args);
        };
      }
    });
  }
}
