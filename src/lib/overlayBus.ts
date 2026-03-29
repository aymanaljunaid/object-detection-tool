/**
 * overlayBus.ts
 * Lightweight per-source event bus.
 * Scheduler calls draw() directly when results arrive —
 * no Zustand -> React re-render chain for canvas painting.
 */
import type { DetectionResult } from '@/types';

type DrawFn = (result: DetectionResult) => void;

const listeners = new Map<string, DrawFn>();

export const overlayBus = {
  register(sourceId: string, fn: DrawFn) {
    listeners.set(sourceId, fn);
  },
  unregister(sourceId: string) {
    listeners.delete(sourceId);
  },
  emit(sourceId: string, result: DetectionResult) {
    listeners.get(sourceId)?.(result);
  },
};
