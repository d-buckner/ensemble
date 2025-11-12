// Core exports
export { Actor, type ActorMetadata, type StateOf, type EventsOf, type StateShape, type ActorConstructor } from './core/Actor';
export { ActorClient, AsyncActorClient, isAsyncActorClient, type ActionsOf, type IActorClient } from './core/ActorClient';
export { SyncActorClient } from './core/SyncActorClient';
export { default as ActorSystem } from './core/ActorSystem';
export type { ActorRegistration } from './core/ActorSystem';
export { action, effect } from './core/decorators';
export { createActorToken } from './core/ActorToken';
export type { ActorToken } from './core/ActorToken';

// Constants
export { MAIN_THREAD_ID } from './constants';
export { PROTOCOL_EVENTS } from './messaging/protocol-events';

// Message monitoring
export type { MessageEvent, MessageMonitor } from './messaging/ThreadBus';
export type { MessageWithTargets, EventType } from './messaging/MainBus';

// Utilities
export { Logger, LogLevel } from './utils/Logger';

// Configuration (types only - import ensemble.json directly in your app)
export type { EnsembleConfig, ThreadConfig } from './config/types';
export { ENSEMBLE_CONFIG_SCHEMA } from './config/types';

// Worker infrastructure (for generated worker bundles)
export { default as WorkerBus } from './messaging/WorkerBus';
export { default as WorkerRuntime } from './threading/WorkerRuntime';
export type { InstantiateCommand } from './threading/WorkerRuntime';
