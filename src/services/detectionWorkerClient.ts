/**
 * detectionWorkerClient.ts
 * Manages a singleton Web Worker for ONNX inference.
 * Uses Next.js bundled ES module worker — no CDN, no importScripts.
 */
import type { YOLOConfig, DetectionResult } from '@/types';

type Resolve = (r: DetectionResult) => void;
type Reject = (e: Error) => void;

const WORKER_DISPOSED_ERROR = 'Worker disposed';

export function isWorkerDisposedError(error: unknown): boolean {
  return error instanceof Error && error.message === WORKER_DISPOSED_ERROR;
}

class DetectionWorkerClient {
  private worker: Worker | null = null;
  private ready = false;
  private demoMode = false;
  private pending = new Map<string, { resolve: Resolve; reject: Reject }>();
  private counter = 0;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  constructor() {
    this.readyPromise = new Promise<void>((res) => { this.readyResolve = res; });
  }

  init(config: YOLOConfig): void {
    if (this.worker) return;
    // new URL(..., import.meta.url) makes webpack/Next.js bundle the worker
    this.worker = new Worker(
      new URL('../workers/detectionWorker.ts', import.meta.url),
      { type: 'module' }
    );
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e);
    this.worker.onerror = (e) => {
      console.error('[DetectionWorker]', e);
      for (const [, p] of this.pending) p.reject(new Error(e.message));
      this.pending.clear();
    };
    this.worker.postMessage({ type: 'load', config });
  }

  private handleMessage(e: MessageEvent) {
    const msg = e.data;
    if (msg.type === 'ready') {
      this.ready = true;
      this.demoMode = msg.demoMode;
      this.readyResolve();
      return;
    }
    const p = this.pending.get(msg.reqId);
    if (!p) return;
    this.pending.delete(msg.reqId);
    if (msg.type === 'result') p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  }

  async waitReady(): Promise<void> {
    return this.readyPromise;
  }

  isReady(): boolean { return this.ready; }
  isDemoMode(): boolean { return this.demoMode; }

  detect(params: {
    sourceId: string;
    pixels: Uint8ClampedArray;
    capW: number;
    capH: number;
    origW: number;
    origH: number;
    config: YOLOConfig;
  }): Promise<DetectionResult> {
    return new Promise((resolve, reject) => {
      const reqId = (++this.counter).toString(36);
      this.pending.set(reqId, { resolve, reject });
      // Transfer the ArrayBuffer — zero-copy
      const buf = params.pixels.buffer.slice(0);
      this.worker!.postMessage(
        { type: 'detect', reqId, ...params, pixels: new Uint8ClampedArray(buf) },
        [buf]
      );
    });
  }

  dispose(): void {
    for (const [, p] of this.pending) p.reject(new Error(WORKER_DISPOSED_ERROR));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }
}

let client: DetectionWorkerClient | null = null;

export function getWorkerClient(): DetectionWorkerClient {
  if (!client) client = new DetectionWorkerClient();
  return client;
}

export async function initWorkerClient(config: YOLOConfig): Promise<DetectionWorkerClient> {
  const c = getWorkerClient();
  c.init(config);
  await c.waitReady();
  return c;
}

export function disposeWorkerClient(): void {
  client?.dispose();
  client = null;
}
