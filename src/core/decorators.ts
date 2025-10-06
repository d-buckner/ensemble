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

  // Wrap method to ensure it's called within actor context
  const originalMethod = descriptor.value;
  descriptor.value = function(this: any, ...args: any[]) {
    // Set context for error tracking
    if (this.__setContext) {
      this.__setContext('action', propertyKey);
    }

    try {
      return originalMethod.apply(this, args);
    } finally {
      if (this.__clearContext) {
        this.__clearContext();
      }
    }
  };

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

    // Wrap method to ensure it's called within actor context
    const originalMethod = descriptor.value;
    descriptor.value = function(this: any, ...args: any[]) {
      // Set context for error tracking
      if (this.__setContext) {
        this.__setContext('effect', propertyKey);
      }

      try {
        return originalMethod.apply(this, args);
      } finally {
        if (this.__clearContext) {
          this.__clearContext();
        }
      }
    };

    return descriptor;
  };
}

/**
 * Extract effect metadata from an actor class
 */
export function getEffectMetadata(actorClass: any): EffectMetadata[] {
  return Reflect.getMetadata(EFFECT_METADATA_KEY, actorClass.prototype) || [];
}
