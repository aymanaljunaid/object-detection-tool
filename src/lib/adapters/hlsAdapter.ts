/**
 * HLS Source Adapter
 * ==================
 * Handles HLS stream playback using HLS.js.
 * Supports direct HLS URLs.
 */

import Hls from 'hls.js';
import { BaseSourceAdapter, InitResult } from './types';
import type { HLSSourceConfig, SourceConfig, PlaybackError } from '@/types';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';
import { PLAYBACK_CONFIG } from '@/lib/constants';

export class HLSAdapter extends BaseSourceAdapter {
  private hlsUrl: string = '';

  override async initialize(
    videoElement: HTMLVideoElement,
    config: SourceConfig,
    signal: AbortSignal
  ): Promise<InitResult> {
    const hlsConfig = config as HLSSourceConfig;
    this.videoElement = videoElement;

    // Get URL from config
    if (hlsConfig.type === 'hls-url') {
      this.hlsUrl = hlsConfig.url;
    } else {
      throw new Error('No HLS URL provided');
    }

    this.isLive = true;

    logger.debug(LOG_CATEGORIES.HLS, 'Initializing HLS stream', { url: this.hlsUrl });

    // Check for cancellation
    if (signal.aborted) {
      throw new Error('Initialization cancelled');
    }

    return new Promise((resolve, reject) => {
      // Track whether the promise has already been settled to guard
      // against reject() being called after resolve() (Bug 13 fix).
      let settled = false;
      const safeReject = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };
      const safeResolve = (value: InitResult) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      // Check if native HLS is supported (Safari)
      if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        logger.debug(LOG_CATEGORIES.HLS, 'Using native HLS support');
        
        videoElement.src = this.hlsUrl;
        
        const onLoadedMetadata = () => {
          videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoElement.removeEventListener('error', onError);
          
          videoElement.play()
            .then(() => {
              safeResolve({
                videoElement,
                isLive: true,
              });
            })
            .catch(safeReject);
        };
        
        const onError = (_e: Event) => {
          videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoElement.removeEventListener('error', onError);
          
          const error: PlaybackError = {
            message: 'Failed to load HLS stream',
            type: 'source',
            recoverable: true,
          };
          safeReject(error);
        };
        
        videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.addEventListener('error', onError);
        
        signal.addEventListener('abort', () => {
          videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoElement.removeEventListener('error', onError);
          safeReject(new Error('Initialization cancelled'));
        });
        
        return;
      }

      // Use HLS.js
      if (!Hls.isSupported()) {
        safeReject(new Error('HLS is not supported in this browser'));
        return;
      }

      const hls = new Hls({
        ...PLAYBACK_CONFIG.hls,
        xhrSetup: (_xhr) => {
          // Can add headers here if needed
        },
      });

      this.hlsInstance = hls;

      // Bug 13 fix: wrap the error handler in try/catch and use safeReject so
      // that (a) errors thrown inside the switch don't propagate unhandled, and
      // (b) reject is never called after the Promise has already been resolved.
      hls.on(Hls.Events.ERROR, (_event: string, data: unknown) => {
        const errData = data as { fatal: boolean; type: string; details?: string };
        logger.error(LOG_CATEGORIES.HLS, 'HLS error', errData);

        if (errData.fatal) {
          try {
            switch (errData.type) {
              case 'networkError':
                logger.warn(LOG_CATEGORIES.HLS, 'Network error, attempting recovery');
                hls.startLoad();
                break;
              case 'mediaError':
                logger.warn(LOG_CATEGORIES.HLS, 'Media error, attempting recovery');
                hls.recoverMediaError();
                break;
              default: {
                const error: PlaybackError = {
                  message: errData.details || 'Fatal HLS error',
                  type: 'network',
                  recoverable: false,
                };
                safeReject(error);
                break;
              }
            }
          } catch (handlerErr) {
            logger.error(LOG_CATEGORIES.HLS, 'Error in HLS error handler', handlerErr);
            safeReject(handlerErr);
          }
        }
      });

      // Handle manifest loaded
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        logger.debug(LOG_CATEGORIES.HLS, 'HLS manifest parsed');
        
        if (signal.aborted) {
          hls.destroy();
          safeReject(new Error('Initialization cancelled'));
          return;
        }

        videoElement.play()
          .then(() => {
            safeResolve({
              videoElement,
              hlsInstance: hls,
              isLive: true,
            });
          })
          .catch(safeReject);
      });

      // Listen for abort
      signal.addEventListener('abort', () => {
        hls.destroy();
        safeReject(new Error('Initialization cancelled'));
      });

      // Load source
      hls.loadSource(this.hlsUrl);
      hls.attachMedia(videoElement);
    });
  }

  override cleanup(): void {
    if (this.hlsInstance) {
      const hls = this.hlsInstance as Hls;
      hls.destroy();
      this.hlsInstance = null;
    }
    super.cleanup();
  }
}

/**
 * Check if HLS is supported
 */
export function isHLSSupported(): boolean {
  // Native HLS (Safari) or HLS.js support
  return typeof document !== 'undefined' && 
    (document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '' ||
     Hls.isSupported());
}
