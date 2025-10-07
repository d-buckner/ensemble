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

  console.log('[useActor] Initial client.state:', client.state);

  // Use a single state object that gets updated when any property changes
  const [state, setState] = useState<StateOf<TActor>>(client.state);

  useEffect(() => {
    console.log('[useActor useEffect] Setting up');

    const unsubscribes: Array<() => void> = [];

    // Create a callback that triggers re-render by setting new state object
    const createCallback = (key: string) => (value: any) => {
      console.log(`[useActor] Received update for ${key}:`, value);
      setState(prevState => ({
        ...prevState,
        [key]: value,
      }));
    };

    // Subscribe to state properties
    const subscribeToProperties = (hydratedState: StateOf<TActor>) => {
      console.log('[useActor] Hydration received, subscribing to state properties:', Object.keys(hydratedState));

      // Update local state with hydrated state
      setState(hydratedState);

      // Subscribe to each property
      for (const key in hydratedState) {
        const callback = createCallback(key);
        console.log(`[useActor] Subscribing to property: ${key}`);
        client.on(key as any, callback);
        unsubscribes.push(() => client.off(key as any, callback));
      }
    };

    // Listen for hydration event
    client.on('__hydrated' as any, subscribeToProperties);
    unsubscribes.push(() => client.off('__hydrated' as any, subscribeToProperties));

    // If already hydrated (main thread actors), subscribe immediately
    if (Object.keys(client.state).length > 0) {
      console.log('[useActor] State already hydrated, subscribing immediately');
      subscribeToProperties(client.state);
    }

    // Cleanup subscriptions on unmount or when client changes
    return () => {
      console.log('[useActor useEffect] Cleaning up subscriptions');
      unsubscribes.forEach(cleanup => cleanup());
    };
  }, [client]);

  console.log('[useActor] Rendering with state:', state);

  return {
    actions: client.actions,
    state,
  };
}
