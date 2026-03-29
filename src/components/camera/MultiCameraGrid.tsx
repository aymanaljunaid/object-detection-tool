/**
 * Multi-Camera Grid Component
 * ===========================
 * Displays multiple camera cells in a grid layout.
 * Handles view mode switching and cell selection.
 */

'use client';

import React, { memo, useMemo, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useDetectionScheduler } from '@/hooks/useDetectionScheduler';
import { CamCell } from './CamCell';
import { GRID_CONFIG } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { LayoutGrid, Maximize2 } from 'lucide-react';
import type { GridLayout } from '@/types';

interface MultiCameraGridProps {
  className?: string;
}

/**
 * Calculate grid layout based on cell count
 */
function calculateGridLayout(cellCount: number): GridLayout {
  if (cellCount <= 1) {
    return { columns: 1, rows: 1, cellCount };
  }
  
  if (cellCount <= 2) {
    return { columns: 2, rows: 1, cellCount };
  }
  
  if (cellCount <= 4) {
    return { columns: 2, rows: 2, cellCount };
  }
  
  if (cellCount <= 6) {
    return { columns: 3, rows: 2, cellCount };
  }
  
  if (cellCount <= 9) {
    return { columns: 3, rows: 3, cellCount };
  }
  
  if (cellCount <= 12) {
    return { columns: 4, rows: 3, cellCount };
  }
  
  return { columns: 4, rows: 4, cellCount: Math.min(cellCount, GRID_CONFIG.maxCells) };
}

/**
 * Empty cell placeholder
 */
const EmptyCell = memo(function EmptyCell() {
  return (
    <div className="relative bg-muted rounded-lg overflow-hidden min-h-[200px] flex items-center justify-center border-2 border-dashed border-muted-foreground/30">
      <p className="text-muted-foreground text-sm">Add a source</p>
    </div>
  );
});

/**
 * MultiCameraGrid Component
 */
export const MultiCameraGrid = memo(function MultiCameraGrid({
  className = '',
}: MultiCameraGridProps) {
  // Store state
  const viewMode = useAppStore((state) => state.viewMode);
  const sourceOrder = useAppStore((state) => state.sourceOrder);
  const primarySourceId = useAppStore((state) => state.primarySourceId);
  const gridLayout = useAppStore((state) => state.gridLayout);
  const detectionEnabled = useAppStore((state) => state.detectionEnabled);

  // Store actions
  const setViewMode = useAppStore((state) => state.setViewMode);
  const setPrimarySource = useAppStore((state) => state.setPrimarySource);
  
  // Detection scheduler - get the register function
  const { registerVideoRef } = useDetectionScheduler();

  // Calculate layout
  const layout = useMemo(() => {
    if (viewMode === 'single') {
      return { columns: 1, rows: 1, cellCount: 1 };
    }
    return calculateGridLayout(sourceOrder.length);
  }, [viewMode, sourceOrder.length]);

  // Get visible sources
  const visibleSources = useMemo(() => {
    if (viewMode === 'single') {
      return primarySourceId ? [primarySourceId] : sourceOrder.slice(0, 1);
    }
    return sourceOrder.slice(0, layout.columns * layout.rows);
  }, [viewMode, primarySourceId, sourceOrder, layout]);

  // Calculate empty cells
  const emptyCellCount = useMemo(() => {
    if (viewMode === 'single') return 0;
    const totalCells = layout.columns * layout.rows;
    return Math.max(0, totalCells - visibleSources.length);
  }, [viewMode, layout, visibleSources.length]);

  // Handle cell selection
  const handleCellSelect = useCallback((sourceId: string) => {
    if (viewMode === 'grid') {
      setPrimarySource(sourceId);
    }
  }, [viewMode, setPrimarySource]);

  // Handle double-click to enter single mode
  const handleCellDoubleClick = useCallback((sourceId: string) => {
    setPrimarySource(sourceId);
    setViewMode('single');
  }, [setPrimarySource, setViewMode]);

  return (
    <div className={cn('relative w-full h-full', className)}>
      {/* View mode indicator */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
        <ViewModeToggle />
        {detectionEnabled && (
          <span className="bg-green-500/80 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            Detection Active
          </span>
        )}
      </div>

      {/* Grid container */}
      <div
        className="grid gap-2 h-full p-2"
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, 1fr)`,
          gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
        }}
      >
        {/* Source cells */}
        {visibleSources.map((sourceId) => (
          <div
            key={sourceId}
            onDoubleClick={() => handleCellDoubleClick(sourceId)}
          >
            <CamCell
              sourceId={sourceId}
              isPrimary={sourceId === primarySourceId}
              onSelect={() => handleCellSelect(sourceId)}
              registerVideoRef={registerVideoRef}
              className="w-full h-full"
            />
          </div>
        ))}

        {/* Empty cells */}
        {Array.from({ length: emptyCellCount }).map((_, index) => (
          <EmptyCell key={`empty-${index}`} />
        ))}
      </div>
    </div>
  );
});

/**
 * View mode toggle component
 */
const ViewModeToggle = memo(function ViewModeToggle() {
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);

  return (
    <div className="bg-black/70 rounded-lg p-1 flex items-center gap-1">
      <button
        onClick={() => setViewMode('single')}
        className={cn(
          'p-1.5 rounded text-white transition-colors',
          viewMode === 'single' ? 'bg-white/20' : 'hover:bg-white/10'
        )}
        title="Single view"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => setViewMode('grid')}
        className={cn(
          'p-1.5 rounded text-white transition-colors',
          viewMode === 'grid' ? 'bg-white/20' : 'hover:bg-white/10'
        )}
        title="Grid view"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
});

export default MultiCameraGrid;