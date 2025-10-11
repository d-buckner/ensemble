import { ActorClient } from '../../core/ActorClient';
import { PROTOCOL_EVENTS } from '../../messaging/protocol-events';
import { MockBus } from '../mocks/MockBus';
import type { Actor , ActorMetadata } from '../../core/Actor';
import type { AllEvents } from '../../messaging/types';

/**
 * Helper utilities for setting up actors and clients in tests
 */

interface SetupActorOptions {
  id?: string;
  name?: string;
  threadId?: string;
  dependencies?: string[];
}

/**
 * Sets up an actor instance with a MockBus and initializes it
 */
export function setupActorWithBus<
  TState extends Record<string, unknown>,
  TEvents extends Record<string, unknown>
>(
  actorInstance: Actor<TState, TEvents>,
  options: SetupActorOptions = {}
): {
  actor: Actor<TState, TEvents>;
  bus: MockBus<AllEvents<TState, TEvents>>;
  metadata: ActorMetadata;
} {
  const bus = new MockBus<AllEvents<TState, TEvents>>();
  const metadata: ActorMetadata = {
    id: options.id ?? 'test-actor',
    name: options.name ?? 'TestActor',
    threadId: options.threadId ?? 'main',
    dependencies: options.dependencies ?? [],
  };

  actorInstance.__init(metadata, bus);

  return { actor: actorInstance, bus, metadata };
}

/**
 * Creates a hydrated ActorClient ready for testing
 */
export function createHydratedClient<TActor extends Actor<any, any>>(
  initialState: any,
  bus?: MockBus<any>
): {
  client: ActorClient<TActor>;
  bus: MockBus<any>;
} {
  const clientBus = bus ?? new MockBus();
  const client = new ActorClient<TActor>(
    clientBus,
    initialState
  );

  // Simulate state hydration
  clientBus.emit(PROTOCOL_EVENTS.STATE, initialState);

  return { client, bus: clientBus };
}

/**
 * Waits for a specific event to be emitted on the bus
 */
export function waitForEvent<T>(
  bus: MockBus<any>,
  eventName: string | number,
  timeout = 1000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bus.off(eventName as any, handler);
      reject(new Error(`Timeout waiting for event: ${String(eventName)}`));
    }, timeout);

    const handler = (payload: T) => {
      clearTimeout(timer);
      bus.off(eventName as any, handler);
      resolve(payload);
    };

    bus.on(eventName as any, handler);
  });
}
