import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensemblePlugin } from './plugin';
import type { Plugin, ResolvedConfig } from 'vite';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

describe('ensemblePlugin', () => {
  describe('configuration', () => {
    it('should create a plugin with default options', () => {
      const plugin = ensemblePlugin();

      expect(plugin.name).toBe('ensemble-vite-plugin');
      expect(plugin).toHaveProperty('configResolved');
      expect(plugin).toHaveProperty('buildStart');
      expect(plugin).toHaveProperty('generateBundle');
      expect(plugin).toHaveProperty('configureServer');
    });

    it('should accept custom workerOutput option', () => {
      const plugin = ensemblePlugin({ workerOutput: 'custom-workers' });

      expect(plugin.name).toBe('ensemble-vite-plugin');
    });

    it('should use default workerOutput when not provided', () => {
      const plugin = ensemblePlugin({});

      expect(plugin.name).toBe('ensemble-vite-plugin');
    });
  });

  describe('build hooks', () => {
    it('should have buildStart hook', () => {
      const plugin = ensemblePlugin();

      expect(typeof plugin.buildStart).toBe('function');
    });

    it('should have generateBundle hook', () => {
      const plugin = ensemblePlugin();

      expect(typeof plugin.generateBundle).toBe('function');
    });

    it('should have configResolved hook', () => {
      const plugin = ensemblePlugin();

      expect(typeof plugin.configResolved).toBe('function');
    });
  });

  describe('dev server', () => {
    it('should have configureServer hook', () => {
      const plugin = ensemblePlugin();

      expect(typeof plugin.configureServer).toBe('function');
    });
  });

  describe('virtual modules', () => {
    const testDir = join(__dirname, '__test-vite-plugin__');
    const srcDir = join(testDir, 'src');

    beforeEach(() => {
      mkdirSync(srcDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should have resolveId hook', () => {
      const plugin = ensemblePlugin();

      expect(typeof plugin.resolveId).toBe('function');
    });

    it('should have load hook', () => {
      const plugin = ensemblePlugin();

      expect(typeof plugin.load).toBe('function');
    });

    it('should resolve virtual worker modules', async () => {
      const plugin = ensemblePlugin() as Plugin;

      const result = await (plugin.resolveId as Function).call(
        {},
        'virtual:ensemble-worker-worker-1',
        undefined
      );

      expect(result).toBe('\0virtual:ensemble-worker-worker-1');
    });

    it('should not resolve non-virtual modules', async () => {
      const plugin = ensemblePlugin() as Plugin;

      const result = await (plugin.resolveId as Function).call(
        {},
        './some-regular-module.ts',
        undefined
      );

      expect(result).toBeUndefined();
    });

    it('should load virtual worker module with actors', async () => {
      writeFileSync(
        join(srcDir, 'TestActor.ts'),
        `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class TestActor extends Actor {
  state = {};
}
`
      );

      const plugin = ensemblePlugin() as Plugin;
      const mockConfig = {
        root: testDir,
        command: 'build',
        mode: 'production',
      } as ResolvedConfig;

      if (plugin.configResolved) {
        await plugin.configResolved.call({}, mockConfig, {} as any);
      }

      const code = await (plugin.load as Function).call(
        {},
        '\0virtual:ensemble-worker-worker-1'
      );

      expect(code).toContain('import { TestActor }');
      expect(code).toContain("'TestActor': TestActor");
      expect(code).toContain("import { WorkerBus, WorkerRuntime } from '@d-buckner/ensemble-core'");
      expect(code).toContain('const actorRegistry');
    });

    it('should return undefined for non-virtual modules in load', async () => {
      const plugin = ensemblePlugin() as Plugin;

      const result = await (plugin.load as Function).call(
        {},
        './some-regular-module.ts'
      );

      expect(result).toBeUndefined();
    });

    it('should generate different worker bundles for different threads', async () => {
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

      const plugin = ensemblePlugin() as Plugin;
      const mockConfig = {
        root: testDir,
        command: 'build',
        mode: 'production',
      } as ResolvedConfig;

      if (plugin.configResolved) {
        await plugin.configResolved.call({}, mockConfig, {} as any);
      }

      const worker1Code = await (plugin.load as Function).call(
        {},
        '\0virtual:ensemble-worker-worker-1'
      );

      const worker2Code = await (plugin.load as Function).call(
        {},
        '\0virtual:ensemble-worker-worker-2'
      );

      // Worker 1 should import Worker1Actor but not Worker2Actor
      expect(worker1Code).toContain("import { Worker1Actor }");
      expect(worker1Code).toContain("'Worker1Actor': Worker1Actor");
      expect(worker1Code).not.toContain("import { Worker2Actor }");
      expect(worker1Code).not.toContain("'Worker2Actor': Worker2Actor,");

      // Worker 2 should import Worker2Actor but not Worker1Actor
      expect(worker2Code).toContain("import { Worker2Actor }");
      expect(worker2Code).toContain("'Worker2Actor': Worker2Actor");
      expect(worker2Code).not.toContain("import { Worker1Actor }");
      expect(worker2Code).not.toContain("'Worker1Actor': Worker1Actor,");
    });
  });

  describe('integration', () => {
    const testDir = join(__dirname, '__test-integration__');
    const srcDir = join(testDir, 'src');

    beforeEach(() => {
      mkdirSync(srcDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should scan for actors during configResolved', async () => {
      writeFileSync(
        join(srcDir, 'TestActor.ts'),
        `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class TestActor extends Actor {
  state = {};
}
`
      );

      const plugin = ensemblePlugin() as Plugin;

      const mockConfig = {
        root: testDir,
        command: 'build',
        mode: 'production',
      } as ResolvedConfig;

      await plugin.configResolved!.call({}, mockConfig, {} as any);

      const code = await (plugin.load as Function).call(
        {},
        '\0virtual:ensemble-worker-worker-1'
      );

      expect(code).toContain('TestActor');
    });

    it('should emit worker bundles for each thread during generateBundle', async () => {
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

      const plugin = ensemblePlugin({ workerOutput: 'workers' }) as Plugin;

      const mockConfig = {
        root: testDir,
        command: 'build',
        mode: 'production',
      } as ResolvedConfig;

      const mockEmitFile = vi.fn();
      const mockContext = {
        emitFile: mockEmitFile,
        error: vi.fn(),
      };

      await plugin.configResolved!.call({}, mockConfig, {} as any);

      // For this unit test, we mock the bundle generation
      // Real bundling is tested in integration/end-to-end tests
      // Populate bundles through the test interface
      if (plugin._test) {
        plugin._test.workerBundles.set('worker-1', '// bundled worker-1');
        plugin._test.workerBundles.set('worker-2', '// bundled worker-2');
      }

      if (plugin.generateBundle) {
        await (plugin.generateBundle as Function).call(mockContext, {} as any, {} as any);
      }

      // Should emit a worker bundle for each thread
      expect(mockEmitFile).toHaveBeenCalledTimes(2);

      expect(mockEmitFile).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asset',
          fileName: 'workers/worker-1.js',
        })
      );

      expect(mockEmitFile).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asset',
          fileName: 'workers/worker-2.js',
        })
      );
    });

    it('should use custom workerOutput directory', async () => {
      writeFileSync(
        join(srcDir, 'TestActor.ts'),
        `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('compute')
export class TestActor extends Actor {
  state = {};
}
`
      );

      const plugin = ensemblePlugin({ workerOutput: 'custom-dir' }) as Plugin;

      const mockConfig = {
        root: testDir,
        command: 'build',
        mode: 'production',
      } as ResolvedConfig;

      const mockEmitFile = vi.fn();
      const mockContext = {
        emitFile: mockEmitFile,
        error: vi.fn(),
      };

      await plugin.configResolved!.call({}, mockConfig, {} as any);

      // Populate bundles through the test interface
      if (plugin._test) {
        plugin._test.workerBundles.set('compute', '// bundled compute worker');
      }

      if (plugin.generateBundle) {
        await (plugin.generateBundle as Function).call(mockContext, {} as any, {} as any);
      }

      expect(mockEmitFile).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'custom-dir/compute.js',
        })
      );
    });

    it('should not emit worker bundles when no actors have @thread decorator', async () => {
      writeFileSync(
        join(srcDir, 'MainActor.ts'),
        `import { Actor } from '@d-buckner/ensemble-core';

export class MainActor extends Actor {
  state = {};
}
`
      );

      const plugin = ensemblePlugin() as Plugin;

      const mockConfig = {
        root: testDir,
        command: 'build',
        mode: 'production',
      } as ResolvedConfig;

      const mockEmitFile = vi.fn();
      const mockContext = {
        emitFile: mockEmitFile,
        error: vi.fn(),
      };

      await plugin.configResolved!.call({}, mockConfig, {} as any);

      if (plugin.buildStart) {
        await (plugin.buildStart as Function).call(mockContext);
      }

      if (plugin.generateBundle) {
        await (plugin.generateBundle as Function).call(mockContext, {} as any, {} as any);
      }

      expect(mockEmitFile).not.toHaveBeenCalled();
    });
  });
});
