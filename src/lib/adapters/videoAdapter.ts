/**
 * Video Source Adapter
 * ====================
 * Handles direct video URLs (MP4) and local video/image files.
 */

import { BaseSourceAdapter, InitResult } from './types';
import type {
  MP4UrlSourceConfig,
  LocalVideoSourceConfig,
  LocalImageSourceConfig,
  SourceConfig,
  PlaybackError,
} from '@/types';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';

export class VideoAdapter extends BaseSourceAdapter {
  private videoUrl: string = '';
  private objectUrl: string | null = null;

  override async initialize(
    videoElement: HTMLVideoElement,
    config: SourceConfig,
    signal: AbortSignal
  ): Promise<InitResult> {
    this.videoElement = videoElement;

    // Get URL from config
    if (config.type === 'mp4-url') {
      this.videoUrl = (config as MP4UrlSourceConfig).url;
    } else if (config.type === 'local-video') {
      const localConfig = config as LocalVideoSourceConfig;
      if (localConfig.objectUrl) {
        this.videoUrl = localConfig.objectUrl;
        this.objectUrl = localConfig.objectUrl;
      } else if (localConfig.file) {
        this.objectUrl = URL.createObjectURL(localConfig.file);
        this.videoUrl = this.objectUrl;
      } else {
        throw new Error('No video file provided');
      }
    } else {
      throw new Error('Invalid source type for VideoAdapter');
    }

    logger.debug(LOG_CATEGORIES.PLAYBACK, 'Initializing video source', { url: this.videoUrl });

    // Check for cancellation
    if (signal.aborted) {
      this.cleanupObjectUrl();
      throw new Error('Initialization cancelled');
    }

    return new Promise((resolve, reject) => {
      const onCanPlay = () => {
        videoElement.removeEventListener('canplay', onCanPlay);
        videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.removeEventListener('error', onError);
        
        videoElement.play()
          .then(() => {
            resolve({
              videoElement,
              isLive: false,
            });
          })
          .catch(reject);
      };

      const onLoadedMetadata = () => {
        logger.debug(LOG_CATEGORIES.PLAYBACK, 'Video metadata loaded', {
          duration: videoElement.duration,
          width: videoElement.videoWidth,
          height: videoElement.videoHeight,
        });
      };

      const onError = (e: Event) => {
        videoElement.removeEventListener('canplay', onCanPlay);
        videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.removeEventListener('error', onError);

        const mediaError = videoElement.error;
        let message = 'Failed to load video';
        let type: PlaybackError['type'] = 'source';

        if (mediaError) {
          switch (mediaError.code) {
            case MediaError.MEDIA_ERR_ABORTED:
              message = 'Video loading was aborted';
              type = 'unknown';
              break;
            case MediaError.MEDIA_ERR_NETWORK:
              message = 'Network error while loading video';
              type = 'network';
              break;
            case MediaError.MEDIA_ERR_DECODE:
              message = 'Video decoding error';
              type = 'decode';
              break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              message = 'Video format not supported';
              type = 'source';
              break;
          }
        }

        const error: PlaybackError = {
          message,
          type,
          recoverable: type === 'network',
        };

        reject(error);
      };

      videoElement.addEventListener('canplay', onCanPlay);
      videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
      videoElement.addEventListener('error', onError);

      // Listen for abort
      signal.addEventListener('abort', () => {
        videoElement.removeEventListener('canplay', onCanPlay);
        videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.removeEventListener('error', onError);
        this.cleanupObjectUrl();
        reject(new Error('Initialization cancelled'));
      });

      // Set source and load
      videoElement.src = this.videoUrl;
      videoElement.load();
    });
  }

  private cleanupObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  override cleanup(): void {
    this.cleanupObjectUrl();
    super.cleanup();
  }
}

/**
 * Image Source Adapter
 * Handles static images with a simulated "video" playback.
 */
export class ImageAdapter extends BaseSourceAdapter {
  private imageUrl: string = '';
  private objectUrl: string | null = null;
  private canvasElement: HTMLCanvasElement | null = null;

  override async initialize(
    videoElement: HTMLVideoElement,
    config: SourceConfig,
    signal: AbortSignal
  ): Promise<InitResult> {
    if (config.type !== 'local-image') {
      throw new Error('Invalid source type for ImageAdapter');
    }

    const imageConfig = config as LocalImageSourceConfig;
    this.videoElement = videoElement;

    if (imageConfig.objectUrl) {
      this.imageUrl = imageConfig.objectUrl;
      this.objectUrl = imageConfig.objectUrl;
    } else if (imageConfig.file) {
      this.objectUrl = URL.createObjectURL(imageConfig.file);
      this.imageUrl = this.objectUrl;
    } else {
      throw new Error('No image file provided');
    }

    logger.debug(LOG_CATEGORIES.PLAYBACK, 'Initializing image source', { url: this.imageUrl });

    if (signal.aborted) {
      this.cleanupObjectUrl();
      throw new Error('Initialization cancelled');
    }

    // For images, we use a canvas to render and treat it like a video
    // The video element will show the image
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        if (signal.aborted) {
          this.cleanupObjectUrl();
          reject(new Error('Initialization cancelled'));
          return;
        }

        // Create a canvas to draw the image
        this.canvasElement = document.createElement('canvas');
        this.canvasElement.width = img.naturalWidth;
        this.canvasElement.height = img.naturalHeight;
        
        const ctx = this.canvasElement.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to create canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0);

        // Use canvas as video source
        const stream = this.canvasElement.captureStream(1); // 1 fps
        this.mediaStream = stream;
        
        videoElement.srcObject = stream;
        
        videoElement.onloadedmetadata = () => {
          videoElement.play()
            .then(() => {
              resolve({
                videoElement,
                mediaStream: stream,
                isLive: false,
              });
            })
            .catch(reject);
        };

        videoElement.onerror = () => {
          reject(new Error('Failed to initialize image playback'));
        };
      };

      img.onerror = () => {
        this.cleanupObjectUrl();
        reject(new Error('Failed to load image'));
      };

      // Listen for abort
      signal.addEventListener('abort', () => {
        img.onload = null;
        img.onerror = null;
        this.cleanupObjectUrl();
        reject(new Error('Initialization cancelled'));
      });

      img.src = this.imageUrl;
    });
  }

  private cleanupObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  override cleanup(): void {
    this.cleanupObjectUrl();
    if (this.canvasElement) {
      this.canvasElement = null;
    }
    super.cleanup();
  }
}
