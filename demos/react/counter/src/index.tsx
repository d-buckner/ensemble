import { ActorSystem } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CounterActor } from './actors/CounterActor';
import { App } from './App';
import { CounterToken } from './tokens';
import ensembleConfig from '../ensemble.json';


async function main() {
  // Load thread configuration from ensemble.json
  const system = new ActorSystem(ensembleConfig);

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
