/**
 * Face Recognition Types
 * ======================
 * Types for local face memory and recognition system.
 */

/**
 * Face embedding vector (128 dimensions from face-api.js)
 */
export type FaceEmbedding = Float32Array;

/**
 * Reusable box type for face detections and recognition results
 */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Single face sample with embedding
 */
export interface FaceSample {
  id: string;
  embedding: FaceEmbedding;
  thumbnail?: string; // Base64 data URL
  capturedAt: number;
  source: 'webcam' | 'upload';
}

/**
 * Stored sample row with identity reference for IndexedDB
 */
export interface StoredFaceSample extends FaceSample {
  identityId: string;
}

/**
 * Known face identity with one or more samples
 */
export interface FaceIdentity {
  id: string;
  name: string;
  samples: FaceSample[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Face detection result from face-api.js
 */
export interface FaceDetection {
  box: FaceBox;
  score: number;
}

/**
 * Face recognition result (matched or unknown)
 */
export interface FaceRecognitionResult {
  detected: boolean;
  identityId: string | null;
  identityName: string | null;
  confidence: number; // 0-1 similarity score
  box: FaceBox;
  // Original detection box in normalized coordinates
  normalizedBox?: FaceBox;
}

/**
 * Face recognition configuration
 */
export interface FaceRecognitionConfig {
  enabled: boolean;
  // Minimum confidence to consider a face detected
  detectionThreshold: number;
  // Maximum distance (Euclidean) to consider a match (lower = stricter)
  recognitionThreshold: number;
  // How often to run face recognition (ms)
  recognitionInterval: number;
  // Minimum face size (pixels) to attempt recognition
  minFaceSize: number;
  // Cache results for this many ms
  cacheTTL: number;
}

/**
 * Face recognition status
 */
export type FaceRecognitionStatus =
  | 'idle'
  | 'loading-models'
  | 'ready'
  | 'error';

/**
 * Enrollment result
 */
export interface EnrollmentResult {
  success: boolean;
  identityId?: string;
  sampleId?: string;
  error?: string;
  faceCount: number;
}

/**
 * Match result for a single face
 */
export interface FaceMatch {
  identityId: string;
  identityName: string;
  distance: number; // lower is better
  confidence: number; // higher is better
}

/**
 * Default face recognition configuration
 */
export const DEFAULT_FACE_RECOGNITION_CONFIG: FaceRecognitionConfig = {
  enabled: false,
  detectionThreshold: 0.5,
  recognitionThreshold: 0.6, // Euclidean distance threshold
  recognitionInterval: 500, // Run every 500ms max
  minFaceSize: 40, // Minimum 40px face
  cacheTTL: 1000, // Cache results for 1 second
};

/**
 * Validate expected 128-d face-api embedding length
 */
export function isValidFaceEmbedding(embedding: Float32Array): boolean {
  return embedding.length === 128;
}

export function assertValidFaceEmbedding(embedding: Float32Array): void {
  if (!isValidFaceEmbedding(embedding)) {
    throw new Error(
      `Invalid face embedding length: ${embedding.length}. Expected 128.`
    );
  }
}
