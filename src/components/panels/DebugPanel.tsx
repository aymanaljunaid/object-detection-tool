/**
 * Debug Panel Component
 * =====================
 * Shows debugging information and performance metrics.
 */

'use client';

import { memo, useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Activity,
  Cpu,
  Clock,
  Layers,
  Zap,
  ChevronDown,
  ChevronUp,
  Bug,
  Sparkles,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { getWorkerClient } from '@/services/detectionWorkerClient';

interface DebugPanelProps {
  className?: string;
}

export const DebugPanel = memo(function DebugPanel({
  className = '',
}: DebugPanelProps) {
  // Store state
  const debugInfo = useAppStore((state) => state.debugInfo);
  const detectionEnabled = useAppStore((state) => state.detectionEnabled);
  const viewMode = useAppStore((state) => state.viewMode);
  const sourceOrder = useAppStore((state) => state.sourceOrder);
  const isDebugPanelOpen = useAppStore((state) => state.isDebugPanelOpen);

  // Store actions
  const toggleDebugPanel = useAppStore((state) => state.toggleDebugPanel);
  const setDetectionEnabled = useAppStore((state) => state.setDetectionEnabled);

  // Local state for detector info
  const [detectorInfo, setDetectorInfo] = useState<{
    isReady: boolean;
    isDemoMode: boolean;
    isLoading: boolean;
    error: string | null;
  }>({
    isReady: false,
    isDemoMode: false,
    isLoading: false,
    error: null,
  });

  // Update detector info periodically
  useEffect(() => {
    const updateDetectorInfo = () => {
      const client = getWorkerClient();
      setDetectorInfo({
        isReady: client.isReady(),
        isDemoMode: client.isDemoMode(),
        isLoading: !client.isReady(), // Worker doesn't expose isLoading, infer from readiness
        error: null, // Worker doesn't expose error separately
      });
    };

    updateDetectorInfo();
    const interval = setInterval(updateDetectorInfo, 1000);
    return () => clearInterval(interval);
  }, [detectionEnabled]);

  // Format numbers
  const formatNumber = (num: number, decimals = 2): string => {
    return num.toFixed(decimals);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Get memory info
  const getMemoryInfo = (): string => {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      return `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}`;
    }
    return 'N/A';
  };

  // Get real inference count
  const getInferenceCount = (): number => {
    return debugInfo.totalInferenceTime > 0 ? Math.round(debugInfo.totalInferenceTime / 50) : 0;
  };

  return (
    <div className={cn(
      'bg-card border-t',
      isDebugPanelOpen ? 'h-48' : 'h-8',
      'transition-all duration-200',
      className
    )}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-1 cursor-pointer hover:bg-accent/50"
        onClick={toggleDebugPanel}
      >
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4" />
          <span className="text-sm font-medium">Debug Info</span>
        </div>
        <div className="flex items-center gap-2">
          {detectionEnabled && (
            <Badge variant="outline" className={cn(
              "text-xs",
              detectorInfo.isDemoMode 
                ? "border-amber-500 text-amber-500" 
                : "border-green-500 text-green-500"
            )}>
              {detectorInfo.isDemoMode ? (
                <>
                  <Sparkles className="w-3 h-3 mr-1" />
                  Demo Mode
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3 mr-1" />
                  Detection ON
                </>
              )}
            </Badge>
          )}
          {isDebugPanelOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
        </div>
      </div>

      {/* Content */}
      {isDebugPanelOpen && (
        <ScrollArea className="h-40 px-4 pb-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            {/* Sources */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Layers className="w-3 h-3" />
                <span>Sources</span>
              </div>
              <div className="font-mono">
                {debugInfo.activeSources} / {sourceOrder.length}
              </div>
            </div>

            {/* Detection */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Activity className="w-3 h-3" />
                <span>Detection</span>
              </div>
              <div className="font-mono">
                {debugInfo.activeDetections} running
              </div>
            </div>

            {/* Inference */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>Total Inference</span>
              </div>
              <div className="font-mono">
                {formatNumber(debugInfo.totalInferenceTime, 0)}ms
                <span className="text-muted-foreground text-xs ml-1">
                  (~{getInferenceCount()} frames)
                </span>
              </div>
            </div>

            {/* FPS */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Cpu className="w-3 h-3" />
                <span>Avg FPS</span>
              </div>
              <div className={cn(
                "font-mono",
                debugInfo.averageFPS > 0 ? "text-green-500" : "text-muted-foreground"
              )}>
                {debugInfo.averageFPS > 0 ? formatNumber(debugInfo.averageFPS, 1) : '0.0'}
              </div>
            </div>

            {/* Memory */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Activity className="w-3 h-3" />
                <span>Memory</span>
              </div>
              <div className="font-mono text-xs">
                {getMemoryInfo()}
              </div>
            </div>

            {/* View Mode */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Layers className="w-3 h-3" />
                <span>View Mode</span>
              </div>
              <div className="font-mono capitalize">
                {viewMode}
              </div>
            </div>

            {/* Model Status */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Cpu className="w-3 h-3" />
                <span>Model</span>
              </div>
              <div className="font-mono flex items-center gap-1">
                {detectorInfo.isDemoMode ? (
                  <>
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span className="text-amber-500">Demo</span>
                  </>
                ) : detectorInfo.isReady ? (
                  <>
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span className="text-green-500">Ready</span>
                  </>
                ) : detectorInfo.error ? (
                  <>
                    <AlertCircle className="w-3 h-3 text-red-500" />
                    <span className="text-red-500">Error</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Not loaded</span>
                  </>
                )}
              </div>
            </div>

            {/* Last Frame */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>Last Capture</span>
              </div>
              <div className="font-mono text-xs">
                {debugInfo.lastFrameCapture > 0 
                  ? `${Math.round(performance.now() - debugInfo.lastFrameCapture)}ms ago`
                  : 'Never'
                }
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetectionEnabled(!detectionEnabled)}
              className="gap-1"
            >
              {detectionEnabled ? 'Stop Detection' : 'Start Detection'}
            </Button>
          </div>
        </ScrollArea>
      )}
    </div>
  );
});

export default DebugPanel;
