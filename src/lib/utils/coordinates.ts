/**
 * Coordinate Mapping Utility
 * ==========================
 * Handles all coordinate transformations between different spaces:
 * - Source video frame (original resolution)
 * - Capture frame (potentially downscaled)
 * - Model input (e.g., 640x640)
 * - Display element (video element size)
 * - Canvas overlay (pixel coordinates)
 * 
 * CRITICAL: This module ensures detection boxes align correctly with objects.
 */

export interface Dimensions {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LetterboxInfo {
  paddingX: number;
  paddingY: number;
  scaleX: number;
  scaleY: number;
  targetDimensions: Dimensions;
}

/**
 * Calculate aspect ratio
 */
export function calculateAspectRatio(width: number, height: number): number {
  return width / height;
}

/**
 * Calculate scaled dimensions to fit within max bounds while preserving aspect ratio
 */
export function calculateScaledDimensions(
  original: Dimensions,
  maxDimensions: Dimensions
): Dimensions {
  const aspectRatio = original.width / original.height;
  
  if (original.width <= maxDimensions.width && original.height <= maxDimensions.height) {
    return { ...original };
  }
  
  if (aspectRatio > maxDimensions.width / maxDimensions.height) {
    // Width constrained
    return {
      width: maxDimensions.width,
      height: Math.round(maxDimensions.width / aspectRatio),
    };
  } else {
    // Height constrained
    return {
      width: Math.round(maxDimensions.height * aspectRatio),
      height: maxDimensions.height,
    };
  }
}

/**
 * Calculate letterbox parameters for fitting source into target with padding
 * This is how YOLOv8 typically resizes images - preserving aspect ratio with padding
 */
export function calculateLetterbox(
  sourceDimensions: Dimensions,
  targetDimensions: Dimensions
): LetterboxInfo {
  const sourceAspect = sourceDimensions.width / sourceDimensions.height;
  const targetAspect = targetDimensions.width / targetDimensions.height;
  
  let scaleX: number;
  let scaleY: number;
  let paddingX = 0;
  let paddingY = 0;
  
  if (sourceAspect > targetAspect) {
    // Source is wider - pad top and bottom
    scaleX = targetDimensions.width / sourceDimensions.width;
    scaleY = scaleX;
    paddingX = 0;
    paddingY = (targetDimensions.height - sourceDimensions.height * scaleY) / 2;
  } else {
    // Source is taller - pad left and right
    scaleY = targetDimensions.height / sourceDimensions.height;
    scaleX = scaleY;
    paddingX = (targetDimensions.width - sourceDimensions.width * scaleX) / 2;
    paddingY = 0;
  }
  
  return {
    paddingX,
    paddingY,
    scaleX,
    scaleY,
    targetDimensions,
  };
}

/**
 * Map a point from source coordinates to target coordinates (with letterbox)
 */
export function mapPointSourceToTarget(
  point: Point,
  letterbox: LetterboxInfo
): Point {
  return {
    x: point.x * letterbox.scaleX + letterbox.paddingX,
    y: point.y * letterbox.scaleY + letterbox.paddingY,
  };
}

/**
 * Map a point from target coordinates back to source coordinates (reverse letterbox)
 */
export function mapPointTargetToSource(
  point: Point,
  letterbox: LetterboxInfo
): Point {
  return {
    x: (point.x - letterbox.paddingX) / letterbox.scaleX,
    y: (point.y - letterbox.paddingY) / letterbox.scaleY,
  };
}

/**
 * Map a bounding box from source coordinates to target coordinates
 */
export function mapRectSourceToTarget(
  rect: Rect,
  letterbox: LetterboxInfo
): Rect {
  const topLeft = mapPointSourceToTarget({ x: rect.x, y: rect.y }, letterbox);
  const bottomRight = mapPointSourceToTarget(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    letterbox
  );
  
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * Map a bounding box from target coordinates back to source coordinates
 */
export function mapRectTargetToSource(
  rect: Rect,
  letterbox: LetterboxInfo
): Rect {
  const topLeft = mapPointTargetToSource({ x: rect.x, y: rect.y }, letterbox);
  const bottomRight = mapPointTargetToSource(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    letterbox
  );
  
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * Convert normalized coordinates [0, 1] to pixel coordinates
 */
export function normalizedToPixel(
  normalized: Rect,
  dimensions: Dimensions
): Rect {
  return {
    x: normalized.x * dimensions.width,
    y: normalized.y * dimensions.height,
    width: normalized.width * dimensions.width,
    height: normalized.height * dimensions.height,
  };
}

/**
 * Convert pixel coordinates to normalized [0, 1]
 */
export function pixelToNormalized(
  pixel: Rect,
  dimensions: Dimensions
): Rect {
  return {
    x: pixel.x / dimensions.width,
    y: pixel.y / dimensions.height,
    width: pixel.width / dimensions.width,
    height: pixel.height / dimensions.height,
  };
}

/**
 * Map detection coordinates through the full pipeline:
 * 1. Detection output is in model input space (e.g., 640x640)
 * 2. Model input may have letterbox padding
 * 3. Source frame was downscaled for capture
 * 4. Display may have different dimensions than source
 * 
 * @param detectionBox - Bounding box from detector (in model input space)
 * @param modelInputSize - Model input dimensions (e.g., 640x640)
 * @param captureSize - Size of captured frame sent to model
 * @param sourceSize - Original video source dimensions
 * @param displaySize - Video element / display dimensions
 */
export function mapDetectionToDisplay(
  detectionBox: Rect,
  modelInputSize: Dimensions,
  captureSize: Dimensions,
  sourceSize: Dimensions,
  displaySize: Dimensions
): Rect {
  // Step 1: Map from model input space to capture frame space
  // The model input is letterboxed, so we need to reverse that
  const letterboxModelToCapture = calculateLetterbox(captureSize, modelInputSize);
  const captureBox = mapRectTargetToSource(detectionBox, letterboxModelToCapture);
  
  // Step 2: Map from capture frame space to source frame space
  // Capture frame is downscaled version of source
  const scaleX = sourceSize.width / captureSize.width;
  const scaleY = sourceSize.height / captureSize.height;
  
  const sourceBox: Rect = {
    x: captureBox.x * scaleX,
    y: captureBox.y * scaleY,
    width: captureBox.width * scaleX,
    height: captureBox.height * scaleY,
  };
  
  // Step 3: Map from source frame space to display space
  // Display may have different dimensions, video element scales with CSS
  const displayScaleX = displaySize.width / sourceSize.width;
  const displayScaleY = displaySize.height / sourceSize.height;
  // Use the same scale for both to preserve aspect ratio (object-fit: contain behavior)
  const displayScale = Math.min(displayScaleX, displayScaleY);
  
  const displayBox: Rect = {
    x: sourceBox.x * displayScale,
    y: sourceBox.y * displayScale,
    width: sourceBox.width * displayScale,
    height: sourceBox.height * displayScale,
  };
  
  // Calculate letterbox offset for display (object-fit: contain centers the video)
  const displayAspect = displaySize.width / displaySize.height;
  const sourceAspect = sourceSize.width / sourceSize.height;
  
  let offsetX = 0;
  let offsetY = 0;
  
  if (displayAspect > sourceAspect) {
    // Display is wider - video is centered with bars on sides
    offsetX = (displaySize.width - sourceSize.width * displayScale) / 2;
  } else {
    // Display is taller - video is centered with bars on top/bottom
    offsetY = (displaySize.height - sourceSize.height * displayScale) / 2;
  }
  
  return {
    x: displayBox.x + offsetX,
    y: displayBox.y + offsetY,
    width: displayBox.width,
    height: displayBox.height,
  };
}

/**
 * Calculate the full coordinate mapping info for a detection pipeline
 */
export function calculateCoordinateMapping(
  sourceSize: Dimensions,
  maxCaptureDimension: number,
  modelInputSize: number
): {
  captureSize: Dimensions;
  letterboxInfo: LetterboxInfo;
  sourceToCaptureScale: number;
} {
  // Calculate capture size (downscaled from source)
  const captureSize = calculateScaledDimensions(
    sourceSize,
    { width: maxCaptureDimension, height: maxCaptureDimension }
  );
  
  // Calculate letterbox for model input
  const letterboxInfo = calculateLetterbox(
    captureSize,
    { width: modelInputSize, height: modelInputSize }
  );
  
  // Calculate source to capture scale
  const sourceToCaptureScale = captureSize.width / sourceSize.width;
  
  return {
    captureSize,
    letterboxInfo,
    sourceToCaptureScale,
  };
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Ensure a rect stays within bounds
 */
export function clampRect(rect: Rect, bounds: Dimensions): Rect {
  return {
    x: clamp(rect.x, 0, bounds.width - 1),
    y: clamp(rect.y, 0, bounds.height - 1),
    width: clamp(rect.width, 1, bounds.width - rect.x),
    height: clamp(rect.height, 1, bounds.height - rect.y),
  };
}
