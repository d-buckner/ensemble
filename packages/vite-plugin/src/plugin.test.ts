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

    it('should resolve virtual manifest module', async () => {
      const plugin = ensemblePlugin() as Plugin;

      const result = await (plugin.resolveId as Function).call(
        {},
        'virtual:ensemble-worker-manifest',
        undefined
      );

      expect(result).toBe('\0virtual:ensemble-worker-manifest');
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

    it('should load virtual manifest module with worker paths', async () => {
      writeFileSync(
        join(srcDir, 'TestActor.ts'),
        `import { Actor, thread } from '@d-buckner/ensemble-core';

@thread('worker-1')
export class TestActor extends Actor {
  state = {};
}
`
      );

      const plugin = ensemblePlugin({ workerOutput: 'assets' }) as Plugin;
      const mockConfig = {
        root: testDir,
        command: 'serve',
        mode: 'development',
      } as ResolvedConfig;

      if (plugin.configResolved) {
        await plugin.configResolved.call({}, mockConfig, {} as any);
      }

      const code = await (plugin.load as Function).call(
        {},
        '\0virtual:ensemble-worker-manifest'
      );

      expect(code).toContain('export const WORKER_PATHS');
      expect(code).toContain('"worker-1"');
      expect(code).toContain('./assets/worker-1.js');
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

    it('should emit worker bundles with content hashes and manifest', async () => {
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

      // Should emit worker bundles + manifest = 3 files
      expect(mockEmitFile).toHaveBeenCalledTimes(3);

      // Worker bundles should have content hashes
      const calls = mockEmitFile.mock.calls;
      const worker1Call = calls.find(c => c[0].fileName?.includes('worker-1'));
      const worker2Call = calls.find(c => c[0].fileName?.includes('worker-2'));
      const manifestCall = calls.find(c => c[0].fileName?.includes('manifest'));

      expect(worker1Call).toBeDefined();
      expect(worker1Call![0].fileName).toMatch(/workers\/worker-1-[a-f0-9]{8}\.js/);
      expect(worker1Call![0].type).toBe('asset');

      expect(worker2Call).toBeDefined();
      expect(worker2Call![0].fileName).toMatch(/workers\/worker-2-[a-f0-9]{8}\.js/);
      expect(worker2Call![0].type).toBe('asset');

      // Manifest should be emitted
      expect(manifestCall).toBeDefined();
      expect(manifestCall![0].fileName).toBe('workers/manifest.js');
      expect(manifestCall![0].type).toBe('asset');

      // Manifest should contain worker paths with hashes
      const manifestSource = manifestCall![0].source as string;
      expect(manifestSource).toContain('WORKER_PATHS');
      expect(manifestSource).toMatch(/worker-1.*worker-1-[a-f0-9]{8}\.js/);
      expect(manifestSource).toMatch(/worker-2.*worker-2-[a-f0-9]{8}\.js/);
    });

    it('should use custom workerOutput directory with content hash', async () => {
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

      // Should emit worker + manifest
      expect(mockEmitFile).toHaveBeenCalledTimes(2);

      const calls = mockEmitFile.mock.calls;
      const workerCall = calls.find(c => c[0].fileName?.includes('compute'));

      expect(workerCall).toBeDefined();
      expect(workerCall![0].fileName).toMatch(/custom-dir\/compute-[a-f0-9]{8}\.js/);
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
