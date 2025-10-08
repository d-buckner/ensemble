import { describe, it, expect } from 'vitest';
import { generateWorkerEntry } from './generate-worker-entry';
import type { ActorInfo } from './scan-actors';


describe('generateWorkerEntry', () => {
  it('should generate worker entry with single actor', () => {
    const actors: ActorInfo[] = [
      {
        className: 'CounterActor',
        threadId: 'worker-1',
        filePath: 'src/actors/CounterActor.ts',
        initialState: { count: 0 },
      },
    ];

    const allActors = new Map(actors.map(a => [a.className, a]));
    const result = generateWorkerEntry('worker-1', actors, allActors);

    expect(result).toContain('import { CounterActor }');
    expect(result).toContain("from './src/actors/CounterActor'");
    expect(result).toContain("'CounterActor': CounterActor");
    expect(result).toContain("import { WorkerBus, WorkerRuntime } from '@d-buckner/ensemble-core'");
    expect(result).toContain('export { workerBus, workerRuntime, actorRegistry }');
  });

  it('should generate worker entry with multiple actors', () => {
    const actors: ActorInfo[] = [
      {
        className: 'Actor1',
        threadId: 'worker-1',
        filePath: 'src/actors/Actor1.ts',
        initialState: {},
      },
      {
        className: 'Actor2',
        threadId: 'worker-1',
        filePath: 'src/actors/Actor2.ts',
        initialState: {},
      },
      {
        className: 'Actor3',
        threadId: 'worker-1',
        filePath: 'src/actors/Actor3.ts',
        initialState: {},
      },
    ];

    const allActors = new Map(actors.map(a => [a.className, a]));
    const result = generateWorkerEntry('worker-1', actors, allActors);

    expect(result).toContain('import { Actor1 }');
    expect(result).toContain('import { Actor2 }');
    expect(result).toContain('import { Actor3 }');
    expect(result).toContain("'Actor1': Actor1");
    expect(result).toContain("'Actor2': Actor2");
    expect(result).toContain("'Actor3': Actor3");
  });

  it('should handle actors in nested directories', () => {
    const actors: ActorInfo[] = [
      {
        className: 'DeepActor',
        threadId: 'worker-1',
        filePath: 'src/features/billing/actors/DeepActor.ts',
        initialState: {},
      },
    ];

    const allActors = new Map(actors.map(a => [a.className, a]));
    const result = generateWorkerEntry('worker-1', actors, allActors);

    expect(result).toContain("from './src/features/billing/actors/DeepActor'");
  });

  it('should handle Windows path separators', () => {
    const actors: ActorInfo[] = [
      {
        className: 'WindowsActor',
        threadId: 'worker-1',
        filePath: 'src\\actors\\WindowsActor.ts',
        initialState: {},
      },
    ];

    const allActors = new Map(actors.map(a => [a.className, a]));
    const result = generateWorkerEntry('worker-1', actors, allActors);

    // Should normalize to forward slashes
    expect(result).toContain("from './src/actors/WindowsActor'");
    expect(result).not.toContain('\\');
  });

  it('should remove file extension from imports', () => {
    const actors: ActorInfo[] = [
      {
        className: 'TsActor',
        threadId: 'worker-1',
        filePath: 'src/TsActor.ts',
        initialState: {},
      },
      {
        className: 'TsxActor',
        threadId: 'worker-1',
        filePath: 'src/TsxActor.tsx',
        initialState: {},
      },
    ];

    const allActors = new Map(actors.map(a => [a.className, a]));
    const result = generateWorkerEntry('worker-1', actors, allActors);

    expect(result).toContain("from './src/TsActor'");
    expect(result).toContain("from './src/TsxActor'");
    expect(result).not.toContain('.ts');
    expect(result).not.toContain('.tsx');
  });

  it('should generate valid TypeScript code', () => {
    const actors: ActorInfo[] = [
      {
        className: 'TestActor',
        threadId: 'worker-1',
        filePath: 'src/TestActor.ts',
        initialState: {},
      },
    ];

    const allActors = new Map(actors.map(a => [a.className, a]));
    const result = generateWorkerEntry('worker-1', actors, allActors);

    // Should have all necessary imports
    expect(result).toContain("import { unpack } from 'msgpackr'");
    expect(result).toContain("import { WorkerBus, WorkerRuntime } from '@d-buckner/ensemble-core'");

    // Should have registry declaration
    expect(result).toContain('const actorRegistry');

    // Should have worker bus setup
    expect(result).toContain('const workerBus = new WorkerBus()');
    expect(result).toContain("self.addEventListener('message'");

    // Should export required items
    expect(result).toContain('export { workerBus, workerRuntime, actorRegistry }');
  });

  it('should handle empty actor list', () => {
    const actors: ActorInfo[] = [];

    const allActors = new Map();
    const result = generateWorkerEntry('worker-1', actors, allActors);

    expect(result).toContain('const actorRegistry');
    expect(result).toContain('export { workerBus, workerRuntime, actorRegistry }');
    // Should still have core imports and setup
    expect(result).toContain("import { WorkerBus, WorkerRuntime } from '@d-buckner/ensemble-core'");
  });
});
