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

// Metadata storage using WeakMaps for automatic garbage collection
const actionMetadataMap = new WeakMap<any, ActionMetadata[]>();
const effectMetadataMap = new WeakMap<any, EffectMetadata[]>();

/**
 * Wraps a method with context management for error tracking
 */
function wrapWithContext<T extends (...args: any[]) => any>(
  originalMethod: T,
  context: 'action' | 'effect',
  methodName: string
): T {
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
  } as T;
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
  if (!actionMetadataMap.has(target)) {
    actionMetadataMap.set(target, []);
  }

  const actions = actionMetadataMap.get(target)!;
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
  return actionMetadataMap.get(actorClass.prototype) ?? [];
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
    if (!effectMetadataMap.has(target)) {
      effectMetadataMap.set(target, []);
    }

    const effects = effectMetadataMap.get(target)!;

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
 * Walks the prototype chain to collect effects from parent classes
 *
 * Why prototype chain traversal is necessary:
 * The @effect decorator stores metadata in a WeakMap keyed by the class prototype.
 * When using inheritance, decorators on the parent class are stored on the parent's
 * prototype, not the child's. Without walking the prototype chain, effects defined
 * in base classes would never be registered for child class instances.
 *
 * Example:
 *   class ParentActor extends Actor {
 *     @effect('dep.event')           // Stored on ParentActor.prototype
 *     handleEvent() {}
 *   }
 *
 *   class ChildActor extends ParentActor {}
 *
 * Without prototype chain traversal, getEffectMetadata(ChildActor) would only check
 * ChildActor.prototype and miss the effect defined in ParentActor.
 */
export function getEffectMetadata(actorClass: any): EffectMetadata[] {
  const effects: EffectMetadata[] = [];
  let currentProto = actorClass.prototype;

  while (currentProto && currentProto !== Object.prototype) {
    const protoEffects = effectMetadataMap.get(currentProto);
    if (protoEffects) {
      effects.push(...protoEffects);
    }
    currentProto = Object.getPrototypeOf(currentProto);
  }

  return effects;
}
