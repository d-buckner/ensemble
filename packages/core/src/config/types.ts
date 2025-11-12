/**
 * Configuration schema for Ensemble threading topology
 */

export interface ActorEntry {
  /**
   * Path to the file containing the actor class.
   * Relative to project root.
   *
   * Example: "./src/actors/MetricGeneratorActor.ts"
   */
  path: string;

  /**
   * Name of the actor class to import and register.
   * Must match the exported class name exactly.
   *
   * Example: "MetricGeneratorActor"
   */
  name: string;
}

export interface ThreadConfig {
  /**
   * Array of actors that should run on this thread.
   * The Vite plugin will automatically generate a worker entry file
   * that imports and registers these actors.
   *
   * Example:
   * [
   *   { "path": "./src/actors/MetricGeneratorActor.ts", "name": "MetricGeneratorActor" },
   *   { "path": "./src/actors/StatisticsActor.ts", "name": "StatisticsActor" }
   * ]
   */
  actors: ActorEntry[];
}

export interface EnsembleConfig {
  /**
   * Thread topology configuration.
   * Key is the thread ID, value is the thread configuration.
   *
   * The Vite plugin will automatically generate worker entry files for each thread
   * that import and register the specified actors.
   *
   * Note: Main thread actors don't need to be listed here.
   * Any actor not assigned to a worker thread will run on the main thread by default.
   *
   * Example:
   * {
   *   "worker-1": {
   *     "actors": [
   *       { "path": "./src/actors/MetricGeneratorActor.ts", "name": "MetricGeneratorActor" },
   *       { "path": "./src/actors/StatisticsActor.ts", "name": "StatisticsActor" }
   *     ]
   *   }
   * }
   */
  threads: Record<string, ThreadConfig>;
}

/**
 * JSON Schema for ensemble.json validation
 * Can be used by IDEs for autocompletion and validation
 */
export const ENSEMBLE_CONFIG_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    threads: {
      type: 'object',
      patternProperties: {
        '^[a-zA-Z0-9-_]+$': {
          type: 'object',
          required: ['actors'],
          properties: {
            actors: {
              type: 'array',
              items: {
                type: 'object',
                required: ['path', 'name'],
                properties: {
                  path: {
                    type: 'string',
                    description: 'Path to actor file',
                  },
                  name: {
                    type: 'string',
                    description: 'Actor class name',
                  },
                },
              },
              description: 'Actors for this thread',
            },
          },
        },
      },
    },
  },
  required: ['threads'],
};
