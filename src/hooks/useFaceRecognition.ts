/**
 * Face Recognition Integration Hook
 * =================================
 * Integrates face recognition into the detection pipeline.
 *
 * Features:
 * - Only processes person detections
 * - Throttled recognition to maintain performance
 * - Caches results to avoid redundant processing
 * - Updates detection results with face names
 *
 * Bug 15 fix: call setFaceRecognitionStatus('idle') when face recognition
 * is disabled so that re-enabling correctly re-triggers the model-loading
 * effect (which only fires when status === 'idle').
 */

import { useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { getFaceRecognizer } from '@/services/faceRecognizer';
import type { Detection } from '@/types';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';

interface CachedRecognition {
  identityId: string | null;
  name: string | null;
  confidence: number;
  timestamp: number;
}

interface FaceRecognitionState {
  lastRunTime: Map<string, number>;
  cache: Map<string, CachedRecognition>;
  pending: Set<string>;
}

const RECOGNITION_INTERVAL = 500;
const CACHE_TTL = 2000;

export function useFaceRecognition() {
  const stateRef = useRef<FaceRecognitionState>({
    lastRunTime: new Map(),
    cache: new Map(),
    pending: new Set(),
  });

  const faceRecognitionEnabled = useAppStore((state) => state.faceRecognitionEnabled);
  const faceRecognitionStatus = useAppStore((state) => state.faceRecognitionStatus);
  const setFaceRecognitionStatus = useAppStore((state) => state.setFaceRecognitionStatus);

  useEffect(() => {
    const recognizer = getFaceRecognizer();
    recognizer.setEnabled(faceRecognitionEnabled);

    if (!faceRecognitionEnabled) {
      recognizer.clearCache();

      const state = stateRef.current;
      state.cache.clear();
      state.lastRunTime.clear();
      state.pending.clear();

      // Bug 15 fix: reset status to 'idle' so that when the user re-enables
      // face recognition the model-loading effect below fires again.
      // Without this reset, status stays at 'ready' or 'error' and the
      // condition (faceRecognitionEnabled && faceRecognitionStatus === 'idle')
      // is never true again, permanently blocking model reload.
      setFaceRecognitionStatus('idle');
    }
  }, [faceRecognitionEnabled, setFaceRecognitionStatus]);

  useEffect(() => {
    if (faceRecognitionEnabled && faceRecognitionStatus === 'idle') {
      setFaceRecognitionStatus('loading-models');

      getFaceRecognizer()
        .loadModels()
        .then(() => {
          setFaceRecognitionStatus('ready');
          logger.info(LOG_CATEGORIES.DETECTION, '[FaceRecognition] Ready');
        })
        .catch((error) => {
          setFaceRecognitionStatus('error');
          logger.error(LOG_CATEGORIES.DETECTION, '[FaceRecognition] Failed to initialize', error);
        });
    }
  }, [faceRecognitionEnabled, faceRecognitionStatus, setFaceRecognitionStatus]);

  const processFaceRecognition = useCallback(
    async (
      sourceId: string,
      video: HTMLVideoElement | null,
      detections: Detection[],
      frameWidth: number,
      frameHeight: number
    ): Promise<Detection[]> => {
      if (!faceRecognitionEnabled || faceRecognitionStatus !== 'ready') {
        return detections;
      }

      const recognizer = getFaceRecognizer();
      if (!recognizer.isReady()) {
        return detections;
      }

      const state = stateRef.current;
      const now = Date.now();

      const lastRun = state.lastRunTime.get(sourceId) ?? 0;
      if (now - lastRun < RECOGNITION_INTERVAL) {
        return detections.map((det) => {
          if (det.className !== 'person') return det;

          const cacheKey = `${sourceId}-${det.id}`;
          const cached = state.cache.get(cacheKey);

          if (cached && now - cached.timestamp < CACHE_TTL) {
            return {
              ...det,
              faceRecognition: {
                identityId: cached.identityId,
                identityName: cached.name,
                confidence: cached.confidence,
              },
            };
          }

          return det;
        });
      }

      if (state.pending.has(sourceId)) {
        return detections;
      }

      const personDetections = detections.filter((d) => d.className === 'person');
      if (personDetections.length === 0) {
        return detections;
      }

      if (!video) {
        return detections;
      }

      state.pending.add(sourceId);
      state.lastRunTime.set(sourceId, now);

      try {
        const faceResults = await recognizer.recognizeFaces(video, sourceId);

        const updatedDetections = detections.map((det) => {
          if (det.className !== 'person') return det;

          const personBox = {
            x: det.bbox.x * frameWidth,
            y: det.bbox.y * frameHeight,
            width: det.bbox.width * frameWidth,
            height: det.bbox.height * frameHeight,
          };

          let bestMatch: {
            identityId: string | null;
            name: string | null;
            confidence: number;
          } | null = null;

          let bestOverlap = 0;

          for (const faceResult of faceResults) {
            if (!faceResult.detected) continue;

            const overlap = calculateOverlap(personBox, faceResult.box);

            if (overlap > bestOverlap && overlap > 0.1) {
              bestOverlap = overlap;
              bestMatch = {
                identityId: faceResult.identityId,
                name: faceResult.identityName,
                confidence: faceResult.confidence,
              };
            }
          }

          const cacheKey = `${sourceId}-${det.id}`;

          if (bestMatch) {
            state.cache.set(cacheKey, {
              identityId: bestMatch.identityId,
              name: bestMatch.name,
              confidence: bestMatch.confidence,
              timestamp: now,
            });
          } else {
            state.cache.delete(cacheKey);
          }

          return {
            ...det,
            faceRecognition: bestMatch
              ? {
                  identityId: bestMatch.identityId,
                  identityName: bestMatch.name,
                  confidence: bestMatch.confidence,
                }
              : undefined,
          };
        });

        return updatedDetections;
      } catch (error) {
        logger.error(
          LOG_CATEGORIES.DETECTION,
          `[FaceRecognition] Error processing ${sourceId}`,
          error
        );
        return detections;
      } finally {
        state.pending.delete(sourceId);
      }
    },
    [faceRecognitionEnabled, faceRecognitionStatus]
  );

  const clearCache = useCallback((sourceId?: string) => {
    const state = stateRef.current;
    const recognizer = getFaceRecognizer();

    if (sourceId) {
      for (const key of Array.from(state.cache.keys())) {
        if (key.startsWith(`${sourceId}-`)) {
          state.cache.delete(key);
        }
      }
      state.lastRunTime.delete(sourceId);
    } else {
      state.cache.clear();
      state.lastRunTime.clear();
      state.pending.clear();
      recognizer.clearCache();
    }
  }, []);

  return {
    processFaceRecognition,
    clearCache,
    isReady: faceRecognitionStatus === 'ready',
    status: faceRecognitionStatus,
  };
}

function calculateOverlap(
  box1: { x: number; y: number; width: number; height: number },
  box2: { x: number; y: number; width: number; height: number }
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

export default useFaceRecognition;
