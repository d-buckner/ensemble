import { createActor } from '@d-buckner/ensemble-solidjs';
import { CounterToken } from './tokens';
import './style.css';

export function App() {
  const counter = createActor(CounterToken);

  return (
    <div class="app">
      <h1 class="app-title">Ensemble Counter Demo</h1>

      <div class="counter-card">
        <h2 class="counter-value">Counter: {counter.state.count()}</h2>

        <div class="button-group">
          <button onClick={counter.actions.increment} class="button">
            Increment
          </button>

          <button onClick={counter.actions.decrement} class="button">
            Decrement
          </button>

          <button onClick={counter.actions.reset} class="button">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
