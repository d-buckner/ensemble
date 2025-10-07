import { createSignal, onCleanup, createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { Actor, ActorSystem, ActorToken, StateOf, ActionsOf } from '@d-buckner/ensemble-core';

// Convert each property to a signal accessor
type ReactiveState<S extends Record<string, unknown>> = {
  [K in keyof S]: () => S[K];
};

interface CreateActorReturn<TActor extends Actor> {
  actions: ActionsOf<TActor>;
  state: ReactiveState<StateOf<TActor>>;
}

const EnsembleContext = createContext<ActorSystem>();

/**
 * Provider component that makes the ActorSystem available to all child components.
 *
 * @example
 * <EnsembleProvider system={system}>
 *   <App />
 * </EnsembleProvider>
 */
export function EnsembleProvider(props: { system: ActorSystem; children: JSX.Element }): JSX.Element {
  return EnsembleContext.Provider({
    value: props.system,
    get children() { return props.children; }
  });
}

/**
 * Accesses the ActorSystem from context.
 * Must be used within an EnsembleProvider.
 */
export function createActorSystem(): ActorSystem {
  const system = useContext(EnsembleContext);
  if (!system) {
    throw new Error('createActorSystem must be used within an EnsembleProvider');
  }
  return system;
}

/**
 * Creates reactive SolidJS signals for an actor's state.
 * Each top-level property becomes a signal that updates when the actor state changes.
 * The actor type is automatically inferred from the token.
 *
 * @example
 * const CounterToken = createActorToken<CounterActor>('counter');
 *
 * <EnsembleProvider system={system}>
 *   <Counter />
 * </EnsembleProvider>
 *
 * function Counter() {
 *   const counter = createActor(CounterToken); // Type automatically inferred!
 *   return (
 *     <div>
 *       Count: {counter.state.count()}
 *       <button onClick={() => counter.actions.increment()}>Increment</button>
 *     </div>
 *   );
 * }
 */
export function createActor<TActor extends Actor>(
  token: ActorToken<TActor>
): CreateActorReturn<TActor> {
  const system = createActorSystem();
  const client = system.getClient(token);

  if (!client) {
    throw new Error(`Actor with id "${token.id}" not found`);
  }

  const initialState = client.state;
  const stateAccessors: Record<string, any> = {};

  // Create a signal for each top-level property
  for (const key in initialState) {
    const [getter, setter] = createSignal(initialState[key]);
    stateAccessors[key] = getter;

    // Subscribe to property changes
    const callback = (value: any) => {
      setter(() => value);
    };
    client.on(key as any, callback);
  }

  onCleanup(() => {
    client.dispose();
  });

  return {
    actions: client.actions,
    state: stateAccessors as ReactiveState<StateOf<TActor>>,
  };
}
