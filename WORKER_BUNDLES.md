# Worker Bundle Requirements

## Overview

Ensemble's actor system supports running actors on Web Worker threads. To enable this, worker code must be bundled separately from the main application bundle.

## Vite Plugin Requirement

A **Vite plugin is required** to:

1. Detect worker entry points (e.g., `src/worker/index.ts`)
2. Create separate bundle(s) for worker code
3. Ensure worker bundles include:
   - Worker-specific code (`WorkerBus`, worker initialization)
   - Shared code (Actor classes, message serialization, etc.)
   - Dependencies (`msgpackr`, `immer`, etc.)
4. Output worker bundles to the correct path (`/js/worker.js` as referenced in `WorkerRegistry.WORKER_PATH`)

## Implementation Options

### Option 1: Custom Vite Plugin

Create a custom plugin that:
- Identifies worker entry points
- Configures separate build for worker bundles
- Handles module sharing between main and worker bundles

### Option 2: Vite's Built-in Worker Support

Vite has built-in support for workers using the `?worker` or `?sharedworker` suffix:

```typescript
import MyWorker from './worker?worker'
const worker = new MyWorker()
```

However, this may not fit our architecture where `WorkerRegistry` manages worker creation dynamically.

### Option 3: vite-plugin-web-worker-loader

Investigate existing plugins like `vite-plugin-web-worker-loader` that may handle worker bundling.

## Current Gap

**Status**: Not yet implemented

The `WorkerRegistry` currently references `/js/worker.js` but:
- No worker entry point exists
- No Vite configuration for worker bundling
- Workers would fail to instantiate at runtime

## Next Steps

1. Create worker entry point: `src/worker/index.ts`
2. Configure Vite plugin for worker bundling
3. Update `WorkerRegistry.WORKER_PATH` to match build output
4. Test worker instantiation and message passing

## Worker Entry Point Structure

The worker entry point should:

```typescript
// src/worker/index.ts
import { unpack } from 'msgpackr';
import WorkerBus from './WorkerBus';
import { ActorBus } from '../busses/ActorBus';
// Import actor classes that can run on workers

const workerBus = new WorkerBus();

// Handle messages from main thread
self.addEventListener('message', (event) => {
  const { actorId, eventName, payload } = unpack(new Uint8Array(event.data));
  workerBus.emit(actorId, eventName, payload);
});

// Additional worker initialization logic
```

## References

- [Vite Worker Documentation](https://vitejs.dev/guide/features.html#web-workers)
- [vite-plugin-web-worker-loader](https://github.com/Schlechtwetterfront/vite-plugin-web-worker-loader)
