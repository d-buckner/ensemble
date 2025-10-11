# Proposal: Thread-Local Scheduler

**Status**: Draft
**Author**: Performance Analysis
**Date**: 2025-10-10
**Target**: v0.x.0

## Executive Summary

This proposal introduces a **Thread-Local Scheduler** to optimize coordination overhead when running multiple actors on any thread (main thread or worker). Current architecture schedules individual microtasks for each mailbox and state update, creating excessive microtask queue overhead. The proposed solution batches all thread-local work into a single coordinated scheduling pass per thread, reducing microtask overhead by 99%+ in high-load scenarios.

**Expected Impact**:
- **Microtask Reduction**: 1000+ microtasks → 1 microtask per coordination cycle (per thread)
- **Performance Gain**: 10-50% improvement in actor throughput across all threads
- **Latency Improvement**: More predictable message processing timing
- **Scalability**: Sub-linear coordination overhead as actor count increases
- **Worker Performance**: Workers with multiple actors benefit equally

## Problem Statement

### Current Architecture

Each actor's mailbox independently schedules message processing using `queueMicrotask()`:

```typescript
// packages/core/src/core/Mailbox.ts
scheduleProcessing(): void {
  if (!this.processingScheduled && !this.isProcessing) {
    this.processingScheduled = true;
    queueMicrotask(() => {
      this.processingScheduled = false;
      this.processNext();
    });
  }
}
```

Similarly, the `Actor` base class schedules state batching independently:

```typescript
// packages/core/src/core/Actor.ts (conceptual)
setState(updates: Partial<TState>): void {
  // ... state update logic ...
  if (!this.stateBatchScheduled) {
    this.stateBatchScheduled = true;
    queueMicrotask(() => {
      this.flushStateBatch();
    });
  }
}
```

### Performance Problem

In a typical scenario with **10 actors** on a single thread (main or worker), each receiving **100 messages**:

- **Total microtasks**: 10 actors × 100 messages = **1,000 microtasks**
- **Overhead per microtask**: ~5-10μs (V8 scheduling, stack unwinding, closure calls)
- **Total overhead**: 5-10ms of pure coordination overhead
- **Compounding effect**: Each microtask competes with others in the queue

This problem exists on **every thread** that runs multiple actors, not just the main thread.

### Real-World Impact

From trace analysis (Trace-20251010T005207.json):
- Message processing averages 0.089ms
- But coordination overhead is hidden in "Minor GC" and "Microtask queue processing"
- Workers are underutilized (12% of CPU time) despite workload
- Main thread spends significant time in event loop coordination

### Why This Matters

Multiple actors per thread are a **core usage pattern** in Ensemble:

**Main Thread**:
1. **UI State Management**: React/SolidJS state often lives on main thread
2. **Coordination Actors**: Orchestrators that don't need isolation
3. **Low-Latency Services**: UI-reactive logic that needs immediate response
4. **Frequently Communicating Actors**: Co-located actors avoid serialization

**Worker Threads**:
1. **Actor Groups**: Multiple related actors on same worker for performance
2. **Pipeline Actors**: Multi-stage processing pipelines (parser → transformer → validator)
3. **Service Clusters**: Multiple service instances on shared worker
4. **Computational Actors**: Parallel processing actors sharing a worker

The current per-actor microtask overhead makes scaling actors on any thread prohibitively expensive.

## Proposed Solution

### Architecture Overview

Introduce a **thread-local singleton ThreadScheduler** that centralizes all actor coordination within each thread:

```typescript
// packages/core/src/scheduling/ThreadScheduler.ts

/**
 * Thread-local scheduler that coordinates all actor message processing
 * and state updates within a single thread.
 *
 * Each thread (main or worker) gets its own scheduler instance, accessed
 * via the thread-local singleton pattern.
 */
class ThreadScheduler {
  // Thread-local storage: each thread context gets its own instance
  private static threadLocalInstance: ThreadScheduler | null = null;

  private pendingMailboxes = new Set<Mailbox>();
  private pendingStateFlushes = new Set<Actor<any>>();
  private isScheduled = false;

  /**
   * Get the thread-local scheduler instance.
   * Each thread (main or worker) has exactly one scheduler.
   */
  static getInstance(): ThreadScheduler {
    if (!ThreadScheduler.threadLocalInstance) {
      ThreadScheduler.threadLocalInstance = new ThreadScheduler();
    }
    return ThreadScheduler.threadLocalInstance;
  }

  /**
   * Schedule a mailbox for processing in the next coordination cycle.
   */
  scheduleMailbox(mailbox: Mailbox): void {
    this.pendingMailboxes.add(mailbox);
    this.scheduleFlush();
  }

  /**
   * Schedule an actor's state flush in the next coordination cycle.
   */
  scheduleStateFlush(actor: Actor<any>): void {
    this.pendingStateFlushes.add(actor);
    this.scheduleFlush();
  }

  /**
   * Schedule a coordination flush on the next microtask.
   * Only schedules one microtask even if called multiple times.
   */
  private scheduleFlush(): void {
    if (this.isScheduled) return;

    this.isScheduled = true;
    queueMicrotask(() => {
      this.flush();
    });
  }

  /**
   * Execute one coordination cycle: process all pending mailboxes
   * and state flushes that were scheduled.
   */
  private flush(): void {
    this.isScheduled = false;

    // Process all pending mailboxes
    const mailboxes = Array.from(this.pendingMailboxes);
    this.pendingMailboxes.clear();

    for (const mailbox of mailboxes) {
      mailbox.processNextImmediate();
    }

    // Process all pending state flushes
    const actors = Array.from(this.pendingStateFlushes);
    this.pendingStateFlushes.clear();

    for (const actor of actors) {
      actor.flushStateImmediate();
    }

    // If new work was scheduled during flush, it will trigger another microtask
  }
}
```

**Key Design Points**:
- **Thread-local singleton**: Each thread context (main or worker) gets its own instance
- **Zero shared state**: No cross-thread coordination needed
- **Automatic isolation**: Worker threads naturally get separate schedulers
- **Transparent operation**: Actors don't need to know which thread they're on

### Integration Points

#### 1. Mailbox Integration

Modify `Mailbox` to use the thread-local scheduler instead of individual microtasks:

```typescript
// packages/core/src/core/Mailbox.ts
import { ThreadScheduler } from '../scheduling/ThreadScheduler.js';

export class Mailbox {
  private scheduler = ThreadScheduler.getInstance();

  scheduleProcessing(): void {
    if (!this.processingScheduled && !this.isProcessing) {
      this.processingScheduled = true;
      this.scheduler.scheduleMailbox(this);
    }
  }

  // Called by scheduler - processes one message without queueMicrotask
  processNextImmediate(): void {
    this.processingScheduled = false;
    if (this.isProcessing || this.queue.isEmpty) return;

    this.isProcessing = true;
    const handler = this.queue.dequeue();

    try {
      handler();
    } catch (error) {
      console.error('[Mailbox] Handler error:', error);
    } finally {
      this.isProcessing = false;

      // If more work, reschedule
      if (!this.queue.isEmpty) {
        this.scheduler.scheduleMailbox(this);
      }
    }
  }
}
```

#### 2. Actor State Batching Integration

Modify `Actor` state batching to use thread-local scheduler:

```typescript
// packages/core/src/core/Actor.ts
import { ThreadScheduler } from '../scheduling/ThreadScheduler.js';

export abstract class Actor<TState extends object = any> {
  private scheduler = ThreadScheduler.getInstance();

  protected setState(updates: Partial<TState>): void {
    Object.assign(this.pendingStateUpdates, updates);

    if (!this.stateBatchScheduled) {
      this.stateBatchScheduled = true;
      this.scheduler.scheduleStateFlush(this);
    }
  }

  // Called by scheduler
  flushStateImmediate(): void {
    this.stateBatchScheduled = false;

    const updates = this.pendingStateUpdates;
    this.pendingStateUpdates = {} as Partial<TState>;

    Object.assign(this._state, updates);
    this.bus.emit(PROTOCOL_EVENTS.STATE as any, this._state);
  }
}
```

### Thread Isolation

The thread-local singleton pattern provides automatic isolation:

```typescript
// Main thread context
const mainScheduler = ThreadScheduler.getInstance();
// mainScheduler is unique to main thread

// Worker 1 context (separate JavaScript runtime)
const worker1Scheduler = ThreadScheduler.getInstance();
// worker1Scheduler is unique to worker 1, different instance than mainScheduler

// Worker 2 context (separate JavaScript runtime)
const worker2Scheduler = ThreadScheduler.getInstance();
// worker2Scheduler is unique to worker 2, different instance than mainScheduler
```

Each thread has its own JavaScript runtime with separate static class state, so `threadLocalInstance` is naturally thread-local without any special detection needed.

**Benefits**:
- No thread detection code required
- No conditional logic based on thread type
- Works identically on main thread and workers
- Zero cross-thread interference

## Performance Analysis

### Microtask Reduction

**Before** (10 actors, 100 messages each):
- Total microtasks: 1,000
- Overhead: ~10ms
- Coordination pattern: Chaotic, unpredictable ordering

**After**:
- Total microtasks: ~10-20 (one per batch cycle)
- Overhead: ~0.1ms
- Coordination pattern: Deterministic, ordered processing

**Improvement**: 99% reduction in microtask overhead

### Throughput Analysis

Current overhead per message:
- Direct processing: 0.089ms (from trace analysis)
- Microtask scheduling: ~0.01ms
- Total: 0.099ms

With global scheduler:
- Direct processing: 0.089ms
- Amortized scheduling: ~0.001ms (shared across batch)
- Total: 0.090ms

**Throughput improvement**: ~10% per message, scales with actor count

### Latency Characteristics

**Before**: Variable latency depending on microtask queue position
- Message 1: processed in next microtask
- Message 1000: waits for 999 prior microtasks

**After**: Consistent batch processing
- All messages in batch processed together
- Maximum 1 microtask delay
- Predictable timing for UI reactivity

### Memory Impact

**Before**: 1000 microtask closures in queue (~100 bytes each = 100KB)

**After**: 1 microtask + 2 Sets with actor references (~1KB)

**Reduction**: 99% memory overhead reduction

## Migration Strategy

### Phase 1: Implementation (v0.x.0)

1. Create `ThreadScheduler` class with thread-local singleton
2. Add `processNextImmediate()` to `Mailbox`
3. Add `flushStateImmediate()` to `Actor`
4. Feature flag: `ENSEMBLE_USE_THREAD_SCHEDULER` (default: false)

### Phase 2: Validation (v0.x.1)

1. Enable in test suite with feature flag
2. Add performance benchmarks comparing both approaches
3. Validate all existing tests pass
4. Document performance characteristics

### Phase 3: Opt-In Release (v0.x.2)

1. Enable by default for new projects
2. Allow opt-out via `ActorSystem` config:
   ```typescript
   const system = new ActorSystem({
     scheduling: {
       useThreadScheduler: true // default true
     }
   });
   ```

### Phase 4: Deprecation (v0.y.0)

1. Remove opt-out option
2. Thread-local scheduler becomes standard behavior
3. Remove old per-mailbox scheduling code

## Risk Analysis

### Risk 1: Behavioral Changes

**Risk**: Processing order may change subtly

**Mitigation**:
- Actor message processing remains FIFO within each mailbox
- Inter-actor message ordering was never guaranteed anyway
- Add tests to validate ordering semantics
- Document any observable behavioral changes

### Risk 2: Debugging Complexity

**Risk**: Stack traces now go through scheduler

**Mitigation**:
- Maintain debug context tracking (already implemented in Mailbox)
- Add scheduler-specific error wrapping
- Provide dev-mode logging for scheduler coordination
- Update debugging documentation

### Risk 3: Thread Isolation

**Risk**: Scheduler state might leak between threads

**Mitigation**:
- Thread-local singleton pattern ensures natural isolation
- Each JavaScript runtime has separate static class state
- No shared state or cross-thread coordination needed
- Test thoroughly with multiple workers to validate isolation

### Risk 4: Third-Party Integration

**Risk**: External code expecting microtask boundaries

**Mitigation**:
- Feature flag allows disabling scheduler
- Document behavior change in migration guide
- Provide adapter patterns for edge cases
- Test with common libraries (React, SolidJS, etc.)

## Testing Strategy

### Unit Tests

1. **Scheduler basics**:
   - Single mailbox scheduling
   - Multiple mailbox batching
   - State flush coordination
   - Recursive scheduling (messages sent during processing)

2. **Thread isolation**:
   - Each thread gets its own scheduler instance
   - Worker schedulers isolated from main thread scheduler
   - Multiple workers don't interfere with each other
   - Browser vs Node.js environments

### Integration Tests

1. **Message ordering**:
   - FIFO guarantees within actors
   - Cross-actor timing semantics
   - Cascading message chains

2. **State consistency**:
   - Multiple setState calls batch correctly
   - State emitted after all updates applied
   - No race conditions with async effects

### Performance Benchmarks

```typescript
// benchmarks/main-thread-scheduler.bench.ts
import { benchmark } from './utils';

benchmark('10 actors, 100 messages each', () => {
  const actors = createActors(10);
  for (const actor of actors) {
    for (let i = 0; i < 100; i++) {
      actor.processMessage(testMessage);
    }
  }
  // Measure throughput and latency
});

benchmark('100 actors, 10 messages each', () => {
  // Test with many actors, fewer messages
});

benchmark('Deep message chain', () => {
  // Test cascading messages (actor1 → actor2 → actor3 → ...)
});
```

## Documentation Updates

### 1. PERFORMANCE.md

Add new section:

```markdown
## Thread-Local Coordination

When running multiple actors on any thread (main or worker), Ensemble uses a
thread-local scheduler to coordinate message processing and state updates. This
batches all work within each thread into a single microtask per cycle, dramatically
reducing coordination overhead.

**Key Benefits**:
- 99% reduction in microtask queue overhead per thread
- 10-50% throughput improvement for multi-actor threads
- More predictable message processing timing
- Works transparently on main thread and workers

**Behavioral Note**: Message processing order within each actor remains FIFO,
but inter-actor processing order may differ from versions before v0.x.0.
```

### 2. Migration Guide

Document for users upgrading:

```markdown
# Migrating to v0.x.0

## Thread-Local Scheduler

Version 0.x.0 introduces coordinated scheduling for all threads (main and workers).

**Breaking Changes**: None - behavior is semantically equivalent

**Behavioral Changes**:
- Inter-actor message processing order is now batched within each thread
- Within-actor FIFO ordering is preserved
- Latency characteristics more consistent
- Applies to both main thread and worker threads

**Opt-Out** (temporary, will be removed in v0.y.0):
```typescript
const system = new ActorSystem({
  scheduling: { useThreadScheduler: false }
});
```
```

### 3. API Documentation

Update JSDoc for affected methods:

```typescript
/**
 * Schedule this mailbox for processing.
 *
 * Uses the thread-local scheduler to batch processing with other actors
 * on the same thread. Works identically on main thread and workers.
 *
 * @internal
 */
scheduleProcessing(): void
```

## Future Enhancements

### Priority Scheduling

Add priority levels for different actor types:

```typescript
class ThreadScheduler {
  private highPriorityMailboxes = new Set<Mailbox>();
  private normalPriorityMailboxes = new Set<Mailbox>();

  scheduleMailbox(mailbox: Mailbox, priority: 'high' | 'normal' = 'normal'): void {
    const set = priority === 'high' ? this.highPriorityMailboxes : this.normalPriorityMailboxes;
    set.add(mailbox);
    this.scheduleFlush();
  }

  private flush(): void {
    // Process high-priority first
    this.processMailboxSet(this.highPriorityMailboxes);
    this.processMailboxSet(this.normalPriorityMailboxes);
    // ...
  }
}
```

### Time-Slicing

Implement cooperative time-slicing to prevent long-running batches:

```typescript
private flush(): void {
  const startTime = performance.now();
  const timeSlice = 5; // 5ms max

  for (const mailbox of this.pendingMailboxes) {
    if (performance.now() - startTime > timeSlice) {
      // Reschedule remaining work
      this.scheduleFlush();
      break;
    }
    mailbox.processNextImmediate();
  }
}
```

### Telemetry

Add performance monitoring:

```typescript
class ThreadScheduler {
  private metrics = {
    totalFlushes: 0,
    totalMessagesProcessed: 0,
    averageBatchSize: 0,
    maxBatchSize: 0,
  };

  getMetrics() {
    return { ...this.metrics };
  }
}
```

### Cross-Thread Coordination

Explore scheduling coordination between main thread and workers:

```typescript
// Speculative - not part of initial proposal
class CrossThreadScheduler {
  coordinateWithWorkers(workers: Worker[]): void {
    // Use SharedArrayBuffer for lock-free coordination
    // Workers signal when they have pending cross-thread messages
    // Main thread coordinates flush timing
  }
}
```

## Alternatives Considered

### Alternative 1: Batching at ThreadBus Level

**Approach**: Batch messages in ThreadBus before enqueuing to mailboxes

**Pros**:
- Single coordination point
- Could reduce message routing overhead

**Cons**:
- Breaks immediate message delivery semantics
- Requires significant ThreadBus refactoring
- Doesn't address state batching overhead
- Less flexible for future priority scheduling

**Decision**: Rejected - too invasive, limited benefits

### Alternative 2: RequestIdleCallback

**Approach**: Use `requestIdleCallback` instead of `queueMicrotask`

**Pros**:
- Automatically defers to browser idle time
- Could improve perceived performance

**Cons**:
- Much higher latency (could be 50ms+)
- Not available in workers
- Breaks low-latency guarantees actors need
- Not suitable for UI-reactive logic

**Decision**: Rejected - latency too high for actor model

### Alternative 3: Throttle Individual Mailboxes

**Approach**: Add per-mailbox throttling/debouncing

**Pros**:
- Simple implementation
- No coordination needed

**Cons**:
- Still N mailboxes = N microtasks
- Doesn't solve core coordination problem
- Adds unpredictable latency
- Not suitable for all actor types

**Decision**: Rejected - doesn't address root cause

### Alternative 4: User-Space Event Loop

**Approach**: Implement custom event loop outside microtask queue

**Pros**:
- Complete control over scheduling
- Could support advanced features like priority, time-slicing

**Cons**:
- Massive complexity
- Hard to integrate with browser/Node.js event loop
- Would need to reimplement timer, I/O coordination
- Breaks ecosystem integration (React Scheduler, etc.)

**Decision**: Rejected - too complex, diminishing returns

## Success Metrics

### Performance Targets

- **Microtask reduction**: >95% fewer microtasks in 10+ actor scenarios
- **Throughput improvement**: 10-30% faster message processing
- **Memory reduction**: 90%+ reduction in microtask closure overhead
- **Latency consistency**: <10% variance in message processing timing

### Adoption Metrics

- All existing tests pass with scheduler enabled
- No reported behavioral regressions within 3 months
- Performance benchmarks show improvement across scenarios
- Documentation updated and published

### Quality Metrics

- Code coverage: >90% for scheduler code
- Integration tests: 100% passing
- Performance tests: All targets met
- No P0/P1 bugs related to scheduler in first release

## Conclusion

The Thread-Local Scheduler addresses a fundamental performance bottleneck in Ensemble's actor coordination across all threads. By batching all scheduling into a single microtask per cycle within each thread, we achieve:

- **Massive overhead reduction**: 99% fewer microtasks per thread
- **Significant throughput gains**: 10-50% faster processing on all threads
- **Better scalability**: Sub-linear coordination cost as actor count increases
- **Improved predictability**: Consistent timing for UI reactivity and worker processing
- **Universal benefit**: Main thread and workers both optimized identically

The thread-local singleton pattern provides:
- **Natural isolation**: Each thread's scheduler is automatically independent
- **Zero configuration**: No thread detection or conditional logic needed
- **Uniform behavior**: Works identically everywhere
- **Future-proof**: Enables advanced features like priority scheduling and time-slicing

The implementation is non-invasive, backward-compatible, and can be incrementally rolled out with feature flags. This optimization is essential for Ensemble's goal of being a high-performance actor framework suitable for demanding browser applications with complex multi-thread architectures.

**Recommendation**: Proceed with implementation in phases, starting with feature-flagged release to gather real-world performance data across both main thread and worker scenarios.
