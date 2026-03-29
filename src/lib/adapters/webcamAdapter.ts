/**
 * Webcam Source Adapter
 * =====================
 * Handles webcam initialization and streaming.
 */

import { BaseSourceAdapter, InitResult } from './types';
import type { WebcamSourceConfig, SourceConfig, PlaybackError } from '@/types';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';

export class WebcamAdapter extends BaseSourceAdapter {
  private deviceId: string | undefined;

  override async initialize(
    videoElement: HTMLVideoElement,
    config: SourceConfig,
    signal: AbortSignal
  ): Promise<InitResult> {
    const webcamConfig = config as WebcamSourceConfig;
    this.videoElement = videoElement;
    this.deviceId = webcamConfig.deviceId;
    this.isLive = true;

    logger.debug(LOG_CATEGORIES.WEBCAM, `Initializing webcam: ${this.deviceId || 'default'}`);

    // Check for cancellation
    if (signal.aborted) {
      throw new Error('Initialization cancelled');
    }

    try {
      // Request camera access
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user',
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Check for cancellation after async operation
      if (signal.aborted) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Initialization cancelled');
      }

      this.mediaStream = stream;
      videoElement.srcObject = stream;
      
      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        const onLoadedMetadata = () => {
          videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoElement.removeEventListener('error', onError);
          resolve();
        };
        
        const onError = (e: Event) => {
          videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoElement.removeEventListener('error', onError);
          reject(new Error('Failed to load webcam stream'));
        };
        
        videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.addEventListener('error', onError);
        
        // Also listen for abort
        signal.addEventListener('abort', () => {
          videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoElement.removeEventListener('error', onError);
          reject(new Error('Initialization cancelled'));
        });
      });

      // Start playback
      await videoElement.play();

      logger.debug(LOG_CATEGORIES.WEBCAM, 'Webcam initialized successfully', {
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      });

      return {
        videoElement,
        mediaStream: stream,
        isLive: true,
      };
    } catch (error) {
      const playbackError: PlaybackError = {
        message: error instanceof Error ? error.message : 'Unknown webcam error',
        type: 'permission',
        recoverable: false,
      };

      if (error instanceof Error && error.name === 'NotAllowedError') {
        playbackError.message = 'Camera access denied. Please allow camera access in your browser settings.';
        playbackError.type = 'permission';
      } else if (error instanceof Error && error.name === 'NotFoundError') {
        playbackError.message = 'No camera found. Please connect a camera and try again.';
        playbackError.type = 'source';
      }

      throw playbackError;
    }
  }

  /**
   * Get available webcam devices
   */
  static async getAvailableDevices(): Promise<MediaDeviceInfo[]> {
    try {
      // Request permission first
      await navigator.mediaDevices.getUserMedia({ video: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'videoinput');
    } catch (error) {
      logger.error(LOG_CATEGORIES.WEBCAM, 'Failed to enumerate devices', error);
      return [];
    }
  }
}
