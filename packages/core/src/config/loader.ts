/**
 * Configuration loader for ensemble.json
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { EnsembleConfig } from './types';

/**
 * Load and parse ensemble.json from the project root
 *
 * @param rootDir - Project root directory (defaults to process.cwd())
 * @returns Parsed configuration object
 * @throws Error if config file doesn't exist or is invalid JSON
 */
export function loadEnsembleConfig(rootDir: string = process.cwd()): EnsembleConfig {
  const configPath = resolve(rootDir, 'ensemble.json');

  if (!existsSync(configPath)) {
    throw new Error(
      `ensemble.json not found at ${configPath}. ` +
      'Please create an ensemble.json file in your project root to configure threading topology.'
    );
  }

  const configContent = readFileSync(configPath, 'utf-8');

  try {
    const config = JSON.parse(configContent) as EnsembleConfig;
    validateConfig(config, configPath);
    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate the structure of the configuration object
 */
function validateConfig(config: any, configPath: string): asserts config is EnsembleConfig {
  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid ensemble.json at ${configPath}: root must be an object`);
  }

  if (!config.threads || typeof config.threads !== 'object') {
    throw new Error(`Invalid ensemble.json at ${configPath}: "threads" field is required and must be an object`);
  }

  // Validate each thread configuration
  for (const [threadId, threadConfig] of Object.entries(config.threads)) {
    if (!threadConfig || typeof threadConfig !== 'object') {
      throw new Error(`Invalid thread config for "${threadId}": must be an object`);
    }

    const tc = threadConfig as any;

    if (!Array.isArray(tc.actors)) {
      throw new Error(`Invalid thread config for "${threadId}": "actors" field must be an array`);
    }

    for (const actor of tc.actors) {
      if (!actor || typeof actor !== 'object') {
        throw new Error(`Invalid thread config for "${threadId}": each actor entry must be an object`);
      }
      if (typeof actor.path !== 'string') {
        throw new Error(`Invalid thread config for "${threadId}": actor entry must have a "path" string field`);
      }
      if (typeof actor.name !== 'string') {
        throw new Error(`Invalid thread config for "${threadId}": actor entry must have a "name" string field`);
      }
    }
  }
}

/**
 * Get thread ID for a specific actor class name
 * Returns undefined if actor is not assigned to any worker thread (runs on main thread)
 */
export function getThreadIdForActor(
  config: EnsembleConfig,
  actorClassName: string
): string | undefined {
  for (const [threadId, threadConfig] of Object.entries(config.threads)) {
    if (threadConfig.actors.some(entry => entry.name === actorClassName)) {
      return threadId;
    }
  }
  return undefined;
}

/**
 * Get all actor class names assigned to a specific thread
 */
export function getActorsForThread(
  config: EnsembleConfig,
  threadId: string
): string[] {
  const threadConfig = config.threads[threadId];
  return threadConfig ? threadConfig.actors.map(entry => entry.name) : [];
}

/**
 * Get all defined thread IDs (excluding main thread)
 */
export function getAllThreadIds(config: EnsembleConfig): string[] {
  return Object.keys(config.threads);
}
