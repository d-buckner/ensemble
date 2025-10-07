# Virtual Module Approach for Worker Bundles

## Overview

The Vite plugin uses **virtual modules** to generate worker entry points dynamically at build time without creating actual files on disk.

## What are Virtual Modules?

Virtual modules are Vite's way of creating modules that don't exist as physical files. They're resolved and loaded entirely in memory during the build process.

## How It Works

### 1. Discovery Phase

During plugin initialization, the plugin:
- Scans the consumer's source code for `@thread(threadId)` decorators
- Groups actors by their threadId
- Example result:
  ```
  'worker-1': [CounterActor, ComputeActor]
  'worker-2': [DataProcessorActor]
  ```

### 2. Virtual Module Creation

For each unique threadId, create a virtual module with ID like:
```
virtual:ensemble-worker-worker-1
```

### 3. Module Resolution

When Vite encounters an import of a virtual module:

```typescript
export default {
  name: 'ensemble-vite-plugin',

  resolveId(id) {
    if (id.startsWith('virtual:ensemble-worker-')) {
      return '\0' + id; // \0 prefix = virtual module
    }
  },

  load(id) {
    if (id.startsWith('\0virtual:ensemble-worker-')) {
      const threadId = id.replace('\0virtual:ensemble-worker-', '');
      const actors = actorsByThread.get(threadId);
      return generateWorkerCode(threadId, actors);
    }
  }
}
```

### 4. Worker Bundle Generation

The plugin generates code for each virtual module that:
- Imports the core worker infrastructure
- Imports all actor classes for that thread
- Creates an actor registry mapping class names to constructors
- Sets up message handling

### 5. Build Output

Each virtual module gets bundled by Rollup into:
```
dist/assets/worker-1.js
dist/assets/worker-2.js
```

## Code Generation Strategy

Instead of inline template literals, we:

1. **Keep a template file** (`worker-entry.template.ts`) with placeholders
2. **Read the template** at build time
3. **Replace placeholders** with actual imports/code
4. **Return the result** from the `load()` hook

Example template:
```typescript
// worker-entry.template.ts
import { unpack } from 'msgpackr';
import WorkerBus from '@d-buckner/ensemble-core/dist/messaging/WorkerBus';

// %ACTOR_IMPORTS%

const actorRegistry = {
  // %ACTOR_REGISTRY%
};

// ... rest of worker logic
```

## Benefits

1. **No file cleanup** - Nothing written to disk during build
2. **Fast** - All in-memory operations
3. **Clean** - No generated files in source tree
4. **Reliable** - Vite handles all the module graph complexity
5. **HMR support** - Virtual modules can participate in hot module replacement

## Implementation Plan

1. Create `worker-entry.template.ts` with placeholders
2. Create `generate-worker-entry.ts` that:
   - Reads the template file
   - Replaces placeholders with actor-specific code
   - Returns the generated source
3. Update plugin to:
   - Scan for actors during `configResolved`
   - Implement `resolveId` and `load` hooks
   - Generate separate bundles for each threadId

## Alternative: Multiple Entry Points

Instead of virtual modules, we could also use Rollup's multi-entry approach:

```typescript
export default {
  build: {
    rollupOptions: {
      input: {
        'worker-1': 'virtual:ensemble-worker-worker-1',
        'worker-2': 'virtual:ensemble-worker-worker-2',
      }
    }
  }
}
```

This ensures each worker gets its own optimized bundle.
