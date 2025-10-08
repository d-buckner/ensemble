import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { EnsembleProvider, useActorSystem, useActor } from './index';
import { ActorSystem, Actor, createActorToken, action } from '@d-buckner/ensemble-core';

// Test Actor
interface CounterState extends Record<string, unknown> {
  count: number;
  label: string;
}

interface CounterEvents extends Record<string, unknown> {
  incremented: { oldValue: number; newValue: number };
}

class CounterActor extends Actor<CounterState, CounterEvents> {
  static readonly initialState: CounterState = { count: 0, label: 'test' };

  constructor() {
    super(CounterActor.initialState);
  }

  @action
  increment(): void {
    let oldValue: number;
    let newValue: number;
    this.setState(draft => {
      oldValue = draft.count;
      draft.count++;
      newValue = draft.count;
    });
    this.emit('incremented', { oldValue: oldValue!, newValue: newValue! });
  }

  @action
  setLabel(label: string): void {
    this.setState(draft => {
      draft.label = label;
    });
  }
}

describe('@ensemble/react', () => {
  let system: ActorSystem;
  const CounterToken = createActorToken<CounterActor>('counter');

  beforeEach(() => {
    system = new ActorSystem();
    system.register({
      token: CounterToken,
      actor: CounterActor
    });
  });

  describe('EnsembleProvider', () => {
    it('should provide ActorSystem to children', () => {
      const { result } = renderHook(() => useActorSystem(), {
        wrapper: ({ children }) =>
          createElement(EnsembleProvider, { system }, children)
      });

      expect(result.current).toBe(system);
    });

    it('should throw error when useActorSystem called outside provider', () => {
      expect(() => {
        renderHook(() => useActorSystem());
      }).toThrow('useActorSystem must be used within an EnsembleProvider');
    });
  });

  describe('useActor', () => {
    it('should return actions and state from actor client', async () => {
      await system.start();

      const { result } = renderHook(() => useActor(CounterToken), {
        wrapper: ({ children }) =>
          createElement(EnsembleProvider, { system }, children)
      });

      expect(result.current.state).toEqual({ count: 0, label: 'test' });
      expect(result.current.actions.increment).toBeDefined();
      expect(typeof result.current.actions.increment).toBe('function');
    });

    it('should update state reactively when actor state changes', async () => {
      await system.start();

      const { result } = renderHook(() => useActor(CounterToken), {
        wrapper: ({ children }) =>
          createElement(EnsembleProvider, { system }, children)
      });

      // Initial state
      expect(result.current.state.count).toBe(0);

      // Trigger action
      result.current.actions.increment();

      // Wait for state update
      await waitFor(() => {
        expect(result.current.state.count).toBe(1);
      });
    });

    it('should handle multiple state property updates', async () => {
      await system.start();

      const { result } = renderHook(() => useActor(CounterToken), {
        wrapper: ({ children }) =>
          createElement(EnsembleProvider, { system }, children)
      });

      // Update count
      result.current.actions.increment();
      await waitFor(() => {
        expect(result.current.state.count).toBe(1);
      });

      // Update label
      result.current.actions.setLabel('updated');
      await waitFor(() => {
        expect(result.current.state.label).toBe('updated');
      });

      // Both properties should be updated
      expect(result.current.state.count).toBe(1);
      expect(result.current.state.label).toBe('updated');
    });

    it('should cleanup subscriptions on unmount', async () => {
      await system.start();

      const { unmount } = renderHook(() => useActor(CounterToken), {
        wrapper: ({ children }) =>
          createElement(EnsembleProvider, { system }, children)
      });

      const client = system.getClient(CounterToken);
      expect(client).toBeDefined();

      // Spy on cleanup
      const offSpy = vi.spyOn(client!, 'off');

      unmount();

      // Should have cleaned up listeners
      expect(offSpy).toHaveBeenCalled();
    });

    it('should throw error when actor not found', async () => {
      const MissingToken = createActorToken<CounterActor>('missing');

      // Don't start system - actor won't be instantiated

      expect(() => {
        renderHook(() => useActor(MissingToken), {
          wrapper: ({ children }) =>
            createElement(EnsembleProvider, { system }, children)
        });
      }).toThrow('Actor with id "missing" not found');
    });

    it('should handle rapid sequential state updates', async () => {
      await system.start();

      const { result } = renderHook(() => useActor(CounterToken), {
        wrapper: ({ children }) =>
          createElement(EnsembleProvider, { system }, children)
      });

      // Trigger multiple rapid updates
      result.current.actions.increment();
      result.current.actions.increment();
      result.current.actions.increment();

      // Should eventually reflect all updates
      await waitFor(() => {
        expect(result.current.state.count).toBe(3);
      });
    });

    it('should maintain referential stability of actions', async () => {
      await system.start();

      const { result, rerender } = renderHook(() => useActor(CounterToken), {
        wrapper: ({ children }) =>
          createElement(EnsembleProvider, { system }, children)
      });

      const firstActions = result.current.actions;

      // Force re-render
      rerender();

      // Actions should be the same reference
      expect(result.current.actions).toBe(firstActions);
    });
  });

  describe('integration', () => {
    it('should work in a real component tree', async () => {
      await system.start();

      function Counter() {
        const { state, actions } = useActor(CounterToken);
        return createElement('div', { 'data-testid': 'counter' },
          createElement('span', { 'data-testid': 'count' }, state.count),
          createElement('button', {
            'data-testid': 'increment',
            onClick: () => actions.increment()
          }, 'Increment')
        );
      }

      const { getByTestId } = render(
        createElement(EnsembleProvider, { system },
          createElement(Counter)
        )
      );

      const countElement = getByTestId('count');
      const button = getByTestId('increment');

      expect(countElement.textContent).toBe('0');

      // Click button
      button.click();

      await waitFor(() => {
        expect(countElement.textContent).toBe('1');
      });
    });
  });
});
