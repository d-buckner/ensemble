import { Actor, thread } from '@d-buckner/ensemble-core';
import type { MetricGeneratorActor, MetricBatch } from './MetricGeneratorActor';
import type { ActorClient } from '@d-buckner/ensemble-core';


export interface ProcessedMetrics {
  timestamp: number;
  cpu: {
    overall: number;
    perCore: number[];
    mean: number;
    stdDev: number;
  };
  memory: {
    usedPercent: number;
    heapPercent: number;
    pressure: number; // 0-1 scale
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    mean: number;
  };
  throughput: {
    requestsPerSec: number;
    errorRate: number;
    byEndpoint: Record<string, number>;
  };
  network: {
    totalMbpsIn: number;
    totalMbpsOut: number;
    byInterface: Record<string, { mbpsIn: number; mbpsOut: number }>;
  };
  database: {
    avgQueryTime: number;
    p95QueryTime: number;
    slowQueries: number;
  };
}

export interface ProcessedBatch {
  metrics: ProcessedMetrics[];
  batchStartTime: number;
  batchEndTime: number;
}

export interface StatisticsState {
  isProcessing: boolean;
  batchesProcessed: number;
  metricsProcessed: number;
  processedBatch: ProcessedBatch | null;
}

interface StatisticsDeps {
  generator: ActorClient<MetricGeneratorActor>;
}

/**
 * StatisticsActor performs heavy data processing on raw metrics.
 *
 * Demonstrates:
 * - Complex aggregations and transformations
 * - Percentile calculations
 * - Batch processing of streaming data
 * - Cross-worker event communication
 *
 * Runs on WORKER-2 for parallel computation
 */
@thread('worker-2')
export class StatisticsActor extends Actor<StatisticsState> {
  static readonly initialState: StatisticsState = {
    isProcessing: false,
    batchesProcessed: 0,
    metricsProcessed: 0,
    processedBatch: null
  };

  protected declare deps: StatisticsDeps;

  constructor() {
    super(StatisticsActor.initialState);
  }

  onInit(): void {
    console.log('[StatisticsActor] onInit called, subscribing to latestBatch');
    this.deps.generator.on('latestBatch', this.processMetricBatch.bind(this));
  }

  onDestroy(): void {
    this.deps.generator.off('latestBatch', this.processMetricBatch.bind(this));
  }

  private processMetricBatch(batch: MetricBatch | null): void {
    console.log('[StatisticsActor] processMetricBatch called with:', batch ? `${batch.metrics.length} metrics` : 'null');
    if (!batch) return;
    this.setState(draft => {
      draft.isProcessing = true;
    });

    const processed: ProcessedMetrics[] = batch.metrics.map(rawMetric => {
      // CPU processing
      const cpuOverall = rawMetric.cpuCores.reduce((sum, val) => sum + val, 0) / rawMetric.cpuCores.length;
      const cpuMean = cpuOverall;
      const cpuVariance = rawMetric.cpuCores.reduce((sum, val) => sum + Math.pow(val - cpuMean, 2), 0) / rawMetric.cpuCores.length;
      const cpuStdDev = Math.sqrt(cpuVariance);

      // Add computational load to simulate heavy processing
      this.simulateHeavyComputation();

      // Memory processing
      const totalUsed = rawMetric.memory.heap + rawMetric.memory.stack + rawMetric.memory.cache;
      const usedPercent = (totalUsed / rawMetric.memory.total) * 100;
      const heapPercent = (rawMetric.memory.heap / rawMetric.memory.total) * 100;
      const memoryPressure = Math.min(1, usedPercent / 90); // Normalize to 0-1

      // Latency percentiles
      const latencies = rawMetric.requests.map(r => r.duration).sort((a, b) => a - b);
      const p50 = this.calculatePercentile(latencies, 50);
      const p95 = this.calculatePercentile(latencies, 95);
      const p99 = this.calculatePercentile(latencies, 99);
      const latencyMean = latencies.length > 0
        ? latencies.reduce((sum, val) => sum + val, 0) / latencies.length
        : 0;

      // Throughput
      const errorCount = rawMetric.requests.filter(r => r.statusCode >= 500).length;
      const errorRate = rawMetric.requests.length > 0
        ? (errorCount / rawMetric.requests.length) * 100
        : 0;

      const byEndpoint: Record<string, number> = {};
      rawMetric.requests.forEach(req => {
        byEndpoint[req.endpoint] = (byEndpoint[req.endpoint] || 0) + 1;
      });

      // Network throughput (convert bytes to Mbps)
      const bytesToMbps = (bytes: number, timeWindow: number = 0.1) => (bytes * 8) / (timeWindow * 1_000_000);
      const totalBytesIn = rawMetric.network.interfaces.reduce((sum, iface) => sum + iface.bytesIn, 0);
      const totalBytesOut = rawMetric.network.interfaces.reduce((sum, iface) => sum + iface.bytesOut, 0);

      const byInterface: Record<string, { mbpsIn: number; mbpsOut: number }> = {};
      rawMetric.network.interfaces.forEach(iface => {
        byInterface[iface.name] = {
          mbpsIn: bytesToMbps(iface.bytesIn),
          mbpsOut: bytesToMbps(iface.bytesOut)
        };
      });

      // Database statistics
      const queryDurations = rawMetric.database.map(q => q.duration).sort((a, b) => a - b);
      const avgQueryTime = queryDurations.length > 0
        ? queryDurations.reduce((sum, val) => sum + val, 0) / queryDurations.length
        : 0;
      const p95QueryTime = this.calculatePercentile(queryDurations, 95);
      const slowQueries = rawMetric.database.filter(q => q.duration > 100).length;

      return {
        timestamp: rawMetric.timestamp,
        cpu: {
          overall: cpuOverall,
          perCore: rawMetric.cpuCores,
          mean: cpuMean,
          stdDev: cpuStdDev
        },
        memory: {
          usedPercent,
          heapPercent,
          pressure: memoryPressure
        },
        latency: {
          p50,
          p95,
          p99,
          mean: latencyMean
        },
        throughput: {
          requestsPerSec: rawMetric.requests.length * 10, // Scale to per-second
          errorRate,
          byEndpoint
        },
        network: {
          totalMbpsIn: bytesToMbps(totalBytesIn),
          totalMbpsOut: bytesToMbps(totalBytesOut),
          byInterface
        },
        database: {
          avgQueryTime,
          p95QueryTime,
          slowQueries
        }
      };
    });

    // Update state with processed batch
    this.setState(draft => {
      draft.processedBatch = {
        metrics: processed,
        batchStartTime: batch.batchStartTime,
        batchEndTime: batch.batchEndTime
      };
      draft.isProcessing = false;
      draft.batchesProcessed++;
      draft.metricsProcessed += batch.metrics.length;
    });
  }

  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  private simulateHeavyComputation(): void {
    // Simulate CPU-intensive statistical computation
    let _sum = 0;
    for (let i = 0; i < 10000; i++) {
      _sum += Math.sin(i) * Math.cos(i) * Math.tan(i / 100);
    }
  }
}
