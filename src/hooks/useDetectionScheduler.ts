'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { initializeDetector, getDetector } from '@/services/detector';
import { getFaceRecognizer } from '@/services/faceRecognizer';
import { useMultiFrameCapture } from './useFrameCapture';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';
import { DEFAULT_DETECTION_CONFIG } from '@/lib/constants';
import type { SourceWithState, Detection } from '@/types';

interface SchedulerState {
  isRunning: boolean;
  currentSourceIndex: number;
  lastDetectionTime: Map<string, number>;
  frameCount: number;
  totalInferenceTime: number;
  processingSources: Set<string>;
  lastLoggedSources: string;
  lastDebugUpdate: number;
  lastFaceRecognitionTime: Map<string, number>;
  faceInitStarted: boolean;
}

interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FaceMatchCandidate {
  identityId: string | null;
  identityName: string | null;
  confidence: number;
  score: number;
  overlap: number;
  faceInsidePerson: boolean;
  faceCenterInsidePerson: boolean;
}

export function useDetectionScheduler() {
  // Use individual stable refs for store values to avoid recreating callbacks
  const detectionEnabledRef = useRef(useAppStore.getState().detectionEnabled);
  const detectionConfigRef = useRef(useAppStore.getState().detectionConfig);
  const yoloConfigRef = useRef(useAppStore.getState().yoloConfig);
  const viewModeRef = useRef(useAppStore.getState().viewMode);
  const primarySourceIdRef = useRef(useAppStore.getState().primarySourceId);
  const sourceOrderRef = useRef(useAppStore.getState().sourceOrder);
  const faceRecognitionEnabledRef = useRef(useAppStore.getState().faceRecognitionEnabled);

  // Subscribe to store changes and update refs without causing re-renders
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      detectionEnabledRef.current = state.detectionEnabled;
      detectionConfigRef.current = state.detectionConfig;
      yoloConfigRef.current = state.yoloConfig;
      viewModeRef.current = state.viewMode;
      primarySourceIdRef.current = state.primarySourceId;
      sourceOrderRef.current = state.sourceOrder;
      faceRecognitionEnabledRef.current = state.faceRecognitionEnabled;
    });
    return unsub;
  }, []);

  const schedulerRef = useRef<SchedulerState>({
    isRunning: false,
    currentSourceIndex: 0,
    lastDetectionTime: new Map(),
    frameCount: 0,
    totalInferenceTime: 0,
    processingSources: new Set(),
    lastLoggedSources: '',
    lastDebugUpdate: 0,
    lastFaceRecognitionTime: new Map(),
    faceInitStarted: false,
  });

  const rafRef = useRef<number | null>(null);
  const lastRunRef = useRef<number>(0);
  const isPausedRef = useRef<boolean>(false);

  const { captureFrame, getImageData, removeCapture } = useMultiFrameCapture({
    maxDimension: DEFAULT_DETECTION_CONFIG.maxFrameDimension,
  });

  const videoRefsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  const registerVideoRef = useCallback((sourceId: string, video: HTMLVideoElement | null) => {
    if (video) {
      videoRefsRef.current.set(sourceId, video);
    } else {
      videoRefsRef.current.delete(sourceId);
      removeCapture(sourceId);
      schedulerRef.current.lastDetectionTime.delete(sourceId);
      schedulerRef.current.lastFaceRecognitionTime.delete(sourceId);
      schedulerRef.current.processingSources.delete(sourceId);
    }
  }, [removeCapture]);

  const getSourceEligibility = useCallback((source: SourceWithState | undefined): { eligible: boolean; reason: string } => {
    if (!source) return { eligible: false, reason: 'source not found' };
    if (!source.detectionEnabled) return { eligible: false, reason: 'detection disabled for this source' };
    if (source.status !== 'playing' && source.status !== 'ready') return { eligible: false, reason: `status is '${source.status}'` };
    if (source.error) return { eligible: false, reason: `source has error: ${source.error}` };
    return { eligible: true, reason: 'eligible' };
  }, []);

  const getSourcesToDetect = useCallback((): string[] => {
    const sources = useAppStore.getState().sources;
    const sourceOrder = sourceOrderRef.current;
    const viewMode = viewModeRef.current;
    const primarySourceId = primarySourceIdRef.current;
    const enableRotation = detectionConfigRef.current.enableRotation;
    const results: { id: string; eligible: boolean; reason: string }[] = [];

    sourceOrder.forEach((id) => {
      const source = sources.get(id);
      const { eligible, reason } = getSourceEligibility(source);
      results.push({ id, eligible, reason });
    });

    const eligibleSources = results.filter((r) => r.eligible);

    const state = schedulerRef.current;
    const statusStr = results.map((r) => `${r.id}:${r.eligible ? 'yes' : r.reason}`).join(',');
    if (statusStr !== state.lastLoggedSources) {
      state.lastLoggedSources = statusStr;
    }

    if (viewMode === 'single' && primarySourceId) {
      const isPrimaryEligible = eligibleSources.some((r) => r.id === primarySourceId);
      return isPrimaryEligible ? [primarySourceId] : [];
    }

    const eligibleIds = eligibleSources.map((r) => r.id);
    if (enableRotation && eligibleIds.length > 1) {
      const index = state.currentSourceIndex % eligibleIds.length;
      return [eligibleIds[index]];
    }

    return eligibleIds;
  }, [getSourceEligibility]);

  const runDetection = useCallback(async (sourceId: string): Promise<void> => {
    const state = schedulerRef.current;

    if (state.processingSources.has(sourceId)) return;

    const video = videoRefsRef.current.get(sourceId);
    if (!video || video.readyState < 2) return;

    const detector = getDetector();
    if (!detector.isReady()) return;

    state.processingSources.add(sourceId);

    try {
      const frame = captureFrame(sourceId, video);
      if (!frame) return;

      const imageData = getImageData(sourceId);
      if (!imageData) return;

      const result = await detector.detect(
        sourceId,
        imageData,
        { width: frame.width, height: frame.height },
        { width: frame.originalWidth, height: frame.originalHeight }
      );

      if (faceRecognitionEnabledRef.current) {
        const faceRecognizer = getFaceRecognizer();
        faceRecognizer.setEnabled(true);

        if (faceRecognizer.isReady()) {
          const now = performance.now();
          const lastFaceTime = state.lastFaceRecognitionTime.get(sourceId) || 0;

          if (now - lastFaceTime >= 500) {
            state.lastFaceRecognitionTime.set(sourceId, now);
            const personDetections = result.detections.filter((d) => d.className === 'person');

            if (personDetections.length > 0 && video.readyState >= 2) {
              try {
                const faceResults = await faceRecognizer.recognizeFaces(video, sourceId);

                result.detections = result.detections.map((det) => {
                  if (det.className !== 'person') return det;

                  const personBox = yoloBoxToPixelBox(det, frame.originalWidth, frame.originalHeight);
                  let bestMatch: FaceMatchCandidate | null = null;

                  for (const face of faceResults) {
                    if (!face.detected) continue;

                    const overlap = calculateOverlap(personBox, face.box);
                    const faceInsidePerson = isBoxMostlyInside(face.box, personBox, 0.6);
                    const faceCenterInsidePerson = isPointInsideBox(
                      { x: face.box.x + face.box.width / 2, y: face.box.y + face.box.height / 2 },
                      personBox
                    );

                    const recognitionBonus = face.identityName ? 1 : 0;
                    const score =
                      (faceCenterInsidePerson ? 1.0 : 0.0) +
                      (faceInsidePerson ? 0.7 : 0.0) +
                      overlap * 2.0 +
                      recognitionBonus * 1.5 +
                      face.confidence * 1.5;

                    const candidate: FaceMatchCandidate = {
                      identityId: face.identityId,
                      identityName: face.identityName,
                      confidence: face.confidence,
                      overlap,
                      faceInsidePerson,
                      faceCenterInsidePerson,
                      score,
                    };

                    if (!bestMatch || candidate.score > bestMatch.score) {
                      bestMatch = candidate;
                    }
                  }

                  if (bestMatch && bestMatch.identityName && bestMatch.faceCenterInsidePerson && bestMatch.confidence >= 0.35) {
                    return {
                      ...det,
                      faceRecognition: {
                        identityId: bestMatch.identityId,
                        identityName: bestMatch.identityName,
                        confidence: bestMatch.confidence,
                      },
                    };
                  }

                  return { ...det, faceRecognition: undefined };
                });
              } catch (error) {
                logger.warn(LOG_CATEGORIES.DETECTION, `[FaceRecognition] Failed for ${sourceId}`, error);
              }
            }
          }
        }
      }

      const currentSource = useAppStore.getState().sources.get(sourceId);
      if (currentSource?.detectionEnabled && (currentSource.status === 'playing' || currentSource.status === 'ready')) {
        useAppStore.getState().updateDetections(sourceId, result);
      }

      state.frameCount += 1;
      state.totalInferenceTime += result.inferenceTime;
    } catch (error) {
      logger.error(LOG_CATEGORIES.DETECTION, `[Scheduler] Detection failed for ${sourceId}`, error);
    } finally {
      state.processingSources.delete(sourceId);
    }
  }, [captureFrame, getImageData]);

  // Single stable RAF loop — never recreated
  const loopFnRef = useRef<((timestamp: number) => void) | null>(null);

  useEffect(() => {
    loopFnRef.current = (timestamp: number) => {
      const state = schedulerRef.current;
      if (!state.isRunning || isPausedRef.current) return;

      const viewMode = viewModeRef.current;
      const targetFPS = viewMode === 'single'
        ? DEFAULT_DETECTION_CONFIG.singleModeTargetFPS
        : DEFAULT_DETECTION_CONFIG.gridModeTargetFPS;
      const targetInterval = 1000 / targetFPS;

      const elapsed = timestamp - lastRunRef.current;
      if (elapsed < targetInterval) {
        rafRef.current = requestAnimationFrame((ts) => loopFnRef.current?.(ts));
        return;
      }

      const sourcesToDetect = getSourcesToDetect();
      const now = performance.now();

      const sourcesReady = sourcesToDetect.filter((sourceId) => {
        const lastTime = state.lastDetectionTime.get(sourceId) || 0;
        return now - lastTime >= DEFAULT_DETECTION_CONFIG.minDetectionInterval;
      });

      if (sourcesReady.length > 0) {
        const sourceToProcess = sourcesReady[0];
        state.lastDetectionTime.set(sourceToProcess, now);
        void runDetection(sourceToProcess);
        lastRunRef.current = timestamp;

        if (detectionConfigRef.current.enableRotation && viewMode === 'grid') {
          state.currentSourceIndex += 1;
        }
      }

      if (now - state.lastDebugUpdate >= 2000) {
        state.lastDebugUpdate = now;
        const avgInferenceTime = state.frameCount > 0 ? state.totalInferenceTime / state.frameCount : 0;
        useAppStore.getState().updateDebugInfo({
          activeSources: sourcesToDetect.length,
          activeDetections: state.processingSources.size,
          totalInferenceTime: state.totalInferenceTime,
          averageFPS: avgInferenceTime > 0 ? 1000 / avgInferenceTime : 0,
          lastFrameCapture: now,
        });
      }

      rafRef.current = requestAnimationFrame((ts) => loopFnRef.current?.(ts));
    };
  }, [getSourcesToDetect, runDetection]);

  useEffect(() => {
    if (!faceRecognitionEnabledRef.current) {
      return;
    }
    const state = schedulerRef.current;
    if (state.faceInitStarted) return;
    state.faceInitStarted = true;
    const recognizer = getFaceRecognizer();
    recognizer.setEnabled(true);
    recognizer.loadModels()
      .then(async () => {
        if ('forceRefreshKnownEmbeddings' in recognizer && typeof recognizer.forceRefreshKnownEmbeddings === 'function') {
          await recognizer.forceRefreshKnownEmbeddings();
        }
      })
      .catch((error) => {
        logger.warn(LOG_CATEGORIES.DETECTION, '[FaceRecognition] Failed to initialize models', error);
      })
      .finally(() => {
        schedulerRef.current.faceInitStarted = false;
      });
  }, []);

  // Watch faceRecognitionEnabled via subscription, not hook deps
  useEffect(() => {
    const unsub = useAppStore.subscribe(
      (state) => state.faceRecognitionEnabled,
      (enabled) => {
        if (!enabled) {
          schedulerRef.current.faceInitStarted = false;
          getFaceRecognizer().setEnabled(false);
        } else {
          const state = schedulerRef.current;
          if (state.faceInitStarted) return;
          state.faceInitStarted = true;
          const recognizer = getFaceRecognizer();
          recognizer.setEnabled(true);
          recognizer.loadModels()
            .then(async () => {
              if ('forceRefreshKnownEmbeddings' in recognizer && typeof recognizer.forceRefreshKnownEmbeddings === 'function') {
                await recognizer.forceRefreshKnownEmbeddings();
              }
            })
            .catch(() => {})
            .finally(() => { schedulerRef.current.faceInitStarted = false; });
        }
      }
    );
    return unsub;
  }, []);

  const start = useCallback(async () => {
    if (schedulerRef.current.isRunning) return;

    logger.info(LOG_CATEGORIES.DETECTION, '[Scheduler] Starting...');

    try {
      const detector = await initializeDetector(yoloConfigRef.current);
      if (!detector.isReady()) {
        logger.error(LOG_CATEGORIES.DETECTION, '[Scheduler] Detector not ready after init');
        return;
      }

      const sources = useAppStore.getState().sources;
      const { updateDetectionStatus } = useAppStore.getState();
      sourceOrderRef.current.forEach((sourceId) => {
        const source = sources.get(sourceId);
        const { eligible } = getSourceEligibility(source);
        updateDetectionStatus(sourceId, eligible ? 'active' : 'inactive');
      });

      schedulerRef.current.isRunning = true;
      lastRunRef.current = performance.now();
      rafRef.current = requestAnimationFrame((ts) => loopFnRef.current?.(ts));

      logger.info(LOG_CATEGORIES.DETECTION, '[Scheduler] Started');
    } catch (error) {
      logger.error(LOG_CATEGORIES.DETECTION, '[Scheduler] Failed to start', error);
      const { updateDetectionStatus } = useAppStore.getState();
      sourceOrderRef.current.forEach((sourceId) => updateDetectionStatus(sourceId, 'error'));
    }
  }, [getSourceEligibility]);

  const stop = useCallback(() => {
    logger.info(LOG_CATEGORIES.DETECTION, '[Scheduler] Stopping');
    schedulerRef.current.isRunning = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const { updateDetectionStatus } = useAppStore.getState();
    sourceOrderRef.current.forEach((sourceId) => updateDetectionStatus(sourceId, 'inactive'));
    schedulerRef.current.processingSources.clear();
  }, []);

  const pause = useCallback(() => { isPausedRef.current = true; }, []);
  const resume = useCallback(() => { isPausedRef.current = false; }, []);

  // React to detectionEnabled changes via subscription
  useEffect(() => {
    const unsub = useAppStore.subscribe(
      (state) => state.detectionEnabled,
      (enabled) => {
        if (enabled) {
          void start();
        } else {
          stop();
        }
      }
    );

    // Start if already enabled
    if (useAppStore.getState().detectionEnabled) {
      void start();
    }

    return () => {
      unsub();
      stop();
    };
  }, [start, stop]);

  useEffect(() => {
    if (!DEFAULT_DETECTION_CONFIG.pauseOnHidden) return;

    const handleVisibilityChange = () => {
      if (document.hidden) { pause(); } else { resume(); }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [pause, resume]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { registerVideoRef, start, stop, pause, resume, isRunning: () => schedulerRef.current.isRunning };
}

function yoloBoxToPixelBox(det: Detection, width: number, height: number): PixelBox {
  return {
    x: (det.bbox.x - det.bbox.width / 2) * width,
    y: (det.bbox.y - det.bbox.height / 2) * height,
    width: det.bbox.width * width,
    height: det.bbox.height * height,
  };
}

function isPointInsideBox(point: { x: number; y: number }, box: PixelBox): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
}

function intersectionArea(a: PixelBox, b: PixelBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function isBoxMostlyInside(inner: PixelBox, outer: PixelBox, minCoverage: number): boolean {
  const inter = intersectionArea(inner, outer);
  const innerArea = inner.width * inner.height;
  if (innerArea <= 0) return false;
  return inter / innerArea >= minCoverage;
}

function calculateOverlap(box1: PixelBox, box2: PixelBox): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;
  return union > 0 ? intersection / union : 0;
}
