'use client';

import React, { useRef, useEffect, useCallback, memo, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { usePlayback } from '@/hooks/usePlayback';
import { DetectionOverlay, DetectionStats } from '@/components/detection/DetectionOverlay';
import { UI_CONFIG } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Play, Pause, AlertCircle, Loader2, Radio, Video, Volume2, VolumeX } from 'lucide-react';
import type { SourceWithState, SourceConfig } from '@/types';

interface CamCellProps {
  sourceId: string;
  isPrimary?: boolean;
  onSelect?: () => void;
  registerVideoRef?: (sourceId: string, video: HTMLVideoElement | null) => void;
  className?: string;
}

const StatusIndicator = memo(function StatusIndicator({ status, detectionStatus }: { status: string; detectionStatus: string }) {
  const statusColors = UI_CONFIG.statusColors;
  const detectionColors = UI_CONFIG.detectionColors;

  return (
    <div className="absolute top-2 right-2 flex items-center gap-2">
      {detectionStatus === 'active' && (
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: detectionColors[detectionStatus as keyof typeof detectionColors] }}
        />
      )}
      <span
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: statusColors[status as keyof typeof statusColors] || statusColors.idle }}
        title={status}
      />
    </div>
  );
});

const ErrorOverlay = memo(function ErrorOverlay({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-4">
      <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
      <p className="text-sm text-center mb-2">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:opacity-90">
          Retry
        </button>
      )}
    </div>
  );
});

const LoadingOverlay = memo(function LoadingOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white">
      <Loader2 className="w-8 h-8 animate-spin mb-2" />
      <p className="text-sm">Loading...</p>
    </div>
  );
});

export const CamCell = memo(function CamCell({
  sourceId,
  isPrimary = false,
  onSelect,
  registerVideoRef,
  className = '',
}: CamCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isMuted, setIsMuted] = useState(true);

  const source = useAppStore((state) => state.sources.get(sourceId));
  const detectionEnabled = useAppStore((state) => state.detectionEnabled);

  const setPrimarySource = useAppStore((state) => state.setPrimarySource);

  const { status, error, play, pause, restart } = usePlayback({
    sourceId,
    config: source?.config as SourceConfig,
    videoRef,
    autoPlay: true,
  });

  useEffect(() => {
    if (registerVideoRef && videoRef.current) {
      registerVideoRef(sourceId, videoRef.current);
    }
    return () => {
      if (registerVideoRef) registerVideoRef(sourceId, null);
    };
  }, [sourceId, registerVideoRef]);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions((prev) => {
          if (Math.abs(prev.width - rect.width) < 2 && Math.abs(prev.height - rect.height) < 2) return prev;
          return { width: rect.width, height: rect.height };
        });
      }
    };

    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const handleClick = useCallback(() => {
    if (onSelect) {
      onSelect();
    } else {
      setPrimarySource(sourceId);
    }
  }, [onSelect, setPrimarySource, sourceId]);

  const handlePlayPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (status === 'playing') { pause(); } else { play(); }
  }, [status, play, pause]);

  const handleMuteToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (video) {
      video.muted = !video.muted;
      setIsMuted(video.muted);
    }
  }, []);

  const handleRetry = useCallback(() => restart(), [restart]);

  if (!source) {
    return (
      <div className={cn('relative bg-muted rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]', className)}>
        <p className="text-muted-foreground">No source</p>
      </div>
    );
  }

  const config = source.config;
  const playbackState = source.playbackState;
  const detectionStatus = source.detectionStatus;
  const isLive = playbackState?.isLive ?? false;
  const sourceDetectionEnabled = source.detectionEnabled;
  const shouldShowDetection = detectionEnabled && sourceDetectionEnabled && status === 'playing' && dimensions.width > 0;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className={cn('relative bg-black rounded-lg overflow-hidden cursor-pointer group', isPrimary && 'ring-2 ring-primary', className)}
    >
      <video ref={videoRef} className="w-full h-full object-contain" playsInline muted autoPlay />

      {shouldShowDetection && (
        <DetectionOverlay sourceId={sourceId} videoWidth={dimensions.width} videoHeight={dimensions.height} />
      )}

      <StatusIndicator status={status} detectionStatus={detectionStatus} />

      <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 text-white text-xs px-2 py-1 rounded">
        {isLive ? <Radio className="w-3 h-3 text-red-500" /> : <Video className="w-3 h-3" />}
        <span className="truncate max-w-[100px]">{config.name}</span>
      </div>

      {shouldShowDetection && <DetectionStats sourceId={sourceId} />}

      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={handlePlayPause} className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors">
              {status === 'playing' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button onClick={handleMuteToggle} className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
          {!isLive && playbackState && (
            <span className="text-xs text-white/80 font-mono">
              {formatTime(playbackState.currentTime)} / {formatTime(playbackState.duration)}
            </span>
          )}
        </div>
      </div>

      {status === 'initializing' && <LoadingOverlay />}
      {status === 'error' && error && <ErrorOverlay error={error} onRetry={handleRetry} />}
    </div>
  );
});

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default CamCell;
