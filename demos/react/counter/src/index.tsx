import 'reflect-metadata';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ActorSystem } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-react';
import { CounterActor } from './actors/CounterActor';
import { CounterToken } from './tokens';
import { App } from './App';

async function main() {
  const system = new ActorSystem({
    workerOutput: 'assets'
  });

  system.register({
    token: CounterToken,
    actor: CounterActor
  });

  await system.start();

  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <EnsembleProvider system={system}>
        <App />
      </EnsembleProvider>
    </StrictMode>
  );

  (window as any).system = system;
}

main().catch(console.error);
