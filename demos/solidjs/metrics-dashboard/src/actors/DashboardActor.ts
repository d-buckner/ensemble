import { Actor } from '@d-buckner/ensemble-core';
import type { ActorClient } from '@d-buckner/ensemble-core';
import type { StatisticsActor, ProcessedBatch, ProcessedMetrics } from './StatisticsActor';
import type { AnomalyDetectionActor, Anomaly } from './AnomalyDetectionActor';

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
  statistics: ActorClient<StatisticsActor>;
  anomalyDetection: ActorClient<AnomalyDetectionActor>;
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

  protected deps!: DashboardDeps;
  private metricQueue: ProcessedMetrics[] = [];
  private replayInterval: number | null = null;
  private readonly replayRate = 10; // Add one point every 10ms for smooth animation

  constructor() {
    super(DashboardActor.initialState);
  }

  onInit(): void {
    console.log('[DashboardActor] onInit called, subscribing to processedBatch and latestAnomaly');
    this.deps.statistics.on('processedBatch', this.updateChartData.bind(this));
    this.deps.anomalyDetection.on('latestAnomaly', this.addAnomaly.bind(this));
    this.startReplay();
  }

  onDestroy(): void {
    this.deps.statistics.off('processedBatch', this.updateChartData.bind(this));
    this.deps.anomalyDetection.off('latestAnomaly', this.addAnomaly.bind(this));
    this.stopReplay();
  }

  private startReplay(): void {
    if (this.replayInterval !== null) return;

    this.replayInterval = setInterval(() => {
      if (this.metricQueue.length === 0) return;

      // Take the next metric from the queue
      const metric = this.metricQueue.shift()!;

      this.setState(draft => {
        // Update current metrics
        draft.currentMetrics = metric;

        // Add new point to time series
        this.addPoint(draft.chartData.cpuSeries, metric.timestamp, metric.cpu.overall);
        this.addPoint(draft.chartData.memorySeries, metric.timestamp, metric.memory.usedPercent);
        this.addPoint(draft.chartData.latencySeries, metric.timestamp, metric.latency.p95);
        this.addPoint(draft.chartData.throughputSeries, metric.timestamp, metric.throughput.requestsPerSec);
        this.addPoint(draft.chartData.errorRateSeries, metric.timestamp, metric.throughput.errorRate);

        // Trim to window size
        this.trimSeries(draft.chartData.cpuSeries, draft.windowSize);
        this.trimSeries(draft.chartData.memorySeries, draft.windowSize);
        this.trimSeries(draft.chartData.latencySeries, draft.windowSize);
        this.trimSeries(draft.chartData.throughputSeries, draft.windowSize);
        this.trimSeries(draft.chartData.errorRateSeries, draft.windowSize);
      });
    }, this.replayRate) as unknown as number;
  }

  private stopReplay(): void {
    if (this.replayInterval !== null) {
      clearInterval(this.replayInterval);
      this.replayInterval = null;
    }
  }

  private updateChartData(batch: ProcessedBatch | null): void {
    console.log('[DashboardActor] updateChartData called with:', batch ? `${batch.metrics.length} metrics` : 'null');
    if (!batch) return;

    // Queue all metrics for replay animation
    this.metricQueue.push(...batch.metrics);
  }

  private addAnomaly(anomaly: Anomaly | null): void {
    if (!anomaly) return;
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
