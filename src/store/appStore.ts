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

interface AppState {
  sources: Map<string, SourceWithState>;
  sourceOrder: string[];
  viewMode: ViewMode;
  primarySourceId: string | null;
  gridLayout: GridLayout;
  detectionEnabled: boolean;
  detectionConfig: DetectionSchedulerConfig;
  yoloConfig: YOLOConfig;
  faceRecognitionEnabled: boolean;
  faceRecognitionConfig: FaceRecognitionConfig;
  faceRecognitionStatus: FaceRecognitionStatus;
  knownFaces: FaceIdentity[];
  selectedSourceId: string | null;
  isSourcePanelOpen: boolean;
  isDebugPanelOpen: boolean;
  isFaceMemoryPanelOpen: boolean;
  debugInfo: DebugInfo;
}

interface AppActions {
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
  setViewMode: (mode: ViewMode) => void;
  setPrimarySource: (id: string | null) => void;
  setGridLayout: (layout: GridLayout) => void;
  setDetectionEnabled: (enabled: boolean) => void;
  updateDetectionConfig: (config: Partial<DetectionSchedulerConfig>) => void;
  updateYOLOConfig: (config: Partial<YOLOConfig>) => void;
  setFaceRecognitionEnabled: (enabled: boolean) => void;
  setFaceRecognitionStatus: (status: FaceRecognitionStatus) => void;
  updateFaceRecognitionConfig: (config: Partial<FaceRecognitionConfig>) => void;
  setKnownFaces: (faces: FaceIdentity[]) => void;
  addKnownFace: (face: FaceIdentity) => void;
  updateKnownFace: (id: string, updates: Partial<FaceIdentity>) => void;
  removeKnownFace: (id: string) => void;
  clearAllKnownFaces: () => void;
  setSelectedSource: (id: string | null) => void;
  toggleSourcePanel: () => void;
  toggleDebugPanel: () => void;
  toggleFaceMemoryPanel: () => void;
  updateDebugInfo: (info: Partial<DebugInfo>) => void;
  getSource: (id: string) => SourceWithState | undefined;
  getAllSources: () => SourceWithState[];
  getActiveSources: () => SourceWithState[];
  reset: () => void;
}

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
  faceRecognitionEnabled: false,
  faceRecognitionConfig: { ...DEFAULT_FACE_RECOGNITION_CONFIG },
  faceRecognitionStatus: 'idle',
  knownFaces: [],
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

export const useAppStore = create<AppState & AppActions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    addSource: (config) => {
      const id = nanoid(10);
      const now = Date.now();
      const fullConfig = { ...config, id, createdAt: now, updatedAt: now } as SourceConfig;
      const sourceWithState: SourceWithState = {
        config: fullConfig,
        status: 'idle',
        detectionEnabled: true,
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
          primarySourceId: state.primarySourceId === id ? (newOrder[0] ?? null) : state.primarySourceId,
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
          config: { ...source.config, ...updates, updatedAt: Date.now() } as SourceConfig,
        });
        return { sources: newSources };
      });
    },

    updateSourceStatus: (id, status) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;
        const newSources = new Map(state.sources);
        newSources.set(id, { ...source, status });
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
        return { sources: newSources };
      });
    },

    updateDetectionStatus: (id, status) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;
        if (source.detectionStatus === status) return state;
        const newSources = new Map(state.sources);
        newSources.set(id, { ...source, detectionStatus: status });
        return { sources: newSources };
      });
    },

    updatePlaybackState: (id, stateUpdates) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;
        const newSources = new Map(state.sources);
        const existingPlayback = source.playbackState;
        // Type assertion needed because stateUpdates is partial but we merge with complete object
        const newPlayback: PlaybackState = existingPlayback
          ? { ...existingPlayback, ...stateUpdates } as PlaybackState
          : {
              sourceId: id,
              status: 'idle' as const,
              currentTime: 0,
              duration: 0,
              volume: 1,
              muted: false,
              playbackRate: 1,
              isLive: false,
              buffered: null,
              error: null,
              ...stateUpdates,
            } as PlaybackState;
        newSources.set(id, { ...source, playbackState: newPlayback });
        return { sources: newSources };
      });
    },

    updateDetections: (id, result) => {
      const state = get();
      const source = state.sources.get(id);
      if (!source) return;
      const newSources = new Map(state.sources);
      newSources.set(id, { ...source, lastDetections: result });
      set({ sources: newSources });
    },

    setSourceError: (id, error) => {
      set((state) => {
        const source = state.sources.get(id);
        if (!source) return state;
        const newSources = new Map(state.sources);
        newSources.set(id, { ...source, error, status: error ? 'error' : source.status });
        if (error) logger.error(LOG_CATEGORIES.SOURCE, `Error for ${id}`, { error });
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
        if (src) newSources.set(id, { ...src, generation: newGeneration });
        return { sources: newSources };
      });
      return newGeneration;
    },

    reorderSources: (newOrder) => set({ sourceOrder: newOrder }),

    setViewMode: (mode) => {
      set((state) => {
        const newDetectionConfig = {
          ...state.detectionConfig,
          targetFPS: mode === 'single'
            ? DEFAULT_DETECTION_CONFIG.singleModeTargetFPS
            : DEFAULT_DETECTION_CONFIG.gridModeTargetFPS,
        };
        return { viewMode: mode, detectionConfig: newDetectionConfig };
      });
    },

    setPrimarySource: (id) => {
      set((state) => {
        if (id !== null && !state.sources.has(id)) return state;
        return { primarySourceId: id };
      });
    },

    setGridLayout: (layout) => set({ gridLayout: layout }),

    setDetectionEnabled: (enabled) => {
      set({ detectionEnabled: enabled });
    },

    updateDetectionConfig: (config) => {
      set((state) => ({ detectionConfig: { ...state.detectionConfig, ...config } }));
    },

    updateYOLOConfig: (config) => {
      set((state) => ({ yoloConfig: { ...state.yoloConfig, ...config } }));
    },

    setFaceRecognitionEnabled: (enabled) => {
      set({ faceRecognitionEnabled: enabled });
    },

    setFaceRecognitionStatus: (status) => set({ faceRecognitionStatus: status }),

    updateFaceRecognitionConfig: (config) => {
      set((state) => ({ faceRecognitionConfig: { ...state.faceRecognitionConfig, ...config } }));
    },

    setKnownFaces: (faces) => set({ knownFaces: faces }),

    addKnownFace: (face) => {
      set((state) => ({ knownFaces: [...state.knownFaces, face] }));
    },

    updateKnownFace: (id, updates) => {
      set((state) => ({
        knownFaces: state.knownFaces.map((face) =>
          face.id === id ? { ...face, ...updates, updatedAt: Date.now() } : face
        ),
      }));
    },

    removeKnownFace: (id) => {
      set((state) => ({ knownFaces: state.knownFaces.filter((face) => face.id !== id) }));
    },

    clearAllKnownFaces: () => set({ knownFaces: [] }),

    setSelectedSource: (id) => {
      set((state) => {
        if (id !== null && !state.sources.has(id)) return state;
        return { selectedSourceId: id };
      });
    },

    toggleSourcePanel: () => set((state) => ({ isSourcePanelOpen: !state.isSourcePanelOpen })),
    toggleDebugPanel: () => set((state) => ({ isDebugPanelOpen: !state.isDebugPanelOpen })),
    toggleFaceMemoryPanel: () => set((state) => ({ isFaceMemoryPanelOpen: !state.isFaceMemoryPanelOpen })),

    updateDebugInfo: (info) => {
      set((state) => ({ debugInfo: { ...state.debugInfo, ...info } }));
    },

    getSource: (id) => get().sources.get(id),

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
    return source && source.status === 'playing' && source.detectionEnabled ? [source] : [];
  }
  return selectActiveSources(state).filter((s) => s.status === 'playing' && s.detectionEnabled);
};

export function createSourceGenerationToken(sourceId: string): {
  token: ReturnType<typeof createGenerationToken>;
  generation: number;
} {
  const state = useAppStore.getState();
  const source = state.sources.get(sourceId);
  const generation = source?.generation ?? 0;
  return { token: createGenerationToken(), generation };
}

export function isCurrentGeneration(sourceId: string, generation: number): boolean {
  const state = useAppStore.getState();
  const source = state.sources.get(sourceId);
  return source?.generation === generation;
}
