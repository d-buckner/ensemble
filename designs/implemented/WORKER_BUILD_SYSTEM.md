# Design: Worker Build System Completion

## Overview

This design documents the completion of the **vite-plugin worker build system** that generates functional Web Worker bundles from `ensemble.json` configuration. The current implementation has the infrastructure in place but generates **non-functional worker entry code** that fails to properly initialize the worker runtime.

**Expected Impact**:
- **Functional Threading**: Enable actors to actually run in Web Workers as configured
- **Automatic Bundling**: Workers bundled automatically from `ensemble.json` without manual setup
- **Dev/Prod Parity**: Same worker behavior in development and production builds
- **Type Safety**: Generated code maintains full type safety

## Problem Statement

### Current State

The vite-plugin has the following components implemented:

| Component | Status | Notes |
|-----------|--------|-------|
| Plugin hooks into Vite | ✅ Working | `configResolved`, `buildStart`, `generateBundle`, `configureServer` |
| Load `ensemble.json` | ✅ Working | Parses thread topology configuration |
| Dev server middleware | ✅ Working | Serves worker bundles on-demand at `/{workerOutput}/{threadId}.js` |
| Rollup bundling | ✅ Working | Bundles virtual modules with dependencies |
| Virtual manifest module | ✅ Working | `virtual:worker-manifest` exports `WORKER_PATHS` |
| Content hashing | ✅ Working | Production builds get hashed filenames |
| **Worker entry generation** | ❌ **Broken** | Generates non-functional code |

### The Broken Code Generation

The current `generate-worker-code.ts` generates:

```typescript
// Current output (BROKEN)
import { CounterActor as Actor0 } from './src/actors/CounterActor.ts';
import WorkerRuntime from '@d-buckner/ensemble-core/dist/threading/WorkerRuntime';

WorkerRuntime.registerActors({
  CounterActor: Actor0
});
```

**Problems with this approach:**

1. **Non-existent method**: `WorkerRuntime` has no static `registerActors()` method
2. **No instantiation**: `WorkerRuntime` is a class that needs to be instantiated with dependencies
3. **No message listener**: Worker needs `self.addEventListener('message', ...)` to receive commands
4. **No WorkerBus**: The `WorkerBus` instance is required for cross-thread communication
5. **IIFE global issue**: Rollup wraps in `(function(WorkerRuntime){...})(WorkerRuntime)` but global `WorkerRuntime` is undefined

### What WorkerRuntime Actually Expects

From `packages/core/src/threading/WorkerRuntime.ts`:

```typescript
export default class WorkerRuntime {
  constructor(
    workerBus: WorkerBus,
    actorRegistry: Record<string, ActorConstructor>,
    actorMetadata: Record<string, Record<string, unknown>>
  ) { ... }

  async instantiate(command: InstantiateCommand): Promise<void> { ... }
  handleEvent(actorId: string, method: string, args: unknown[]): void { ... }
}
```

The worker needs to:
1. Create a `WorkerBus` instance
2. Build an actor registry (className → ActorConstructor)
3. Build actor metadata (className → initialState)
4. Create a `WorkerRuntime` instance
5. Listen for messages and route them appropriately

### Message Protocol

The main thread sends two types of messages to workers:

**1. Instantiation Command** (from `ActorSystem.instantiateActor`):
```typescript
interface InstantiateCommand {
  type: 'instantiate';
  actorId: string;
  className: string;
  metadata: ActorMetadata;
  dependencies: Record<string, { actorId: string; className: string }>;
}
```

**2. Event/Action Messages** (from `MainBus`):
```typescript
interface EventMessage {
  actorId: string;
  eventName: string;
  payload: unknown;
}
```

All messages are serialized with `msgpackr.pack()` before `postMessage()`.

## Proposed Solution

### Correct Worker Entry Code

Generate worker entry code that properly initializes the runtime:

```typescript
/**
 * Auto-generated worker entry file for thread: {threadId}
 * DO NOT EDIT - Generated from ensemble.json
 */

import { unpack } from 'msgpackr';
import WorkerBus from '@d-buckner/ensemble-core/dist/messaging/WorkerBus';
import WorkerRuntime from '@d-buckner/ensemble-core/dist/threading/WorkerRuntime';

// Actor imports
import { CounterActor } from './src/actors/CounterActor.ts';

// Actor registry: className -> ActorConstructor
const actorRegistry = {
  CounterActor: CounterActor,
};

// Actor metadata: className -> initialState (for dependency hydration)
const actorMetadata = {
  CounterActor: CounterActor.initialState,
};

// Create worker infrastructure
const workerBus = new WorkerBus();
const workerRuntime = new WorkerRuntime(workerBus, actorRegistry, actorMetadata);

// Message handler for commands from main thread
self.addEventListener('message', (event) => {
  try {
    const message = unpack(new Uint8Array(event.data));

    // Handle instantiation commands
    if (message.type === 'instantiate') {
      workerRuntime.instantiate(message).catch((error) => {
        console.error(`Worker: Failed to instantiate actor ${message.actorId}:`, error);
      });
      return;
    }

    // Handle event/action messages (routed through WorkerBus)
    const { actorId, eventName, payload } = message;
    workerBus.emit(actorId, eventName, payload);
  } catch (error) {
    console.error('Worker: Failed to handle message from main thread', error);
  }
});
```

### Implementation Changes

#### 1. Rewrite `generate-worker-code.ts`

**File**: `packages/vite-plugin/src/generate-worker-code.ts`

```typescript
import type { ThreadConfig } from '@d-buckner/ensemble-core';

/**
 * Generates worker entry code that properly initializes WorkerRuntime
 * @param threadConfig - Configuration for this thread from ensemble.json
 * @param threadId - The thread identifier
 * @returns Generated worker entry code
 */
export function generateWorkerEntryCode(
  threadConfig: ThreadConfig,
  threadId: string
): string {
  // Generate actor imports
  const imports = threadConfig.actors
    .map((actor, index) => {
      return `import { ${actor.name} as Actor${index} } from '${actor.path}';`;
    })
    .join('\n');

  // Generate actor registry entries
  const registryEntries = threadConfig.actors
    .map((actor, index) => `  ${actor.name}: Actor${index}`)
    .join(',\n');

  // Generate actor metadata entries (initialState for each actor)
  const metadataEntries = threadConfig.actors
    .map((actor, index) => `  ${actor.name}: Actor${index}.initialState`)
    .join(',\n');

  return `/**
 * Auto-generated worker entry file for thread: ${threadId}
 * DO NOT EDIT - Generated from ensemble.json
 */

import { unpack } from 'msgpackr';
import WorkerBus from '@d-buckner/ensemble-core/dist/messaging/WorkerBus';
import WorkerRuntime from '@d-buckner/ensemble-core/dist/threading/WorkerRuntime';

// Actor imports
${imports}

// Actor registry: className -> ActorConstructor
const actorRegistry = {
${registryEntries}
};

// Actor metadata: className -> initialState (for dependency hydration)
const actorMetadata = {
${metadataEntries}
};

// Create worker infrastructure
const workerBus = new WorkerBus();
const workerRuntime = new WorkerRuntime(workerBus, actorRegistry, actorMetadata);

// Message handler for commands from main thread
self.addEventListener('message', (event) => {
  try {
    const message = unpack(new Uint8Array(event.data));

    // Handle instantiation commands
    if (message.type === 'instantiate') {
      workerRuntime.instantiate(message).catch((error) => {
        console.error(\`Worker [${threadId}]: Failed to instantiate actor \${message.actorId}:\`, error);
      });
      return;
    }

    // Handle event/action messages (routed through WorkerBus)
    const { actorId, eventName, payload } = message;
    workerBus.emit(actorId, eventName, payload);
  } catch (error) {
    console.error('Worker [${threadId}]: Failed to handle message from main thread', error);
  }
});
`;
}
```

#### 2. Update `plugin.ts` to Pass Thread ID

The plugin currently calls `generateWorkerEntryCode(threadConfig, config.root)` but doesn't pass the thread ID. Update to:

```typescript
// In buildStart()
const workerCode = generateWorkerEntryCode(threadConfig, threadId);

// In configureServer()
const workerCode = generateCode(threadConfig, threadId);
```

Update the function signature in `dev-server.ts` accordingly:

```typescript
export function createWorkerMiddleware(
  workerOutput: string,
  ensembleConfig: EnsembleConfig,
  projectRoot: string,
  viteServer: ViteDevServer | undefined,
  generateCode: (config: ThreadConfig, threadId: string) => string  // Changed signature
): Connect.NextHandleFunction
```

#### 3. Update Bundle Format

The current Rollup configuration uses IIFE format which wraps the code in a function expecting a global parameter. Change to a simpler format:

**File**: `packages/vite-plugin/src/bundle-worker.ts`

```typescript
const { output } = await bundle.generate({
  format: 'es',  // Changed from 'iife' to 'es' (ES modules work in workers)
  // Remove 'name' property - not needed for ES format
});
```

Alternatively, if IIFE is preferred for broader compatibility:

```typescript
const { output } = await bundle.generate({
  format: 'iife',
  name: 'EnsembleWorkerInit',
  // Ensure no external globals are expected
});
```

#### 4. Delete Unused Template File

The file `worker-entry.template.ts` contains placeholder patterns (`%ACTOR_IMPORTS%`, `%ACTOR_REGISTRY%`) that are never used. Either:
- Delete it (the generated code approach is cleaner)
- Or refactor to use it as a string template

**Recommendation**: Delete it to avoid confusion.

### Message Flow After Fix

```
┌─────────────────────────────────────────────────────────────────┐
│                         MAIN THREAD                              │
│                                                                  │
│  ActorSystem.start()                                            │
│       │                                                         │
│       ├── workerRegistry.add(threadId)                          │
│       │      └── new Worker(workerPath)  ─────────────────────┐ │
│       │                                                       │ │
│       └── instantiateActor(actorId)                           │ │
│              └── worker.postMessage(pack({                    │ │
│                    type: 'instantiate',                       │ │
│                    actorId, className, metadata, deps         │ │
│                  }))  ────────────────────────────────────────┼─┤
│                                                               │ │
└───────────────────────────────────────────────────────────────┼─┘
                                                                │
                                                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        WORKER THREAD                             │
│                                                                  │
│  worker-entry.js loads:                                         │
│       │                                                         │
│       ├── Creates WorkerBus                                     │
│       ├── Creates WorkerRuntime(bus, registry, metadata)        │
│       └── self.addEventListener('message', handler)             │
│                                                                  │
│  On 'instantiate' message:                                      │
│       │                                                         │
│       └── workerRuntime.instantiate(command)                    │
│              ├── Looks up ActorClass in registry                │
│              ├── Creates actor instance                         │
│              ├── Creates ActorBus for this actor                │
│              ├── Calls actor.__init(metadata, actorBus)         │
│              ├── Sets up effects                                │
│              └── Emits __state for hydration  ──────────────────┤
│                                                                  │
│  On action message:                                             │
│       │                                                         │
│       └── workerBus.emit(actorId, eventName, payload)           │
│              └── Routes to actor's mailbox                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Testing Strategy

### 1. Unit Tests for Code Generation

**File**: `packages/vite-plugin/src/generate-worker-code.test.ts`

```typescript
describe('generateWorkerEntryCode', () => {
  it('should generate valid worker entry code', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/CounterActor.ts', name: 'CounterActor' }
      ]
    };

    const code = generateWorkerEntryCode(config, 'counter');

    // Should import required modules
    expect(code).toContain("import { unpack } from 'msgpackr'");
    expect(code).toContain("import WorkerBus from '@d-buckner/ensemble-core/dist/messaging/WorkerBus'");
    expect(code).toContain("import WorkerRuntime from '@d-buckner/ensemble-core/dist/threading/WorkerRuntime'");

    // Should import actors
    expect(code).toContain("import { CounterActor as Actor0 } from './src/actors/CounterActor.ts'");

    // Should create registry
    expect(code).toContain('const actorRegistry = {');
    expect(code).toContain('CounterActor: Actor0');

    // Should create metadata
    expect(code).toContain('const actorMetadata = {');
    expect(code).toContain('CounterActor: Actor0.initialState');

    // Should set up message handler
    expect(code).toContain("self.addEventListener('message'");
    expect(code).toContain('workerRuntime.instantiate(message)');
    expect(code).toContain('workerBus.emit(actorId, eventName, payload)');
  });

  it('should handle multiple actors', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/ActorA.ts', name: 'ActorA' },
        { path: './src/actors/ActorB.ts', name: 'ActorB' },
      ]
    };

    const code = generateWorkerEntryCode(config, 'multi');

    expect(code).toContain('ActorA: Actor0');
    expect(code).toContain('ActorB: Actor1');
  });

  it('should include thread ID in error messages', () => {
    const config: ThreadConfig = {
      actors: [{ path: './src/actors/Test.ts', name: 'Test' }]
    };

    const code = generateWorkerEntryCode(config, 'my-thread');

    expect(code).toContain('Worker [my-thread]:');
  });
});
```

### 2. Integration Test: Worker Bundle Syntax

Verify the bundled output is valid JavaScript:

```typescript
describe('bundled worker', () => {
  it('should produce valid JavaScript', async () => {
    const config: ThreadConfig = {
      actors: [{ path: './fixtures/TestActor.ts', name: 'TestActor' }]
    };

    const code = generateWorkerEntryCode(config, 'test');
    const result = await bundleVirtualWorker(
      '\0virtual:test-worker',
      (id) => id === '\0virtual:test-worker' ? code : undefined,
      projectRoot
    );

    // Should not throw when parsed
    expect(() => new Function(result.code)).not.toThrow();
  });
});
```

### 3. E2E Test: Counter Demo

The existing Playwright tests in `e2e/counter-react.spec.ts` should pass once the fix is implemented:

```typescript
test('should increment counter when clicking increment button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Increment' }).click();
  await expect(page.locator('.counter-value')).toHaveText('Counter: 1');
});
```

These tests verify the full flow:
1. Plugin generates worker bundle
2. Worker loads and initializes
3. ActorSystem sends instantiate command
4. Worker creates actor
5. UI actions trigger worker actor methods
6. State updates flow back to main thread

### 4. Manual Verification Steps

1. Start counter demo: `npm run demo:react:counter`
2. Open browser DevTools → Network tab
3. Verify worker bundle loads at `/assets/counter.js`
4. Open DevTools → Sources → Worker threads
5. Verify worker is running (no console errors)
6. Click Increment button → counter should update
7. Check DevTools Console for any worker errors

## Implementation Plan

### Phase 1: Core Fix (Required)

1. **Rewrite `generate-worker-code.ts`** (~30 min)
   - Implement new code generation with proper WorkerRuntime initialization
   - Add thread ID parameter

2. **Update `plugin.ts`** (~10 min)
   - Pass threadId to generateWorkerEntryCode

3. **Update `dev-server.ts`** (~10 min)
   - Update function signature for generateCode callback

4. **Update bundle format** (~10 min)
   - Change from IIFE to ES module format (or fix IIFE)

5. **Delete unused template** (~5 min)
   - Remove `worker-entry.template.ts`

### Phase 2: Testing (Required)

1. **Add unit tests for code generation** (~20 min)
2. **Verify E2E tests pass** (~10 min)
3. **Manual verification with counter demo** (~10 min)

### Phase 3: Cleanup (Optional)

1. **Remove unused `build-worker.ts`** if not needed
2. **Update README** with any usage changes
3. **Add JSDoc comments** to generated code functions

## Migration Path

This is a **bug fix**, not a breaking change. Users don't interact with the generated worker code directly. The fix should:

1. Be transparent to users
2. Require no changes to `ensemble.json` format
3. Require no changes to actor definitions
4. Require no changes to `vite.config.ts` plugin options

## Open Questions

1. **ES modules vs IIFE**: Modern browsers support ES modules in workers (`type: 'module'`). Should we:
   - Use ES modules (cleaner, modern)
   - Keep IIFE for broader compatibility

   **Recommendation**: Start with ES modules, add IIFE option if needed.

2. **Error handling**: Should worker initialization errors:
   - Silently fail (current approach via console.error)
   - Propagate to main thread
   - Throw and crash the worker

   **Recommendation**: Log errors but also emit an error event to main thread for observability.

3. **Hot Module Replacement**: Does the dev server middleware properly invalidate cached bundles when actor files change?

   **Status**: The `isCacheStale` function in `dev-server.ts` checks file mtimes, so this should work. Verify during testing.

## Appendix: File Inventory

### Files to Modify

| File | Changes |
|------|---------|
| `packages/vite-plugin/src/generate-worker-code.ts` | Complete rewrite |
| `packages/vite-plugin/src/plugin.ts` | Pass threadId to code generator |
| `packages/vite-plugin/src/dev-server.ts` | Update generateCode signature |
| `packages/vite-plugin/src/bundle-worker.ts` | Change output format |

### Files to Delete

| File | Reason |
|------|--------|
| `packages/vite-plugin/src/worker-entry.template.ts` | Unused placeholder-based template |

### Files to Add

| File | Purpose |
|------|---------|
| `packages/vite-plugin/src/generate-worker-code.test.ts` | Unit tests for code generation |

### Files Unchanged

| File | Notes |
|------|-------|
| `packages/vite-plugin/src/types.ts` | No changes needed |
| `packages/vite-plugin/src/index.ts` | No changes needed |
| `packages/vite-plugin/src/build-worker.ts` | May be unused, evaluate |
| `packages/vite-plugin/src/build-worker.test.ts` | May need updates if build-worker.ts changes |
