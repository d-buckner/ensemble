# @d-buckner/ensemble-vite-plugin

Vite plugin for Ensemble actor threading with Web Workers.

## Features

- **Automatic Worker Bundling**: Bundles actors for Web Worker execution based on `ensemble.json`
- **Type Safety**: Full TypeScript support
- **Dev Mode Support**: On-demand bundling with hot reload in development
- **Production Optimized**: Content-hashed bundles for optimal caching

## Installation

```bash
npm install @d-buckner/ensemble-core @d-buckner/ensemble-vite-plugin vite
```

## Quick Start

### 1. Add the plugin to your Vite config

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { ensemblePlugin } from '@d-buckner/ensemble-vite-plugin';

export default defineConfig({
  plugins: [ensemblePlugin()],
});
```

### 2. Create an `ensemble.json` configuration file

```json
{
  "$schema": "https://raw.githubusercontent.com/d-buckner/ensemble/main/ensemble.schema.json",
  "threads": {
    "compute": {
      "actors": [
        {
          "path": "./src/actors/HeavyComputationActor.ts",
          "name": "HeavyComputationActor"
        }
      ]
    }
  }
}
```

### 3. Define your actor

```typescript
// src/actors/HeavyComputationActor.ts
import { Actor, action } from '@d-buckner/ensemble-core';

interface ComputationState {
  result: number;
}

interface ComputationActions {
  compute(data: number[]): Promise<void>;
}

export class HeavyComputationActor extends Actor<ComputationState, ComputationActions> {
  static readonly initialState: ComputationState = { result: 0 };

  constructor() {
    super(HeavyComputationActor.initialState);
  }

  @action
  async compute(data: number[]): Promise<void> {
    // Expensive computation runs in Web Worker
    const result = data.reduce((sum, n) => sum + n * n, 0);
    this.setState(draft => { draft.result = result; });
  }
}
```

### 4. Register and use the actor

```typescript
import { ActorSystem, createActorToken } from '@d-buckner/ensemble-core';
import { HeavyComputationActor } from './actors/HeavyComputationActor';
import ensembleConfig from './ensemble.json';

const ComputeToken = createActorToken<HeavyComputationActor>('compute');

const system = new ActorSystem(ensembleConfig);

system.register({
  token: ComputeToken,
  actor: HeavyComputationActor,
});

await system.start();

// The actor now runs in a Web Worker!
const client = system.getClient(ComputeToken);
await client.actions.compute([1, 2, 3, 4, 5]);
```

## Configuration

The plugin accepts an optional configuration object:

```typescript
ensemblePlugin({
  // Directory for worker bundle output (relative to build.outDir)
  // Default: 'workers'
  workerOutput: 'assets',
})
```

## How It Works

The plugin:
1. Reads `ensemble.json` from your project root
2. For each thread, generates a worker entry that:
   - Imports the configured actors
   - Creates a `WorkerBus` and `WorkerRuntime`
   - Sets up message handling for instantiation and action invocation
3. Bundles each worker with all dependencies (msgpackr, mutative, etc.)
4. In dev mode: Serves workers via middleware with caching
5. In production: Emits content-hashed worker files

## Virtual Modules

The plugin provides a virtual module for worker paths:

```typescript
import { WORKER_PATHS } from 'virtual:worker-manifest';
// { "compute": "./workers/compute-abc123.js" }
```

This is used internally by `@d-buckner/ensemble-core` to load workers.

## Documentation

For comprehensive documentation, visit the [Ensemble GitHub repository](https://github.com/d-buckner/ensemble).

## License

Apache-2.0 © Daniel Buckner
