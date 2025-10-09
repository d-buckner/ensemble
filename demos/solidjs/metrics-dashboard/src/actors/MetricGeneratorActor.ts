import { Actor, action, thread } from '@d-buckner/ensemble-core';
import { createNoise2D } from 'simplex-noise';


export interface RawMetrics {
  timestamp: number;
  cpuCores: number[];
  memory: {
    heap: number;
    stack: number;
    cache: number;
    total: number;
  };
  requests: Array<{
    timestamp: number;
    duration: number;
    endpoint: string;
    statusCode: number;
  }>;
  network: {
    interfaces: Array<{
      name: string;
      bytesIn: number;
      bytesOut: number;
    }>;
  };
  database: Array<{
    query: string;
    duration: number;
    rows: number;
  }>;
}

export interface MetricBatch {
  metrics: RawMetrics[];
  batchStartTime: number;
  batchEndTime: number;
}

export interface MetricGeneratorState {
  isGenerating: boolean;
  batchesGenerated: number;
  metricsGenerated: number;
  batchSize: number;
  batchInterval: number; // ms between batches
  throughput: number; // target metrics per second
}

export interface MetricGeneratorEvents {
  metricBatch: MetricBatch;
}

/**
 * MetricGeneratorActor continuously generates raw server metrics.
 *
 * Demonstrates:
 * - Batched event emissions (reduces serialization overhead)
 * - Complex data structure generation
 * - Continuous streaming on worker thread
 *
 * Runs on WORKER-1 to avoid blocking main thread
 */
@thread('worker-1')
export class MetricGeneratorActor extends Actor<MetricGeneratorState, MetricGeneratorEvents> {
  static readonly initialState: MetricGeneratorState = {
    isGenerating: false,
    batchesGenerated: 0,
    metricsGenerated: 0,
    batchSize: 1,
    batchInterval: 1, // Calculated: (1 × 1000) / 1000 = 1ms
    throughput: 1000 // Default 1000 metrics/sec
  };

  private readonly endpoints = ['/api/users', '/api/orders', '/api/products', '/api/auth', '/api/analytics'];
  private readonly queries = ['SELECT * FROM users', 'SELECT * FROM orders', 'UPDATE inventory', 'INSERT INTO logs'];
  private intervalId: number | null = null;
  private currentBatchSize = 1; // Cached batch size for interval callback
  private currentBatchInterval = 1; // Cached interval for interval callback
  private currentThroughput = 1000; // Cached throughput for calculations

  // Simplex noise generators for smooth, organic trends
  private cpuNoise = createNoise2D();
  private memoryNoise = createNoise2D();
  private latencyNoise = createNoise2D();
  private throughputNoise = createNoise2D();

  // Time tracking for noise functions
  private cpuNoiseTime = 0;
  private memoryNoiseTime = 0;
  private latencyNoiseTime = 0;
  private throughputNoiseTime = 0;

  // Different noise scales for each metric type
  private readonly cpuNoiseScale = 0.01; // Faster variation for CPU
  private readonly memoryNoiseScale = 0.01; // Faster variation for memory
  private readonly latencyNoiseScale = 0.002; // Keep latency smooth
  private readonly throughputNoiseScale = 0.01; // Faster variation for throughput

  // State for anomalies
  private cpuBaseline = 40;
  private memoryTrend = 0;
  private requestRateMultiplier = 1;

  constructor() {
    super(MetricGeneratorActor.initialState);
  }

  @action
  start(): void {
    if (this.intervalId !== null) return;

    this.setState(draft => {
      draft.isGenerating = true;
      draft.batchesGenerated = 0;
      draft.metricsGenerated = 0;
    });

    this.startBatchGeneration();
  }

  @action
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.setState(draft => {
      draft.isGenerating = false;
    });
  }

  @action
  setBatchSize(size: number): void {
    const clampedSize = Math.max(1, Math.min(1000, Math.floor(size)));
    this.currentBatchSize = clampedSize;

    // Recalculate interval to maintain throughput
    // throughput (metrics/s) = batchSize × (1000 / interval)
    // interval = (batchSize × 1000) / throughput
    const newInterval = Math.max(1, Math.floor((clampedSize * 1000) / this.currentThroughput));
    this.currentBatchInterval = newInterval;

    this.setState(draft => {
      draft.batchSize = clampedSize;
      draft.batchInterval = newInterval;
    });

    // If currently generating, restart the interval with new timing
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.startBatchGeneration();
    }
  }

  @action
  setThroughput(throughput: number): void {
    const clampedThroughput = Math.max(1, Math.min(10000, Math.floor(throughput)));
    this.currentThroughput = clampedThroughput;

    // Recalculate interval based on current batch size
    // interval = (batchSize × 1000) / throughput
    const newInterval = Math.max(1, Math.floor((this.currentBatchSize * 1000) / clampedThroughput));
    this.currentBatchInterval = newInterval;

    this.setState(draft => {
      draft.throughput = clampedThroughput;
      draft.batchInterval = newInterval;
    });

    // If currently generating, restart the interval with new timing
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.startBatchGeneration();
    }
  }

  private startBatchGeneration(): void {
    this.intervalId = setInterval(() => {
      if (this.intervalId === null) return;

      const batchStartTime = Date.now();
      const batch: RawMetrics[] = [];

      for (let i = 0; i < this.currentBatchSize; i++) {
        batch.push(this.generateMetrics());
      }

      const batchEndTime = Date.now();

      const metricBatch: MetricBatch = {
        metrics: batch,
        batchStartTime,
        batchEndTime
      };

      console.log('[MetricGeneratorActor] Emitting metricBatch event with', batch.length, 'metrics');
      this.emit('metricBatch', metricBatch);

      this.setState(draft => {
        draft.batchesGenerated++;
        draft.metricsGenerated += this.currentBatchSize;
      });

      // Randomly inject anomalies
      this.updateTrends();
    }, this.currentBatchInterval) as unknown as number;
  }

  private generateMetrics(): RawMetrics {
    // Advance noise time for each metric independently
    this.cpuNoiseTime += this.cpuNoiseScale;
    this.memoryNoiseTime += this.memoryNoiseScale;
    this.latencyNoiseTime += this.latencyNoiseScale;
    this.throughputNoiseTime += this.throughputNoiseScale;

    // CPU: Use simplex noise for smooth baseline + anomaly spikes
    const cpuNoiseValue = this.cpuNoise(this.cpuNoiseTime, 0);
    const cpuBase = 30 + (cpuNoiseValue + 1) * 20; // Range: 30-70
    const cpuCores = Array.from({ length: 4 }, (_, i) => {
      const coreNoise = this.cpuNoise(this.cpuNoiseTime, i * 10);
      const base = cpuBase + this.cpuBaseline - 40 + coreNoise * 5;
      return Math.max(0, Math.min(100, base + (Math.random() - 0.5) * 2)); // Tiny random variation
    });

    // Memory: Smooth trend with simplex noise
    const memoryNoiseValue = this.memoryNoise(this.memoryNoiseTime, 0);
    const heapBase = 40 + (memoryNoiseValue + 1) * 15 + this.memoryTrend;
    const heap = Math.max(0, Math.min(100, heapBase + (Math.random() - 0.5) * 1));
    const stack = 5 + (this.memoryNoise(this.memoryNoiseTime, 1) + 1) * 7.5;
    const cache = 10 + (this.memoryNoise(this.memoryNoiseTime, 2) + 1) * 10;

    // Requests: Smooth throughput with noise
    const throughputNoiseValue = this.throughputNoise(this.throughputNoiseTime, 0);
    const baseRequests = 2 + (throughputNoiseValue + 1) * 2; // Range: 2-6
    const numRequests = Math.floor(baseRequests * this.requestRateMultiplier);

    const latencyNoiseValue = this.latencyNoise(this.latencyNoiseTime, 0);
    const baseLatency = 20 + (latencyNoiseValue + 1) * 30; // Range: 20-80ms

    const requests = Array.from({ length: numRequests }, () => ({
      timestamp: Date.now(),
      duration: Math.random() < 0.05
        ? Math.random() * 1000 // 5% slow requests
        : baseLatency + (Math.random() - 0.5) * 5,
      endpoint: this.endpoints[Math.floor(Math.random() * this.endpoints.length)],
      statusCode: Math.random() < 0.02 ? 500 : 200 // 2% error rate
    }));

    // Network I/O: Smooth variation
    const networkNoiseValue = this.throughputNoise(this.throughputNoiseTime, 5);
    const networkBase = 300000 + (networkNoiseValue + 1) * 200000;
    const networkInterfaces = [
      {
        name: 'eth0',
        bytesIn: Math.floor(networkBase + (Math.random() - 0.5) * 20000),
        bytesOut: Math.floor(networkBase * 0.8 + (Math.random() - 0.5) * 16000)
      },
      {
        name: 'eth1',
        bytesIn: Math.floor(networkBase * 0.5 + (Math.random() - 0.5) * 10000),
        bytesOut: Math.floor(networkBase * 0.4 + (Math.random() - 0.5) * 8000)
      }
    ];

    // Database queries: Smooth latency
    const numQueries = Math.floor((throughputNoiseValue + 1) * 1.5);
    const dbLatency = 10 + (latencyNoiseValue + 1) * 15; // Range: 10-40ms
    const database = Array.from({ length: numQueries }, () => ({
      query: this.queries[Math.floor(Math.random() * this.queries.length)],
      duration: Math.random() < 0.1
        ? Math.random() * 500
        : dbLatency + (Math.random() - 0.5) * 3,
      rows: Math.floor(Math.random() * 1000)
    }));

    return {
      timestamp: Date.now(),
      cpuCores,
      memory: {
        heap,
        stack,
        cache,
        total: 16384 // 16GB total
      },
      requests,
      network: {
        interfaces: networkInterfaces
      },
      database
    };
  }

  private updateTrends(): void {
    // Slowly increase memory (simulate leak)
    this.memoryTrend += Math.random() * 0.1;

    // Randomly spike CPU
    if (Math.random() < 0.05) {
      this.cpuBaseline = 80 + Math.random() * 20;
    } else {
      this.cpuBaseline = Math.max(20, this.cpuBaseline * 0.95); // Decay back to normal
    }

    // Randomly spike request rate
    if (Math.random() < 0.05) {
      this.requestRateMultiplier = 3 + Math.random() * 2;
    } else {
      this.requestRateMultiplier = Math.max(1, this.requestRateMultiplier * 0.9);
    }
  }
}
