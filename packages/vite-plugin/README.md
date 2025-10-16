# @d-buckner/ensemble-vite-plugin

Vite plugin for Ensemble actor threading with Web Workers.

## Features

- **Automatic Worker Bundling**: Bundles actors for Web Worker execution
- **Type Safety**: Full TypeScript support
- **Zero Config**: Works out of the box with Ensemble threading
- **Optimized**: Efficient code splitting for worker threads

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

### 2. Use threading in your actors

```typescript
import { Actor, action, createActorToken, ActorSystem } from '@d-buckner/ensemble-core';

class HeavyComputationActor extends Actor<{ result: number }> {
  static readonly initialState = { result: 0 };

  @action
  async compute(data: number[]): Promise<void> {
    // Expensive computation runs in Web Worker
    const result = data.reduce((sum, n) => sum + n * n, 0);
    this.setState(draft => { draft.result = result; });
  }
}

const ComputeToken = createActorToken<HeavyComputationActor>('compute');
const system = new ActorSystem();

// Register with threading enabled
system.register({
  token: ComputeToken,
  actor: HeavyComputationActor,
  threading: 'worker' // Runs in Web Worker!
});

await system.start();
```

## Configuration

The plugin accepts an optional configuration object:

```typescript
ensemblePlugin({
  // Custom worker entry point (optional)
  workerEntry: '@d-buckner/ensemble-core/worker',
})
```

## How It Works

The plugin:
1. Detects actors registered with `threading: 'worker'`
2. Bundles them into separate Web Worker files
3. Sets up communication between main thread and workers
4. Handles serialization/deserialization automatically

## Documentation

For comprehensive documentation, visit the [Ensemble GitHub repository](https://github.com/d-buckner/ensemble).

## License

Apache-2.0 © Daniel Buckner
