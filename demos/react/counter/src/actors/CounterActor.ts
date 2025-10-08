import { Actor, action, thread } from '@d-buckner/ensemble-core';

export interface CounterState {
  count: number;
}

@thread('counter')
export class CounterActor extends Actor<CounterState> {
  static readonly initialState: CounterState = { count: 0 };

  constructor() {
    super(CounterActor.initialState);
  }

  @action
  increment(): void {
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
