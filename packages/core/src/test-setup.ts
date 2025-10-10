import { vi } from 'vitest';
import { Logger } from './utils/Logger';

// Mock all Logger methods to be no-ops during tests
vi.spyOn(Logger, 'debug').mockImplementation(() => {});
vi.spyOn(Logger, 'info').mockImplementation(() => {});
vi.spyOn(Logger, 'warn').mockImplementation(() => {});
vi.spyOn(Logger, 'error').mockImplementation(() => {});

// Test helper to flush event loop (for batched state updates, promises, etc)
async function flushAsync(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

// Make helper globally available
declare global {
  // eslint-disable-next-line no-var
  var flushAsync: () => Promise<void>;
}

globalThis.flushAsync = flushAsync;
