import type { Actor, StateOf, EventsOf } from './Actor';
import type { AllEvents, TypedListener } from '../messaging/types';
import type { IActorBus } from '../messaging/ActorBus';
import { PROTOCOL_EVENTS } from '../messaging/protocol-events';

// Exclude all base Actor class methods and properties
type BaseActorKeys = keyof Actor<any, any>;

// Extract only the methods defined on the concrete actor, excluding base class members
export type ActionsOf<TActor> = {
  [K in Exclude<keyof TActor, BaseActorKeys>]: TActor[K] extends (...args: any[]) => any
    ? TActor[K]
    : never;
};

/**
 * ActorClient provides type-safe access to an actor's state and events.
 * The generic parameter TActor should be the concrete Actor class type,
 * from which state, events, and actions are automatically inferred.
 */
export interface IActorClient<TActor extends Actor<any, any>> {
  readonly state: StateOf<TActor>;

  on<K extends keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>>(
    eventName: K,
    callback: TypedListener<AllEvents<StateOf<TActor>, EventsOf<TActor>>[K]>
  ): void;

  off<K extends keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>>(
    eventName: K,
    callback: TypedListener<AllEvents<StateOf<TActor>, EventsOf<TActor>>[K]>
  ): void;

  dispose(): void;

  readonly actions: ActionsOf<TActor>;
}

/**
 * Concrete implementation of ActorClient that maintains a local state cache
 * and provides type-safe event subscriptions
 */
export class ActorClient<TActor extends Actor<any, any>> implements IActorClient<TActor> {
  private _state: StateOf<TActor>;
  private bus: IActorBus<AllEvents<StateOf<TActor>, EventsOf<TActor>>>;
  private listeners: Map<string, Set<TypedListener<any>>> = new Map();
  public readonly actions: ActionsOf<TActor>;
  private stateHydrationCallback?: TypedListener<StateOf<TActor>>;
  private isSubscribedToStateUpdates = false;

  constructor(
    bus: IActorBus<AllEvents<StateOf<TActor>, EventsOf<TActor>>>,
    initialState: StateOf<TActor>
  ) {
    this.bus = bus;
    this._state = initialState;
    this.actions = this.createActionProxy();
    this.requestStateHydration();
  }

  get state(): StateOf<TActor> {
    return this._state;
  }

  on<K extends keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>>(
    eventName: K,
    callback: TypedListener<AllEvents<StateOf<TActor>, EventsOf<TActor>>[K]>
  ): void {
    this.bus.on(eventName, callback);
    this.trackListener(eventName as string, callback);
  }

  off<K extends keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>>(
    eventName: K,
    callback: TypedListener<AllEvents<StateOf<TActor>, EventsOf<TActor>>[K]>
  ): void {
    this.bus.off(eventName, callback);

    // Remove from tracking
    const key = eventName as string;
    const listeners = this.listeners.get(key);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.listeners.delete(key);
      }
    }
  }

  /**
   * Track a listener for cleanup
   */
  private trackListener(key: string, callback: TypedListener<any>): void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
  }

  /**
   * Dispose of this client and cleanup all event listeners
   */
  dispose(): void {
    // Unsubscribe all user listeners
    for (const [eventName, callbacks] of this.listeners.entries()) {
      for (const callback of callbacks) {
        this.bus.off(eventName as any, callback);
      }
    }
    this.listeners.clear();

    // Unsubscribe protocol event listeners
    if (this.stateHydrationCallback) {
      this.bus.off(PROTOCOL_EVENTS.STATE as any, this.stateHydrationCallback);
      this.stateHydrationCallback = undefined;
    }
  }

  /**
   * Subscribe to all state property events to keep local cache updated
   * Uses current state to ensure all properties (including optional) are subscribed
   */
  private subscribeToStateUpdates(): void {
    // Subscribe to each state property key
    for (const key in this._state) {
      const callback = (value: any) => {
        // Type-safe state update via index signature
        (this._state as Record<string, unknown>)[key] = value;
      };

      this.bus.on(key as keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>, callback);
      this.trackListener(key, callback);
    }

    this.isSubscribedToStateUpdates = true;
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
    this.bus.on(PROTOCOL_EVENTS.STATE as any, this.stateHydrationCallback);

    // Request state from actor
    this.bus.emit(PROTOCOL_EVENTS.STATE_REQUEST as any, undefined);
  }

  /**
   * Hydrate the local state cache with the full state from the actor
   * Called when receiving state response from actor
   */
  hydrateState(state: StateOf<TActor>): void {
    this._state = state;

    // Subscribe to state updates (idempotent - only subscribes once)
    if (!this.isSubscribedToStateUpdates) {
      this.subscribeToStateUpdates();
    }

    // Emit __hydrated event to notify consumers (like React hooks) that state is ready
    // Consumers can then subscribe to individual state properties
    this.bus.emit(PROTOCOL_EVENTS.HYDRATED as any, state);
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
