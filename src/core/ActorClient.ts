import type { Actor } from './Actor';
import type { AllEvents, TypedListener } from '../messaging/types';
import type { IActorBus } from '../messaging/ActorBus';
import { getActionMetadata } from './decorators';

// Extract state type from Actor class
export type StateOf<T> = T extends Actor<infer S, any> ? S : never;

// Extract events type from Actor class
export type EventsOf<T> = T extends Actor<any, infer E> ? E : never;

// Extract action methods from Actor class
export type ActorActions<TActor> = {
  [K in keyof TActor]: TActor[K] extends (...args: any[]) => any
    ? TActor[K]
    : never;
};

/**
 * ActorClient provides type-safe access to an actor's state and events.
 * The generic parameter TActor should be the concrete Actor class type,
 * from which state and events are automatically inferred.
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

  readonly actions: Partial<ActorActions<TActor>>;
}

/**
 * Concrete implementation of ActorClient that maintains a local state cache
 * and provides type-safe event subscriptions
 */
export class ActorClient<TActor extends Actor<any, any>> implements IActorClient<TActor> {
  private _state: StateOf<TActor>;
  private bus: IActorBus<AllEvents<StateOf<TActor>, EventsOf<TActor>>>;
  private actorClass: new (...args: any[]) => TActor;
  public readonly actions: Partial<ActorActions<TActor>>;

  constructor(
    bus: IActorBus<AllEvents<StateOf<TActor>, EventsOf<TActor>>>,
    initialState: StateOf<TActor>,
    actorClass: new (...args: any[]) => TActor
  ) {
    this.bus = bus;
    this.actorClass = actorClass;
    this._state = initialState;
    this.actions = this.createActionProxy();
    this.subscribeToStateUpdates();
  }

  get state(): StateOf<TActor> {
    return this._state;
  }

  on<K extends keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>>(
    eventName: K,
    callback: TypedListener<AllEvents<StateOf<TActor>, EventsOf<TActor>>[K]>
  ): void {
    this.bus.on(eventName, callback);
  }

  off<K extends keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>>(
    eventName: K,
    callback: TypedListener<AllEvents<StateOf<TActor>, EventsOf<TActor>>[K]>
  ): void {
    this.bus.off(eventName, callback);
  }

  /**
   * Subscribe to all state property events to keep local cache updated
   */
  private subscribeToStateUpdates(): void {
    // Subscribe to each state property key
    for (const key in this._state) {
      this.bus.on(key as keyof AllEvents<StateOf<TActor>, EventsOf<TActor>>, (value) => {
        // Type-safe state update via index signature
        (this._state as Record<string, unknown>)[key] = value;
      });
    }
  }

  /**
   * Create a proxy object with methods for all @action decorated methods
   * Calling these methods sends action messages to the actor
   */
  private createActionProxy(): Partial<ActorActions<TActor>> {
    const actionMetadata = getActionMetadata(this.actorClass);
    const proxy: any = {};

    for (const { methodName } of actionMetadata) {
      proxy[methodName] = (...args: unknown[]) => {
        // Emit action event to bus
        // The actor on the other end will execute the actual method
        this.bus.emit('__action', {
          method: methodName,
          args,
        });
      };
    }

    return proxy;
  }
}
