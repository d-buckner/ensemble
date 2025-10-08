import 'reflect-metadata';
import { render } from 'solid-js/web';
import { ActorSystem } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-solidjs';
import { MetricGeneratorActor } from './actors/MetricGeneratorActor';
import { StatisticsActor } from './actors/StatisticsActor';
import { AnomalyDetectionActor } from './actors/AnomalyDetectionActor';
import { DashboardActor } from './actors/DashboardActor';
import { GeneratorToken, StatisticsToken, AnomalyDetectionToken, DashboardToken } from './tokens';
import { App } from './App';

async function main() {
  const system = new ActorSystem({
    workerOutput: 'assets'
  });

  // Register actors in dependency order
  system.register({
    token: GeneratorToken,
    actor: MetricGeneratorActor
  });

  system.register({
    token: StatisticsToken,
    actor: StatisticsActor,
    dependencies: {
      generator: GeneratorToken
    }
  });

  system.register({
    token: AnomalyDetectionToken,
    actor: AnomalyDetectionActor,
    dependencies: {
      statistics: StatisticsToken
    }
  });

  system.register({
    token: DashboardToken,
    actor: DashboardActor,
    dependencies: {
      statistics: StatisticsToken,
      anomalyDetection: AnomalyDetectionToken
    }
  });

  await system.start();

  const root = document.getElementById('app')!;
  render(
    () => (
      <EnsembleProvider system={system}>
        <App />
      </EnsembleProvider>
    ),
    root
  );

  (window as any).system = system;
}

main().catch(console.error);
