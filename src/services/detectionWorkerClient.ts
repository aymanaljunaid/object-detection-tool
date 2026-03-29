/**
 * detectionWorkerClient.ts
 * Bridge between the scheduler and the Web Worker.
 */

import type { YOLOConfig, DetectionResult } from '@/types';

type PendingResolve = (result: DetectionResult) => void;
type PendingReject = (err: Error) => void;

interface WorkerClient {
  detect(params: DetectParams): Promise<DetectionResult>;
  isReady(): boolean;
  isDemoMode(): boolean;
  dispose(): void;
}

interface DetectParams {
  sourceId: string;
  pixels: Uint8ClampedArray;
  capW: number;
  capH: number;
  origW: number;
  origH: number;
}

let client: WorkerClientImpl | null = null;

class WorkerClientImpl implements WorkerClient {
  private worker: Worker;
  private ready = false;
  private demo = false;
  private pending = new Map<string, { resolve: PendingResolve; reject: PendingReject }>();
  private reqCounter = 0;
  private config: YOLOConfig;

  constructor(config: YOLOConfig) {
    this.config = config;
    this.worker = new Worker('/detectionWorker.js');
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = (e) => {
      console.error('[DetectionWorker] error', e);
      for (const [, p] of this.pending) p.reject(new Error(String(e.message)));
      this.pending.clear();
    };
    this.worker.postMessage({ type: 'load', modelPath: config.modelPath, inputSize: config.inputSize });
  }

  private handleMessage(e: MessageEvent) {
    const msg = e.data;
    if (msg.type === 'ready') {
      this.ready = true;
      this.demo = msg.demoMode;
      return;
    }
    if (msg.type === 'result' || msg.type === 'error') {
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      this.pending.delete(msg.reqId);
      if (msg.type === 'error') {
        p.reject(new Error(msg.error));
      } else {
        p.resolve({
          sourceId: msg.sourceId,
          timestamp: Date.now(),
          detections: msg.detections,
          inferenceTime: msg.inferenceTime,
          frameSize: { width: msg.capW, height: msg.capH },
          modelInputSize: { width: this.config.inputSize, height: this.config.inputSize },
        });
      }
    }
  }

  detect(params: DetectParams): Promise<DetectionResult> {
    return new Promise((resolve, reject) => {
      const reqId = (++this.reqCounter).toString(36);
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({
        type: 'detect',
        reqId,
        sourceId: params.sourceId,
        pixels: params.pixels,
        capW: params.capW,
        capH: params.capH,
        origW: params.origW,
        origH: params.origH,
        inputSize: this.config.inputSize,
        confThr: this.config.confThreshold,
        iouThr: this.config.iouThreshold,
        maxDet: this.config.maxDetections,
      }, [params.pixels.buffer]);
    });
  }

  isReady() { return this.ready; }
  isDemoMode() { return this.demo; }

  dispose() {
    for (const [, p] of this.pending) p.reject(new Error('Worker disposed'));
    this.pending.clear();
    this.worker.terminate();
    this.ready = false;
  }
}

export function getWorkerClient(config: YOLOConfig): WorkerClient {
  if (!client) {
    client = new WorkerClientImpl(config);
  }
  return client;
}

export async function initWorkerClient(config: YOLOConfig): Promise<WorkerClient> {
  const c = getWorkerClient(config);
  if (!c.isReady()) {
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (c.isReady()) { clearInterval(check); resolve(); }
      }, 50);
    });
  }
  return c;
}

export function disposeWorkerClient() {
  if (client) { client.dispose(); client = null; }
}
