import { Actor } from '../../core/Actor';
import { action } from '../../core/decorators';

/**
 * Shared test actor fixtures for use across test files.
 * These provide common actor patterns for testing without duplication.
 */

// Simple counter actor with basic state
interface CounterState extends Record<string, unknown> {
  count: number;
  name: string;
}

interface CounterEvents extends Record<string, unknown> {
  incremented: { oldValue: number; newValue: number };
}

export class CounterActor extends Actor<CounterState, CounterEvents> {
  constructor(initialCount = 0) {
    super({ count: initialCount, name: 'test' });
  }

  @action
  increment(): void {
    const oldValue = this.state.count;
    this.setState(draft => {
      draft.count++;
    });
    this.emit('incremented', { oldValue, newValue: this.state.count });
  }

  @action
  decrement(): void {
    this.setState(draft => {
      draft.count--;
    });
  }

  @action
  setName(name: string): void {
    this.setState(draft => {
      draft.name = name;
    });
  }

  @action
  reset(): void {
    this.setState(draft => {
      draft.count = 0;
      draft.name = 'test';
    });
  }
}

// Actor with complex nested state
interface Item {
  id: string;
  value: number;
}

interface CollectionState extends Record<string, unknown> {
  items: Item[];
  filter: string;
}

export class CollectionActor extends Actor<CollectionState> {
  constructor() {
    super({ items: [], filter: '' });
  }

  @action
  addItem(id: string, value: number): void {
    this.setState(draft => {
      draft.items.push({ id, value });
    });
  }

  @action
  removeItem(id: string): void {
    this.setState(draft => {
      draft.items = draft.items.filter(item => item.id !== id);
    });
  }

  @action
  updateItem(id: string, value: number): void {
    this.setState(draft => {
      const item = draft.items.find(i => i.id === id);
      if (item) {
        item.value = value;
      }
    });
  }

  @action
  setFilter(filter: string): void {
    this.setState(draft => {
      draft.filter = filter;
    });
  }
}

// Actor that throws errors for testing error handling
interface ErrorProneState extends Record<string, unknown> {
  value: number;
}

export class ErrorProneActor extends Actor<ErrorProneState> {
  constructor() {
    super({ value: 0 });
  }

  @action
  throwError(): void {
    this.throw('Intentional test error', { context: 'test' });
  }

  @action
  throwInAction(): void {
    throw new Error('Error thrown in action');
  }

  @action
  safeAction(): void {
    this.setState(draft => {
      draft.value++;
    });
  }
}
