import { ActorSystem } from '@d-buckner/ensemble-core';
import { EnsembleProvider } from '@d-buckner/ensemble-solidjs';
import { render } from 'solid-js/web';
import { AnomalyDetectionActor } from './actors/AnomalyDetectionActor';
import { DashboardActor } from './actors/DashboardActor';
import { MetricGeneratorActor } from './actors/MetricGeneratorActor';
import { StatisticsActor } from './actors/StatisticsActor';
import { App } from './App';
import { GeneratorToken, StatisticsToken, AnomalyDetectionToken, DashboardToken } from './tokens';


async function main() {
  const system = new ActorSystem();

  // Register actors in dependency order
  system.register({
    token: GeneratorToken,
    actor: MetricGeneratorActor
  });

  system.register({
    token: StatisticsToken,
    actor: StatisticsActor,
    dependencies: {
      MetricGeneratorActor: GeneratorToken
    }
  });

  system.register({
    token: AnomalyDetectionToken,
    actor: AnomalyDetectionActor,
    dependencies: {
      StatisticsActor: StatisticsToken
    }
  });

  system.register({
    token: DashboardToken,
    actor: DashboardActor,
    dependencies: {
      StatisticsActor: StatisticsToken,
      AnomalyDetectionActor: AnomalyDetectionToken
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
