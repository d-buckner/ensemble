import 'reflect-metadata';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ActorSystem, MAIN_THREAD_ID } from '@d-buckner/ensemble-core';
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
    actor: CounterActor,
    options: {}
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

  console.log('🎭 Ensemble demo ready!');
  console.log('Try: system.getClient(CounterToken).actions.increment()');
}

main().catch(console.error);
