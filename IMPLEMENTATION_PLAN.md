# Ensemble Production Hardening - Implementation Plan

**Generated from comprehensive design review**
**Focus**: Critical issues + selected high/medium priority improvements

---

## Overview

This plan addresses production quality issues and architectural improvements identified in the comprehensive review of Ensemble's conformity to first principles. The project has a solid foundation but needs hardening for production use.

**Selected Issues:**
- **Critical (1-3)**: Logger service, circular dependency detection, automatic cleanup
- **High Priority (5)**: State hydration timing fix
- **Medium Priority (7-10, 15)**: Documentation, type safety, best practices

---

## Phase 1: Critical Issues

### 1. Logger Service (Replace console.log)

**Problem**: ~30+ console.log statements throughout production code
**Files Affected**: `Actor.ts`, `ActorClient.ts`, `ActorSystem.ts`, `ThreadBus.ts`, `WorkerRuntime.ts`

**Implementation**:

1. Create `packages/core/src/utils/Logger.ts`:
   ```typescript
   export enum LogLevel {
     DEBUG = 0,
     INFO = 1,
     WARN = 2,
     ERROR = 3,
     NONE = 4
   }

   export class Logger {
     private static level: LogLevel = LogLevel.INFO;

     static setLevel(level: LogLevel): void {
       this.level = level;
     }

     static debug(context: string, message: string, ...args: unknown[]): void {
       if (this.level <= LogLevel.DEBUG) {
         console.log(`[DEBUG][${context}] ${message}`, ...args);
       }
     }

     static info(context: string, message: string, ...args: unknown[]): void {
       if (this.level <= LogLevel.INFO) {
         console.log(`[INFO][${context}] ${message}`, ...args);
       }
     }

     static warn(context: string, message: string, ...args: unknown[]): void {
       if (this.level <= LogLevel.WARN) {
         console.warn(`[WARN][${context}] ${message}`, ...args);
       }
     }

     static error(context: string, message: string, ...args: unknown[]): void {
       if (this.level <= LogLevel.ERROR) {
         console.error(`[ERROR][${context}] ${message}`, ...args);
       }
     }
   }
   ```

2. Replace console.log calls in each file:
   - `Actor.ts:41-67` → `Logger.debug('Actor', ...)`
   - `ActorClient.ts:144-172` → `Logger.debug('ActorClient', ...)`
   - `ActorSystem.ts:118-188` → `Logger.debug('ActorSystem', ...)`
   - `ThreadBus.ts:27-58` → `Logger.debug('ThreadBus', ...)`
   - `WorkerRuntime.ts` → `Logger.debug('WorkerRuntime', ...)`

3. Export Logger from main package index
4. Set default log level to WARN for production

**Testing**:
- Verify all existing tests pass
- Add Logger.setLevel(LogLevel.DEBUG) in tests that need verbose output
- Test that NONE level silences all output

---

### 2. Circular Dependency Detection

**Problem**: ActorSystem assumes correct registration order; no cycle detection
**File**: `packages/core/src/core/ActorSystem.ts`

**Implementation**:

1. Add cycle detection method to ActorSystem:
   ```typescript
   private detectCycle(startToken: ActorToken<any>): string[] | null {
     const visited = new Set<string>();
     const recursionStack = new Set<string>();

     const dfs = (tokenId: string, path: string[]): string[] | null => {
       if (recursionStack.has(tokenId)) {
         // Found cycle - return the cycle path
         const cycleStart = path.indexOf(tokenId);
         return path.slice(cycleStart).concat(tokenId);
       }

       if (visited.has(tokenId)) {
         return null; // Already explored this path
       }

       visited.add(tokenId);
       recursionStack.add(tokenId);

       const node = this.graph[tokenId];
       if (node && node.dependencies) {
         for (const depToken of Object.values(node.dependencies)) {
           const cycle = dfs(depToken.id, [...path, tokenId]);
           if (cycle) return cycle;
         }
       }

       recursionStack.delete(tokenId);
       return null;
     };

     return dfs(startToken.id, []);
   }
   ```

2. Call in `start` after registering to graph:

**Testing**:
- Add test case with A → B → C → A cycle
- Verify error message shows full cycle path
- Verify graph state is rolled back

---

### 3. Automatic ActorClient Cleanup

**Problem**: `ActorClient.dispose()` exists but never called; potential memory leaks
**Files**: `ActorSystem.ts`, `ActorClient.ts`

**Implementation**:

1. Add `shutdown()` method to ActorSystem:
   ```typescript
   async shutdown(): Promise<void> {
     // Call onDestroy lifecycle hooks
     for (const [symbol, instance] of this.instances.entries()) {
       if (instance.onDestroy) {
         await instance.onDestroy();
       }
     }

     // Dispose all clients
     for (const [symbol, client] of this.clients.entries()) {
       client.dispose();
     }

     // Clear collections
     this.instances.clear();
     this.clients.clear();

     // Terminate workers
     this.workerRegistry.terminateAll();

     // Clear main bus
     this.mainBus = undefined;
   }
   ```

2. Add `terminateAll()` to WorkerRegistry:
   ```typescript
   terminateAll(): void {
     for (const worker of this.workers.values()) {
       worker.terminate();
     }
     this.workers.clear();
   }
   ```

3. Update ActorClient to unsubscribe protocol events in dispose():
   ```typescript
   dispose(): void {
     // Unsubscribe all tracked listeners
     for (const [eventName, callbacks] of this.listeners.entries()) {
       for (const callback of callbacks) {
         this.bus.off(eventName as any, callback);
       }
     }

     // Unsubscribe protocol events (not tracked)
     // These are subscribed in requestStateHydration()
     // Need to store these callbacks to unsubscribe them

     this.listeners.clear();
   }
   ```

**Testing**:
- Add integration test that creates system, starts it, then shuts down
- Verify no listeners remain
- Verify workers terminated
- Test multiple start/shutdown cycles

---

## Phase 2: High Priority Fix

### 5. State Hydration Timing

**Problem**: ActorClient subscribes to state updates AFTER hydration, potential race condition
**File**: `packages/core/src/core/ActorClient.ts`

**Current Flow (Race Condition)**:
```
constructor() → requestStateHydration() → emits __state-request
                                         ↓
                                    hydrateState() → subscribeToStateUpdates()
```

If state changes between request and subscription, updates are missed.

**Implementation**:

1. Move subscription before request in `requestStateHydration()`:
   ```typescript
   private requestStateHydration(): void {
     Logger.debug('ActorClient', 'Subscribing to __state responses');

     // Subscribe to __state responses
     this.bus.on(PROTOCOL_EVENTS.STATE as any, (state: StateOf<TActor>) => {
       Logger.debug('ActorClient', 'Received __state response:', state);
       this.hydrateState(state);
     });

     // Request state from actor
     Logger.debug('ActorClient', 'Emitting __state-request');
     this.bus.emit(PROTOCOL_EVENTS.STATE_REQUEST as any, undefined);
   }
   ```

2. Update `hydrateState()` to only subscribe if not already subscribed:
   ```typescript
   private isSubscribedToStateUpdates = false;

   hydrateState(state: StateOf<TActor>): void {
     Logger.debug('ActorClient', 'hydrateState called with:', state);
     this._state = state;
     this.stateShape = state;

     // Subscribe to state updates (idempotent)
     if (!this.isSubscribedToStateUpdates) {
       this.subscribeToStateUpdates();
       this.isSubscribedToStateUpdates = true;
     }

     // Emit __hydrated event
     this.bus.emit(PROTOCOL_EVENTS.HYDRATED as any, state);
     Logger.debug('ActorClient', 'Emitted __hydrated event');
   }
   ```

**Testing**:
- Test rapid state changes during hydration
- Verify no updates are lost
- Test with both main thread and worker actors

---

## Phase 3: Documentation

### 7. Create Missing Documentation

**Problem**: HIGH_LEVEL_DESIGN.md references non-existent documentation

#### 7a. Create `packages/core/src/core/README.md`

**Content Outline**:
```markdown
# Actor Implementation

## Overview
Core actor abstractions and their relationships.

## Actor Class
- State management with Immer
- Action decorator and invocation
- State change events
- Error handling with throw()
- Lifecycle hooks (onInit, onDestroy)

## ActorClient
- Local state cache
- Event subscriptions (on/off/dispose)
- Action proxy
- State hydration protocol

## ActorToken
- Type-safe actor lookup
- Symbol-based identity

## Decorators
- @action: Mark methods as remotely callable
- @effect: Subscribe to dependency events
- @thread: Specify execution context

## ActorSystem
- Registration and dependency resolution
- Topology management
- Lifecycle coordination
```

#### 7b. Create `packages/core/src/messaging/README.md`

**Content Outline**:
```markdown
# Message Bus Architecture

## Overview
Three-layer bus hierarchy for actor communication.

## ActorBus
- Type-safe wrapper per actor
- Converts typed events to thread bus calls

## ThreadBus (Abstract)
- Local event routing within a thread
- Listeners keyed by [actorId][eventName]
- emit() → notifies local + post() to other threads
- receive() → notifies local only (from other threads)

## MainBus
- Queries ActorSystem for actor locations
- Routes to local actors or workers
- Handles worker → main communication
- Special handling for __state messages

## WorkerBus
- Minimal implementation (12 lines)
- Posts all messages to main thread
- Main thread handles routing

## Message Flow Examples
1. Same thread: ActorBus → ThreadBus (local delivery)
2. Main → Worker: ActorBus → MainBus → Worker.postMessage
3. Worker → Main: ActorBus → WorkerBus → self.postMessage → MainBus
4. Worker → Worker: ActorBus → WorkerBus → MainBus → Worker.postMessage
```

**Testing**:
- Verify links work in HIGH_LEVEL_DESIGN.md
- Review docs with fresh eyes for clarity

---

## Phase 4: Type Safety Improvements

### 8. Effect Type Safety (Compile-Time Validation)

**Problem**: `@effect('todoActor.todos')` uses runtime string parsing; typos not caught

**Implementation**:

This is challenging with current TypeScript limitations. Best approach:

1. Create a type-safe effect factory:
   ```typescript
   export function createTypedEffect<TDeps extends Record<string, ActorClient<any>>>() {
     return function <
       TDepKey extends keyof TDeps & string,
       TEventKey extends keyof AllEvents<
         StateOf<TDeps[TDepKey] extends ActorClient<infer A> ? A : never>,
         EventsOf<TDeps[TDepKey] extends ActorClient<infer A> ? A : never>
       > & string
     >(
       subscriptions: `${TDepKey}.${TEventKey}`[]
     ) {
       return effect(...subscriptions);
     };
   }
   ```

2. Usage in actor:
   ```typescript
   interface StatsDeps {
     todoActor: ActorClient<TodoActor>;
   }

   const typedEffect = createTypedEffect<StatsDeps>();

   class StatsActor extends Actor<StatsState> {
     protected deps!: StatsDeps;

     @typedEffect(['todoActor.todos']) // Compile-time validated!
     updateStats(): void { ... }
   }
   ```

**Limitations**: Requires defining deps interface separately. Worth it for compile-time safety.

**Testing**:
- Add test with intentional typo, verify compile error
- Verify runtime behavior unchanged

---

### 9. Standardize Protocol Events

**Problem**: Mix of string literals and PROTOCOL_EVENTS enum

**Implementation**:

1. Audit all protocol event usage:
   - `Actor.ts:63,65` - uses PROTOCOL_EVENTS ✓
   - `ActorClient.ts:146,153,171` - uses PROTOCOL_EVENTS ✓
   - `MainBus.ts:65` - uses PROTOCOL_EVENTS ✓
   - `WorkerRuntime.ts:60` - uses magic string `'__state'` ✗

2. Update `WorkerRuntime.ts:60`:
   ```typescript
   import { PROTOCOL_EVENTS } from '../messaging/protocol-events';

   // Send initial state to main thread for ActorClient hydration
   actorBus.emit(PROTOCOL_EVENTS.STATE as any, actorInstance.state);
   ```

3. Verify no other magic strings for protocol events

**Testing**:
- Grep for '__state', '__hydrated', '__state-request' literals
- Verify all tests pass

---

### 10. Dependency Injection Helper

**Problem**: Type assertion in ActorSystem: `(actorInstance as unknown as { deps: ... }).deps = deps`

**Implementation**:

1. Create type helper in `ActorSystem.ts`:
   ```typescript
   export type WithDeps<TDeps extends Record<string, ActorClient<any>>> = {
     deps: TDeps;
   };
   ```

2. Update actor instantiation:
   ```typescript
   // Before
   (actorInstance as unknown as { deps: Record<string, ActorClient<any>> }).deps = deps;

   // After
   if (Object.keys(deps).length > 0) {
     (actorInstance as any as WithDeps<typeof deps>).deps = deps;
   }
   ```

3. Update Actor class to include optional deps:
   ```typescript
   export abstract class Actor<
     TState extends UnknownObject = {},
     TEvents extends EventMap = {}
   > {
     protected deps?: Record<string, ActorClient<any>>;
     // ... rest of class
   }
   ```

**Testing**:
- Verify type inference works
- Verify existing dependency injection tests pass

---

## Phase 5: Best Practices Documentation

### 15. Thread Topology Best Practices

**Problem**: No guidance on when/how to use workers

**Implementation**:

Create `BEST_PRACTICES.md` in project root:

```markdown
# Ensemble Best Practices

## Thread Topology Decisions

### Decision Tree: Should This Actor Run on a Worker?

**Ask these questions in order:**

1. **Does it communicate frequently with UI/main thread actors?**
   - YES → Keep on main thread
   - NO → Continue

2. **Does it perform heavy computation (>16ms blocking)?**
   - YES → Move to worker
   - NO → Continue

3. **Does it process large amounts of data?**
   - YES → Move to worker
   - NO → Keep on main thread

### Common Patterns

#### Pattern 1: Data Processing Pipeline
```
[Main Thread]           [Worker: data-processor]
- UI Actor              - ParserActor
- RouterActor           - TransformActor
                        - ValidatorActor
```

**When**: Heavy data transformation separate from UI

#### Pattern 2: Computational Background Tasks
```
[Main Thread]           [Worker: analytics]
- UI Actors             - MetricsActor
- StateActor            - AggregationActor
```

**When**: Analytics/metrics that don't need immediate results

#### Pattern 3: All Main Thread (Default)
```
[Main Thread]
- All actors here
```

**When**: CRUD apps, typical interactive apps

### Anti-Patterns

❌ **DON'T**: Put chatty actors on different workers
```
// BAD: Frequent cross-worker communication
@thread('worker-1')
class ActorA { /* emits 60 events/sec */ }

@thread('worker-2')
class ActorB { /* depends on ActorA */ }
```

❌ **DON'T**: Create workers "just in case"
```
// BAD: No computational benefit
@thread('worker-1')
class SimpleCounterActor { }
```

❌ **DON'T**: Put actors with DOM access on workers
```
// BAD: Workers can't access DOM
@thread('worker-1')
class ChartRendererActor { }
```

### Performance Tips

1. **Co-locate related actors**: Keep actors that communicate frequently on same thread
2. **Measure first**: Profile before moving to workers
3. **Batch updates**: If worker emits many events, batch them
4. **Minimize payload size**: Large messages have serialization cost

### Monitoring Checklist

When using workers, monitor:
- [ ] Message volume per second
- [ ] Average message payload size
- [ ] Main thread utilization
- [ ] Worker idle time
- [ ] Time spent in serialization

### Example: Traffic Monitor Demo

The traffic-monitor demo demonstrates effective worker usage:

```typescript
// Main thread - UI and routing
class UIActor { }
class RouterActor { }

// Worker - heavy data processing
@thread('traffic-worker')
class TrafficAnalyzer {
  // Processes 1000s of network events
  // Computes statistics
  // Emits aggregated results (not individual events)
}
```

**Why this works:**
- Heavy computation isolated
- Low message frequency (aggregated results)
- UI stays responsive
```

**Testing**:
- Review with team
- Add link from HIGH_LEVEL_DESIGN.md

---

## Execution Order

1. **Phase 1 (Critical)**: Logger, Circular deps, Cleanup
2. **Phase 2**: State hydration fix
3. **Phase 3**: Documentation
4. **Phase 4**: Type safety (8, 9, 10)
5. **Phase 5**: Best practices doc

## Testing Strategy

After each phase:
1. Run full test suite: `npm test`
2. Run type checking: `npm run typecheck`
3. Test demos manually:
   - `npm run demo:react:counter`
   - `npm run demo:react:traffic-monitor`
   - `npm run demo:solidjs:counter`
4. Verify no console warnings/errors

## Success Criteria

- [ ] All tests pass
- [ ] No console.log in production code
- [ ] Zero type assertions with `as unknown`
- [ ] Circular dependency detection working
- [ ] System shutdown/cleanup implemented
- [ ] Documentation complete and linked
- [ ] Demos functional
- [ ] Type errors caught at compile time
- [ ] Best practices documented

---

**Estimated Effort**: 2-3 days of focused work
