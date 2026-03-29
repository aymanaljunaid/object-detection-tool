/**
 * useFrameCapture Hook
 * ====================
 * Captures frames from video elements for detection.
 * Handles downscaling and coordinate mapping.
 * 
 * Key features:
 * - Efficient frame capture using canvas
 * - Automatic downscaling for performance
 * - Coordinate mapping for detection accuracy
 */

import { useRef, useCallback } from 'react';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';
import { calculateScaledDimensions } from '@/lib/utils/coordinates';
import type { Dimensions, CapturedFrame, FrameCaptureOptions } from '@/types';

const DEFAULT_OPTIONS: FrameCaptureOptions = {
  maxDimension: 320,
  format: 'canvas',
  quality: 0.8,
};

interface FrameCaptureState {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  lastCaptureTime: number;
  frameCount: number;
}

/**
 * Hook for capturing video frames
 */
export function useFrameCapture(options: Partial<FrameCaptureOptions> = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const stateRef = useRef<FrameCaptureState>({
    canvas: null,
    ctx: null,
    lastCaptureTime: 0,
    frameCount: 0,
  });

  /**
   * Initialize canvas for frame capture
   */
  const initializeCanvas = useCallback((width: number, height: number): void => {
    const state = stateRef.current;
    
    // Create canvas if needed or size changed
    const needNewCanvas = !state.canvas || 
      state.canvas.width !== width || 
      state.canvas.height !== height;
    
    if (needNewCanvas) {
      // Use OffscreenCanvas if available (better performance)
      const useOffscreen = typeof OffscreenCanvas !== 'undefined';
      
      if (useOffscreen) {
        state.canvas = new OffscreenCanvas(width, height);
        state.ctx = state.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      } else {
        state.canvas = document.createElement('canvas');
        state.canvas.width = width;
        state.canvas.height = height;
        state.ctx = state.canvas.getContext('2d');
      }
      
      if (state.ctx) {
        // Disable image smoothing for faster processing
        state.ctx.imageSmoothingEnabled = false;
      }
    }
  }, []);

  /**
   * Capture a frame from video element
   */
  const captureFrame = useCallback((
    sourceId: string,
    video: HTMLVideoElement
  ): CapturedFrame | null => {
    if (!video || video.readyState < 2) {
      return null;
    }

    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;
    
    if (originalWidth === 0 || originalHeight === 0) {
      logger.warn(LOG_CATEGORIES.DETECTION, `Invalid video dimensions for ${sourceId}`);
      return null;
    }

    // Calculate downscaled dimensions
    const targetDimensions = calculateScaledDimensions(
      { width: originalWidth, height: originalHeight },
      { width: opts.maxDimension, height: opts.maxDimension }
    );

    // Initialize canvas
    initializeCanvas(targetDimensions.width, targetDimensions.height);

    const state = stateRef.current;
    if (!state.canvas || !state.ctx) {
      logger.error(LOG_CATEGORIES.DETECTION, `Failed to initialize canvas for ${sourceId}`);
      return null;
    }

    // Draw video frame to canvas
    try {
      state.ctx.drawImage(
        video,
        0,
        0,
        originalWidth,
        originalHeight,
        0,
        0,
        targetDimensions.width,
        targetDimensions.height
      );
    } catch (error) {
      logger.error(LOG_CATEGORIES.DETECTION, `Failed to draw frame for ${sourceId}`, error);
      return null;
    }

    // Update stats
    state.lastCaptureTime = performance.now();
    state.frameCount++;

    return {
      sourceId,
      timestamp: video.currentTime,
      canvas: state.canvas,
      width: targetDimensions.width,
      height: targetDimensions.height,
      originalWidth,
      originalHeight,
    };
  }, [opts.maxDimension, initializeCanvas]);

  /**
   * Get canvas image data for detection
   */
  const getImageData = useCallback((): ImageData | null => {
    const state = stateRef.current;
    if (!state.canvas || !state.ctx) {
      return null;
    }

    try {
      return state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height);
    } catch (error) {
      logger.error(LOG_CATEGORIES.DETECTION, 'Failed to get image data', error);
      return null;
    }
  }, []);

  /**
   * Get capture statistics
   */
  const getStats = useCallback(() => {
    const state = stateRef.current;
    return {
      lastCaptureTime: state.lastCaptureTime,
      frameCount: state.frameCount,
    };
  }, []);

  /**
   * Reset capture state
   */
  const reset = useCallback(() => {
    const state = stateRef.current;
    state.lastCaptureTime = 0;
    state.frameCount = 0;
  }, []);

  return {
    captureFrame,
    getImageData,
    getStats,
    reset,
  };
}

/**
 * Hook for managing frame capture for multiple sources
 */
export function useMultiFrameCapture(options: Partial<FrameCaptureOptions> = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Store capture state per source
  const capturesRef = useRef<Map<string, FrameCaptureState>>(new Map());

  /**
   * Get or create a capture state for a source
   */
  const getOrCreateCapture = useCallback((sourceId: string): FrameCaptureState => {
    if (!capturesRef.current.has(sourceId)) {
      capturesRef.current.set(sourceId, {
        canvas: null,
        ctx: null,
        lastCaptureTime: 0,
        frameCount: 0,
      });
    }
    return capturesRef.current.get(sourceId)!;
  }, []);

  /**
   * Capture frame for a specific source
   */
  const captureFrame = useCallback((
    sourceId: string,
    video: HTMLVideoElement
  ): CapturedFrame | null => {
    if (!video || video.readyState < 2) {
      return null;
    }

    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;
    
    if (originalWidth === 0 || originalHeight === 0) {
      return null;
    }

    // Calculate downscaled dimensions
    const targetDimensions = calculateScaledDimensions(
      { width: originalWidth, height: originalHeight },
      { width: opts.maxDimension, height: opts.maxDimension }
    );

    // Get or create capture state
    const capture = getOrCreateCapture(sourceId);

    // Initialize canvas
    const needNewCanvas = !capture.canvas || 
      capture.canvas.width !== targetDimensions.width || 
      capture.canvas.height !== targetDimensions.height;
    
    if (needNewCanvas) {
      const useOffscreen = typeof OffscreenCanvas !== 'undefined';
      
      if (useOffscreen) {
        capture.canvas = new OffscreenCanvas(targetDimensions.width, targetDimensions.height);
        capture.ctx = capture.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      } else {
        capture.canvas = document.createElement('canvas');
        capture.canvas.width = targetDimensions.width;
        capture.canvas.height = targetDimensions.height;
        capture.ctx = capture.canvas.getContext('2d');
      }
      
      if (capture.ctx) {
        capture.ctx.imageSmoothingEnabled = false;
      }
    }

    if (!capture.canvas || !capture.ctx) {
      return null;
    }

    // Draw frame
    try {
      capture.ctx.drawImage(
        video,
        0, 0, originalWidth, originalHeight,
        0, 0, targetDimensions.width, targetDimensions.height
      );
    } catch {
      return null;
    }

    capture.lastCaptureTime = performance.now();
    capture.frameCount++;

    return {
      sourceId,
      timestamp: video.currentTime,
      canvas: capture.canvas,
      width: targetDimensions.width,
      height: targetDimensions.height,
      originalWidth,
      originalHeight,
    };
  }, [opts.maxDimension, getOrCreateCapture]);

  /**
   * Get image data for a source
   */
  const getImageData = useCallback((sourceId: string): ImageData | null => {
    const capture = capturesRef.current.get(sourceId);
    if (!capture?.canvas || !capture?.ctx) {
      return null;
    }

    try {
      return capture.ctx.getImageData(0, 0, capture.canvas.width, capture.canvas.height);
    } catch {
      return null;
    }
  }, []);

  /**
   * Remove capture for a source
   */
  const removeCapture = useCallback((sourceId: string) => {
    capturesRef.current.delete(sourceId);
  }, []);

  /**
   * Clear all captures
   */
  const clearAll = useCallback(() => {
    capturesRef.current.clear();
  }, []);

  return {
    captureFrame,
    getImageData,
    removeCapture,
    clearAll,
  };
}