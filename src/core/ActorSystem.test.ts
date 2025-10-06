import { describe, it, expect, beforeEach } from 'vitest';
import ActorSystem, { type ActorRegistration } from './ActorSystem';
import { MAIN_THREAD_ID } from '../constants';

// Mock actor class for testing
class MockActor {}

describe('ActorSystem', () => {
  let system: ActorSystem;

  beforeEach(() => {
    system = new ActorSystem();
  });

  describe('register', () => {
    it('should register an actor without dependencies', () => {
      const registration = createRegistration('actor');
      system.register(registration);
      expectActorRegistration(registration.id, registration);
    });

    it('should register an actor with dependencies', () => {
      const dep1 = createRegistration('dep-1');
      const dep2 = createRegistration('dep-2');
      system.register(dep1);
      system.register(dep2);

      const actor = createRegistration('actor', {
        userActor: dep1.id,
        storageActor: dep2.id,
      });
      system.register(actor);

      expectActorRegistration(actor.id, actor);
    });

    it('should throw when registering an actor that already exists', () => {
      const registration = createRegistration('actor');
      system.register(registration);

      expect(() => system.register(registration)).toThrow('Cannot register actor that is already registered: actor-id');
    });

    it('should throw when registering an actor before its dependencies', () => {
      const registration = createRegistration('actor', { dep: 'dep-id-1' });
      expect(() => system.register(registration)).toThrow('Cannot register actor before its dependencies: actor-id depends on dep-id-1');
    });

    it('should update dependents when registering an actor with dependencies', () => {
      const dep1 = createRegistration('dep-1');
      const dep2 = createRegistration('dep-2');
      system.register(dep1);
      system.register(dep2);

      const actor = createRegistration('actor', {
        userActor: dep1.id,
        storageActor: dep2.id,
      });
      system.register(actor);

      expectActorRegistration(dep1.id, dep1, [actor.id]);
      expectActorRegistration(dep2.id, dep2, [actor.id]);
    });
  });

  describe('get', () => {
    it('should return an actor by id', () => {
      const registration = createRegistration('actor');
      system.register(registration);
      expectActorRegistration(registration.id, registration);
    });

    it('should return null for non-existent actor', () => {
      expectActorRegistration('non-existant-actor-id', null);
    });
  });

  function createRegistration(name: string, dependencies: Record<string, string> = {}): ActorRegistration {
    return {
      id: name + '-id',
      actor: MockActor,
      threadId: MAIN_THREAD_ID,
      options: {},
      dependencies,
    }
  }

  function expectActorRegistration(actorId: string, expectedRegistration: ActorRegistration | null, dependents: string[] = []) {
    if (expectedRegistration === null) {
      expect(system.get(actorId)).toBeNull();
      return;
    }

    expect(system.get(actorId)).toEqual({
      ...expectedRegistration,
      dependents,
    })
  }
});
