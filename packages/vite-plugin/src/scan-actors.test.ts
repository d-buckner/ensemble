import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanForThreadActors } from './scan-actors';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

describe('scanForThreadActors', () => {
  const testDir = join(__dirname, '__test-fixtures__');
  const srcDir = join(testDir, 'src');

  beforeEach(() => {
    mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should find actors with @thread decorator', async () => {
    writeFileSync(
      join(srcDir, 'TestActor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class TestActor extends Actor {
  state = { count: 0 };
}
`
    );

    const result = await scanForThreadActors(testDir, 'src');

    expect(result.size).toBe(1);
    expect(result.has('worker-1')).toBe(true);

    const actors = result.get('worker-1')!;
    expect(actors).toHaveLength(1);
    expect(actors[0].className).toBe('TestActor');
    expect(actors[0].threadId).toBe('worker-1');
  });

  it('should group multiple actors by threadId', async () => {
    writeFileSync(
      join(srcDir, 'Actor1.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class Actor1 extends Actor {
  state = {};
}
`
    );

    writeFileSync(
      join(srcDir, 'Actor2.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class Actor2 extends Actor {
  state = {};
}
`
    );

    writeFileSync(
      join(srcDir, 'Actor3.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-2')
export class Actor3 extends Actor {
  state = {};
}
`
    );

    const result = await scanForThreadActors(testDir, 'src');

    expect(result.size).toBe(2);
    expect(result.get('worker-1')).toHaveLength(2);
    expect(result.get('worker-2')).toHaveLength(1);
  });

  it('should ignore actors without @thread decorator', async () => {
    writeFileSync(
      join(srcDir, 'MainActor.ts'),
      `import { Actor } from '@d-buckner/ensemble-core';

export class MainActor extends Actor {
  state = {};
}
`
    );

    writeFileSync(
      join(srcDir, 'WorkerActor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class WorkerActor extends Actor {
  state = {};
}
`
    );

    const result = await scanForThreadActors(testDir, 'src');

    expect(result.size).toBe(1);
    expect(result.has('worker-1')).toBe(true);
    expect(result.get('worker-1')).toHaveLength(1);
    expect(result.get('worker-1')![0].className).toBe('WorkerActor');
  });

  it('should ignore test files', async () => {
    writeFileSync(
      join(srcDir, 'TestActor.test.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class TestActor extends Actor {
  state = {};
}
`
    );

    const result = await scanForThreadActors(testDir, 'src');

    expect(result.size).toBe(0);
  });

  it('should handle files with syntax errors gracefully', async () => {
    writeFileSync(
      join(srcDir, 'ValidActor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class ValidActor extends Actor {
  state = {};
}
`
    );

    writeFileSync(
      join(srcDir, 'InvalidActor.ts'),
      `this is not valid TypeScript code @#$%^&*()`
    );

    const result = await scanForThreadActors(testDir, 'src');

    expect(result.size).toBe(1);
    expect(result.get('worker-1')).toHaveLength(1);
  });

  it('should return empty map when no actors found', async () => {
    writeFileSync(
      join(srcDir, 'utils.ts'),
      `export function helper() { return 42; }`
    );

    const result = await scanForThreadActors(testDir, 'src');

    expect(result.size).toBe(0);
  });

  it('should handle nested directories', async () => {
    const actorsDir = join(srcDir, 'actors');
    mkdirSync(actorsDir, { recursive: true });

    writeFileSync(
      join(actorsDir, 'NestedActor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class NestedActor extends Actor {
  state = {};
}
`
    );

    const result = await scanForThreadActors(testDir, 'src');

    expect(result.size).toBe(1);
    expect(result.get('worker-1')).toHaveLength(1);
    expect(result.get('worker-1')![0].className).toBe('NestedActor');
  });

  it('should store correct relative file paths', async () => {
    const actorsDir = join(srcDir, 'actors');
    mkdirSync(actorsDir, { recursive: true });

    writeFileSync(
      join(actorsDir, 'TestActor.ts'),
      `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class TestActor extends Actor {
  state = {};
}
`
    );

    const result = await scanForThreadActors(testDir, 'src');

    const actors = result.get('worker-1')!;
    expect(actors[0].filePath).toMatch(/src[\/\\]actors[\/\\]TestActor\.ts/);
  });
});
