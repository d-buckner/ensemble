import 'reflect-metadata';
import { render } from 'solid-js/web';
import { ActorSystem, MAIN_THREAD_ID } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-solidjs';
import { CounterActor } from './actors/CounterActor';
import { CounterToken } from './tokens';
import { App } from './App';

async function main() {
  const system = new ActorSystem();

  system.register({
    token: CounterToken,
    actor: CounterActor,
    options: {}
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
