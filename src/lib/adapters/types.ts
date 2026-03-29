/**
 * Source Adapter Interface
 * ========================
 * Abstract interface for different video source types.
 * Each adapter handles source-specific initialization and cleanup.
 */

import type { SourceConfig, PlaybackState, PlaybackError } from '@/types';

/**
 * Result of source initialization
 */
export interface InitResult {
  videoElement: HTMLVideoElement;
  mediaStream?: MediaStream;
  hlsInstance?: unknown; // HLS.js instance
  isLive: boolean;
}

/**
 * Source adapter interface
 */
export interface ISourceAdapter {
  /**
   * Initialize the video source
   * Returns the video element and any associated resources
   */
  initialize(
    videoElement: HTMLVideoElement,
    config: SourceConfig,
    signal: AbortSignal
  ): Promise<InitResult>;

  /**
   * Cleanup resources when source is removed
   */
  cleanup(): void;

  /**
   * Get current playback state
   */
  getPlaybackState(): Partial<PlaybackState>;

  /**
   * Play the video
   */
  play(): Promise<void>;

  /**
   * Pause the video
   */
  pause(): void;

  /**
   * Seek to a time position
   */
  seek(time: number): void;

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void;

  /**
   * Set muted state
   */
  setMuted(muted: boolean): void;
}

/**
 * Base adapter with common video element handling
 */
export abstract class BaseSourceAdapter implements ISourceAdapter {
  protected videoElement: HTMLVideoElement | null = null;
  protected mediaStream: MediaStream | null = null;
  protected hlsInstance: unknown = null;
  protected isLive = false;

  abstract initialize(
    videoElement: HTMLVideoElement,
    config: SourceConfig,
    signal: AbortSignal
  ): Promise<InitResult>;

  cleanup(): void {
    // Stop media stream if any
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Destroy HLS instance if any
    const hls = this.hlsInstance as { destroy: () => void } | null;
    if (hls && typeof hls.destroy === 'function') {
      hls.destroy();
      this.hlsInstance = null;
    }

    // Clear video element
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement.src = '';
      this.videoElement.load();
      this.videoElement = null;
    }
  }

  getPlaybackState(): Partial<PlaybackState> {
    if (!this.videoElement) {
      return {};
    }

    const video = this.videoElement;
    return {
      currentTime: video.currentTime,
      duration: video.duration || 0,
      volume: video.volume,
      muted: video.muted,
      playbackRate: video.playbackRate,
      isLive: this.isLive,
      buffered: video.buffered,
    };
  }

  async play(): Promise<void> {
    if (this.videoElement) {
      await this.videoElement.play();
    }
  }

  pause(): void {
    if (this.videoElement) {
      this.videoElement.pause();
    }
  }

  seek(time: number): void {
    if (this.videoElement) {
      this.videoElement.currentTime = time;
    }
  }

  setVolume(volume: number): void {
    if (this.videoElement) {
      this.videoElement.volume = Math.max(0, Math.min(1, volume));
    }
  }

  setMuted(muted: boolean): void {
    if (this.videoElement) {
      this.videoElement.muted = muted;
    }
  }
}
