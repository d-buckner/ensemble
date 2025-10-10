import 'reflect-metadata';
import { ActorSystem } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CounterActor } from './actors/CounterActor';
import { App } from './App';
import { CounterToken } from './tokens';


async function main() {
  const system = new ActorSystem();

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
