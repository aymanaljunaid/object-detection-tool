/* detectionWorker.js — runs in a Web Worker, never on the main thread */

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js');

const COCO_CLASSES = [
  'person','bicycle','car','motorcycle','airplane','bus','train','truck',
  'boat','traffic light','fire hydrant','stop sign','parking meter','bench',
  'bird','cat','dog','horse','sheep','cow','elephant','bear','zebra',
  'giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee',
  'skis','snowboard','sports ball','kite','baseball bat','baseball glove',
  'skateboard','surfboard','tennis racket','bottle','wine glass','cup',
  'fork','knife','spoon','bowl','banana','apple','sandwich','orange',
  'broccoli','carrot','hot dog','pizza','donut','cake','chair','couch',
  'potted plant','bed','dining table','toilet','tv','laptop','mouse',
  'remote','keyboard','cell phone','microwave','oven','toaster','sink',
  'refrigerator','book','clock','vase','scissors','teddy bear','hair drier',
  'toothbrush',
];

let session = null;
let modelFormat = 'unknown';
let inputName = 'images';
let outputName = 'output0';
let warmupDone = false;
let isDemoMode = false;
let idCounter = 0;

function uid() { return (++idCounter).toString(36); }

// ---- letterbox helpers ----
function calcLetterbox(src, dst) {
  const sx = dst.w / src.w;
  const sy = dst.h / src.h;
  const scale = Math.min(sx, sy);
  const nw = src.w * scale;
  const nh = src.h * scale;
  return {
    scaleX: scale, scaleY: scale,
    paddingX: (dst.w - nw) / 2,
    paddingY: (dst.h - nh) / 2,
    scaledW: nw, scaledH: nh,
  };
}

function unletterbox(box, lb) {
  return {
    x: (box.x - lb.paddingX) / lb.scaleX,
    y: (box.y - lb.paddingY) / lb.scaleY,
    w: box.w / lb.scaleX,
    h: box.h / lb.scaleY,
  };
}

// ---- preprocess ----
function preprocess(pixels, srcW, srcH, inputSize) {
  const lb = calcLetterbox({ w: srcW, h: srcH }, { w: inputSize, h: inputSize });
  const n = inputSize * inputSize;
  const tensor = new Float32Array(3 * n);
  tensor.fill(114 / 255);

  const sx = lb.scaleX;
  const sy = lb.scaleY;
  const px = lb.paddingX;
  const py = lb.paddingY;

  for (let y = 0; y < srcH; y++) {
    const dstY = Math.floor(y * sy + py);
    if (dstY < 0 || dstY >= inputSize) continue;
    const rowOff = dstY * inputSize;
    const srcRowOff = y * srcW;
    for (let x = 0; x < srcW; x++) {
      const dstX = Math.floor(x * sx + px);
      if (dstX < 0 || dstX >= inputSize) continue;
      const si = (srcRowOff + x) * 4;
      const di = rowOff + dstX;
      tensor[di]         = pixels[si]     / 255;
      tensor[n + di]     = pixels[si + 1] / 255;
      tensor[2 * n + di] = pixels[si + 2] / 255;
    }
  }
  return { tensor, lb };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function nms(dets, thresh) {
  dets.sort((a, b) => b.confidence - a.confidence);
  const keep = [];
  while (dets.length) {
    const cur = dets.shift();
    keep.push(cur);
    for (let i = dets.length - 1; i >= 0; i--) {
      if (iou(cur.raw, dets[i].raw) > thresh) dets.splice(i, 1);
    }
  }
  return keep;
}

function postprocess(data, dims, lb, capW, capH, origW, origH, confThr, iouThr, maxDet) {
  const sx = origW / capW;
  const sy = origH / capH;
  const dets = [];

  if (dims.length === 3 && dims[2] === 6) {
    // end2end
    const N = dims[1];
    for (let i = 0; i < N; i++) {
      const b = i * 6;
      const conf = data[b + 4];
      if (conf < confThr) continue;
      const classId = Math.round(data[b + 5]);
      const raw = unletterbox({ x: data[b], y: data[b+1], w: data[b+2]-data[b], h: data[b+3]-data[b+1] }, lb);
      dets.push({ id: uid(), classId, className: COCO_CLASSES[classId] || `class_${classId}`, confidence: conf, raw,
        bbox: { x: (raw.x * sx) / origW, y: (raw.y * sy) / origH, width: (raw.w * sx) / origW, height: (raw.h * sy) / origH } });
    }
    dets.sort((a, b) => b.confidence - a.confidence);
    return dets.slice(0, maxDet);
  }

  // raw [1, 84, 8400]
  const numPred = dims[2] || (data.length / 84);
  const nc = 80;
  const rawDets = [];
  for (let i = 0; i < numPred; i++) {
    let maxScore = 0, maxCls = 0;
    for (let c = 0; c < nc; c++) {
      const s = data[(4 + c) * numPred + i];
      if (s > maxScore) { maxScore = s; maxCls = c; }
    }
    if (maxScore < confThr) continue;
    const cx = data[i], cy = data[numPred + i], w = data[2*numPred+i], h = data[3*numPred+i];
    const raw = unletterbox({ x: cx - w/2, y: cy - h/2, w, h }, lb);
    rawDets.push({ id: uid(), classId: maxCls, className: COCO_CLASSES[maxCls]||`class_${maxCls}`, confidence: maxScore, raw,
      bbox: { x: (raw.x*sx)/origW, y: (raw.y*sy)/origH, width: (raw.w*sx)/origW, height: (raw.h*sy)/origH } });
  }
  const kept = nms(rawDets, iouThr);
  return kept.slice(0, maxDet).map(d => ({ id: d.id, classId: d.classId, className: d.className, confidence: d.confidence, bbox: d.bbox }));
}

async function warmup(inputSize) {
  if (warmupDone || !session) return;
  const dummy = new Float32Array(inputSize * inputSize * 3);
  const t = new ort.Tensor('float32', dummy, [1, 3, inputSize, inputSize]);
  const feeds = {}; feeds[inputName] = t;
  const res = await session.run(feeds);
  const out = res[outputName];
  const dims = out.dims;
  if (dims.length === 3 && dims[2] === 6) modelFormat = 'end2end';
  else modelFormat = 'raw';
  warmupDone = true;
}

async function loadModel(modelPath, inputSize) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    inputName = Array.from(session.inputNames)[0] || 'images';
    outputName = Array.from(session.outputNames)[0] || 'output0';
    await warmup(inputSize);
    isDemoMode = false;
    self.postMessage({ type: 'ready', demoMode: false });
  } catch (e) {
    isDemoMode = true;
    self.postMessage({ type: 'ready', demoMode: true, error: String(e) });
  }
}

function demoDetect(sourceId, capW, capH) {
  const classes = [0, 1, 2, 3, 5, 7];
  const n = Math.floor(Math.random() * 3) + 1;
  const dets = [];
  for (let i = 0; i < n; i++) {
    const classId = classes[Math.floor(Math.random() * classes.length)];
    const w = 0.1 + Math.random() * 0.25;
    const h = 0.15 + Math.random() * 0.25;
    dets.push({ id: uid(), classId, className: COCO_CLASSES[classId], confidence: 0.55 + Math.random() * 0.4,
      bbox: { x: Math.random() * (1 - w), y: Math.random() * (1 - h), width: w, height: h } });
  }
  return dets;
}

self.onmessage = async function(e) {
  const msg = e.data;

  if (msg.type === 'load') {
    await loadModel(msg.modelPath, msg.inputSize);
    return;
  }

  if (msg.type === 'detect') {
    const t0 = performance.now();
    const { sourceId, pixels, capW, capH, origW, origH, inputSize, confThr, iouThr, maxDet, reqId } = msg;

    let detections;
    try {
      if (isDemoMode || !session) {
        await new Promise(r => setTimeout(r, 20 + Math.random() * 15));
        detections = demoDetect(sourceId, capW, capH);
      } else {
        const { tensor, lb } = preprocess(pixels, capW, capH, inputSize);
        const t = new ort.Tensor('float32', tensor, [1, 3, inputSize, inputSize]);
        const feeds = {}; feeds[inputName] = t;
        const res = await session.run(feeds);
        const out = res[outputName];
        detections = postprocess(out.data, out.dims, lb, capW, capH, origW, origH, confThr, iouThr, maxDet);
      }
      const inferenceTime = performance.now() - t0;
      self.postMessage({ type: 'result', sourceId, reqId, detections, inferenceTime, capW, capH, origW, origH });
    } catch (err) {
      self.postMessage({ type: 'error', sourceId, reqId, error: String(err) });
    }
  }
};
