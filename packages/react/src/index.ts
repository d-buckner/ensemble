import { useState, useEffect, createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import type { Actor, ActorSystem, ActorToken, StateOf, ActionsOf } from '@d-buckner/ensemble-core';

interface UseActorReturn<TActor extends Actor> {
  actions: ActionsOf<TActor>;
  state: StateOf<TActor>;
}

const EnsembleContext = createContext<ActorSystem | undefined>(undefined);

/**
 * Provider component that makes the ActorSystem available to all child components.
 *
 * @example
 * <EnsembleProvider system={system}>
 *   <App />
 * </EnsembleProvider>
 */
export function EnsembleProvider({ system, children }: { system: ActorSystem; children: ReactNode }) {
  return createElement(EnsembleContext.Provider, { value: system }, children);
}

/**
 * Hook to access the ActorSystem from context.
 * Must be used within an EnsembleProvider.
 */
export function useActorSystem(): ActorSystem {
  const system = useContext(EnsembleContext);
  if (!system) {
    throw new Error('useActorSystem must be used within an EnsembleProvider');
  }
  return system;
}

/**
 * React hook that provides reactive state for an actor.
 * State updates trigger component re-renders automatically.
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
 *   const { actions, state } = useActor(CounterToken); // Type automatically inferred!
 *   return (
 *     <div>
 *       Count: {state.count}
 *       <button onClick={() => actions.increment()}>Increment</button>
 *     </div>
 *   );
 * }
 */
export function useActor<TActor extends Actor>(
  token: ActorToken<TActor>
): UseActorReturn<TActor> {
  const system = useActorSystem();
  const client = system.getClient(token);

  if (!client) {
    throw new Error(`Actor with id "${token.id}" not found`);
  }

  const initialState = client.state;
  const stateHooks: Record<string, any> = {};
  const stateObject: Record<string, any> = {};

  // Create a useState hook for each top-level property
  for (const key in initialState) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState(initialState[key]);
    stateHooks[key] = setValue;
    stateObject[key] = value;
  }

  useEffect(() => {
    // Subscribe to each property change
    const unsubscribes: Array<() => void> = [];

    for (const key in initialState) {
      const setter = stateHooks[key];
      const callback = (value: any) => {
        setter(value);
      };
      client.on(key as any, callback);
      unsubscribes.push(() => client.off(key as any, callback));
    }

    // Cleanup subscriptions on unmount
    return () => {
      unsubscribes.forEach(cleanup => cleanup());
    };
  }, [client]);

  return {
    actions: client.actions,
    state: stateObject as StateOf<TActor>,
  };
}
