/**
 * Source Adapter Factory
 * ======================
 * Creates the appropriate adapter for each source type.
 */

import type { SourceConfig, SourceType } from '@/types';
import { ISourceAdapter, BaseSourceAdapter } from './types';
import { WebcamAdapter } from './webcamAdapter';
import { HLSAdapter, isHLSSupported } from './hlsAdapter';
import { VideoAdapter, ImageAdapter } from './videoAdapter';

/**
 * Create a source adapter for the given source config
 */
export function createSourceAdapter(type: SourceType, _config?: SourceConfig): ISourceAdapter {
  switch (type) {
    case 'webcam':
      return new WebcamAdapter();

    case 'hls-url':
      if (!isHLSSupported()) {
        throw new Error('HLS is not supported in this browser');
      }
      return new HLSAdapter();

    case 'mp4-url':
      return new VideoAdapter();

    case 'local-video':
      return new VideoAdapter();

    case 'local-image':
      return new ImageAdapter();

    case 'rtsp-relay':
    case 'mjpeg':
      throw new Error(`Source type '${type}' is not yet implemented`);

    default:
      throw new Error(`Unknown source type: ${type}`);
  }
}

/**
 * Check if a source type is supported
 */
export function isSourceTypeSupported(type: SourceType): boolean {
  switch (type) {
    case 'webcam':
      return typeof navigator !== 'undefined' && 'mediaDevices' in navigator;

    case 'hls-url':
      return isHLSSupported();

    case 'mp4-url':
    case 'local-video':
    case 'local-image':
      return true;

    case 'rtsp-relay':
    case 'mjpeg':
      return false; // Not yet implemented

    default:
      return false;
  }
}

/**
 * Get human-readable name for source type
 */
export function getSourceTypeName(type: SourceType): string {
  const names: Record<SourceType, string> = {
    'webcam': 'Webcam',
    'mp4-url': 'Video URL',
    'hls-url': 'HLS Stream',
    'local-video': 'Local Video',
    'local-image': 'Local Image',
    'rtsp-relay': 'RTSP Stream',
    'mjpeg': 'MJPEG Stream',
  };
  return names[type] || type;
}

// Re-export types and adapters
export type { ISourceAdapter, BaseSourceAdapter } from './types';
export { WebcamAdapter } from './webcamAdapter';
export { HLSAdapter, isHLSSupported } from './hlsAdapter';
export { VideoAdapter, ImageAdapter } from './videoAdapter';
