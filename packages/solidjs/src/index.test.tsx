import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { EnsembleProvider, createActorSystem, createActor } from './index';
import { ActorSystem, Actor, createActorToken, action } from '@d-buckner/ensemble-core';

// Mock the virtual manifest module
vi.mock('virtual:ensemble-worker-manifest', () => ({
  WORKER_PATHS: {}
}));

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

describe('@ensemble/solidjs', () => {
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
    it('should provide ActorSystem to children', async () => {
      await system.start();

      let capturedSystem: ActorSystem | undefined;

      function TestComponent() {
        try {
          capturedSystem = createActorSystem();
        } catch (e) {
          // Expected to throw if not in provider
        }
        return <div>test</div>;
      }

      render(() => (
        <EnsembleProvider system={system}>
          <TestComponent />
        </EnsembleProvider>
      ));

      expect(capturedSystem).toBe(system);
    });

    it('should throw error when createActorSystem called outside provider', () => {
      expect(() => {
        function TestComponent() {
          createActorSystem();
          return <div>test</div>;
        }

        render(() => <TestComponent />);
      }).toThrow('createActorSystem must be used within an EnsembleProvider');
    });
  });

  describe('createActor', () => {
    it('should return actions and reactive state signals', async () => {
      await system.start();

      let capturedActor: any;

      function TestComponent() {
        capturedActor = createActor(CounterToken);
        return <div>test</div>;
      }

      render(() => (
        <EnsembleProvider system={system}>
          <TestComponent />
        </EnsembleProvider>
      ));

      expect(capturedActor).toBeDefined();
      expect(capturedActor.actions.increment).toBeDefined();
      expect(typeof capturedActor.actions.increment).toBe('function');
      expect(typeof capturedActor.state.count).toBe('function');
      expect(capturedActor.state.count()).toBe(0);
    });

    it('should create reactive signals that update when actor state changes', async () => {
      await system.start();

      let capturedActor: any;

      function TestComponent() {
        capturedActor = createActor(CounterToken);
        return <div data-testid="count">{capturedActor.state.count()}</div>;
      }

      const { getByTestId } = render(() => (
        <EnsembleProvider system={system}>
          <TestComponent />
        </EnsembleProvider>
      ));

      const countElement = getByTestId('count');

      // Initial state
      expect(countElement.textContent).toBe('0');

      // Trigger action
      capturedActor.actions.increment();

      // Wait a tick for signal update
      await new Promise(resolve => setTimeout(resolve, 0));

      // Signal should update
      expect(capturedActor.state.count()).toBe(1);
    });

    it('should handle multiple state property updates', async () => {
      await system.start();

      let capturedActor: any;

      function TestComponent() {
        capturedActor = createActor(CounterToken);
        return (
          <div>
            <span data-testid="count">{capturedActor.state.count()}</span>
            <span data-testid="label">{capturedActor.state.label()}</span>
          </div>
        );
      }

      const { getByTestId } = render(() => (
        <EnsembleProvider system={system}>
          <TestComponent />
        </EnsembleProvider>
      ));

      // Update count
      capturedActor.actions.increment();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(capturedActor.state.count()).toBe(1);
      expect(getByTestId('count').textContent).toBe('1');

      // Update label
      capturedActor.actions.setLabel('updated');
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(capturedActor.state.label()).toBe('updated');
      expect(getByTestId('label').textContent).toBe('updated');
    });

    it('should cleanup subscriptions on component dispose', async () => {
      await system.start();

      const client = system.getClient(CounterToken);
      expect(client).toBeDefined();

      const disposeSpy = vi.spyOn(client!, 'dispose');

      function TestComponent() {
        createActor(CounterToken);
        return <div>test</div>;
      }

      const { unmount } = render(() => (
        <EnsembleProvider system={system}>
          <TestComponent />
        </EnsembleProvider>
      ));

      unmount();

      // Should have called dispose
      expect(disposeSpy).toHaveBeenCalled();
    });

    it('should throw error when actor not found', async () => {
      const MissingToken = createActorToken<CounterActor>('missing');

      expect(() => {
        function TestComponent() {
          createActor(MissingToken);
          return <div>test</div>;
        }

        render(() => (
          <EnsembleProvider system={system}>
            <TestComponent />
          </EnsembleProvider>
        ));
      }).toThrow('Actor with id "missing" not found');
    });

    it('should handle rapid sequential state updates', async () => {
      await system.start();

      let capturedActor: any;

      function TestComponent() {
        capturedActor = createActor(CounterToken);
        return <div data-testid="count">{capturedActor.state.count()}</div>;
      }

      render(() => (
        <EnsembleProvider system={system}>
          <TestComponent />
        </EnsembleProvider>
      ));

      // Trigger multiple rapid updates
      capturedActor.actions.increment();
      capturedActor.actions.increment();
      capturedActor.actions.increment();

      // Wait for updates
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should reflect all updates
      expect(capturedActor.state.count()).toBe(3);
    });

  });

  describe('integration', () => {
    it('should work in a real component tree', async () => {
      await system.start();

      function Counter() {
        const counter = createActor(CounterToken);
        return (
          <div data-testid="counter">
            <span data-testid="count">{counter.state.count()}</span>
            <button data-testid="increment" onClick={() => counter.actions.increment()}>
              Increment
            </button>
          </div>
        );
      }

      const { getByTestId } = render(() => (
        <EnsembleProvider system={system}>
          <Counter />
        </EnsembleProvider>
      ));

      const countElement = getByTestId('count');
      const button = getByTestId('increment');

      expect(countElement.textContent).toBe('0');

      // Click button
      button.click();

      // Wait for signal update
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(countElement.textContent).toBe('1');
    });
  });
});
