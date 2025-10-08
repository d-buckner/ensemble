import { vi } from 'vitest';
import { Logger } from './utils/Logger';

// Mock all Logger methods to be no-ops during tests
vi.spyOn(Logger, 'debug').mockImplementation(() => {});
vi.spyOn(Logger, 'info').mockImplementation(() => {});
vi.spyOn(Logger, 'warn').mockImplementation(() => {});
vi.spyOn(Logger, 'error').mockImplementation(() => {});
