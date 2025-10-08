// Core exports
export { Actor, type ActorMetadata, type StateOf, type EventsOf, type StateShape, type ActorConstructor } from './core/Actor';
export { ActorClient, type ActionsOf } from './core/ActorClient';
export { default as ActorSystem } from './core/ActorSystem';
export type { ActorRegistration, ActorSystemOptions } from './core/ActorSystem';
export { action, effect, thread } from './core/decorators';
export { createActorToken } from './core/ActorToken';
export type { ActorToken } from './core/ActorToken';

// Constants
export { MAIN_THREAD_ID } from './constants';
export { PROTOCOL_EVENTS } from './messaging/protocol-events';

// Worker infrastructure (for generated worker bundles)
export { default as WorkerBus } from './messaging/WorkerBus';
export { default as WorkerRuntime } from './threading/WorkerRuntime';
export type { InstantiateCommand } from './threading/WorkerRuntime';
