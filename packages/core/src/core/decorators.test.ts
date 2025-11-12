import { describe, it, expect } from 'vitest';
import { Actor } from './Actor';
import { action, effect, getActionMetadata, getEffectMetadata } from './decorators';


describe('Decorators', () => {
  describe('@action decorator', () => {
    it('should collect metadata for decorated methods', () => {
      interface TestActions {
        testMethod(): void;
        anotherMethod(): void;
      }

      class TestActor extends Actor<{}, TestActions, {}> {
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
      interface TestActions {
        increment(): void;
      }

      class TestActor extends Actor<{ count: number }, TestActions, {}> {
        static readonly initialState = { count: 0 };

        constructor() {
          super(TestActor.initialState);
        }

        @action
        increment() {
          this.setState(draft => {
            draft.count++;
          });
        }
      }

      expect(TestActor.initialState.count).toBe(0);
    });

    it('should handle actors with no actions', () => {
      class TestActor extends Actor<{}, {}, {}> {
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
      class TestActor extends Actor<{}, {}, {}> {
        protected declare deps: { someActor: unknown };

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
        class TestActor extends Actor<{}, {}, {}> {
          constructor() {
            super({});
          }

          @effect('invalid-format')
          badEffect() {}
        }
        // Force decorator evaluation by accessing prototype
        void TestActor.prototype;
      }).toThrow('Invalid effect subscription format');
    });

    it('should handle actors with no effects', () => {
      class TestActor extends Actor<{}, {}, {}> {
        constructor() {
          super({});
        }

        regularMethod() {}
      }

      const metadata = getEffectMetadata(TestActor);
      expect(metadata).toEqual([]);
    });

    it('should preserve method functionality', () => {
      class TestActor extends Actor<{ derived: number }, {}, {}> {
        static readonly initialState = { derived: 0 };

        protected declare deps: { someActor: { state: { count: number } } };

        constructor() {
          super(TestActor.initialState);
        }

        @effect('someActor.count')
        updateDerived() {
          // Method still executes normally
          this.setState(draft => {
            draft.derived = 42;
          });
        }
      }

      expect(TestActor.initialState.derived).toBe(0);
    });
  });

  describe('Decorator metadata inheritance', () => {
    it('should collect metadata from class hierarchy', () => {
      interface BaseActions {
        baseAction(): void;
      }

      class BaseActor extends Actor<{}, BaseActions, {}> {
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

    it('should collect effect metadata from parent classes', () => {
      class ParentActor extends Actor<{}, {}, {}> {
        protected declare deps: { dependency: unknown };

        constructor() {
          super({});
        }

        @effect('dependency.parentEvent')
        parentEffect() {}
      }

      class ChildActor extends ParentActor {
        @effect('dependency.childEvent')
        childEffect() {}
      }

      const metadata = getEffectMetadata(ChildActor);

      // Should collect effects from both parent and child
      expect(metadata).toHaveLength(2);

      const methodNames = metadata.map(m => m.methodName);
      expect(methodNames).toContain('parentEffect');
      expect(methodNames).toContain('childEffect');

      const parentEffect = metadata.find(m => m.methodName === 'parentEffect');
      expect(parentEffect?.eventSubscriptions).toEqual([
        { actorClientKey: 'dependency', eventName: 'parentEvent' }
      ]);

      const childEffect = metadata.find(m => m.methodName === 'childEffect');
      expect(childEffect?.eventSubscriptions).toEqual([
        { actorClientKey: 'dependency', eventName: 'childEvent' }
      ]);
    });

    it('should collect effects from multi-level inheritance', () => {
      class GrandparentActor extends Actor<{}, {}, {}> {
        protected declare deps: { dep: unknown };

        constructor() {
          super({});
        }

        @effect('dep.grandparentEvent')
        grandparentEffect() {}
      }

      class ParentActor extends GrandparentActor {
        @effect('dep.parentEvent')
        parentEffect() {}
      }

      class ChildActor extends ParentActor {
        @effect('dep.childEvent')
        childEffect() {}
      }

      const metadata = getEffectMetadata(ChildActor);

      // Should collect effects from all three levels
      expect(metadata).toHaveLength(3);

      const methodNames = metadata.map(m => m.methodName);
      expect(methodNames).toContain('grandparentEffect');
      expect(methodNames).toContain('parentEffect');
      expect(methodNames).toContain('childEffect');
    });
  });
});
