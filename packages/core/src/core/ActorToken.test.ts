import { describe, it, expect } from 'vitest';
import { Actor } from './Actor';
import { createActorToken } from './ActorToken';

// Mock actor for testing
class TestActor extends Actor<Record<string, unknown>> {
  constructor() {
    super({});
  }
}

describe('ActorToken', () => {
  describe('createActorToken', () => {
    it('should create a token with the correct id', () => {
      const token = createActorToken<TestActor>('test-actor');
      expect(token.id).toBe('test-actor');
    });

    it('should create a token with a unique symbol', () => {
      const token1 = createActorToken<TestActor>('test');
      const token2 = createActorToken<TestActor>('test');

      // Symbols should be unique even with same id
      expect(token1.symbol).not.toBe(token2.symbol);
      expect(typeof token1.symbol).toBe('symbol');
      expect(typeof token2.symbol).toBe('symbol');
    });

    it('should create tokens with the same id but different symbols', () => {
      const token1 = createActorToken<TestActor>('actor');
      const token2 = createActorToken<TestActor>('actor');

      expect(token1.id).toBe(token2.id);
      expect(token1.symbol).not.toBe(token2.symbol);
    });

    it('should handle different ids correctly', () => {
      const token1 = createActorToken<TestActor>('actor1');
      const token2 = createActorToken<TestActor>('actor2');

      expect(token1.id).toBe('actor1');
      expect(token2.id).toBe('actor2');
      expect(token1.symbol).not.toBe(token2.symbol);
    });
  });
});
