import { describe, it, expect } from 'vitest';
import { buildWorkerBundle } from './build-worker';

describe('buildWorkerBundle', () => {
  it('should return a non-empty string', async () => {
    const code = await buildWorkerBundle();

    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  it('should generate valid JavaScript code', async () => {
    const code = await buildWorkerBundle();

    // Should contain IIFE wrapper
    expect(code).toContain('EnsembleWorker');

    // Should not throw when evaluated (basic syntax check)
    expect(() => {
      new Function(code);
    }).not.toThrow();
  });

  it('should bundle worker dependencies', async () => {
    const code = await buildWorkerBundle();

    // Should contain references to core worker functionality
    // The actual content depends on the worker-entry implementation
    expect(code.length).toBeGreaterThan(100); // Should be substantial
  });
});
