/**
 * usePlayback Hook
 * ================
 * Main hook for managing video playback lifecycle.
 * Handles adapter creation, initialization, cleanup, and state updates.
 * 
 * Key features:
 * - Generation-based async cancellation
 * - Automatic cleanup on unmount
 * - State updates to store
 * - Error handling
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { createSourceAdapter, ISourceAdapter } from '@/lib/adapters';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';
import type { SourceConfig, SourceStatus, PlaybackError } from '@/types';

interface UsePlaybackOptions {
  sourceId: string;
  config: SourceConfig;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  autoPlay?: boolean;
}

interface UsePlaybackResult {
  status: SourceStatus;
  error: string | null;
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  restart: () => void;
}

export function usePlayback({
  sourceId,
  config,
  videoRef,
  autoPlay = true,
}: UsePlaybackOptions): UsePlaybackResult {
  const adapterRef = useRef<ISourceAdapter | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef<number>(0);
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store actions
  const updateSourceStatus = useAppStore((state) => state.updateSourceStatus);
  const setSourceError = useAppStore((state) => state.setSourceError);
  const updatePlaybackState = useAppStore((state) => state.updatePlaybackState);
  const incrementGeneration = useAppStore((state) => state.incrementGeneration);

  // Get current source state
  const source = useAppStore((state) => state.sources.get(sourceId));
  const status = source?.status ?? 'idle';
  const error = source?.error ?? null;

  /**
   * Cleanup function - destroys adapter and resets state
   */
  const cleanup = useCallback(() => {
    logger.debug(LOG_CATEGORIES.PLAYBACK, `Cleaning up playback: ${sourceId}`);

    // Clear update interval
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }

    // Destroy adapter
    if (adapterRef.current) {
      adapterRef.current.cleanup();
      adapterRef.current = null;
    }

    // Abort any pending initialization
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [sourceId]);

  /**
   * Initialize playback
   */
  const initialize = useCallback(async () => {
    if (!videoRef.current) {
      logger.warn(LOG_CATEGORIES.PLAYBACK, `Video ref not ready for ${sourceId}`);
      return;
    }

    // Cleanup any existing playback
    cleanup();

    // Create new abort controller for this initialization
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Increment generation for cancellation tracking
    const generation = incrementGeneration(sourceId);
    generationRef.current = generation;

    logger.debug(LOG_CATEGORIES.PLAYBACK, `Initializing playback: ${sourceId}`, {
      type: config.type,
      generation,
    });

    // Update status
    updateSourceStatus(sourceId, 'initializing');

    try {
      // Create adapter for this source type
      const adapter = createSourceAdapter(config.type, config);
      adapterRef.current = adapter;

      // Initialize the adapter
      const result = await adapter.initialize(
        videoRef.current,
        config,
        abortController.signal
      );

      // Check if still current generation (not cancelled)
      if (generationRef.current !== generation || abortController.signal.aborted) {
        logger.debug(LOG_CATEGORIES.PLAYBACK, `Initialization cancelled for ${sourceId}`);
        adapter.cleanup();
        adapterRef.current = null;
        return;
      }

      // Update status and playback state
      updateSourceStatus(sourceId, 'ready');
      updatePlaybackState(sourceId, {
        sourceId,
        status: 'ready',
        currentTime: 0,
        duration: result.videoElement.duration || 0,
        volume: result.videoElement.volume,
        muted: result.videoElement.muted,
        playbackRate: result.videoElement.playbackRate,
        isLive: result.isLive,
        buffered: null,
        error: null,
      });

      // Start playback state updates
      updateIntervalRef.current = setInterval(() => {
        if (adapterRef.current && videoRef.current) {
          const playbackState = adapterRef.current.getPlaybackState();
          updatePlaybackState(sourceId, {
            ...playbackState,
            sourceId,
          } as any);
        }
      }, 500);

      logger.debug(LOG_CATEGORIES.PLAYBACK, `Playback initialized: ${sourceId}`);
    } catch (err) {
      // Check if cancelled
      if (abortController.signal.aborted || generationRef.current !== generation) {
        logger.debug(LOG_CATEGORIES.PLAYBACK, `Initialization cancelled for ${sourceId}`);
        return;
      }

      const playbackError = err as PlaybackError;
      const errorMessage = playbackError.message || 'Unknown initialization error';
      
      logger.error(LOG_CATEGORIES.PLAYBACK, `Initialization failed for ${sourceId}`, {
        error: errorMessage,
      });

      updateSourceStatus(sourceId, 'error');
      setSourceError(sourceId, errorMessage);
      adapterRef.current = null;
    }
  }, [sourceId, config, videoRef, cleanup, updateSourceStatus, updatePlaybackState, incrementGeneration, setSourceError]);

  /**
   * Restart playback (re-initialize)
   */
  const restart = useCallback(() => {
    initialize();
  }, [initialize]);

  /**
   * Control functions
   */
  const play = useCallback(async () => {
    if (adapterRef.current) {
      try {
        await adapterRef.current.play();
        updateSourceStatus(sourceId, 'playing');
      } catch (err) {
        logger.error(LOG_CATEGORIES.PLAYBACK, `Play failed for ${sourceId}`, err);
      }
    }
  }, [sourceId, updateSourceStatus]);

  const pause = useCallback(() => {
    if (adapterRef.current) {
      adapterRef.current.pause();
      updateSourceStatus(sourceId, 'paused');
    }
  }, [sourceId, updateSourceStatus]);

  const seek = useCallback((time: number) => {
    if (adapterRef.current) {
      adapterRef.current.seek(time);
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (adapterRef.current) {
      adapterRef.current.setVolume(volume);
      updatePlaybackState(sourceId, { volume });
    }
  }, [sourceId, updatePlaybackState]);

  const setMuted = useCallback((muted: boolean) => {
    if (adapterRef.current) {
      adapterRef.current.setMuted(muted);
      updatePlaybackState(sourceId, { muted });
    }
  }, [sourceId, updatePlaybackState]);

  // Initialize on mount and when config changes
  useEffect(() => {
    if (autoPlay) {
      initialize();
    }

    return () => {
      cleanup();
    };
  }, [sourceId, config.id, autoPlay, initialize, cleanup]);

  // Setup video element event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      updateSourceStatus(sourceId, 'playing');
    };

    const handlePause = () => {
      updateSourceStatus(sourceId, 'paused');
    };

    const handleEnded = () => {
      updateSourceStatus(sourceId, 'ended');
    };

    const handleError = () => {
      const mediaError = video.error;
      if (mediaError) {
        setSourceError(sourceId, `Video error: ${mediaError.message}`);
        updateSourceStatus(sourceId, 'error');
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [sourceId, videoRef, updateSourceStatus, setSourceError]);

  return {
    status,
    error,
    play,
    pause,
    seek,
    setVolume,
    setMuted,
    restart,
  };
}
