'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import {
  initWorkerClient,
  disposeWorkerClient,
  getWorkerClient,
  isWorkerDisposedError,
} from '@/services/detectionWorkerClient';
import { useMultiFrameCapture } from './useFrameCapture';
import { DEFAULT_DETECTION_CONFIG } from '@/lib/constants';
import { overlayBus } from '@/lib/overlayBus';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';
import { useFaceRecognition } from './useFaceRecognition';

export function useDetectionScheduler() {
  const viewModeRef = useRef(useAppStore.getState().viewMode);
  const primarySourceIdRef = useRef(useAppStore.getState().primarySourceId);
  const sourceOrderRef = useRef(useAppStore.getState().sourceOrder);
  const yoloConfigRef = useRef(useAppStore.getState().yoloConfig);

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      viewModeRef.current = state.viewMode;
      primarySourceIdRef.current = state.primarySourceId;
      sourceOrderRef.current = state.sourceOrder;
      yoloConfigRef.current = state.yoloConfig;
    });
  }, []);

  const isRunningRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastRunRef = useRef(0);
  const currentSourceIndexRef = useRef(0);
  const lastDetectionTimeRef = useRef<Map<string, number>>(new Map());
  const processingRef = useRef<Set<string>>(new Set());
  const videoRefsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const lastDebugUpdateRef = useRef(0);
  const totalInferenceTimeRef = useRef(0);
  const completedDetectionsRef = useRef(0);
  const schedulerStartedAtRef = useRef(0);

  const { captureFrame, getImageData, removeCapture } = useMultiFrameCapture({
    maxDimension: DEFAULT_DETECTION_CONFIG.maxFrameDimension,
  });

  // Face recognition hook
  const { processFaceRecognition, isReady: faceRecognitionReady } = useFaceRecognition();

  const registerVideoRef = useCallback((sourceId: string, video: HTMLVideoElement | null) => {
    if (video) {
      videoRefsRef.current.set(sourceId, video);
    } else {
      videoRefsRef.current.delete(sourceId);
      removeCapture(sourceId);
      lastDetectionTimeRef.current.delete(sourceId);
      processingRef.current.delete(sourceId);
    }
  }, [removeCapture]);

  const getSourcesToProcess = useCallback((): string[] => {
    const sources = useAppStore.getState().sources;
    const viewMode = viewModeRef.current;
    const primarySourceId = primarySourceIdRef.current;
    const sourceOrder = sourceOrderRef.current;

    const eligible: string[] = [];
    for (const id of sourceOrder) {
      const s = sources.get(id);
      if (s && s.detectionEnabled && !s.error && (s.status === 'playing' || s.status === 'ready')) {
        eligible.push(id);
      }
    }

    if (viewMode === 'single' && primarySourceId) {
      return eligible.includes(primarySourceId) ? [primarySourceId] : [];
    }

    if (DEFAULT_DETECTION_CONFIG.enableRotation && eligible.length > 1) {
      const idx = currentSourceIndexRef.current % eligible.length;
      return [eligible[idx]];
    }

    return eligible;
  }, []);

  const runDetection = useCallback(async (sourceId: string) => {
    if (processingRef.current.has(sourceId)) return;

    const video = videoRefsRef.current.get(sourceId);
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;

    const workerClient = getWorkerClient();
    if (!workerClient.isReady()) return;

    processingRef.current.add(sourceId);

    try {
      const frame = captureFrame(sourceId, video);
      if (!frame) return;

      const imageData = getImageData(sourceId);
      if (!imageData) return;
      const captureTimestamp = performance.now();

      const result = await workerClient.detect({
        sourceId,
        pixels: new Uint8ClampedArray(imageData.data.buffer.slice(0)),
        capW: frame.width,
        capH: frame.height,
        origW: frame.originalWidth,
        origH: frame.originalHeight,
        config: yoloConfigRef.current,
      });

      // Process face recognition on person detections if enabled
      let finalDetections = result.detections;
      if (faceRecognitionReady && result.detections.some(d => d.className === 'person')) {
        try {
          finalDetections = await processFaceRecognition(
            sourceId,
            video,
            result.detections,
            frame.width,
            frame.height
          );
        } catch (faceError) {
          // Don't let face recognition errors break the detection pipeline
          logger.warn(
            LOG_CATEGORIES.DETECTION,
            `Face recognition failed for ${sourceId}, using original detections`,
            faceError
          );
        }
      }

      // Create updated result with face recognition data
      const finalResult = { ...result, detections: finalDetections };

      // Paint overlay immediately — bypasses Zustand->React re-render lag
      overlayBus.emit(sourceId, finalResult);

      // Update store for sidebar stats (non-visual, no urgency)
      const src = useAppStore.getState().sources.get(sourceId);
      if (src?.detectionEnabled && (src.status === 'playing' || src.status === 'ready')) {
        useAppStore.getState().updateDetections(sourceId, finalResult);
      }

      totalInferenceTimeRef.current += result.inferenceTime;
      completedDetectionsRef.current += 1;
      const elapsedMs = Math.max(1, performance.now() - schedulerStartedAtRef.current);
      useAppStore.getState().updateDebugInfo({
        totalInferenceTime: totalInferenceTimeRef.current,
        averageFPS: (completedDetectionsRef.current * 1000) / elapsedMs,
        lastFrameCapture: captureTimestamp,
        activeDetections: processingRef.current.size,
      });
    } catch (error) {
      if (isWorkerDisposedError(error) || !isRunningRef.current) {
        return;
      }

      // Log detection errors for debugging - don't silently fail
      logger.error(
        LOG_CATEGORIES.DETECTION,
        `Detection failed for source ${sourceId}`,
        error instanceof Error ? error : String(error)
      );
    } finally {
      processingRef.current.delete(sourceId);
    }
  }, [captureFrame, getImageData, faceRecognitionReady, processFaceRecognition]);

  const loopFnRef = useRef<((ts: number) => void) | null>(null);

  useEffect(() => {
    loopFnRef.current = (ts: number) => {
      if (!isRunningRef.current) return;

      const viewMode = viewModeRef.current;
      const targetFPS = viewMode === 'single'
        ? DEFAULT_DETECTION_CONFIG.singleModeTargetFPS
        : DEFAULT_DETECTION_CONFIG.gridModeTargetFPS;
      const interval = 1000 / targetFPS;

      if (ts - lastRunRef.current >= interval) {
        const sources = getSourcesToProcess();
        const now = performance.now();
        const ready = sources.filter(id => {
          const last = lastDetectionTimeRef.current.get(id) ?? 0;
          return now - last >= DEFAULT_DETECTION_CONFIG.minDetectionInterval;
        });

        if (ready.length > 0) {
          const id = ready[0];
          lastDetectionTimeRef.current.set(id, now);
          void runDetection(id);
          lastRunRef.current = ts;
          if (DEFAULT_DETECTION_CONFIG.enableRotation && viewMode === 'grid') {
            currentSourceIndexRef.current += 1;
          }
        } else {
          // Still advance lastRun so we don't spin-check every RAF tick
          lastRunRef.current = ts;
        }

        if (now - lastDebugUpdateRef.current >= 3000) {
          lastDebugUpdateRef.current = now;
          useAppStore.getState().updateDebugInfo({
            activeSources: sources.length,
            activeDetections: processingRef.current.size,
          });
        }
      }

      rafRef.current = requestAnimationFrame(t => loopFnRef.current!(t));
    };
  }, [getSourcesToProcess, runDetection]);

  const start = useCallback(async () => {
    if (isRunningRef.current) return;
    await initWorkerClient(yoloConfigRef.current);
    isRunningRef.current = true;
    schedulerStartedAtRef.current = performance.now();
    totalInferenceTimeRef.current = 0;
    completedDetectionsRef.current = 0;
    lastRunRef.current = performance.now();
    rafRef.current = requestAnimationFrame(t => loopFnRef.current!(t));
    useAppStore.getState().updateDebugInfo({
      totalInferenceTime: 0,
      averageFPS: 0,
      lastFrameCapture: 0,
      activeDetections: 0,
    });
    const { updateDetectionStatus, sources, sourceOrder } = useAppStore.getState();
    for (const id of sourceOrder) {
      const s = sources.get(id);
      updateDetectionStatus(id, (s?.detectionEnabled && !s.error && (s.status === 'playing' || s.status === 'ready')) ? 'active' : 'inactive');
    }
  }, []);

  const stop = useCallback(() => {
    isRunningRef.current = false;
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    processingRef.current.clear();
    totalInferenceTimeRef.current = 0;
    completedDetectionsRef.current = 0;
    schedulerStartedAtRef.current = 0;
    useAppStore.getState().updateDebugInfo({
      activeDetections: 0,
      totalInferenceTime: 0,
      averageFPS: 0,
      lastFrameCapture: 0,
    });
    const { updateDetectionStatus, sourceOrder } = useAppStore.getState();
    for (const id of sourceOrder) updateDetectionStatus(id, 'inactive');
  }, []);

  useEffect(() => {
    const unsub = useAppStore.subscribe(
      s => s.detectionEnabled,
      enabled => { if (enabled) void start(); else stop(); }
    );
    if (useAppStore.getState().detectionEnabled) void start();
    return () => { unsub(); stop(); };
  }, [start, stop]);

  useEffect(() => {
    if (!DEFAULT_DETECTION_CONFIG.pauseOnHidden) return;
    const onVis = () => {
      if (document.hidden) {
        if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      } else if (isRunningRef.current) {
        rafRef.current = requestAnimationFrame(t => loopFnRef.current!(t));
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    return () => { stop(); disposeWorkerClient(); };
  }, [stop]);

  return { registerVideoRef };
}
