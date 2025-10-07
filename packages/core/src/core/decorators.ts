import 'reflect-metadata';

/**
 * Metadata for action methods
 */
export interface ActionMetadata {
  methodName: string;
}

/**
 * Metadata for effect methods
 */
export interface EffectMetadata {
  methodName: string;
  eventSubscriptions: Array<{
    actorClientKey: string;  // e.g., 'todoActor'
    eventName: string;        // e.g., 'todos'
  }>;
}

const ACTION_METADATA_KEY = Symbol('actor:actions');
const EFFECT_METADATA_KEY = Symbol('actor:effects');
const THREAD_METADATA_KEY = Symbol('actor:thread');

/**
 * Wraps a method with context management for error tracking
 */
function wrapWithContext(
  originalMethod: Function,
  context: 'action' | 'effect',
  methodName: string
): Function {
  return function(this: any, ...args: any[]) {
    if (this.__setContext) {
      this.__setContext(context, methodName);
    }

    try {
      return originalMethod.apply(this, args);
    } finally {
      if (this.__clearContext) {
        this.__clearContext();
      }
    }
  };
}

/**
 * @action decorator - marks methods that can modify actor state
 * and be called via ActorClient
 */
export function action(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  // Store metadata
  if (!Reflect.hasMetadata(ACTION_METADATA_KEY, target)) {
    Reflect.defineMetadata(ACTION_METADATA_KEY, [], target);
  }

  const actions = Reflect.getMetadata(ACTION_METADATA_KEY, target) as ActionMetadata[];
  actions.push({
    methodName: propertyKey,
  });

  descriptor.value = wrapWithContext(descriptor.value, 'action', propertyKey);
  return descriptor;
}

/**
 * Extract action metadata from an actor class
 */
export function getActionMetadata(actorClass: any): ActionMetadata[] {
  return Reflect.getMetadata(ACTION_METADATA_KEY, actorClass.prototype) || [];
}

/**
 * @effect decorator - marks methods that react to specific dependency events
 *
 * Usage: @effect('depName.eventName', 'depName.otherEvent')
 */
export function effect(...subscriptions: string[]) {
  return function(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    if (!Reflect.hasMetadata(EFFECT_METADATA_KEY, target)) {
      Reflect.defineMetadata(EFFECT_METADATA_KEY, [], target);
    }

    const effects = Reflect.getMetadata(EFFECT_METADATA_KEY, target) as EffectMetadata[];

    // Parse subscriptions: 'todoActor.todos' -> { actorClientKey: 'todoActor', eventName: 'todos' }
    const eventSubscriptions = subscriptions.map(sub => {
      const [actorClientKey, eventName] = sub.split('.');
      if (!actorClientKey || !eventName) {
        throw new Error(`Invalid effect subscription format: "${sub}". Expected "depName.eventName"`);
      }
      return { actorClientKey, eventName };
    });

    effects.push({
      methodName: propertyKey,
      eventSubscriptions,
    });

    descriptor.value = wrapWithContext(descriptor.value, 'effect', propertyKey);
    return descriptor;
  };
}

/**
 * Extract effect metadata from an actor class
 */
export function getEffectMetadata(actorClass: any): EffectMetadata[] {
  return Reflect.getMetadata(EFFECT_METADATA_KEY, actorClass.prototype) || [];
}

/**
 * @thread decorator - marks which thread an actor should run on
 *
 * Usage: @thread('worker-1')
 * class MyActor extends Actor { ... }
 *
 * If not specified, actors run on the main thread by default.
 */
export function thread(threadId: string) {
  return function<T extends { new(...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(THREAD_METADATA_KEY, threadId, constructor);
    return constructor;
  };
}

/**
 * Extract thread metadata from an actor class
 * Returns undefined if no @thread decorator was used (defaults to main thread)
 */
export function getThreadMetadata(actorClass: any): string | undefined {
  return Reflect.getMetadata(THREAD_METADATA_KEY, actorClass);
}
