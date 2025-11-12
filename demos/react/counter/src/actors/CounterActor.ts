import { Actor, action } from '@d-buckner/ensemble-core';


export interface CounterState {
  count: number;
}

export interface CounterActions {
  increment(): void;
  decrement(): void;
  reset(): void;
}

export class CounterActor extends Actor<CounterState, CounterActions> {
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
