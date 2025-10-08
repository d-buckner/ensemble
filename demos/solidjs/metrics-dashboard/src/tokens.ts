import { createActorToken } from '@d-buckner/ensemble-core';
import type { AnomalyDetectionActor } from './actors/AnomalyDetectionActor';
import type { DashboardActor } from './actors/DashboardActor';
import type { MetricGeneratorActor } from './actors/MetricGeneratorActor';
import type { StatisticsActor } from './actors/StatisticsActor';


export const GeneratorToken = createActorToken<MetricGeneratorActor>('generator');
export const StatisticsToken = createActorToken<StatisticsActor>('statistics');
export const AnomalyDetectionToken = createActorToken<AnomalyDetectionActor>('anomalyDetection');
export const DashboardToken = createActorToken<DashboardActor>('dashboard');
