import { useActor } from '@d-buckner/ensemble-react';
import { CounterToken } from './tokens';
import './style.css';


export function App() {
  const counter = useActor(CounterToken);

  return (
    <div className="app">
      <h1 className="app-title">Ensemble Counter Demo</h1>

      <div className="counter-card">
        <h2 className="counter-value">Counter: {counter.state.count}</h2>

        <div className="button-group">
          <button onClick={() => counter.actions.increment()} className="button">
            Increment
          </button>

          <button onClick={() => counter.actions.decrement()} className="button">
            Decrement
          </button>

          <button onClick={() => counter.actions.reset()} className="button">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
