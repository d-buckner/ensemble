import { Actor, effect } from '@d-buckner/ensemble-core';
import type { AnomalyDetectionActor, Anomaly } from './AnomalyDetectionActor';
import type { StatisticsActor, ProcessedBatch, ProcessedMetrics } from './StatisticsActor';
import type { ActorClient } from '@d-buckner/ensemble-core';


export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface ChartData {
  cpuSeries: TimeSeriesPoint[];
  memorySeries: TimeSeriesPoint[];
  latencySeries: TimeSeriesPoint[];
  throughputSeries: TimeSeriesPoint[];
  errorRateSeries: TimeSeriesPoint[];
}

export interface DashboardState {
  chartData: ChartData;
  currentMetrics: ProcessedMetrics | null;
  recentAnomalies: Anomaly[];
  windowSize: number; // Number of data points to keep
}

interface DashboardDeps {
  StatisticsActor: ActorClient<StatisticsActor>;
  AnomalyDetectionActor: ActorClient<AnomalyDetectionActor>;
}

/**
 * DashboardActor prepares chart-ready data for the UI.
 *
 * Demonstrates:
 * - Time-series data windowing
 * - Multiple data source aggregation
 * - Main thread data preparation (close to UI)
 * - Minimal state updates for smooth rendering
 *
 * Runs on MAIN THREAD for direct UI access
 */
export class DashboardActor extends Actor<DashboardState> {
  static readonly initialState: DashboardState = {
    chartData: {
      cpuSeries: [],
      memorySeries: [],
      latencySeries: [],
      throughputSeries: [],
      errorRateSeries: []
    },
    currentMetrics: null,
    recentAnomalies: [],
    windowSize: 300 // Keep last 300 data points (~30 seconds at 10Hz sampling)
  };

  protected declare deps: DashboardDeps;
  private readonly samplingRate = 10; // Sample every Nth metric to reduce chart density

  constructor() {
    super(DashboardActor.initialState);
  }

  @effect('StatisticsActor.processedBatch')
  handleProcessedBatch(batch: ProcessedBatch): void {
    // Sample metrics to reduce chart density
    // Take every Nth metric plus the last one (most recent)
    const metricsToAdd = batch.metrics.filter((_, i) =>
      i % this.samplingRate === 0 || i === batch.metrics.length - 1
    );

    this.setState(draft => {
      // Update current metrics to the latest we're adding
      draft.currentMetrics = metricsToAdd[metricsToAdd.length - 1];

      // Add points to time series
      for (const metric of metricsToAdd) {
        this.addPoint(draft.chartData.cpuSeries, metric.timestamp, metric.cpu.overall);
        this.addPoint(draft.chartData.memorySeries, metric.timestamp, metric.memory.usedPercent);
        this.addPoint(draft.chartData.latencySeries, metric.timestamp, metric.latency.p95);
        this.addPoint(draft.chartData.throughputSeries, metric.timestamp, metric.throughput.requestsPerSec);
        this.addPoint(draft.chartData.errorRateSeries, metric.timestamp, metric.throughput.errorRate);
      }

      // Trim to window size
      this.trimSeries(draft.chartData.cpuSeries, draft.windowSize);
      this.trimSeries(draft.chartData.memorySeries, draft.windowSize);
      this.trimSeries(draft.chartData.latencySeries, draft.windowSize);
      this.trimSeries(draft.chartData.throughputSeries, draft.windowSize);
      this.trimSeries(draft.chartData.errorRateSeries, draft.windowSize);
    });

  }

  @effect('AnomalyDetectionActor.latestAnomaly')
  handleAnomaly(anomaly: Anomaly): void {
    this.setState(draft => {
      draft.recentAnomalies = [anomaly, ...draft.recentAnomalies].slice(0, 5);
    });
  }

  private addPoint(series: TimeSeriesPoint[], timestamp: number, value: number): void {
    series.push({ timestamp, value });
  }

  private trimSeries(series: TimeSeriesPoint[], maxSize: number): void {
    if (series.length > maxSize) {
      series.splice(0, series.length - maxSize);
    }
  }
}
