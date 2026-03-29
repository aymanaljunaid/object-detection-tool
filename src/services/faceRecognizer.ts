/**
 * Face Recognition Service
 * ========================
 * Browser-based face detection and recognition using face-api.js.
 * All processing happens locally in the browser.
 */

import * as faceapi from 'face-api.js';
import type {
  FaceRecognitionConfig,
  FaceRecognitionResult,
  FaceRecognitionStatus,
  FaceDetection,
  FaceMatch,
} from '@/types/face';
import {
  DEFAULT_FACE_RECOGNITION_CONFIG,
  assertValidFaceEmbedding,
} from '@/types/face';
import { getAllEmbeddings } from '@/lib/faceStorage';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';

interface FaceRecognizerState {
  status: FaceRecognitionStatus;
  config: FaceRecognitionConfig;
  error: string | null;
  modelsLoaded: boolean;
  resultCache: Map<string, { results: FaceRecognitionResult[]; timestamp: number }>;
  knownEmbeddings: Array<{
    identityId: string;
    identityName: string;
    embedding: Float32Array;
  }>;
  lastEmbeddingRefresh: number;
}

let recognizerInstance: FaceRecognizer | null = null;

export class FaceRecognizer {
  private state: FaceRecognizerState;

  constructor(config: Partial<FaceRecognitionConfig> = {}) {
    this.state = {
      status: 'idle',
      config: { ...DEFAULT_FACE_RECOGNITION_CONFIG, ...config },
      error: null,
      modelsLoaded: false,
      resultCache: new Map(),
      knownEmbeddings: [],
      lastEmbeddingRefresh: 0,
    };

    logger.info(
      LOG_CATEGORIES.DETECTION,
      `[FaceRecognizer] Created with config.enabled=${this.state.config.enabled}`
    );
  }

  async loadModels(): Promise<void> {
    if (this.state.modelsLoaded) return;

    this.state.status = 'loading-models';
    logger.info(LOG_CATEGORIES.DETECTION, '[FaceRecognizer] Loading face-api.js models...');

    try {
      const modelPath = '/models/face-api';

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
      ]);

      this.state.modelsLoaded = true;
      this.state.status = 'ready';
      this.state.error = null;

      logger.info(LOG_CATEGORIES.DETECTION, '[FaceRecognizer] Models loaded successfully');
    } catch (error) {
      this.state.status = 'error';
      this.state.error = error instanceof Error ? error.message : 'Failed to load models';
      logger.error(LOG_CATEGORIES.DETECTION, '[FaceRecognizer] Failed to load models', error);
      throw error;
    }
  }

  isReady(): boolean {
    return this.state.modelsLoaded && this.state.status === 'ready';
  }

  getStatus(): FaceRecognitionStatus {
    return this.state.status;
  }

  getError(): string | null {
    return this.state.error;
  }

  async refreshKnownEmbeddings(force = false): Promise<void> {
    const now = Date.now();

    if (!force && now - this.state.lastEmbeddingRefresh < 5000) {
      return;
    }

    try {
      this.state.knownEmbeddings = await getAllEmbeddings();
      this.state.lastEmbeddingRefresh = now;

      logger.debug(
        LOG_CATEGORIES.DETECTION,
        `[FaceRecognizer] Loaded ${this.state.knownEmbeddings.length} known embeddings`
      );
    } catch (error) {
      logger.error(LOG_CATEGORIES.DETECTION, '[FaceRecognizer] Failed to load embeddings', error);
    }
  }

  async forceRefreshKnownEmbeddings(): Promise<void> {
    this.state.lastEmbeddingRefresh = 0;
    await this.refreshKnownEmbeddings(true);
  }

  async detectFaces(
    input: HTMLVideoElement | HTMLCanvasElement
  ): Promise<FaceDetection[]> {
    if (!this.state.modelsLoaded) {
      await this.loadModels();
    }

    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: this.state.config.detectionThreshold,
    });

    const detections = await faceapi.detectAllFaces(input as faceapi.TNetInput, options);

    return detections.map((det) => ({
      box: {
        x: det.box.x,
        y: det.box.y,
        width: det.box.width,
        height: det.box.height,
      },
      score: det.score,
    }));
  }

  async detectAndExtractEmbedding(
    input: HTMLVideoElement | HTMLCanvasElement
  ): Promise<{ detection: FaceDetection; embedding: Float32Array } | null> {
    if (!this.state.modelsLoaded) {
      await this.loadModels();
    }

    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: this.state.config.detectionThreshold,
    });

    const detection = await faceapi
      .detectSingleFace(input as faceapi.TNetInput, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      return null;
    }

    const embedding = new Float32Array(detection.descriptor);
    assertValidFaceEmbedding(embedding);

    return {
      detection: {
        box: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height,
        },
        score: detection.detection.score,
      },
      embedding,
    };
  }

  matchEmbedding(embedding: Float32Array): FaceMatch | null {
    assertValidFaceEmbedding(embedding);

    if (this.state.knownEmbeddings.length === 0) {
      return null;
    }

    let bestMatch: FaceMatch | null = null;
    let bestDistance = Infinity;

    for (const known of this.state.knownEmbeddings) {
      const distance = this.euclideanDistance(embedding, known.embedding);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = {
          identityId: known.identityId,
          identityName: known.identityName,
          distance,
          confidence: this.distanceToConfidence(distance),
        };
      }
    }

    if (bestMatch && bestMatch.distance <= this.state.config.recognitionThreshold) {
      return bestMatch;
    }

    return null;
  }

  async recognizeFaces(
    input: HTMLVideoElement | HTMLCanvasElement,
    sourceId: string
  ): Promise<FaceRecognitionResult[]> {
    logger.info(
      LOG_CATEGORIES.DETECTION,
      `[FaceRecognizer] recognizeFaces called: enabled=${this.state.config.enabled}, modelsLoaded=${this.state.modelsLoaded}`
    );

    if (!this.state.config.enabled) {
      logger.warn(
        LOG_CATEGORIES.DETECTION,
        `[FaceRecognizer] recognizeFaces returning [] - enabled=${this.state.config.enabled}`
      );
      return [];
    }

    if (!this.state.modelsLoaded) {
      await this.loadModels();
    }

    const cacheKey = sourceId;
    const cached = this.state.resultCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.state.config.cacheTTL) {
      logger.debug(
        LOG_CATEGORIES.DETECTION,
        `[FaceRecognizer] Returning cached results: ${cached.results.length} faces`
      );
      return cached.results;
    }

    await this.refreshKnownEmbeddings();

    logger.info(
      LOG_CATEGORIES.DETECTION,
      `[FaceRecognizer] Known embeddings: ${this.state.knownEmbeddings.length} loaded`
    );

    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: this.state.config.detectionThreshold,
    });

    const detections = await faceapi
      .detectAllFaces(input as faceapi.TNetInput, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    logger.info(
      LOG_CATEGORIES.DETECTION,
      `[FaceRecognizer] Detected ${detections.length} faces in frame`
    );

    const results: FaceRecognitionResult[] = [];

    for (const det of detections) {
      const embedding = new Float32Array(det.descriptor);
      assertValidFaceEmbedding(embedding);

      const match = this.matchEmbedding(embedding);

      results.push({
        detected: true,
        identityId: match?.identityId ?? null,
        identityName: match?.identityName ?? null,
        confidence: match?.confidence ?? 0,
        box: {
          x: det.detection.box.x,
          y: det.detection.box.y,
          width: det.detection.box.width,
          height: det.detection.box.height,
        },
      });

      if (match) {
        logger.info(
          LOG_CATEGORIES.DETECTION,
          `[FaceRecognizer] Face matched: "${match.identityName}" (distance=${match.distance.toFixed(
            3
          )}, confidence=${match.confidence.toFixed(2)})`
        );
      }
    }

    this.state.resultCache.set(cacheKey, {
      results,
      timestamp: Date.now(),
    });

    logger.info(
      LOG_CATEGORIES.DETECTION,
      `[FaceRecognizer] Results: ${results.length} detected, ${
        results.filter((result) => result.identityName).length
      } recognized`
    );

    return results;
  }

  async recognizeRegion(
    source: HTMLVideoElement | HTMLCanvasElement,
    region: { x: number; y: number; width: number; height: number },
    _sourceId: string
  ): Promise<FaceRecognitionResult | null> {
    if (!this.state.config.enabled) {
      return null;
    }

    if (
      region.width < this.state.config.minFaceSize ||
      region.height < this.state.config.minFaceSize
    ) {
      return null;
    }

    await this.refreshKnownEmbeddings();

    const canvas = document.createElement('canvas');
    canvas.width = region.width;
    canvas.height = region.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(
      source,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height
    );

    const result = await this.detectAndExtractEmbedding(canvas);
    if (!result) {
      return null;
    }

    const match = this.matchEmbedding(result.embedding);

    return {
      detected: true,
      identityId: match?.identityId ?? null,
      identityName: match?.identityName ?? null,
      confidence: match?.confidence ?? 0,
      box: {
        x: region.x + result.detection.box.x,
        y: region.y + result.detection.box.y,
        width: result.detection.box.width,
        height: result.detection.box.height,
      },
    };
  }

  updateConfig(config: Partial<FaceRecognitionConfig>): void {
    this.state.config = { ...this.state.config, ...config };
    this.clearCache();
  }

  getConfig(): FaceRecognitionConfig {
    return { ...this.state.config };
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.state.config.enabled;
    this.state.config.enabled = enabled;

    if (!enabled) {
      this.clearCache();
    }

    logger.info(
      LOG_CATEGORIES.DETECTION,
      `[FaceRecognizer] setEnabled: ${wasEnabled} -> ${enabled}`
    );
  }

  clearCache(): void {
    this.state.resultCache.clear();
  }

  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Embedding length mismatch: ${a.length} vs ${b.length}`);
    }

    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  private distanceToConfidence(distance: number): number {
    const threshold = this.state.config.recognitionThreshold;

    if (distance >= threshold * 1.5) return 0;
    if (distance <= 0) return 1;

    return Math.max(0, Math.min(1, 1 - distance / (threshold * 1.5)));
  }

  dispose(): void {
    this.state.resultCache.clear();
    this.state.knownEmbeddings = [];
    this.state.status = 'idle';
    this.state.error = null;
    this.state.modelsLoaded = false;
    this.state.lastEmbeddingRefresh = 0;
  }
}

export function getFaceRecognizer(config?: Partial<FaceRecognitionConfig>): FaceRecognizer {
  if (!recognizerInstance) {
    recognizerInstance = new FaceRecognizer(config);
  } else if (config) {
    recognizerInstance.updateConfig(config);
  }

  return recognizerInstance;
}

export async function initializeFaceRecognizer(
  config?: Partial<FaceRecognitionConfig>
): Promise<FaceRecognizer> {
  const recognizer = getFaceRecognizer(config);
  if (!recognizer.isReady()) {
    await recognizer.loadModels();
  }
  return recognizer;
}

export async function disposeFaceRecognizer(): Promise<void> {
  if (recognizerInstance) {
    recognizerInstance.dispose();
    recognizerInstance = null;
  }
}
