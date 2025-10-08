import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkerMiddleware } from './dev-server';
import type { IncomingMessage, ServerResponse } from 'http';
import type { ActorInfo } from './scan-actors';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, relative } from 'path';
import * as bundleWorkerModule from './bundle-worker';

// Mock the bundleVirtualWorker function to avoid complex Rollup bundling in tests
vi.mock('./bundle-worker', () => ({
  bundleVirtualWorker: vi.fn(async (virtualModuleId: string, loadModule: (id: string) => string | undefined) => {
    // Generate a simple bundled code that includes the loaded module content
    const code = loadModule(virtualModuleId);
    return {
      code: `(function() { ${code} })();`,
      watchFiles: [],
    };
  }),
}));

describe('createWorkerMiddleware', () => {
  const testDir = join(__dirname, '__test-dev-server__');
  const srcDir = join(testDir, 'src');
  const projectRoot = join(__dirname, '..');

  beforeEach(() => {
    mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create a middleware function', () => {
    const actorsByThread = new Map<string, ActorInfo[]>();
    const middleware = createWorkerMiddleware('workers', actorsByThread, projectRoot);

    expect(typeof middleware).toBe('function');
  });

  it('should serve virtual worker module for specific thread', async () => {
    writeFileSync(
      join(srcDir, 'TestActor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class TestActor extends Actor {
  state = {};
}
`
    );

    const actorsByThread = new Map<string, ActorInfo[]>([
      [
        'worker-1',
        [
          {
            className: 'TestActor',
            filePath: relative(projectRoot, join(srcDir, 'TestActor.ts')),
            threadId: 'worker-1',
            initialState: {},
          },
        ],
      ],
    ]);

    const allActors = new Map([['TestActor', actorsByThread.get('worker-1')![0]]]);
    const middleware = createWorkerMiddleware('workers', actorsByThread, allActors, projectRoot);

    const req = {
      url: '/workers/worker-1.js',
    } as IncomingMessage;

    const res = {
      setHeader: vi.fn(),
      end: vi.fn(),
      statusCode: 200,
    } as unknown as ServerResponse;

    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript');
    expect(res.end).toHaveBeenCalled();
    const workerCode = (res.end as any).mock.calls[0][0];
    expect(workerCode).toContain('TestActor');
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next for non-worker paths', async () => {
    const actorsByThread = new Map<string, ActorInfo[]>();
    const allActors = new Map<string, ActorInfo>();
    const middleware = createWorkerMiddleware('workers', actorsByThread, allActors, projectRoot);

    const req = {
      url: '/some/other/path',
    } as IncomingMessage;

    const res = {} as ServerResponse;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should return 404 for non-existent thread', async () => {
    const actorsByThread = new Map<string, ActorInfo[]>();
    const allActors = new Map<string, ActorInfo>();
    const middleware = createWorkerMiddleware('workers', actorsByThread, allActors, projectRoot);

    const req = {
      url: '/workers/non-existent-thread.js',
    } as IncomingMessage;

    const res = {
      statusCode: 200,
      end: vi.fn(),
    } as unknown as ServerResponse;

    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith('Thread not found: non-existent-thread');
    expect(next).not.toHaveBeenCalled();
  });

  it('should use custom worker output path', async () => {
    const actorsByThread = new Map<string, ActorInfo[]>([
      [
        'compute',
        [
          {
            className: 'ComputeActor',
            filePath: relative(projectRoot, join(srcDir, 'ComputeActor.ts')),
            threadId: 'compute',
            initialState: {},
          },
        ],
      ],
    ]);

    writeFileSync(
      join(srcDir, 'ComputeActor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('compute')
export class ComputeActor extends Actor {
  state = {};
}
`
    );

    const allActors = new Map([['ComputeActor', actorsByThread.get('compute')![0]]]);
    const middleware = createWorkerMiddleware('custom-dir', actorsByThread, allActors, projectRoot);

    const req = {
      url: '/custom-dir/compute.js',
    } as IncomingMessage;

    const res = {
      setHeader: vi.fn(),
      end: vi.fn(),
      statusCode: 200,
    } as unknown as ServerResponse;

    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript');
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('should serve different bundles for different threads', async () => {
    writeFileSync(
      join(srcDir, 'Worker1Actor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class Worker1Actor extends Actor {
  state = {};
}
`
    );

    writeFileSync(
      join(srcDir, 'Worker2Actor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-2')
export class Worker2Actor extends Actor {
  state = {};
}
`
    );

    const actorsByThread = new Map<string, ActorInfo[]>([
      [
        'worker-1',
        [
          {
            className: 'Worker1Actor',
            filePath: relative(projectRoot, join(srcDir, 'Worker1Actor.ts')),
            threadId: 'worker-1',
            initialState: {},
          },
        ],
      ],
      [
        'worker-2',
        [
          {
            className: 'Worker2Actor',
            filePath: relative(projectRoot, join(srcDir, 'Worker2Actor.ts')),
            threadId: 'worker-2',
            initialState: {},
          },
        ],
      ],
    ]);

    const allActors = new Map([
      ['Worker1Actor', actorsByThread.get('worker-1')![0]],
      ['Worker2Actor', actorsByThread.get('worker-2')![0]],
    ]);
    const middleware = createWorkerMiddleware('workers', actorsByThread, allActors, projectRoot);

    // Request worker-1
    const req1 = { url: '/workers/worker-1.js' } as IncomingMessage;
    const res1 = {
      setHeader: vi.fn(),
      end: vi.fn(),
      statusCode: 200,
    } as unknown as ServerResponse;
    await middleware(req1, res1, vi.fn());

    const worker1Code = (res1.end as any).mock.calls[0][0];
    expect(worker1Code).toContain("import { Worker1Actor }");
    expect(worker1Code).toContain("'Worker1Actor': Worker1Actor");
    expect(worker1Code).not.toContain("import { Worker2Actor }");

    // Request worker-2
    const req2 = { url: '/workers/worker-2.js' } as IncomingMessage;
    const res2 = {
      setHeader: vi.fn(),
      end: vi.fn(),
      statusCode: 200,
    } as unknown as ServerResponse;
    await middleware(req2, res2, vi.fn());

    const worker2Code = (res2.end as any).mock.calls[0][0];
    expect(worker2Code).toContain("import { Worker2Actor }");
    expect(worker2Code).toContain("'Worker2Actor': Worker2Actor");
    expect(worker2Code).not.toContain("import { Worker1Actor }");
  });
});
