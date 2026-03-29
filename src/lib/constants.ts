/**
 * Application Constants and Default Configurations
 * ================================================
 * Central location for all configuration values and defaults.
 */

// ============================================================================
// YOLOV8 DETECTION CONFIGURATION
// ============================================================================

export const DEFAULT_YOLO_CONFIG = {
  // Model path relative to public folder
  modelPath: '/models/yolov8n.onnx',
  // Input size for the model (640x640 is standard for YOLOv8n)
  inputSize: 640,
  // Confidence threshold for detections
  confThreshold: 0.25,
  // IoU threshold for NMS
  iouThreshold: 0.45,
  // Maximum detections per frame
  maxDetections: 100,
} as const;

// ============================================================================
// DETECTION SCHEDULER CONFIGURATION
// ============================================================================

export const DEFAULT_DETECTION_CONFIG = {
  // Target detection FPS in single view mode
  singleModeTargetFPS: 10,
  // Target detection FPS in grid view mode (total across all cells)
  gridModeTargetFPS: 6,
  // Maximum frame dimension before inference (downscale for performance)
  maxFrameDimension: 320,
  // Enable rotating detection in grid mode
  enableRotation: true,
  // Rotation interval in ms (time spent on each cell before moving to next)
  rotationInterval: 500,
  // Pause detection when tab is hidden
  pauseOnHidden: true,
  // Minimum time between detections per source (ms)
  minDetectionInterval: 100,
} as const;

// ============================================================================
// PLAYBACK CONFIGURATION
// ============================================================================

export const PLAYBACK_CONFIG = {
  // Default volume
  defaultVolume: 1.0,
  // Default playback rate
  defaultPlaybackRate: 1.0,
  // HLS.js configuration
  hls: {
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 90,
    maxBufferLength: 30,
    maxMaxBufferLength: 600,
    maxBufferSize: 60 * 1000 * 1000, // 60MB
    maxBufferHole: 0.5,
    startLevel: -1, // Auto
  },
  // Video element constraints
  video: {
    playsInline: true,
    muted: true, // Start muted for autoplay
    preload: 'auto' as const,
  },
} as const;

// ============================================================================
// GRID LAYOUT CONFIGURATION
// ============================================================================

export const GRID_CONFIG = {
  // Default grid layout
  defaultColumns: 2,
  defaultRows: 2,
  // Maximum cells supported
  maxCells: 16,
  // Minimum cell size in pixels
  minCellWidth: 200,
  minCellHeight: 150,
  // Cell gap in pixels
  cellGap: 8,
  // Aspect ratio for cells (width / height)
  cellAspectRatio: 16 / 9,
} as const;


// ============================================================================
// COCO CLASS LABELS
// ============================================================================

export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush'
] as const;

// ============================================================================
// UI CONFIGURATION
// ============================================================================

export const UI_CONFIG = {
  // Detection overlay styling
  overlay: {
    boxColor: '#00ff00',
    boxLineWidth: 2,
    labelBackgroundColor: 'rgba(0, 255, 0, 0.7)',
    labelTextColor: '#000000',
    labelFontSize: 12,
    labelPadding: 4,
  },
  // Status indicator colors
  statusColors: {
    idle: '#6b7280',
    initializing: '#3b82f6',
    loading: '#3b82f6',
    ready: '#10b981',
    playing: '#10b981',
    paused: '#f59e0b',
    error: '#ef4444',
    ended: '#6b7280',
  },
  // Detection status colors
  detectionColors: {
    inactive: '#6b7280',
    'loading-model': '#3b82f6',
    active: '#10b981',
    paused: '#f59e0b',
    error: '#ef4444',
  },
  // Sidebar width
  sidebarWidth: 320,
  // Debug panel height
  debugPanelHeight: 200,
} as const;

// ============================================================================
// DEBUG CONFIGURATION
// ============================================================================

export const DEBUG_CONFIG = {
  // Enable debug logging
  enableLogging: process.env.NODE_ENV === 'development',
  // Log prefix
  logPrefix: '[DetectionApp]',
  // Performance monitoring
  enablePerformanceMonitoring: true,
  // Memory monitoring interval (ms)
  memoryMonitorInterval: 5000,
} as const;

// ============================================================================
// INDEXED DB CONFIGURATION
// ============================================================================

export const DB_CONFIG = {
  dbName: 'detection-app-db',
  dbVersion: 1,
  stores: {
    sources: 'sources',
    detections: 'detections',
    settings: 'settings',
  },
} as const;
