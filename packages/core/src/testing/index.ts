/**
 * Shared testing utilities for @d-buckner/ensemble-core
 *
 * This module provides common mocks, fixtures, and helpers for writing tests.
 */

export { MockBus } from './mocks/MockBus';
export { CounterActor, CollectionActor, ErrorProneActor } from './fixtures/TestActors';
export { setupActorWithBus, createHydratedClient, waitForEvent } from './helpers/actor-helpers';
