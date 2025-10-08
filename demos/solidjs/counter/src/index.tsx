import 'reflect-metadata';
import { ActorSystem } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-solidjs';
import { render } from 'solid-js/web';
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

  render(
    () => (
      <EnsembleProvider system={system}>
        <App />
      </EnsembleProvider>
    ),
    document.getElementById('app')!
  );

  (window as any).system = system;
}

main().catch(console.error);
