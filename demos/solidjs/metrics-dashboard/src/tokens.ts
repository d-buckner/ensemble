import { createActorToken } from '@d-buckner/ensemble-core';
import type { AnomalyDetectionActor } from './actors/AnomalyDetectionActor';
import type { DashboardActor } from './actors/DashboardActor';
import type { MetricGeneratorActor } from './actors/MetricGeneratorActor';
import type { StatisticsActor } from './actors/StatisticsActor';


export const GeneratorToken = createActorToken<MetricGeneratorActor>('MetricGeneratorActor');
export const StatisticsToken = createActorToken<StatisticsActor>('StatisticsActor');
export const AnomalyDetectionToken = createActorToken<AnomalyDetectionActor>('AnomalyDetectionActor');
export const DashboardToken = createActorToken<DashboardActor>('DashboardActor');
