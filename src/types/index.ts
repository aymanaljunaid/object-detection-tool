/**
 * Core Type Definitions for Multi-Source Object Detection App
 * ============================================================
 * This file contains all the fundamental types used throughout the application.
 * Types are organized by domain: Source, Detection, Playback, and UI.
 */

// ============================================================================
// SOURCE TYPES
// ============================================================================

/**
 * Supported source types for video/image input
 */
export type SourceType =
  | 'webcam'
  | 'mp4-url'
  | 'hls-url'
  | 'local-video'
  | 'local-image'
  // Future-ready placeholders
  | 'rtsp-relay'
  | 'mjpeg';

/**
 * Source status states for lifecycle management
 */
export type SourceStatus =
  | 'idle'
  | 'initializing'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'error'
  | 'ended';

/**
 * Detection status for a source
 */
export type DetectionStatus =
  | 'inactive'
  | 'loading-model'
  | 'active'
  | 'paused'
  | 'error';

/**
 * Base source configuration
 */
export interface BaseSourceConfig {
  id: string;
  name: string;
  type: SourceType;
  createdAt: number;
  updatedAt: number;
}

/**
 * Webcam source configuration
 */
export interface WebcamSourceConfig extends BaseSourceConfig {
  type: 'webcam';
  deviceId?: string;
  constraints?: MediaTrackConstraints;
}

/**
 * Direct MP4 URL source configuration
 */
export interface MP4UrlSourceConfig extends BaseSourceConfig {
  type: 'mp4-url';
  url: string;
}

/**
 * HLS stream source configuration
 */
export interface HLSSourceConfig extends BaseSourceConfig {
  type: 'hls-url';
  url: string;
}

/**
 * Local video source configuration
 */
export interface LocalVideoSourceConfig extends BaseSourceConfig {
  type: 'local-video';
  file?: File;
  objectUrl?: string;
}

/**
 * Local image source configuration
 */
export interface LocalImageSourceConfig extends BaseSourceConfig {
  type: 'local-image';
  file?: File;
  objectUrl?: string;
}

/**
 * Union type of all source configurations
 */
export type SourceConfig =
  | WebcamSourceConfig
  | MP4UrlSourceConfig
  | HLSSourceConfig
  | LocalVideoSourceConfig
  | LocalImageSourceConfig;

// ============================================================================
// DETECTION TYPES
// ============================================================================

/**
 * Dimensions interface for width/height
 */
export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Bounding box in normalized coordinates [0, 1]
 */
export interface BoundingBox {
  x: number; // Center X (normalized)
  y: number; // Center Y (normalized)
  width: number; // Width (normalized)
  height: number; // Height (normalized)
}

/**
 * Single detection result
 */
export interface Detection {
  id: string;
  classId: number;
  className: string;
  confidence: number;
  bbox: BoundingBox;
  // Pixel coordinates for rendering (computed during overlay)
  pixelBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // Face recognition data (only for person detections)
  faceRecognition?: {
    identityId: string | null;
    identityName: string | null;
    confidence: number;
  };
}

/**
 * Frame detection results
 */
export interface DetectionResult {
  sourceId: string;
  timestamp: number;
  detections: Detection[];
  inferenceTime: number; // ms
  frameSize: { width: number; height: number };
  modelInputSize: { width: number; height: number };
}

/**
 * YOLOv8 model configuration
 */
export interface YOLOConfig {
  modelPath: string;
  inputSize: number; // e.g., 640 for 640x640
  confThreshold: number;
  iouThreshold: number;
  maxDetections: number;
}

/**
 * Detection scheduler configuration
 */
export interface DetectionSchedulerConfig {
  targetFPS: number;
  maxFrameDimension: number; // Downscale before inference
  enableRotation: boolean; // For grid mode
  rotationInterval: number; // ms between cell rotations
  pauseOnHidden: boolean;
}

// ============================================================================
// PLAYBACK TYPES
// ============================================================================

/**
 * Playback state for a source
 */
export interface PlaybackState {
  sourceId: string;
  status: SourceStatus;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  isLive: boolean;
  buffered: TimeRanges | null;
  error: PlaybackError | null;
}

/**
 * Playback error
 */
export interface PlaybackError {
  code?: number;
  message: string;
  type: 'network' | 'decode' | 'source' | 'permission' | 'unknown';
  recoverable: boolean;
}

/**
 * Video frame capture options
 */
export interface FrameCaptureOptions {
  maxDimension: number;
  format: 'canvas' | 'bitmap';
  quality: number;
}

/**
 * Captured frame data
 */
export interface CapturedFrame {
  sourceId: string;
  timestamp: number;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

// ============================================================================
// UI TYPES
// ============================================================================

/**
 * View mode
 */
export type ViewMode = 'single' | 'grid';

/**
 * Grid layout configuration
 */
export interface GridLayout {
  columns: number;
  rows: number;
  cellCount: number;
}

/**
 * Cell status for UI display
 */
export interface CellStatus {
  sourceId: string;
  sourceStatus: SourceStatus;
  detectionStatus: DetectionStatus;
  isPrimary: boolean;
  error?: string;
  fps?: number;
  detectionFPS?: number;
}

/**
 * App-level debug info
 */
export interface DebugInfo {
  activeSources: number;
  activeDetections: number;
  totalInferenceTime: number;
  averageFPS: number;
  memoryUsage?: number;
  lastFrameCapture: number;
}

// ============================================================================
// STORE TYPES
// ============================================================================

/**
 * Source with runtime state
 */
export interface SourceWithState {
  config: SourceConfig;
  status: SourceStatus;
  detectionEnabled: boolean; // Per-source detection toggle
  detectionStatus: DetectionStatus;
  playbackState: PlaybackState | null;
  lastDetections: DetectionResult | null;
  error: string | null;
  generation: number; // For async cancellation
}

/**
 * App store state
 */
export interface AppStore {
  // Source management
  sources: Map<string, SourceWithState>;
  sourceOrder: string[]; // Display order

  // View management
  viewMode: ViewMode;
  primarySourceId: string | null;
  gridLayout: GridLayout;

  // Detection management
  detectionEnabled: boolean;
  detectionConfig: DetectionSchedulerConfig;
  yoloConfig: YOLOConfig;

  // UI state
  selectedSourceId: string | null;
  isSourcePanelOpen: boolean;
  isDebugPanelOpen: boolean;

  // Debug info
  debugInfo: DebugInfo;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Internal event types for cross-component communication
 */
export type AppEventType =
  | 'source:added'
  | 'source:removed'
  | 'source:status-changed'
  | 'source:error'
  | 'playback:started'
  | 'playback:stopped'
  | 'playback:error'
  | 'detection:started'
  | 'detection:stopped'
  | 'detection:result'
  | 'detection:error'
  | 'view:mode-changed'
  | 'grid:layout-changed';

/**
 * Internal event payload
 */
export interface AppEvent {
  type: AppEventType;
  payload: unknown;
  timestamp: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Generation token for async cancellation
 */
export interface GenerationToken {
  id: string;
  cancelled: boolean;
  cancel: () => void;
}

/**
 * Async operation result
 */
export type AsyncResult<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Deep partial type for config updates
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ============================================================================
// NEW SOURCE CONFIG TYPES (for creating sources without id/timestamps)
// ============================================================================

/**
 * Helper type for creating new sources - removes id and timestamps while preserving discriminator
 */
export type NewSourceConfig =
  | Omit<WebcamSourceConfig, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<MP4UrlSourceConfig, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<HLSSourceConfig, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<LocalVideoSourceConfig, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<LocalImageSourceConfig, 'id' | 'createdAt' | 'updatedAt'>;

// ============================================================================
// FACE RECOGNITION TYPES (re-exported from face.ts)
// ============================================================================

export type {
  FaceEmbedding,
  FaceSample,
  FaceIdentity,
  FaceDetection,
  FaceRecognitionResult,
  FaceRecognitionConfig,
  FaceRecognitionStatus,
  EnrollmentResult,
  FaceMatch,
} from './face';

export { DEFAULT_FACE_RECOGNITION_CONFIG } from './face';
