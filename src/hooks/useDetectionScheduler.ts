/**
 * Detection Scheduler Hook
 * ========================
 * Manages detection scheduling for single and grid view modes.
 *
 * Fixes in this version:
 * - Improves person-to-face matching logic (IoU alone was too strict for small face boxes)
 * - Initializes face models when face recognition is enabled
 * - Syncs face recognizer enabled state reliably
 * - Preserves recognized identities on detections
 * - Adds safer per-source cleanup and clearer debug logging
 * - Bug 5 fix: faceRecognitionEnabled moved to a ref so it is NOT in
 *   runDetection's useCallback deps, preventing the RAF loop from restarting
 *   on every face-recognition state toggle.
 * - Bug 14 fix: faceInitStarted is reset to false when faceRecognitionEnabled
 *   becomes false, so that a subsequent re-enable can load models again.
 */

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
  const detectionEnabled = useAppStore((state) => state.detectionEnabled);
  const detectionConfig = useAppStore((state) => state.detectionConfig);
  const yoloConfig = useAppStore((state) => state.yoloConfig);
  const viewMode = useAppStore((state) => state.viewMode);
  const primarySourceId = useAppStore((state) => state.primarySourceId);
  const sourceOrder = useAppStore((state) => state.sourceOrder);

  const updateDetections = useAppStore((state) => state.updateDetections);
  const updateDetectionStatus = useAppStore((state) => state.updateDetectionStatus);
  const updateDebugInfo = useAppStore((state) => state.updateDebugInfo);

  const faceRecognitionEnabled = useAppStore((state) => state.faceRecognitionEnabled);

  // Bug 5 fix: Keep faceRecognitionEnabled in a ref so runDetection can read
  // the latest value without it appearing in the useCallback dependency array.
  // Previously, having faceRecognitionEnabled as a dep caused runDetection to
  // get a new identity on every toggle, which in turn caused the
  // detectionLoopRef effect to re-run and restart the entire RAF loop,
  // potentially dropping in-flight frames.
  const faceRecognitionEnabledRef = useRef(faceRecognitionEnabled);
  useEffect(() => {
    faceRecognitionEnabledRef.current = faceRecognitionEnabled;
  }, [faceRecognitionEnabled]);

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
    maxDimension: detectionConfig.maxFrameDimension,
  });

  const videoRefsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  const registerVideoRef = useCallback((sourceId: string, video: HTMLVideoElement | null) => {
    if (video) {
      videoRefsRef.current.set(sourceId, video);
      logger.debug(LOG_CATEGORIES.DETECTION, `[Scheduler] Registered video ref for ${sourceId}`);
    } else {
      videoRefsRef.current.delete(sourceId);
      removeCapture(sourceId);
      schedulerRef.current.lastDetectionTime.delete(sourceId);
      schedulerRef.current.lastFaceRecognitionTime.delete(sourceId);
      schedulerRef.current.processingSources.delete(sourceId);
      logger.debug(LOG_CATEGORIES.DETECTION, `[Scheduler] Unregistered video ref for ${sourceId}`);
    }
  }, [removeCapture]);

  const getSourceEligibility = useCallback((source: SourceWithState | undefined): { eligible: boolean; reason: string } => {
    if (!source) {
      return { eligible: false, reason: 'source not found' };
    }

    if (!source.detectionEnabled) {
      return { eligible: false, reason: 'detection disabled for this source' };
    }

    if (source.status !== 'playing' && source.status !== 'ready') {
      return { eligible: false, reason: `status is '${source.status}' (need 'playing' or 'ready')` };
    }

    if (source.error) {
      return { eligible: false, reason: `source has error: ${source.error}` };
    }

    return { eligible: true, reason: 'eligible' };
  }, []);

  const getSourcesToDetect = useCallback((): string[] => {
    const sources = useAppStore.getState().sources;
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
      logger.info(LOG_CATEGORIES.DETECTION, '[Scheduler] Source eligibility check:');
      results.forEach((r) => {
        logger.info(
          LOG_CATEGORIES.DETECTION,
          `  - ${r.id}: ${r.eligible ? 'ELIGIBLE' : `SKIPPED (${r.reason})`}`
        );
      });
    }

    if (viewMode === 'single' && primarySourceId) {
      const isPrimaryEligible = eligibleSources.some((r) => r.id === primarySourceId);
      return isPrimaryEligible ? [primarySourceId] : [];
    }

    const eligibleIds = eligibleSources.map((r) => r.id);
    if (detectionConfig.enableRotation && eligibleIds.length > 1) {
      const index = state.currentSourceIndex % eligibleIds.length;
      return [eligibleIds[index]];
    }

    return eligibleIds;
  }, [viewMode, primarySourceId, sourceOrder, detectionConfig.enableRotation, getSourceEligibility]);

  const runDetection = useCallback(async (sourceId: string): Promise<void> => {
    const state = schedulerRef.current;

    if (state.processingSources.has(sourceId)) {
      logger.debug(LOG_CATEGORIES.DETECTION, `[Scheduler] Skipping ${sourceId} - already processing`);
      return;
    }

    const video = videoRefsRef.current.get(sourceId);
    if (!video) {
      logger.debug(LOG_CATEGORIES.DETECTION, `[Scheduler] No video ref for ${sourceId}`);
      return;
    }

    if (video.readyState < 2) {
      logger.debug(
        LOG_CATEGORIES.DETECTION,
        `[Scheduler] Video not ready for ${sourceId} (readyState: ${video.readyState})`
      );
      return;
    }

    const detector = getDetector();
    if (!detector.isReady()) {
      logger.warn(LOG_CATEGORIES.DETECTION, `[Scheduler] Detector not ready for ${sourceId}`);
      return;
    }

    state.processingSources.add(sourceId);
    logger.debug(LOG_CATEGORIES.DETECTION, `[Scheduler] Starting detection for ${sourceId}`);

    try {
      const frame = captureFrame(sourceId, video);
      if (!frame) {
        logger.warn(LOG_CATEGORIES.DETECTION, `[Scheduler] Failed to capture frame for ${sourceId}`);
        return;
      }

      const imageData = getImageData(sourceId);
      if (!imageData) {
        logger.warn(LOG_CATEGORIES.DETECTION, `[Scheduler] Failed to get image data for ${sourceId}`);
        return;
      }

      const result = await detector.detect(
        sourceId,
        imageData,
        { width: frame.width, height: frame.height },
        { width: frame.originalWidth, height: frame.originalHeight }
      );

      // Read face recognition toggle from ref (not closure) to avoid stale value
      // and to prevent runDetection from being recreated on every toggle.
      if (faceRecognitionEnabledRef.current) {
        const faceRecognizer = getFaceRecognizer();

        // Keep recognizer state in sync with app state.
        faceRecognizer.setEnabled(true);

        if (faceRecognizer.isReady()) {
          const now = performance.now();
          const lastFaceTime = state.lastFaceRecognitionTime.get(sourceId) || 0;

          if (now - lastFaceTime >= 500) {
            state.lastFaceRecognitionTime.set(sourceId, now);

            const personDetections = result.detections.filter((d) => d.className === 'person');

            logger.debug(
              LOG_CATEGORIES.DETECTION,
              `[FaceRecognition] Processing ${sourceId}: ${personDetections.length} person detections`
            );

            if (personDetections.length > 0 && video.readyState >= 2) {
              try {
                const faceResults = await faceRecognizer.recognizeFaces(video, sourceId);

                logger.debug(
                  LOG_CATEGORIES.DETECTION,
                  `[FaceRecognition] Detected ${faceResults.length} faces, ${faceResults.filter((f) => f.identityName).length} recognized`
                );

                result.detections = result.detections.map((det) => {
                  if (det.className !== 'person') return det;

                  const personBox = yoloBoxToPixelBox(det, frame.originalWidth, frame.originalHeight);

                  let bestMatch: FaceMatchCandidate | null = null;

                  for (const face of faceResults) {
                    if (!face.detected) continue;

                    const overlap = calculateOverlap(personBox, face.box);
                    const faceInsidePerson = isBoxMostlyInside(face.box, personBox, 0.6);
                    const faceCenterInsidePerson = isPointInsideBox(
                      {
                        x: face.box.x + face.box.width / 2,
                        y: face.box.y + face.box.height / 2,
                      },
                      personBox
                    );

                    const recognitionBonus = face.identityName ? 1 : 0;
                    const score =
                      (faceCenterInsidePerson ? 1.0 : 0.0) +
                      (faceInsidePerson ? 0.7 : 0.0) +
                      overlap * 2.0 +
                      recognitionBonus * 1.5 +
                      face.confidence * 1.5;

                    logger.debug(
                      LOG_CATEGORIES.DETECTION,
                      `[FaceRecognition] Matching person=${JSON.stringify(personBox)} face=${JSON.stringify(face.box)} overlap=${overlap.toFixed(3)} centerInside=${faceCenterInsidePerson} inside=${faceInsidePerson} name=${face.identityName ?? 'unknown'} confidence=${face.confidence.toFixed(2)} score=${score.toFixed(3)}`
                    );

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

                  if (
                    bestMatch &&
                    bestMatch.identityName &&
                    bestMatch.faceCenterInsidePerson &&
                    bestMatch.confidence >= 0.35
                  ) {
                    logger.info(
                      LOG_CATEGORIES.DETECTION,
                      `[FaceRecognition] MATCHED: "${bestMatch.identityName}" to person (score=${bestMatch.score.toFixed(3)}, overlap=${bestMatch.overlap.toFixed(3)}, confidence=${bestMatch.confidence.toFixed(2)})`
                    );

                    return {
                      ...det,
                      faceRecognition: {
                        identityId: bestMatch.identityId,
                        identityName: bestMatch.identityName,
                        confidence: bestMatch.confidence,
                      },
                    };
                  }

                  if (bestMatch) {
                    logger.debug(
                      LOG_CATEGORIES.DETECTION,
                      `[FaceRecognition] Best face for person was not confident enough: name=${bestMatch.identityName ?? 'unknown'} confidence=${bestMatch.confidence.toFixed(2)} score=${bestMatch.score.toFixed(3)}`
                    );
                  }

                  return {
                    ...det,
                    faceRecognition: undefined,
                  };
                });

                logger.debug(
                  LOG_CATEGORIES.DETECTION,
                  `[FaceRecognition] Complete for ${sourceId}: ${result.detections.filter((d) => d.faceRecognition?.identityName).length} persons identified`
                );
              } catch (error) {
                logger.warn(
                  LOG_CATEGORIES.DETECTION,
                  `[FaceRecognition] Failed for ${sourceId}`,
                  error
                );
              }
            }
          }
        } else {
          logger.debug(
            LOG_CATEGORIES.DETECTION,
            `[FaceRecognition] Recognizer not ready for ${sourceId}`
          );
        }
      }

      const currentSource = useAppStore.getState().sources.get(sourceId);
      if (
        currentSource?.detectionEnabled &&
        (currentSource.status === 'playing' || currentSource.status === 'ready')
      ) {
        updateDetections(sourceId, result);

        logger.debug(
          LOG_CATEGORIES.DETECTION,
          `[Scheduler] Detection complete for ${sourceId}: ${result.detections.length} objects in ${result.inferenceTime.toFixed(1)}ms`
        );
      }

      state.frameCount += 1;
      state.totalInferenceTime += result.inferenceTime;
    } catch (error) {
      logger.error(LOG_CATEGORIES.DETECTION, `[Scheduler] Detection failed for ${sourceId}`, error);
    } finally {
      state.processingSources.delete(sourceId);
    }
  // faceRecognitionEnabled intentionally omitted — read via ref to avoid
  // restarting the RAF loop on every toggle (Bug 5).
  }, [captureFrame, getImageData, updateDetections]);

  const detectionLoopRef = useRef<((timestamp: number) => void) | null>(null);

  useEffect(() => {
    detectionLoopRef.current = (timestamp: number) => {
      const state = schedulerRef.current;

      if (!state.isRunning || isPausedRef.current) {
        return;
      }

      const targetFPS = viewMode === 'single'
        ? DEFAULT_DETECTION_CONFIG.singleModeTargetFPS
        : DEFAULT_DETECTION_CONFIG.gridModeTargetFPS;
      const targetInterval = 1000 / targetFPS;

      const elapsed = timestamp - lastRunRef.current;
      if (elapsed < targetInterval) {
        rafRef.current = requestAnimationFrame((ts) => detectionLoopRef.current?.(ts));
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

        if (detectionConfig.enableRotation && viewMode === 'grid') {
          state.currentSourceIndex += 1;
        }
      }

      if (now - state.lastDebugUpdate >= 1000) {
        state.lastDebugUpdate = now;
        const avgInferenceTime = state.frameCount > 0
          ? state.totalInferenceTime / state.frameCount
          : 0;

        updateDebugInfo({
          activeSources: sourcesToDetect.length,
          activeDetections: state.processingSources.size,
          totalInferenceTime: state.totalInferenceTime,
          averageFPS: avgInferenceTime > 0 ? 1000 / avgInferenceTime : 0,
          lastFrameCapture: now,
        });
      }

      rafRef.current = requestAnimationFrame((ts) => detectionLoopRef.current?.(ts));
    };
  }, [viewMode, getSourcesToDetect, runDetection, detectionConfig.enableRotation, updateDebugInfo]);

  useEffect(() => {
    if (!faceRecognitionEnabled) {
      // Bug 14 fix: reset faceInitStarted when disabling so a subsequent
      // re-enable is not permanently blocked by the guard at the top of the
      // enabled branch below.
      schedulerRef.current.faceInitStarted = false;
      const recognizer = getFaceRecognizer();
      recognizer.setEnabled(false);
      return;
    }

    const state = schedulerRef.current;
    if (state.faceInitStarted) {
      return;
    }

    state.faceInitStarted = true;

    const recognizer = getFaceRecognizer();
    recognizer.setEnabled(true);

    recognizer.loadModels()
      .then(async () => {
        if ('forceRefreshKnownEmbeddings' in recognizer && typeof recognizer.forceRefreshKnownEmbeddings === 'function') {
          await recognizer.forceRefreshKnownEmbeddings();
        }
        logger.info(LOG_CATEGORIES.DETECTION, '[FaceRecognition] Models initialized from scheduler');
      })
      .catch((error) => {
        logger.warn(LOG_CATEGORIES.DETECTION, '[FaceRecognition] Failed to initialize models from scheduler', error);
      })
      .finally(() => {
        schedulerRef.current.faceInitStarted = false;
      });
  }, [faceRecognitionEnabled]);

  const start = useCallback(async () => {
    if (schedulerRef.current.isRunning) {
      logger.debug(LOG_CATEGORIES.DETECTION, '[Scheduler] Already running, skipping start');
      return;
    }

    logger.info(LOG_CATEGORIES.DETECTION, '[Scheduler] Starting detection scheduler...');

    try {
      const detector = await initializeDetector(yoloConfig);

      if (!detector.isReady()) {
        logger.error(LOG_CATEGORIES.DETECTION, '[Scheduler] Detector not ready after initialization');
        return;
      }

      logger.info(
        LOG_CATEGORIES.DETECTION,
        `[Scheduler] Detector ready. Demo mode: ${detector.isDemoMode()}`
      );

      const sources = useAppStore.getState().sources;
      sourceOrder.forEach((sourceId) => {
        const source = sources.get(sourceId);
        const { eligible } = getSourceEligibility(source);
        updateDetectionStatus(sourceId, eligible ? 'active' : 'inactive');
      });

      schedulerRef.current.isRunning = true;
      lastRunRef.current = performance.now();

      rafRef.current = requestAnimationFrame((ts) => detectionLoopRef.current?.(ts));

      logger.info(LOG_CATEGORIES.DETECTION, '[Scheduler] Detection scheduler started successfully');
    } catch (error) {
      logger.error(LOG_CATEGORIES.DETECTION, '[Scheduler] Failed to start detector', error);

      sourceOrder.forEach((sourceId) => {
        updateDetectionStatus(sourceId, 'error');
      });
    }
  }, [yoloConfig, sourceOrder, updateDetectionStatus, getSourceEligibility]);

  const stop = useCallback(() => {
    logger.info(LOG_CATEGORIES.DETECTION, '[Scheduler] Stopping detection scheduler');

    schedulerRef.current.isRunning = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    sourceOrder.forEach((sourceId) => {
      updateDetectionStatus(sourceId, 'inactive');
    });

    schedulerRef.current.processingSources.clear();
  }, [sourceOrder, updateDetectionStatus]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    logger.debug(LOG_CATEGORIES.DETECTION, '[Scheduler] Detection paused');
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    logger.debug(LOG_CATEGORIES.DETECTION, '[Scheduler] Detection resumed');
  }, []);

  useEffect(() => {
    if (detectionEnabled) {
      void start();
    } else {
      stop();
    }

    return () => {
      stop();
    };
  }, [detectionEnabled, start, stop]);

  useEffect(() => {
    if (!detectionConfig.pauseOnHidden) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        pause();
      } else {
        resume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [detectionConfig.pauseOnHidden, pause, resume]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return {
    registerVideoRef,
    start,
    stop,
    pause,
    resume,
    isRunning: () => schedulerRef.current.isRunning,
  };
}

function yoloBoxToPixelBox(
  det: Detection,
  width: number,
  height: number
): PixelBox {
  return {
    x: (det.bbox.x - det.bbox.width / 2) * width,
    y: (det.bbox.y - det.bbox.height / 2) * height,
    width: det.bbox.width * width,
    height: det.bbox.height * height,
  };
}

function isPointInsideBox(
  point: { x: number; y: number },
  box: PixelBox
): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function intersectionArea(a: PixelBox, b: PixelBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function isBoxMostlyInside(
  inner: PixelBox,
  outer: PixelBox,
  minCoverage: number
): boolean {
  const inter = intersectionArea(inner, outer);
  const innerArea = inner.width * inner.height;
  if (innerArea <= 0) return false;
  return inter / innerArea >= minCoverage;
}

/**
 * IoU between two boxes.
 * Note: for person-vs-face matching this is usually small, so we only use it as one weak signal.
 */
function calculateOverlap(
  box1: PixelBox,
  box2: PixelBox
): number {
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
