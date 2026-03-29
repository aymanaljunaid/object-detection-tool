/**
 * Application Store
 * =================
 * Central state management using Zustand.
 * Manages sources, view mode, detection settings, and UI state.
 * 
 * Design principles:
 * - Immutable updates
 * - Generation-based cancellation support
 * - Per-source state isolation
 * - No React state for frame data
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type {
  SourceConfig,
  SourceWithState,
  SourceStatus,
  DetectionStatus,
  PlaybackState,
  DetectionResult,
  ViewMode,
  GridLayout,
  DetectionSchedulerConfig,
  YOLOConfig,
  DebugInfo,
  NewSourceConfig,
  FaceRecognitionConfig,
  FaceRecognitionStatus,
  FaceIdentity,
} from '@/types';
import { DEFAULT_FACE_RECOGNITION_CONFIG } from '@/types';
import {
  DEFAULT_YOLO_CONFIG,
  DEFAULT_DETECTION_CONFIG,
  GRID_CONFIG,
} from '@/lib/constants';
import { createGenerationToken } from '@/lib/utils/generationToken';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';

// ============================================================================
// STORE STATE INTERFACE
// ============================================================================

interface AppState {
  // Source management
  sources: Map<string, SourceWithState>;
  sourceOrder: string[];

  // View management
  viewMode: ViewMode;
  primarySourceId: string | null;
  gridLayout: GridLayout;

  // Detection management
  detectionEnabled: boolean;
  detectionConfig: DetectionSchedulerConfig;
  yoloConfig: YOLOConfig;

  // Face recognition
  faceRecognitionEnabled: boolean;
  faceRecognitionConfig: FaceRecognitionConfig;
  faceRecognitionStatus: FaceRecognitionStatus;
  knownFaces: FaceIdentity[];

  // UI state
  selectedSourceId: string | null;
  isSourcePanelOpen: boolean;
  isDebugPanelOpen: boolean;
  isFaceMemoryPanelOpen: boolean;

  // Debug info
  debugInfo: DebugInfo;
}

// ============================================================================
// STORE ACTIONS INTERFACE
// ============================================================================

interface AppActions {
  // Source actions
  addSource: (config: NewSourceConfig) => string;
  removeSource: (id: string) => void;
  updateSourceConfig: (id: string, updates: Partial<SourceConfig>) => void;
  updateSourceStatus: (id: string, status: SourceStatus) => void;
  setSourceDetectionEnabled: (id: string, enabled: boolean) => void;
  updateDetectionStatus: (id: string, status: DetectionStatus) => void;
  updatePlaybackState: (id: string, state: Partial<PlaybackState>) => void;
  updateDetections: (id: string, result: DetectionResult) => void;
  setSourceError: (id: string, error: string | null) => void;
  incrementGeneration: (id: string) => number;
  reorderSources: (newOrder: string[]) => void;

  // View actions
  setViewMode: (mode: ViewMode) => void;
  setPrimarySource: (id: string | null) => void;
  setGridLayout: (layout: GridLayout) => void;

  // Detection actions
  setDetectionEnabled: (enabled: boolean) => void;
  updateDetectionConfig: (config: Partial<DetectionSchedulerConfig>) => void;
  updateYOLOConfig: (config: Partial<YOLOConfig>) => void;

  // Face recognition actions
  setFaceRecognitionEnabled: (enabled: boolean) => void;
  setFaceRecognitionStatus: (status: FaceRecognitionStatus) => void;
  updateFaceRecognitionConfig: (config: Partial<FaceRecognitionConfig>) => void;
  setKnownFaces: (faces: FaceIdentity[]) => void;
  addKnownFace: (face: FaceIdentity) => void;
  updateKnownFace: (id: string, updates: Partial<FaceIdentity>) => void;
  removeKnownFace: (id: string) => void;
  clearAllKnownFaces: () => void;

  // UI actions
  setSelectedSource: (id: string | null) => void;
  toggleSourcePanel: () => void;
  toggleDebugPanel: () => void;
  toggleFaceMemoryPanel: () => void;

  // Debug actions
  updateDebugInfo: (info: Partial<DebugInfo>) => void;

  // Utility actions
  getSource: (id: string) => SourceWithState | undefined;
  getAllSources: () => SourceWithState[];
  getActiveSources: () => SourceWithState[];
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: AppState = {
  sources: new Map(),
  sourceOrder: [],
  viewMode: 'single',
  primarySourceId: null,
  gridLayout: {
    columns: GRID_CONFIG.defaultColumns,
    rows: GRID_CONFIG.defaultRows,
    cellCount: GRID_CONFIG.defaultColumns * GRID_CONFIG.defaultRows,
  },
  detectionEnabled: false,
  detectionConfig: {
    targetFPS: DEFAULT_DETECTION_CONFIG.singleModeTargetFPS,
    maxFrameDimension: DEFAULT_DETECTION_CONFIG.maxFrameDimension,
    enableRotation: DEFAULT_DETECTION_CONFIG.enableRotation,
    rotationInterval: DEFAULT_DETECTION_CONFIG.rotationInterval,
    pauseOnHidden: DEFAULT_DETECTION_CONFIG.pauseOnHidden,
  },
  yoloConfig: { ...DEFAULT_YOLO_CONFIG },
  // Face recognition
  faceRecognitionEnabled: false,
  faceRecognitionConfig: { ...DEFAULT_FACE_RECOGNITION_CONFIG },
  faceRecognitionStatus: 'idle',
  knownFaces: [],
  // UI state
  selectedSourceId: null,
  isSourcePanelOpen: true,
  isDebugPanelOpen: false,
  isFaceMemoryPanelOpen: false,
  debugInfo: {
    activeSources: 0,
    activeDetections: 0,
    totalInferenceTime: 0,
    averageFPS: 0,
    lastFrameCapture: 0,
  },
};

// ============================================================================
// STORE CREATION
// ============================================================================

export const useAppStore = create<AppState & AppActions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // ========================================================================
    // SOURCE ACTIONS
    // ========================================================================

    addSource: (config) => {
      const id = nanoid(10);
      const now = Date.now();
      
      const fullConfig = {
        ...config,
        id,
        createdAt: now,
        updatedAt: now,
      } as SourceConfig;

      const sourceWithState: SourceWithState = {
        config: fullConfig,
        status: 'idle',
        detectionEnabled: true, // Detection enabled by default
        detectionStatus: 'inactive',
        playbackState: null,
        lastDetections: null,
        error: null,
        generation: 0,
      };

      set((state) => {
        const newSources = new Map(state.sources);
        newSources.set(id, sourceWithState);
        
        logger.debug(LOG_CATEGORIES.SOURCE, `Added source: ${id}`, { type: config.type });
        
        return {
          sources: newSources,
          sourceOrder: [...state.sourceOrder, id],
          // Auto-select first source as primary
          primarySourceId: state.primarySourceId === null ? id : state.primarySourceId,
        };
      });

      return id;
    },

    removeSource: (id) => {
      set((state) => {
        const newSources = new Map(state.sources);
        newSources.delete(id);
        
        const newOrder = state.sourceOrder.filter((orderId) => orderId !== id);
        
        logger.debug(LOG_CATEGORIES.SOURCE, `Removed source: ${id}`);
        
        return {
          sources: newSources,
          sourceOrder: newOrder,
          primarySourceId: state.primarySourceId === id
            ? (newOrder[0] ?? null)
            : state.primarySourceId,
          selectedSourceId: state.selectedSourceId === id ? null : state.selectedSourceId,
        };
      });
    },

    updateSourceConfig: (id, updates) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;

        const newSources = new Map(state.sources);
        newSources.set(id, {
          ...source,
          config: {
            ...source.config,
            ...updates,
            updatedAt: Date.now(),
          } as SourceConfig,
        });

        return { sources: newSources };
      });
    },

    updateSourceStatus: (id, status) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;

        const newSources = new Map(state.sources);
        newSources.set(id, {
          ...source,
          status,
        });

        logger.debug(LOG_CATEGORIES.SOURCE, `Status updated: ${id}`, { status });
        
        return { sources: newSources };
      });
    },

    setSourceDetectionEnabled: (id, enabled) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;

        const newSources = new Map(state.sources);
        newSources.set(id, {
          ...source,
          detectionEnabled: enabled,
          detectionStatus: enabled ? source.detectionStatus : 'inactive',
        });

        logger.debug(LOG_CATEGORIES.SOURCE, `Detection ${enabled ? 'enabled' : 'disabled'} for source: ${id}`);
        
        return { sources: newSources };
      });
    },

    updateDetectionStatus: (id, status) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;

        const newSources = new Map(state.sources);
        newSources.set(id, {
          ...source,
          detectionStatus: status,
        });

        return { sources: newSources };
      });
    },

    updatePlaybackState: (id, stateUpdates) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;

        const newSources = new Map(state.sources);
        const existingPlayback = source.playbackState;

        // Bug 12 fix: when no playbackState exists yet, provide all required
        // PlaybackState defaults before spreading the incoming updates.
        // Previously the fallback was cast as PlaybackState with missing required
        // fields, causing downstream runtime crashes on first playback update.
        const newPlayback: PlaybackState = existingPlayback
          ? { ...existingPlayback, ...stateUpdates }
          : {
              sourceId: id,
              currentTime: 0,
              duration: 0,
              volume: 1,
              muted: false,
              playbackRate: 1,
              isLive: false,
              buffered: null,
              ...stateUpdates,
            };

        newSources.set(id, {
          ...source,
          playbackState: newPlayback,
        });

        return { sources: newSources };
      });
    },

    updateDetections: (id, result) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;

        const newSources = new Map(state.sources);
        newSources.set(id, {
          ...source,
          lastDetections: result,
        });

        return { sources: newSources };
      });
    },

    setSourceError: (id, error) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;

        const newSources = new Map(state.sources);
        newSources.set(id, {
          ...source,
          error,
          status: error ? 'error' : source.status,
        });

        if (error) {
          logger.error(LOG_CATEGORIES.SOURCE, `Error for ${id}`, { error });
        }

        return { sources: newSources };
      });
    },

    incrementGeneration: (id) => {
      const state = get();
      const source = state.sources.get(id);
      if (!source) return 0;

      const newGeneration = source.generation + 1;
      
      set((s) => {
        const newSources = new Map(s.sources);
        const src = newSources.get(id);
        if (src) {
          newSources.set(id, {
            ...src,
            generation: newGeneration,
          });
        }
        return { sources: newSources };
      });

      return newGeneration;
    },

    reorderSources: (newOrder) => {
      set({ sourceOrder: newOrder });
    },

    // ========================================================================
    // VIEW ACTIONS
    // ========================================================================

    setViewMode: (mode) => {
      set((state) => {
        logger.debug(LOG_CATEGORIES.STATE, `View mode changed: ${mode}`);
        
        // Adjust detection config based on view mode
        const newDetectionConfig = {
          ...state.detectionConfig,
          targetFPS: mode === 'single'
            ? DEFAULT_DETECTION_CONFIG.singleModeTargetFPS
            : DEFAULT_DETECTION_CONFIG.gridModeTargetFPS,
        };
        
        return {
          viewMode: mode,
          detectionConfig: newDetectionConfig,
        };
      });
    },

    setPrimarySource: (id) => {
      set((state) => {
        if (id !== null && !state.sources.has(id)) {
          logger.warn(LOG_CATEGORIES.STATE, `Cannot set primary to non-existent source: ${id}`);
          return state;
        }
        return { primarySourceId: id };
      });
    },

    setGridLayout: (layout) => {
      set({ gridLayout: layout });
    },

    // ========================================================================
    // DETECTION ACTIONS
    // ========================================================================

    setDetectionEnabled: (enabled) => {
      set((state) => {
        logger.debug(LOG_CATEGORIES.DETECTION, `Detection ${enabled ? 'enabled' : 'disabled'}`);
        return { detectionEnabled: enabled };
      });
    },

    updateDetectionConfig: (config) => {
      set((state) => ({
        detectionConfig: { ...state.detectionConfig, ...config },
      }));
    },

    updateYOLOConfig: (config) => {
      set((state) => ({
        yoloConfig: { ...state.yoloConfig, ...config },
      }));
    },

    // ========================================================================
    // FACE RECOGNITION ACTIONS
    // ========================================================================

    setFaceRecognitionEnabled: (enabled) => {
      set((state) => {
        logger.debug(LOG_CATEGORIES.DETECTION, `Face recognition ${enabled ? 'enabled' : 'disabled'}`);
        return { faceRecognitionEnabled: enabled };
      });
    },

    setFaceRecognitionStatus: (status) => {
      set({ faceRecognitionStatus: status });
    },

    updateFaceRecognitionConfig: (config) => {
      set((state) => ({
        faceRecognitionConfig: { ...state.faceRecognitionConfig, ...config },
      }));
    },

    setKnownFaces: (faces) => {
      set({ knownFaces: faces });
    },

    addKnownFace: (face) => {
      set((state) => ({
        knownFaces: [...state.knownFaces, face],
      }));
      logger.debug(LOG_CATEGORIES.DETECTION, `Added known face: ${face.name}`);
    },

    updateKnownFace: (id, updates) => {
      set((state) => ({
        knownFaces: state.knownFaces.map((face) =>
          face.id === id ? { ...face, ...updates, updatedAt: Date.now() } : face
        ),
      }));
    },

    removeKnownFace: (id) => {
      set((state) => ({
        knownFaces: state.knownFaces.filter((face) => face.id !== id),
      }));
      logger.debug(LOG_CATEGORIES.DETECTION, `Removed known face: ${id}`);
    },

    clearAllKnownFaces: () => {
      set({ knownFaces: [] });
      logger.debug(LOG_CATEGORIES.DETECTION, 'Cleared all known faces');
    },

    // ========================================================================
    // UI ACTIONS
    // ========================================================================

    setSelectedSource: (id) => {
      set((state) => {
        if (id !== null && !state.sources.has(id)) return state;
        return { selectedSourceId: id };
      });
    },

    toggleSourcePanel: () => {
      set((state) => ({ isSourcePanelOpen: !state.isSourcePanelOpen }));
    },

    toggleDebugPanel: () => {
      set((state) => ({ isDebugPanelOpen: !state.isDebugPanelOpen }));
    },

    toggleFaceMemoryPanel: () => {
      set((state) => ({ isFaceMemoryPanelOpen: !state.isFaceMemoryPanelOpen }));
    },

    // ========================================================================
    // DEBUG ACTIONS
    // ========================================================================

    updateDebugInfo: (info) => {
      set((state) => ({
        debugInfo: { ...state.debugInfo, ...info },
      }));
    },

    // ========================================================================
    // UTILITY ACTIONS
    // ========================================================================

    getSource: (id) => {
      return get().sources.get(id);
    },

    getAllSources: () => {
      const state = get();
      return state.sourceOrder.map((id) => state.sources.get(id)!).filter(Boolean);
    },

    getActiveSources: () => {
      const state = get();
      return state.sourceOrder
        .map((id) => state.sources.get(id)!)
        .filter((source) => source && ['ready', 'playing', 'paused'].includes(source.status));
    },

    reset: () => {
      set(initialState);
      logger.info(LOG_CATEGORIES.STATE, 'Store reset');
    },
  }))
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectSourceById = (id: string) => (state: AppState) => state.sources.get(id);

export const selectAllSources = (state: AppState) => 
  state.sourceOrder.map((id) => state.sources.get(id)!).filter(Boolean);

export const selectActiveSources = (state: AppState) =>
  state.sourceOrder
    .map((id) => state.sources.get(id)!)
    .filter((source) => source && ['ready', 'playing', 'paused'].includes(source.status));

export const selectPrimarySource = (state: AppState) =>
  state.primarySourceId ? state.sources.get(state.primarySourceId) : undefined;

export const selectSourcesForDetection = (state: AppState) => {
  if (!state.detectionEnabled) return [];
  
  if (state.viewMode === 'single' && state.primarySourceId) {
    const source = state.sources.get(state.primarySourceId);
    // Check both global detection enabled and per-source detection enabled
    return source && source.status === 'playing' && source.detectionEnabled ? [source] : [];
  }
  
  // Grid mode: all active sources with detection enabled
  return selectActiveSources(state).filter((s) => s.status === 'playing' && s.detectionEnabled);
};

// ============================================================================
// GENERATION TOKEN HELPER
// ============================================================================

/**
 * Create a cancellation token tied to a source's generation
 * Returns the token and current generation number
 */
export function createSourceGenerationToken(sourceId: string): {
  token: ReturnType<typeof createGenerationToken>;
  generation: number;
} {
  const state = useAppStore.getState();
  const source = state.sources.get(sourceId);
  const generation = source?.generation ?? 0;
  
  return {
    token: createGenerationToken(),
    generation,
  };
}

/**
 * Check if the current generation matches (for async operation validation)
 */
export function isCurrentGeneration(sourceId: string, generation: number): boolean {
  const state = useAppStore.getState();
  const source = state.sources.get(sourceId);
  return source?.generation === generation;
}
