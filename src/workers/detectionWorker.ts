/**
 * detectionWorker.ts
 * Runs in a Web Worker — all ONNX preprocessing + inference happens here,
 * never blocking the main thread.
 */
import * as ort from 'onnxruntime-web';
import { COCO_CLASSES } from '@/lib/constants';
import { calculateLetterbox, mapRectTargetToSource } from '@/lib/utils/coordinates';
import type { YOLOConfig, Detection, DetectionResult, BoundingBox, Dimensions } from '@/types';

let session: ort.InferenceSession | null = null;
let inputName = 'images';
let outputName = 'output0';
let modelFormat: 'raw' | 'end2end' | 'unknown' = 'unknown';
let warmupDone = false;
let isDemoMode = false;
let idCounter = 0;

function uid(): string { return (++idCounter).toString(36); }

function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function nms(dets: Detection[], thresh: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence);
  const keep: Detection[] = [];
  while (sorted.length) {
    const cur = sorted.shift()!;
    keep.push(cur);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (iou(cur.bbox, sorted[i].bbox) > thresh) sorted.splice(i, 1);
    }
  }
  return keep;
}

function preprocess(
  pixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  inputSize: number
): { tensor: ort.Tensor; lb: ReturnType<typeof calculateLetterbox> } {
  const lb = calculateLetterbox({ width: srcW, height: srcH }, { width: inputSize, height: inputSize });
  const n = inputSize * inputSize;
  const data = new Float32Array(3 * n);
  data.fill(114 / 255);

  const { scaleX, scaleY, paddingX, paddingY } = lb;

  for (let y = 0; y < srcH; y++) {
    const dstY = Math.floor(y * scaleY + paddingY);
    if (dstY < 0 || dstY >= inputSize) continue;
    const srcRow = y * srcW;
    const dstRow = dstY * inputSize;
    for (let x = 0; x < srcW; x++) {
      const dstX = Math.floor(x * scaleX + paddingX);
      if (dstX < 0 || dstX >= inputSize) continue;
      const si = (srcRow + x) * 4;
      const di = dstRow + dstX;
      data[di]         = pixels[si]     / 255;
      data[n + di]     = pixels[si + 1] / 255;
      data[2 * n + di] = pixels[si + 2] / 255;
    }
  }

  return { tensor: new ort.Tensor('float32', data, [1, 3, inputSize, inputSize]), lb };
}

function postprocessEnd2End(
  output: ort.Tensor,
  capW: number, capH: number,
  origW: number, origH: number,
  lb: ReturnType<typeof calculateLetterbox>,
  confThr: number,
  maxDet: number
): Detection[] {
  const data = output.data as Float32Array;
  const dims = output.dims;
  const N = dims.length === 3 ? dims[1] : dims[0];
  const stride = dims.length === 3 ? dims[2] : dims[1];
  const scaleX = origW / capW;
  const scaleY = origH / capH;
  const dets: Detection[] = [];

  for (let i = 0; i < N; i++) {
    const b = i * stride;
    const conf = data[b + 4];
    if (conf < confThr) continue;
    const classId = Math.round(data[b + 5]);
    const modelBox = { x: data[b], y: data[b + 1], width: data[b + 2] - data[b], height: data[b + 3] - data[b + 1] };
    const capBox = mapRectTargetToSource(modelBox, lb);
    const norm: BoundingBox = {
      x: (capBox.x * scaleX) / origW,
      y: (capBox.y * scaleY) / origH,
      width: (capBox.width * scaleX) / origW,
      height: (capBox.height * scaleY) / origH,
    };
    dets.push({ id: uid(), classId, className: COCO_CLASSES[classId] ?? `class_${classId}`, confidence: conf, bbox: norm });
  }
  dets.sort((a, b) => b.confidence - a.confidence);
  return dets.slice(0, maxDet);
}

function postprocessRaw(
  output: ort.Tensor,
  capW: number, capH: number,
  origW: number, origH: number,
  lb: ReturnType<typeof calculateLetterbox>,
  confThr: number,
  iouThr: number,
  maxDet: number
): Detection[] {
  const data = output.data as Float32Array;
  const dims = output.dims;
  const numPred = dims.length === 3 ? dims[2] : (data.length / 84);
  const nc = 80;
  const scaleX = origW / capW;
  const scaleY = origH / capH;
  const raw: Detection[] = [];

  for (let i = 0; i < numPred; i++) {
    let maxScore = 0, maxCls = 0;
    for (let c = 0; c < nc; c++) {
      const s = data[(4 + c) * numPred + i];
      if (s > maxScore) { maxScore = s; maxCls = c; }
    }
    if (maxScore < confThr) continue;
    const cx = data[i], cy = data[numPred + i], w = data[2 * numPred + i], h = data[3 * numPred + i];
    const modelBox = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    const capBox = mapRectTargetToSource(modelBox, lb);
    const norm: BoundingBox = {
      x: (capBox.x * scaleX) / origW,
      y: (capBox.y * scaleY) / origH,
      width: (capBox.width * scaleX) / origW,
      height: (capBox.height * scaleY) / origH,
    };
    raw.push({ id: uid(), classId: maxCls, className: COCO_CLASSES[maxCls] ?? `class_${maxCls}`, confidence: maxScore, bbox: norm });
  }
  return nms(raw, iouThr).slice(0, maxDet);
}

function demoDetect(): Detection[] {
  const classes = [0, 1, 2, 3, 5, 7];
  const n = Math.floor(Math.random() * 3) + 1;
  return Array.from({ length: n }, () => {
    const classId = classes[Math.floor(Math.random() * classes.length)];
    const w = 0.1 + Math.random() * 0.25;
    const h = 0.15 + Math.random() * 0.25;
    return {
      id: uid(),
      classId,
      className: COCO_CLASSES[classId] ?? `class_${classId}`,
      confidence: 0.55 + Math.random() * 0.4,
      bbox: { x: Math.random() * (1 - w), y: Math.random() * (1 - h), width: w, height: h },
    };
  });
}

async function warmup(inputSize: number): Promise<void> {
  if (warmupDone || !session) return;
  const dummy = new Float32Array(inputSize * inputSize * 3);
  const t = new ort.Tensor('float32', dummy, [1, 3, inputSize, inputSize]);
  const feeds: Record<string, ort.Tensor> = {};
  feeds[inputName] = t;
  const res = await session.run(feeds);
  const dims = res[outputName].dims;
  modelFormat = (dims.length === 3 && dims[2] === 6) ? 'end2end' : 'raw';
  warmupDone = true;
}

async function loadModel(config: YOLOConfig): Promise<void> {
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    session = await ort.InferenceSession.create(config.modelPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    inputName = Array.from(session.inputNames)[0] ?? 'images';
    outputName = Array.from(session.outputNames)[0] ?? 'output0';
    await warmup(config.inputSize);
    isDemoMode = false;
    self.postMessage({ type: 'ready', demoMode: false });
  } catch {
    isDemoMode = true;
    self.postMessage({ type: 'ready', demoMode: true });
  }
}

interface DetectMsg {
  type: 'detect';
  reqId: string;
  sourceId: string;
  pixels: Uint8ClampedArray;
  capW: number;
  capH: number;
  origW: number;
  origH: number;
  config: YOLOConfig;
}

interface LoadMsg {
  type: 'load';
  config: YOLOConfig;
}

self.onmessage = async (e: MessageEvent<DetectMsg | LoadMsg>) => {
  const msg = e.data;

  if (msg.type === 'load') {
    await loadModel(msg.config);
    return;
  }

  if (msg.type === 'detect') {
    const t0 = performance.now();
    const { reqId, sourceId, pixels, capW, capH, origW, origH, config } = msg;
    try {
      let detections: Detection[];
      if (isDemoMode || !session) {
        await new Promise<void>(r => setTimeout(r, 20));
        detections = demoDetect();
      } else {
        const { tensor, lb } = preprocess(pixels, capW, capH, config.inputSize);
        const feeds: Record<string, ort.Tensor> = {};
        feeds[inputName] = tensor;
        const res = await session.run(feeds);
        const out = res[outputName];
        if (modelFormat === 'end2end') {
          detections = postprocessEnd2End(out, capW, capH, origW, origH, lb, config.confThreshold, config.maxDetections);
        } else {
          detections = postprocessRaw(out, capW, capH, origW, origH, lb, config.confThreshold, config.iouThreshold, config.maxDetections);
        }
      }
      const result: DetectionResult = {
        sourceId,
        timestamp: Date.now(),
        detections,
        inferenceTime: performance.now() - t0,
        frameSize: { width: capW, height: capH },
        modelInputSize: { width: config.inputSize, height: config.inputSize },
      };
      self.postMessage({ type: 'result', reqId, result });
    } catch (err) {
      self.postMessage({ type: 'error', reqId, error: String(err) });
    }
  }
};
