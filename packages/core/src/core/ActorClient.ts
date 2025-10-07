import type { Actor } from './Actor';
import type { AllEvents, TypedListener } from '../messaging/types';
import type { IActorBus } from '../messaging/ActorBus';
import { getActionMetadata } from './decorators';

// Extract state type from Actor class
export type StateOf<T> = T extends Actor<infer S, any> ? S : never;

// Extract events type from Actor class
export type EventsOf<T> = T extends Actor<any, infer E> ? E : never;

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
  private stateShape: StateOf<TActor>;
  private bus: IActorBus<AllEvents<StateOf<TActor>, EventsOf<TActor>>>;
  private actorClass: new (...args: any[]) => TActor;
  private listeners: Map<string, Set<TypedListener<any>>> = new Map();
  public readonly actions: ActionsOf<TActor>;

  constructor(
    bus: IActorBus<AllEvents<StateOf<TActor>, EventsOf<TActor>>>,
    stateShape: StateOf<TActor>,
    actorClass: new (...args: any[]) => TActor
  ) {
    this.bus = bus;
    this.actorClass = actorClass;
    this.stateShape = stateShape;
    this._state = {} as StateOf<TActor>;
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

    // Track listener for cleanup
    const key = eventName as string;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
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
   * Dispose of this client and cleanup all event listeners
   */
  dispose(): void {
    // Unsubscribe all listeners
    for (const [eventName, callbacks] of this.listeners.entries()) {
      for (const callback of callbacks) {
        this.bus.off(eventName as any, callback);
      }
    }
    this.listeners.clear();
  }

  /**
   * Subscribe to all state property events to keep local cache updated
   * Uses state shape to ensure all properties (including optional) are subscribed
   */
  private subscribeToStateUpdates(): void {
    // Subscribe to each state property key from state shape
    for (const key in this.stateShape) {
      const callback = (value: any) => {
        // Type-safe state update via index signature
        (this._state as Record<string, unknown>)[key] = value;
      };


      this.bus.on(key as keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>, callback);

      // Track for cleanup
      if (!this.listeners.has(key)) {
        this.listeners.set(key, new Set());
      }
      this.listeners.get(key)!.add(callback);
    }
  }

  /**
   * Request initial state hydration from the actor
   */
  private requestStateHydration(): void {
    // Subscribe to __state responses
    this.bus.on('__state' as any, (state: StateOf<TActor>) => {
      this.hydrateState(state);
    });

    // Request state from actor
    this.bus.emit('__state-request' as any, undefined);
  }

  /**
   * Hydrate the local state cache with the full state from the actor
   * Called when receiving state response from actor
   */
  hydrateState(state: StateOf<TActor>): void {
    console.log('[ActorClient.hydrateState] Called with state:', state);
    console.log('[ActorClient.hydrateState] Current _state before:', this._state);

    this._state = state;
    this.stateShape = state;

    console.log('[ActorClient.hydrateState] Updated _state to:', this._state);

    // Subscribe to state updates now that we have the actual state shape
    // This is called exactly once after receiving the state response
    console.log('[ActorClient.hydrateState] Calling subscribeToStateUpdates');
    this.subscribeToStateUpdates();

    // Emit __hydrated event to notify consumers (like React hooks) that state is ready
    // Consumers can then subscribe to individual state properties
    console.log('[ActorClient.hydrateState] Emitting __hydrated event');
    this.bus.emit('__hydrated' as any, state);

    console.log('[ActorClient.hydrateState] Done');
  }

  /**
   * Create a proxy object with methods for all @action decorated methods
   * Calling these methods sends action messages to the actor
   */
  private createActionProxy(): ActionsOf<TActor> {
    const actionMetadata = getActionMetadata(this.actorClass);
    const proxy: any = {};

    for (const { methodName } of actionMetadata) {
      proxy[methodName] = (...args: unknown[]) => {
        // Emit action event with method name as eventName and args as payload
        this.bus.emit(methodName, args);
      };
    }

    return proxy as ActionsOf<TActor>;
  }
}
