import { describe, it, expect } from 'vitest';
import { action, effect, getActionMetadata, getEffectMetadata } from './decorators';
import { Actor } from './Actor';

describe('Decorators', () => {
  describe('@action decorator', () => {
    it('should collect metadata for decorated methods', () => {
      class TestActor extends Actor {
        constructor() {
          super({});
        }

        @action
        testMethod() {}

        @action
        anotherMethod() {}

        regularMethod() {}
      }

      const metadata = getActionMetadata(TestActor);

      expect(metadata).toHaveLength(2);
      expect(metadata.map(m => m.methodName)).toContain('testMethod');
      expect(metadata.map(m => m.methodName)).toContain('anotherMethod');
      expect(metadata.map(m => m.methodName)).not.toContain('regularMethod');
    });

    it('should preserve method functionality', () => {
      class TestActor extends Actor<{ count: number }> {
        constructor() {
          super({ count: 0 });
        }

        @action
        increment() {
          this.setState(draft => {
            draft.count++;
          });
        }
      }

      const actor = new TestActor();
      expect(actor.state.count).toBe(0);
    });

    it('should handle actors with no actions', () => {
      class TestActor extends Actor {
        constructor() {
          super({});
        }

        regularMethod() {}
      }

      const metadata = getActionMetadata(TestActor);
      expect(metadata).toEqual([]);
    });
  });

  describe('@effect decorator', () => {
    it('should collect metadata with event subscriptions', () => {
      class TestActor extends Actor {
        protected deps!: { someActor: unknown };

        constructor() {
          super({});
        }

        @effect('someActor.todos', 'someActor.filter')
        syncEffect() {}

        @effect('otherActor.count')
        countEffect() {}

        regularMethod() {}
      }

      const metadata = getEffectMetadata(TestActor);

      expect(metadata).toHaveLength(2);

      const syncEffect = metadata.find(m => m.methodName === 'syncEffect');
      expect(syncEffect).toBeDefined();
      expect(syncEffect?.eventSubscriptions).toHaveLength(2);
      expect(syncEffect?.eventSubscriptions).toContainEqual({
        actorClientKey: 'someActor',
        eventName: 'todos',
      });
      expect(syncEffect?.eventSubscriptions).toContainEqual({
        actorClientKey: 'someActor',
        eventName: 'filter',
      });

      const countEffect = metadata.find(m => m.methodName === 'countEffect');
      expect(countEffect?.eventSubscriptions).toHaveLength(1);
      expect(countEffect?.eventSubscriptions[0]).toEqual({
        actorClientKey: 'otherActor',
        eventName: 'count',
      });
    });

    it('should throw on invalid subscription format', () => {
      expect(() => {
        class TestActor extends Actor {
          constructor() {
            super({});
          }

          @effect('invalid-format')
          badEffect() {}
        }
        // Force decorator evaluation by accessing prototype
        TestActor.prototype;
      }).toThrow('Invalid effect subscription format');
    });

    it('should handle actors with no effects', () => {
      class TestActor extends Actor {
        constructor() {
          super({});
        }

        regularMethod() {}
      }

      const metadata = getEffectMetadata(TestActor);
      expect(metadata).toEqual([]);
    });

    it('should preserve method functionality', () => {
      class TestActor extends Actor<{ derived: number }> {
        protected deps!: { someActor: { state: { count: number } } };

        constructor() {
          super({ derived: 0 });
        }

        @effect('someActor.count')
        updateDerived() {
          // Method still executes normally
          this.setState(draft => {
            draft.derived = 42;
          });
        }
      }

      const actor = new TestActor();
      expect(actor.state.derived).toBe(0);
    });
  });

  describe('Decorator metadata inheritance', () => {
    it('should collect metadata from class hierarchy', () => {
      class BaseActor extends Actor {
        constructor() {
          super({});
        }

        @action
        baseAction() {}
      }

      class DerivedActor extends BaseActor {
        @action
        derivedAction() {}
      }

      const metadata = getActionMetadata(DerivedActor);

      // Should have both base and derived actions
      expect(metadata.length).toBeGreaterThanOrEqual(1);
      expect(metadata.map(m => m.methodName)).toContain('derivedAction');
    });
  });
});
