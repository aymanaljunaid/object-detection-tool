/**
 * YOLOv8 Detector Service
 * =======================
 * Runs YOLOv8 object detection in the browser using ONNX Runtime Web.
 * 
 * Features:
 * - WASM-based inference
 * - Supports both raw and end-to-end ONNX model formats
 * - Configurable input size and thresholds
 * - Proper coordinate mapping with letterbox handling
 * - Performance monitoring
 * - Demo mode with simulated detections when model is unavailable
 */

import * as ort from 'onnxruntime-web';
import { nanoid } from 'nanoid';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';
import { COCO_CLASSES } from '@/lib/constants';
import { calculateLetterbox, mapRectTargetToSource } from '@/lib/utils/coordinates';
import type { Detection, DetectionResult, YOLOConfig, BoundingBox, Dimensions } from '@/types';

// ============================================================================
// TYPES
// ============================================================================

interface DetectorState {
  session: ort.InferenceSession | null;
  config: YOLOConfig;
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
  warmupDone: boolean;
  isDemoMode: boolean;
  modelFormat: 'raw' | 'end2end' | 'unknown';
  inputName: string;
  outputName: string;
}

type DetectionCallback = (result: DetectionResult) => void;

// ============================================================================
// MODEL STATUS
// ============================================================================

/**
 * Check if the model file exists and is valid
 */
async function checkModelAvailability(modelPath: string): Promise<{ available: boolean; reason: string }> {
  try {
    const response = await fetch(modelPath, { method: 'HEAD' });
    if (!response.ok) {
      return { available: false, reason: 'Model file not found (404)' };
    }
    const contentLength = response.headers.get('content-length');
    if (!contentLength || parseInt(contentLength, 10) === 0) {
      return { available: false, reason: 'Model file is empty (0 bytes)' };
    }
    const size = parseInt(contentLength, 10);
    // ONNX models should be at least 1MB
    if (size < 1000000) {
      return { available: false, reason: `Model file too small (${(size / 1024).toFixed(1)}KB) - likely corrupted or placeholder` };
    }
    return { available: true, reason: 'Model available' };
  } catch (error) {
    return { available: false, reason: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// ============================================================================
// DETECTOR CLASS
// ============================================================================

export class YOLOv8Detector {
  private state: DetectorState;
  private modelName: string = 'yolov8n';

  constructor(config: Partial<YOLOConfig> = {}) {
    this.state = {
      session: null,
      config: {
        modelPath: config.modelPath || '/models/yolov8n.onnx',
        inputSize: config.inputSize || 640,
        confThreshold: config.confThreshold || 0.25,
        iouThreshold: config.iouThreshold || 0.45,
        maxDetections: config.maxDetections || 100,
      },
      isLoading: false,
      isReady: false,
      error: null,
      warmupDone: false,
      isDemoMode: false,
      modelFormat: 'unknown',
      inputName: 'images',
      outputName: 'output0',
    };
  }

  /**
   * Load the ONNX model or fall back to demo mode
   */
  async loadModel(): Promise<void> {
    if (this.state.isReady || this.state.isLoading) {
      return;
    }

    this.state.isLoading = true;
    this.state.error = null;

    logger.debug(LOG_CATEGORIES.DETECTION, 'Loading YOLOv8 model', {
      path: this.state.config.modelPath,
    });

    // Check if model is available
    const modelStatus = await checkModelAvailability(this.state.config.modelPath);
    
    if (!modelStatus.available) {
      logger.warn(LOG_CATEGORIES.DETECTION, `Model not available: ${modelStatus.reason}`);
      logger.info(LOG_CATEGORIES.DETECTION, 'Falling back to demo mode with simulated detections');
      
      this.state.isDemoMode = true;
      this.state.isReady = true;
      this.state.isLoading = false;
      this.state.error = `Running in demo mode: ${modelStatus.reason}`;
      
      logger.info(LOG_CATEGORIES.DETECTION, 'Detector ready in demo mode');
      return;
    }

    try {
      // Configure ONNX Runtime WASM
      // Only use multi-threading if crossOriginIsolated is enabled (required for SharedArrayBuffer)
      const isCrossOriginIsolated = window.crossOriginIsolated === true;
      if (isCrossOriginIsolated) {
        ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
        logger.info(LOG_CATEGORIES.DETECTION, `WASM multi-threading enabled: ${ort.env.wasm.numThreads} threads (crossOriginIsolated)`);
      } else {
        ort.env.wasm.numThreads = 1;
        logger.info(LOG_CATEGORIES.DETECTION, 'WASM single-threaded mode (crossOriginIsolated not enabled)');
      }
      ort.env.wasm.simd = true;

      // Try WebGPU first, then fall back to WASM
      let executionProvider: string = 'wasm';
      let sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      };

      // Check for WebGPU support (using type assertion for navigator.gpu)
      const nav = navigator as Navigator & { gpu?: unknown };
      if (nav.gpu) {
        try {
          const gpu = nav.gpu as {
            requestAdapter: () => Promise<unknown>;
          };
          const adapter = await gpu.requestAdapter();
          if (adapter) {
            logger.info(LOG_CATEGORIES.DETECTION, 'WebGPU adapter found, attempting WebGPU execution');
            sessionOptions = {
              executionProviders: ['webgpu', 'wasm'],
              graphOptimizationLevel: 'all',
            };
            executionProvider = 'webgpu (with wasm fallback)';
          }
        } catch (webgpuError) {
          logger.warn(LOG_CATEGORIES.DETECTION, 'WebGPU check failed, falling back to WASM', webgpuError);
        }
      } else {
        logger.info(LOG_CATEGORIES.DETECTION, 'WebGPU not available, using WASM execution');
      }

      // Create inference session
      logger.info(LOG_CATEGORIES.DETECTION, `Creating ONNX session with providers: [${sessionOptions.executionProviders?.join(', ')}]`);
      this.state.session = await ort.InferenceSession.create(
        this.state.config.modelPath,
        sessionOptions
      );

      // Log which provider was actually used (check session info if available)
      logger.info(LOG_CATEGORIES.DETECTION, `ONNX session created successfully`);
      logger.info(LOG_CATEGORIES.DETECTION, `Configured execution provider: ${executionProvider}`);

      // Get input and output names from session
      const inputNames = Array.from(this.state.session.inputNames);
      const outputNames = Array.from(this.state.session.outputNames);

      this.state.inputName = inputNames[0] || 'images';
      this.state.outputName = outputNames[0] || 'output0';

      logger.info(LOG_CATEGORIES.DETECTION, `Model loaded successfully`);
      logger.info(LOG_CATEGORIES.DETECTION, `  Input names: [${inputNames.join(', ')}]`);
      logger.info(LOG_CATEGORIES.DETECTION, `  Output names: [${outputNames.join(', ')}]`);
      logger.info(LOG_CATEGORIES.DETECTION, `  Using input: "${this.state.inputName}", output: "${this.state.outputName}"`);

      this.state.isReady = true;
      this.state.isDemoMode = false;
      logger.info(LOG_CATEGORIES.DETECTION, 'YOLOv8 model loaded successfully');

      // Warmup inference to detect model format
      await this.warmup();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error loading model';
      this.state.error = message;
      logger.error(LOG_CATEGORIES.DETECTION, 'Failed to load YOLOv8 model', error);
      
      // Fall back to demo mode instead of throwing
      this.state.isDemoMode = true;
      this.state.isReady = true;
      this.state.isLoading = false;
      logger.info(LOG_CATEGORIES.DETECTION, 'Falling back to demo mode due to model load error');
      return;
    } finally {
      this.state.isLoading = false;
    }
  }

  /**
   * Run warmup inference to initialize WASM and detect model format
   */
  private async warmup(): Promise<void> {
    if (this.state.warmupDone || !this.state.session) {
      return;
    }

    logger.debug(LOG_CATEGORIES.DETECTION, 'Running warmup inference');

    const inputSize = this.state.config.inputSize;
    const dummyInput = new Float32Array(inputSize * inputSize * 3);
    dummyInput.fill(0);

    const tensor = new ort.Tensor('float32', dummyInput, [1, 3, inputSize, inputSize]);

    try {
      const feeds: Record<string, ort.Tensor> = {};
      feeds[this.state.inputName] = tensor;
      
      const results = await this.state.session.run(feeds);
      const output = results[this.state.outputName];
      
      // Detect model format based on output shape
      const dims = output.dims;
      logger.info(LOG_CATEGORIES.DETECTION, `Model output shape: [${dims.join(', ')}]`);
      
      // End-to-end model: [1, N, 6] where N is max detections (e.g., 300)
      // Raw model: [1, 84, 8400] for 640x640 input
      if (dims.length === 3 && dims[2] === 6) {
        this.state.modelFormat = 'end2end';
        logger.info(LOG_CATEGORIES.DETECTION, 'Detected end-to-end model format (NMS built-in)');
      } else if (dims.length === 3 && dims[1] >= 80) {
        this.state.modelFormat = 'raw';
        logger.info(LOG_CATEGORIES.DETECTION, 'Detected raw YOLO output format (NMS needed)');
      } else {
        logger.warn(LOG_CATEGORIES.DETECTION, `Unknown output format, will try to adapt. Shape: [${dims.join(', ')}]`);
        this.state.modelFormat = 'unknown';
      }
      
      this.state.warmupDone = true;
      logger.debug(LOG_CATEGORIES.DETECTION, 'Warmup complete');
    } catch (error) {
      logger.warn(LOG_CATEGORIES.DETECTION, 'Warmup failed', error);
    }
  }

  /**
   * Check if detector is ready (including demo mode)
   */
  isReady(): boolean {
    return this.state.isReady;
  }

  /**
   * Check if running in demo mode
   */
  isDemoMode(): boolean {
    return this.state.isDemoMode;
  }

  /**
   * Check if model is loading
   */
  isLoading(): boolean {
    return this.state.isLoading;
  }

  /**
   * Get current error
   */
  getError(): string | null {
    return this.state.error;
  }

  /**
   * Generate simulated detections for demo mode
   */
  private generateSimulatedDetections(frameSize: Dimensions): Detection[] {
    const detections: Detection[] = [];
    const numDetections = Math.floor(Math.random() * 4) + 1;
    
    const demoClasses = [0, 1, 2, 3, 5, 7, 15, 16, 17, 24, 26, 39, 41, 56, 60, 62, 67, 73];
    
    for (let i = 0; i < numDetections; i++) {
      const classId = demoClasses[Math.floor(Math.random() * demoClasses.length)];
      
      const width = 0.1 + Math.random() * 0.3;
      const height = 0.1 + Math.random() * 0.3;
      const x = 0.1 + Math.random() * 0.8;
      const y = 0.1 + Math.random() * 0.8;
      const confidence = 0.5 + Math.random() * 0.45;
      
      detections.push({
        id: nanoid(8),
        classId,
        className: COCO_CLASSES[classId] || `class_${classId}`,
        confidence,
        bbox: { x, y, width, height },
      });
    }
    
    return detections;
  }

  /**
   * Preprocess image for YOLOv8
   */
  private preprocess(
    imageData: ImageData,
    targetSize: number
  ): { tensor: ort.Tensor; letterboxInfo: ReturnType<typeof calculateLetterbox> } {
    const { width, height, data } = imageData;
    
    const letterboxInfo = calculateLetterbox(
      { width, height },
      { width: targetSize, height: targetSize }
    );

    const inputTensor = new Float32Array(3 * targetSize * targetSize);
    inputTensor.fill(114 / 255);

    const scaleX = letterboxInfo.scaleX;
    const scaleY = letterboxInfo.scaleY;
    const padX = letterboxInfo.paddingX;
    const padY = letterboxInfo.paddingY;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstX = Math.floor(x * scaleX + padX);
        const dstY = Math.floor(y * scaleY + padY);
        
        if (dstX >= 0 && dstX < targetSize && dstY >= 0 && dstY < targetSize) {
          const dstIdx = dstY * targetSize + dstX;
          
          inputTensor[dstIdx] = data[srcIdx] / 255;
          inputTensor[targetSize * targetSize + dstIdx] = data[srcIdx + 1] / 255;
          inputTensor[2 * targetSize * targetSize + dstIdx] = data[srcIdx + 2] / 255;
        }
      }
    }

    const tensor = new ort.Tensor('float32', inputTensor, [1, 3, targetSize, targetSize]);

    return { tensor, letterboxInfo };
  }

  /**
   * Post-process end-to-end model output (NMS built-in)
   * Format: [1, N, 6] where each detection is [x1, y1, x2, y2, confidence, class_id]
   * 
   * @param output - Model output tensor
   * @param captureSize - Size of the captured frame (downscaled)
   * @param originalSize - Size of the original video
   * @param letterboxInfo - Letterbox info from preprocessing
   */
  private postprocessEnd2End(
    output: ort.Tensor,
    captureSize: Dimensions,
    originalSize: Dimensions,
    letterboxInfo: ReturnType<typeof calculateLetterbox>
  ): Detection[] {
    const data = output.data as Float32Array;
    const dims = output.dims;
    const config = this.state.config;
    
    // Shape: [1, N, 6] or [N, 6]
    const numDetections = dims.length === 3 ? dims[1] : dims[0];
    const stride = dims.length === 3 ? dims[2] : dims[1];
    
    const detections: Detection[] = [];

    // Calculate scale factor from capture frame to original video
    const scaleX = originalSize.width / captureSize.width;
    const scaleY = originalSize.height / captureSize.height;

    for (let i = 0; i < numDetections; i++) {
      const baseIdx = i * stride;
      
      // [x1, y1, x2, y2, confidence, class_id]
      const x1 = data[baseIdx + 0];
      const y1 = data[baseIdx + 1];
      const x2 = data[baseIdx + 2];
      const y2 = data[baseIdx + 3];
      const confidence = data[baseIdx + 4];
      const classId = Math.round(data[baseIdx + 5]);

      // Skip low confidence detections
      if (confidence < config.confThreshold) {
        continue;
      }

      // Convert from pixel coordinates in model space
      // The model outputs coordinates in the 640x640 space (letterboxed)
      const modelBox = {
        x: (x1 + x2) / 2,  // center x
        y: (y1 + y2) / 2,  // center y
        width: x2 - x1,
        height: y2 - y1,
      };

      // Step 1: Reverse letterbox mapping (640x640 -> capture frame)
      const captureBox = mapRectTargetToSource(modelBox, letterboxInfo);
      
      // Step 2: Scale from capture frame to original video
      const originalBox = {
        x: captureBox.x * scaleX,
        y: captureBox.y * scaleY,
        width: captureBox.width * scaleX,
        height: captureBox.height * scaleY,
      };
      
      // Step 3: Convert to normalized coordinates [0, 1]
      const normalizedBox: BoundingBox = {
        x: originalBox.x / originalSize.width,
        y: originalBox.y / originalSize.height,
        width: originalBox.width / originalSize.width,
        height: originalBox.height / originalSize.height,
      };

      detections.push({
        id: nanoid(8),
        classId,
        className: COCO_CLASSES[classId] || `class_${classId}`,
        confidence,
        bbox: normalizedBox,
      });
    }

    // Sort by confidence and limit
    detections.sort((a, b) => b.confidence - a.confidence);
    return detections.slice(0, config.maxDetections);
  }

  /**
   * Post-process raw YOLOv8 output (no NMS)
   * Format: [1, 84, 8400] for 640x640
   * 
   * @param output - Model output tensor
   * @param captureSize - Size of the captured frame (downscaled)
   * @param originalSize - Size of the original video
   * @param letterboxInfo - Letterbox info from preprocessing
   */
  private postprocessRaw(
    output: ort.Tensor,
    captureSize: Dimensions,
    originalSize: Dimensions,
    letterboxInfo: ReturnType<typeof calculateLetterbox>
  ): Detection[] {
    const data = output.data as Float32Array;
    const config = this.state.config;
    
    const numClasses = 80;
    const dims = output.dims;
    
    // Calculate number of predictions based on actual output size
    const numPredictions = dims.length === 3 ? dims[2] : (data.length / (4 + numClasses));
    
    const detections: Detection[] = [];

    // Calculate scale factor from capture frame to original video
    const scaleX = originalSize.width / captureSize.width;
    const scaleY = originalSize.height / captureSize.height;

    for (let i = 0; i < numPredictions; i++) {
      let maxClassScore = 0;
      let maxClassId = 0;
      
      for (let c = 0; c < numClasses; c++) {
        const score = dims.length === 3 
          ? data[(4 + c) * numPredictions + i]
          : data[(4 + c) * numPredictions + i];
        if (score > maxClassScore) {
          maxClassScore = score;
          maxClassId = c;
        }
      }

      if (maxClassScore >= config.confThreshold) {
        const cx = data[0 * numPredictions + i];
        const cy = data[1 * numPredictions + i];
        const w = data[2 * numPredictions + i];
        const h = data[3 * numPredictions + i];

        const modelBox = { x: cx, y: cy, width: w, height: h };
        
        // Step 1: Reverse letterbox mapping (640x640 -> capture frame)
        const captureBox = mapRectTargetToSource(modelBox, letterboxInfo);
        
        // Step 2: Scale from capture frame to original video
        const originalBox = {
          x: captureBox.x * scaleX,
          y: captureBox.y * scaleY,
          width: captureBox.width * scaleX,
          height: captureBox.height * scaleY,
        };
        
        // Step 3: Convert to normalized coordinates [0, 1]
        const normalizedBox: BoundingBox = {
          x: originalBox.x / originalSize.width,
          y: originalBox.y / originalSize.height,
          width: originalBox.width / originalSize.width,
          height: originalBox.height / originalSize.height,
        };

        detections.push({
          id: nanoid(8),
          classId: maxClassId,
          className: COCO_CLASSES[maxClassId] || `class_${maxClassId}`,
          confidence: maxClassScore,
          bbox: normalizedBox,
        });
      }
    }

    // Apply NMS
    const nmsDetections = this.nms(detections, config.iouThreshold);
    return nmsDetections.slice(0, config.maxDetections);
  }

  /**
   * Post-process YOLOv8 output - auto-detects format
   * 
   * @param output - Model output tensor
   * @param captureSize - Size of the captured frame (downscaled)
   * @param originalSize - Size of the original video
   * @param letterboxInfo - Letterbox info from preprocessing
   */
  private postprocess(
    output: ort.Tensor,
    captureSize: Dimensions,
    originalSize: Dimensions,
    letterboxInfo: ReturnType<typeof calculateLetterbox>
  ): Detection[] {
    const dims = output.dims;
    
    logger.debug(LOG_CATEGORIES.DETECTION, `Post-processing output shape: [${dims.join(', ')}], format: ${this.state.modelFormat}`);
    
    // Auto-detect format based on output shape
    if (this.state.modelFormat === 'end2end' || (dims.length === 3 && dims[2] === 6)) {
      return this.postprocessEnd2End(output, captureSize, originalSize, letterboxInfo);
    } else {
      return this.postprocessRaw(output, captureSize, originalSize, letterboxInfo);
    }
  }

  /**
   * Non-Maximum Suppression
   */
  private nms(detections: Detection[], iouThreshold: number): Detection[] {
    if (detections.length === 0) return [];

    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
    const keep: Detection[] = [];

    while (sorted.length > 0) {
      const current = sorted.shift()!;
      keep.push(current);

      for (let i = sorted.length - 1; i >= 0; i--) {
        if (this.iou(current.bbox, sorted[i].bbox) > iouThreshold) {
          sorted.splice(i, 1);
        }
      }
    }

    return keep;
  }

  /**
   * Calculate Intersection over Union
   */
  private iou(a: BoundingBox, b: BoundingBox): number {
    const x1 = Math.max(a.x - a.width / 2, b.x - b.width / 2);
    const y1 = Math.max(a.y - a.height / 2, b.y - b.height / 2);
    const x2 = Math.min(a.x + a.width / 2, b.x + b.width / 2);
    const y2 = Math.min(a.y + a.height / 2, b.y + b.height / 2);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.width * a.height + b.width * b.height - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Run detection on an image (real or simulated in demo mode)
   * 
   * @param sourceId - Source identifier
   * @param imageData - Image data from captured frame
   * @param frameSize - Size of the captured frame (may be downscaled from original video)
   * @param originalVideoSize - Optional original video dimensions for proper coordinate mapping
   */
  async detect(
    sourceId: string,
    imageData: ImageData,
    frameSize: Dimensions,
    originalVideoSize?: Dimensions
  ): Promise<DetectionResult> {
    const startTime = performance.now();

    // Demo mode
    if (this.state.isDemoMode) {
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 30));
      
      const detections = this.generateSimulatedDetections(frameSize);
      const inferenceTime = performance.now() - startTime;

      logger.debug(LOG_CATEGORIES.DETECTION, `[DEMO] Detection complete for ${sourceId}`, {
        detections: detections.length,
        inferenceTime: inferenceTime.toFixed(2),
      });

      return {
        sourceId,
        timestamp: Date.now(),
        detections,
        inferenceTime,
        frameSize,
        modelInputSize: {
          width: this.state.config.inputSize,
          height: this.state.config.inputSize,
        },
      };
    }

    // Real inference
    if (!this.state.session) {
      throw new Error('Model not loaded');
    }

    // Preprocess
    const { tensor, letterboxInfo } = this.preprocess(imageData, this.state.config.inputSize);

    // Run inference with correct input name
    const feeds: Record<string, ort.Tensor> = {};
    feeds[this.state.inputName] = tensor;
    const results = await this.state.session.run(feeds);

    // Get output
    const output = results[this.state.outputName];

    // Postprocess with proper coordinate mapping
    // frameSize is the captured (possibly downscaled) frame dimensions
    // originalVideoSize is the original video dimensions (if different from frameSize)
    const captureSize = frameSize;
    const originalSize = originalVideoSize || frameSize;
    const detections = this.postprocess(output, captureSize, originalSize, letterboxInfo);

    const inferenceTime = performance.now() - startTime;

    logger.debug(LOG_CATEGORIES.DETECTION, `Detection complete for ${sourceId}`, {
      detections: detections.length,
      inferenceTime: inferenceTime.toFixed(2),
    });

    return {
      sourceId,
      timestamp: Date.now(),
      detections,
      inferenceTime,
      frameSize,
      modelInputSize: {
        width: this.state.config.inputSize,
        height: this.state.config.inputSize,
      },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<YOLOConfig>): void {
    this.state.config = { ...this.state.config, ...config };
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.state.session) {
      await this.state.session.release();
      this.state.session = null;
    }
    this.state.isReady = false;
    this.state.warmupDone = false;
    this.state.isDemoMode = false;
    this.state.error = null;
    logger.debug(LOG_CATEGORIES.DETECTION, 'Detector disposed');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let detectorInstance: YOLOv8Detector | null = null;

export function getDetector(config?: Partial<YOLOConfig>): YOLOv8Detector {
  if (!detectorInstance) {
    detectorInstance = new YOLOv8Detector(config);
  }
  return detectorInstance;
}

export async function initializeDetector(config?: Partial<YOLOConfig>): Promise<YOLOv8Detector> {
  const detector = getDetector(config);
  if (!detector.isReady()) {
    await detector.loadModel();
  }
  return detector;
}

export async function disposeDetector(): Promise<void> {
  if (detectorInstance) {
    await detectorInstance.dispose();
    detectorInstance = null;
  }
}
