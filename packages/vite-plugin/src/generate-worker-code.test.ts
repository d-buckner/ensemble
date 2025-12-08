import { describe, it, expect } from 'vitest';
import { generateWorkerEntryCode } from './generate-worker-code';
import type { ThreadConfig } from '@d-buckner/ensemble-core';


describe('generateWorkerEntryCode', () => {
  it('should generate valid worker entry code with required imports', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/CounterActor.ts', name: 'CounterActor' }
      ]
    };

    const code = generateWorkerEntryCode(config, 'counter');

    // Should import required modules
    expect(code).toContain("import { unpack } from 'msgpackr'");
    expect(code).toContain("import WorkerBus from '@d-buckner/ensemble-core/worker/bus'");
    expect(code).toContain("import WorkerRuntime from '@d-buckner/ensemble-core/worker/runtime'");
  });

  it('should generate actor imports', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/CounterActor.ts', name: 'CounterActor' }
      ]
    };

    const code = generateWorkerEntryCode(config, 'counter');

    expect(code).toContain("import { CounterActor as Actor0 } from './src/actors/CounterActor.ts'");
  });

  it('should generate actor registry', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/CounterActor.ts', name: 'CounterActor' }
      ]
    };

    const code = generateWorkerEntryCode(config, 'counter');

    expect(code).toContain('const actorRegistry = {');
    expect(code).toContain('CounterActor: Actor0');
  });

  it('should generate actor metadata for initialState', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/CounterActor.ts', name: 'CounterActor' }
      ]
    };

    const code = generateWorkerEntryCode(config, 'counter');

    expect(code).toContain('const actorMetadata = {');
    expect(code).toContain('CounterActor: Actor0.initialState');
  });

  it('should set up message handler', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/CounterActor.ts', name: 'CounterActor' }
      ]
    };

    const code = generateWorkerEntryCode(config, 'counter');

    expect(code).toContain("self.addEventListener('message'");
    expect(code).toContain('workerRuntime.instantiate(message)');
    expect(code).toContain('workerBus.emit(actorId, eventName, payload)');
  });

  it('should handle multiple actors', () => {
    const config: ThreadConfig = {
      actors: [
        { path: './src/actors/ActorA.ts', name: 'ActorA' },
        { path: './src/actors/ActorB.ts', name: 'ActorB' },
        { path: './src/actors/ActorC.ts', name: 'ActorC' },
      ]
    };

    const code = generateWorkerEntryCode(config, 'multi');

    // Should have all imports
    expect(code).toContain("import { ActorA as Actor0 } from './src/actors/ActorA.ts'");
    expect(code).toContain("import { ActorB as Actor1 } from './src/actors/ActorB.ts'");
    expect(code).toContain("import { ActorC as Actor2 } from './src/actors/ActorC.ts'");

    // Should have all registry entries
    expect(code).toContain('ActorA: Actor0');
    expect(code).toContain('ActorB: Actor1');
    expect(code).toContain('ActorC: Actor2');

    // Should have all metadata entries
    expect(code).toContain('ActorA: Actor0.initialState');
    expect(code).toContain('ActorB: Actor1.initialState');
    expect(code).toContain('ActorC: Actor2.initialState');
  });

  it('should include thread ID in error messages', () => {
    const config: ThreadConfig = {
      actors: [{ path: './src/actors/Test.ts', name: 'Test' }]
    };

    const code = generateWorkerEntryCode(config, 'my-custom-thread');

    expect(code).toContain('Worker [my-custom-thread]:');
  });

  it('should include thread ID in header comment', () => {
    const config: ThreadConfig = {
      actors: [{ path: './src/actors/Test.ts', name: 'Test' }]
    };

    const code = generateWorkerEntryCode(config, 'worker-thread-1');

    expect(code).toContain('Auto-generated worker entry file for thread: worker-thread-1');
  });

  it('should create WorkerBus and WorkerRuntime instances', () => {
    const config: ThreadConfig = {
      actors: [{ path: './src/actors/Test.ts', name: 'Test' }]
    };

    const code = generateWorkerEntryCode(config, 'test');

    expect(code).toContain('const workerBus = new WorkerBus()');
    expect(code).toContain('const workerRuntime = new WorkerRuntime(workerBus, actorRegistry, actorMetadata)');
  });

  it('should handle instantiate commands', () => {
    const config: ThreadConfig = {
      actors: [{ path: './src/actors/Test.ts', name: 'Test' }]
    };

    const code = generateWorkerEntryCode(config, 'test');

    expect(code).toContain("if (message.type === 'instantiate')");
    expect(code).toContain('workerRuntime.instantiate(message)');
  });

  it('should unpack messages with msgpackr', () => {
    const config: ThreadConfig = {
      actors: [{ path: './src/actors/Test.ts', name: 'Test' }]
    };

    const code = generateWorkerEntryCode(config, 'test');

    expect(code).toContain('const message = unpack(new Uint8Array(event.data))');
  });
});
