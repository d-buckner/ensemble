import type { Actor } from './Actor';

/**
 * Type-safe token for identifying an actor instance.
 * Carries the actor type information for full type inference.
 */
export interface ActorToken<T extends Actor> {
  readonly __type: T;
  readonly symbol: symbol;
  readonly id: string;
}

/**
 * Creates a type-safe token for an actor.
 * This token can be used for registration, lookup, and hooks with full type inference.
 *
 * @example
 * const CounterToken = createActorToken<CounterActor>('counter');
 * system.register({ token: CounterToken, actor: CounterActor, ... });
 * const counter = createActor(CounterToken); // Type automatically inferred!
 */
export function createActorToken<T extends Actor>(id: string): ActorToken<T> {
  return {
    __type: undefined as any,
    symbol: Symbol(id),
    id
  };
}
