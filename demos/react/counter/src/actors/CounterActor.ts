import { Actor, action, thread } from '@d-buckner/ensemble-core';

export interface CounterState extends Record<string, unknown> {
  count: number;
}

@thread('counter-worker')
export class CounterActor extends Actor<CounterState> {
  constructor() {
    super({ count: 0 });
  }

  @action
  increment(): void {
    console.log('[CounterActor] increment called in worker');
    this.setState(draft => {
      draft.count += 1;
    });
  }

  @action
  decrement(): void {
    this.setState(draft => {
      draft.count -= 1;
    });
  }

  @action
  reset(): void {
    this.setState(draft => {
      draft.count = 0;
    });
  }
}
