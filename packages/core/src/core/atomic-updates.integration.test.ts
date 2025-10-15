import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Actor } from './Actor';
import ActorSystem from './ActorSystem';
import { createActorToken } from './ActorToken';
import { ThreadContext } from './ThreadContext';
import { action, effect } from './decorators';
import type { IActorClient } from './types';

// Mock the virtual manifest module
vi.mock('virtual:worker-manifest', () => ({
  WORKER_PATHS: {}
}));

/**
 * Integration tests for atomic cross-actor state updates
 *
 * These tests verify that when multiple actors update state in response to
 * the same event, observers see all updates atomically (no intermediate states).
 */

// ============================================================================
// Source Actor - Emits events that trigger cascading updates
// ============================================================================

interface SourceState {
  value: number;
}

interface SourceEvents {
  valueChanged: { newValue: number };
}

class SourceActor extends Actor<SourceState, SourceEvents> {
  static readonly initialState: SourceState = { value: 0 };

  constructor() {
    super(SourceActor.initialState);
  }

  @action
  setValue(newValue: number): void {
    this.setState(draft => {
      draft.value = newValue;
    });
    this.emit('valueChanged', { newValue });
  }
}

// ============================================================================
// Derived Actor A - Updates based on source value
// ============================================================================

interface DerivedAState {
  doubled: number;
  updateCount: number;
}

interface DerivedADeps {
  source: IActorClient<SourceActor>;
}

class DerivedActorA extends Actor<DerivedAState> {
  static readonly initialState: DerivedAState = { doubled: 0, updateCount: 0 };

  protected declare deps: DerivedADeps;

  constructor() {
    super(DerivedActorA.initialState);
  }

  @effect('source.value')
  onSourceValueChange(value: number): void {
    this.setState(draft => {
      draft.doubled = value * 2;
      draft.updateCount++;
    });
  }
}

// ============================================================================
// Derived Actor B - Updates based on source value
// ============================================================================

interface DerivedBState {
  tripled: number;
  updateCount: number;
}

interface DerivedBDeps {
  source: IActorClient<SourceActor>;
}

class DerivedActorB extends Actor<DerivedBState> {
  static readonly initialState: DerivedBState = { tripled: 0, updateCount: 0 };

  protected declare deps: DerivedBDeps;

  constructor() {
    super(DerivedActorB.initialState);
  }

  @effect('source.value')
  onSourceValueChange(value: number): void {
    this.setState(draft => {
      draft.tripled = value * 3;
      draft.updateCount++;
    });
  }
}

// ============================================================================
// Composite Observer - Observes both derived actors
// ============================================================================

interface CompositeState {
  lastSum: number;
  observations: Array<{ doubled: number; tripled: number }>;
}

interface CompositeDeps {
  derivedA: IActorClient<DerivedActorA>;
  derivedB: IActorClient<DerivedActorB>;
}

class CompositeActor extends Actor<CompositeState> {
  static readonly initialState: CompositeState = {
    lastSum: 0,
    observations: [],
  };

  protected declare deps: CompositeDeps;

  constructor() {
    super(CompositeActor.initialState);
  }

  @effect('derivedA.doubled')
  @effect('derivedB.tripled')
  onDerivedChange(): void {
    const doubled = this.deps.derivedA.state.doubled;
    const tripled = this.deps.derivedB.state.tripled;

    this.setState(draft => {
      draft.lastSum = doubled + tripled;
      draft.observations.push({ doubled, tripled });
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

const SourceToken = createActorToken<SourceActor>('source');
const DerivedAToken = createActorToken<DerivedActorA>('derived-a');
const DerivedBToken = createActorToken<DerivedActorB>('derived-b');
const CompositeToken = createActorToken<CompositeActor>('composite');

describe('Atomic Cross-Actor Updates Integration', () => {
  let system: ActorSystem;
  let sourceClient: IActorClient<SourceActor>;
  let derivedAClient: IActorClient<DerivedActorA>;
  let derivedBClient: IActorClient<DerivedActorB>;
  let compositeClient: IActorClient<CompositeActor>;

  beforeEach(async () => {
    ThreadContext.reset();

    system = new ActorSystem();

    // Register source actor
    system.register({
      token: SourceToken,
      actor: SourceActor,
    });

    // Register derived actors that depend on source
    system.register({
      token: DerivedAToken,
      actor: DerivedActorA,
      dependencies: { source: SourceToken },
    });

    system.register({
      token: DerivedBToken,
      actor: DerivedActorB,
      dependencies: { source: SourceToken },
    });

    // Register composite actor that depends on both derived actors
    system.register({
      token: CompositeToken,
      actor: CompositeActor,
      dependencies: {
        derivedA: DerivedAToken,
        derivedB: DerivedBToken,
      },
    });

    await system.start();

    sourceClient = system.getClient(SourceToken)!;
    derivedAClient = system.getClient(DerivedAToken)!;
    derivedBClient = system.getClient(DerivedBToken)!;
    compositeClient = system.getClient(CompositeToken)!;
  });

  describe('atomic visibility', () => {
    it('should trigger effects when source state changes', async () => {
      // Simple test to verify effects work at all
      sourceClient.actions.setValue?.(5);
      await flushEffects();

      // Both effects should have fired
      expect(derivedAClient.state.doubled).toBe(10);
      expect(derivedBClient.state.tripled).toBe(15);
      expect(derivedAClient.state.updateCount).toBe(1);
      expect(derivedBClient.state.updateCount).toBe(1);
    });

    it('should update all derived actors atomically when source changes', async () => {
      // Track all state observations
      const observations: Array<{ doubled: number; tripled: number }> = [];

      derivedAClient.on('doubled', () => {
        observations.push({
          doubled: derivedAClient.state.doubled,
          tripled: derivedBClient.state.tripled,
        });
      });

      derivedBClient.on('tripled', () => {
        observations.push({
          doubled: derivedAClient.state.doubled,
          tripled: derivedBClient.state.tripled,
        });
      });

      // Change source value
      sourceClient.actions.setValue?.(10);

      // Wait for effects to execute (main-thread effects are synchronous, but state emission is microt asked)
      await flushEffects();

      // Verify both derived actors updated
      expect(derivedAClient.state.doubled).toBe(20);
      expect(derivedBClient.state.tripled).toBe(30);

      // ATOMIC VISIBILITY CHECK:
      // All observations should show both actors updated together
      // No intermediate state where only one has updated
      if (observations.length > 0) {
        for (const obs of observations) {
          // Should never see partial updates like (20, 0) or (0, 30)
          // Either both are at initial state or both are at final state
          const isInitialState = obs.doubled === 0 && obs.tripled === 0;
          const isFinalState = obs.doubled === 20 && obs.tripled === 30;

          // At least one should be true (not a partial update)
          expect(isInitialState || isFinalState).toBe(true);

          // More specific: should never see these partial states
          expect(obs.doubled === 20 && obs.tripled === 0).toBe(false); // A updated but not B
          expect(obs.doubled === 0 && obs.tripled === 30).toBe(false); // B updated but not A
        }
      }
    });

    it('should prevent intermediate state visibility in composite observer', async () => {
      // Change source value multiple times
      sourceClient.actions.setValue?.(5);
      await flushEffects();

      sourceClient.actions.setValue?.(10);
      await flushEffects();

      // Verify composite observer only saw consistent states
      const observations = compositeClient.state.observations;

      // Each observation should be mathematically consistent:
      // doubled should be 2x source value, tripled should be 3x source value
      for (const obs of observations) {
        if (obs.doubled === 0 && obs.tripled === 0) {
          continue; // Initial state
        }

        // Verify the ratio is consistent (doubled / tripled should equal 2/3)
        const ratio = obs.doubled / obs.tripled;
        expect(ratio).toBeCloseTo(2 / 3, 5);
      }
    });

    it('should batch rapid updates without intermediate visibility', async () => {
      const snapshots: Array<{ doubled: number; tripled: number }> = [];

      // Subscribe to either derived actor
      derivedAClient.on('doubled', () => {
        snapshots.push({
          doubled: derivedAClient.state.doubled,
          tripled: derivedBClient.state.tripled,
        });
      });

      // Rapid updates
      sourceClient.actions.setValue?.(1);
      sourceClient.actions.setValue?.(2);
      sourceClient.actions.setValue?.(3);

      await flushEffects();

      // Should see final state (both updated to 3)
      expect(derivedAClient.state.doubled).toBe(6);
      expect(derivedBClient.state.tripled).toBe(9);

      // All snapshots should be consistent (no partial updates visible)
      for (const snapshot of snapshots) {
        if (snapshot.doubled === 0 && snapshot.tripled === 0) {
          continue; // Initial state
        }
        const ratio = snapshot.doubled / snapshot.tripled;
        expect(ratio).toBeCloseTo(2 / 3, 5);
      }
    });
  });

  describe('update ordering', () => {
    it('should execute effects in insertion order', async () => {
      const executionOrder: string[] = [];

      // Spy on effect methods
      const originalAEffect = DerivedActorA.prototype.onSourceValueChange;
      const originalBEffect = DerivedActorB.prototype.onSourceValueChange;

      DerivedActorA.prototype.onSourceValueChange = function (value: number) {
        executionOrder.push('A');
        originalAEffect.call(this, value);
      };

      DerivedActorB.prototype.onSourceValueChange = function (value: number) {
        executionOrder.push('B');
        originalBEffect.call(this, value);
      };

      // Trigger update
      sourceClient.actions.setValue?.(5);
      await flushEffects();

      // Effects should execute in order (A registered before B)
      expect(executionOrder).toEqual(['A', 'B']);

      // Restore original methods
      DerivedActorA.prototype.onSourceValueChange = originalAEffect;
      DerivedActorB.prototype.onSourceValueChange = originalBEffect;
    });

    it('should propagate updates through dependency chain atomically', async () => {
      // This tests the full chain: Source -> DerivedA/B -> Composite
      sourceClient.actions.setValue?.(10);
      await flushEffects();

      // All actors should have updated
      expect(sourceClient.state.value).toBe(10);
      expect(derivedAClient.state.doubled).toBe(20);
      expect(derivedBClient.state.tripled).toBe(30);
      expect(compositeClient.state.lastSum).toBe(50);

      // CompositeActor has two @effect decorators on the same method,
      // so it fires twice when both properties change (once per subscription)
      // With two-phase flushing, both effects fire in the same microtask but sequentially
      expect(compositeClient.state.observations.length).toBeGreaterThanOrEqual(1);

      // All observations should show consistent state (no partial updates)
      for (const obs of compositeClient.state.observations) {
        expect(obs).toEqual({
          doubled: 20,
          tripled: 30,
        });
      }
    });
  });

  describe('state update batching', () => {
    it('should batch multiple setState calls within one actor', async () => {
      const updateCounts: number[] = [];

      derivedAClient.on('doubled', () => {
        updateCounts.push(derivedAClient.state.updateCount);
      });

      // Single setValue triggers one effect, which calls setState once
      sourceClient.actions.setValue?.(5);
      await flushEffects();

      // Should only see one state emission from derivedA
      expect(updateCounts.length).toBe(1);
      expect(derivedAClient.state.updateCount).toBe(1);
    });

    it('should emit single update even when multiple properties change', async () => {
      const emissionCount: number[] = [];

      compositeClient.on('lastSum', () => {
        emissionCount.push(compositeClient.state.lastSum);
      });

      sourceClient.actions.setValue?.(7);
      await flushEffects();

      // Composite effect updates both lastSum and observations array
      // but should only emit once
      expect(emissionCount.length).toBe(1);
      expect(compositeClient.state.lastSum).toBe(35); // 14 + 21
    });
  });

  describe('effect execution guarantees', () => {
    it('should execute all effects synchronously before flushing', async () => {
      const events: string[] = [];

      // Track when effects execute vs when state emissions happen
      const originalAEffect = DerivedActorA.prototype.onSourceValueChange;
      const originalBEffect = DerivedActorB.prototype.onSourceValueChange;

      DerivedActorA.prototype.onSourceValueChange = function (value: number) {
        events.push('effect-A-start');
        originalAEffect.call(this, value);
        events.push('effect-A-end');
      };

      DerivedActorB.prototype.onSourceValueChange = function (value: number) {
        events.push('effect-B-start');
        originalBEffect.call(this, value);
        events.push('effect-B-end');
      };

      derivedAClient.on('doubled', () => {
        events.push('emit-A');
      });

      derivedBClient.on('tripled', () => {
        events.push('emit-B');
      });

      sourceClient.actions.setValue?.(5);
      await flushEffects();

      // Effects should execute before any emissions
      expect(events).toEqual([
        'effect-A-start',
        'effect-A-end',
        'effect-B-start',
        'effect-B-end',
        'emit-A',
        'emit-B',
      ]);

      // Restore
      DerivedActorA.prototype.onSourceValueChange = originalAEffect;
      DerivedActorB.prototype.onSourceValueChange = originalBEffect;
    });

    it('should handle multiple sequential source updates correctly', async () => {
      sourceClient.actions.setValue?.(5);
      await flushEffects();

      expect(derivedAClient.state.doubled).toBe(10);
      expect(derivedAClient.state.updateCount).toBe(1);

      sourceClient.actions.setValue?.(10);
      await flushEffects();

      expect(derivedAClient.state.doubled).toBe(20);
      expect(derivedAClient.state.updateCount).toBe(2);

      sourceClient.actions.setValue?.(15);
      await flushEffects();

      expect(derivedAClient.state.doubled).toBe(30);
      expect(derivedAClient.state.updateCount).toBe(3);
    });
  });

  describe('error isolation', () => {
    it('should continue updating other actors if one effect fails', async () => {
      // Make DerivedA's effect throw an error
      const originalEffect = DerivedActorA.prototype.onSourceValueChange;
      DerivedActorA.prototype.onSourceValueChange = function () {
        throw new Error('Effect failed');
      };

      sourceClient.actions.setValue?.(5);
      await flushEffects();

      // DerivedB should still update despite DerivedA's error
      expect(derivedBClient.state.tripled).toBe(15);

      // Restore
      DerivedActorA.prototype.onSourceValueChange = originalEffect;
    });
  });

  describe('consistency verification', () => {
    it('should maintain invariants across all updates', async () => {
      // Invariant: doubled = 2 * source.value, tripled = 3 * source.value
      const testValues = [1, 5, 10, 15, 20];

      for (const value of testValues) {
        sourceClient.actions.setValue?.(value);
        await flushEffects();

        expect(derivedAClient.state.doubled).toBe(value * 2);
        expect(derivedBClient.state.tripled).toBe(value * 3);
        expect(compositeClient.state.lastSum).toBe(value * 2 + value * 3);
      }
    });

    it('should never expose partial update state to observers', async () => {
      let partialStateDetected = false;

      // Monitor both actors simultaneously
      derivedAClient.on('doubled', () => {
        const doubled = derivedAClient.state.doubled;
        const tripled = derivedBClient.state.tripled;

        // Check if we can see a state where only one has updated
        // (this would violate atomicity)
        if ((doubled === 20 && tripled === 0) || (doubled === 0 && tripled === 30)) {
          partialStateDetected = true;
        }
      });

      derivedBClient.on('tripled', () => {
        const doubled = derivedAClient.state.doubled;
        const tripled = derivedBClient.state.tripled;

        if ((doubled === 20 && tripled === 0) || (doubled === 0 && tripled === 30)) {
          partialStateDetected = true;
        }
      });

      sourceClient.actions.setValue?.(10);
      await flushEffects();

      // Should never have detected partial state
      expect(partialStateDetected).toBe(false);
    });
  });
});
