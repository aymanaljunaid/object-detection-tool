'use client';

import React, { memo, useCallback, useState, useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  Zap, Loader2, AlertCircle, CheckCircle, ExternalLink, Sparkles, Users,
} from 'lucide-react';
import { initWorkerClient, getWorkerClient } from '@/services/detectionWorkerClient';
import { logger, LOG_CATEGORIES } from '@/lib/utils/logger';

interface DetectionControlPanelProps {
  className?: string;
}

export const DetectionControlPanel = memo(function DetectionControlPanel({
  className = '',
}: DetectionControlPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState<'unloaded' | 'loading' | 'ready' | 'error' | 'demo'>('unloaded');

  const detectionEnabled = useAppStore((state) => state.detectionEnabled);
  const detectionConfig = useAppStore((state) => state.detectionConfig);
  const yoloConfig = useAppStore((state) => state.yoloConfig);
  const faceRecognitionEnabled = useAppStore((state) => state.faceRecognitionEnabled);
  const faceRecognitionStatus = useAppStore((state) => state.faceRecognitionStatus);
  const knownFaces = useAppStore((state) => state.knownFaces);

  const setDetectionEnabled = useAppStore((state) => state.setDetectionEnabled);
  const updateDetectionConfig = useAppStore((state) => state.updateDetectionConfig);
  const updateYOLOConfig = useAppStore((state) => state.updateYOLOConfig);
  const setFaceRecognitionEnabled = useAppStore((state) => state.setFaceRecognitionEnabled);

  useEffect(() => {
    const client = getWorkerClient();
    if (client.isReady()) {
      setModelStatus(client.isDemoMode() ? 'demo' : 'ready');
    }
  }, []);

  const handleEnableDetection = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      setDetectionEnabled(false);
      return;
    }

    if (modelStatus === 'unloaded' || modelStatus === 'error') {
      setIsLoading(true);
      setModelStatus('loading');
      try {
        // Load model inside the Web Worker — main thread never blocks
        const client = await initWorkerClient(yoloConfig);
        setModelStatus(client.isDemoMode() ? 'demo' : 'ready');
        logger.info(LOG_CATEGORIES.DETECTION, client.isDemoMode() ? 'Worker running in demo mode' : 'Worker model loaded');
        setDetectionEnabled(true);
      } catch (error) {
        logger.error(LOG_CATEGORIES.DETECTION, 'Failed to init detection worker', error);
        setModelStatus('error');
      } finally {
        setIsLoading(false);
      }
    } else {
      setDetectionEnabled(true);
    }
  }, [modelStatus, yoloConfig, setDetectionEnabled]);

  const handleTargetFPSChange = useCallback((value: number[]) => {
    updateDetectionConfig({ targetFPS: value[0] });
  }, [updateDetectionConfig]);

  const handleMaxDimensionChange = useCallback((value: number[]) => {
    updateDetectionConfig({ maxFrameDimension: value[0] });
  }, [updateDetectionConfig]);

  const handleConfThresholdChange = useCallback((value: number[]) => {
    updateYOLOConfig({ confThreshold: value[0] / 100 });
  }, [updateYOLOConfig]);

  const handleRotationToggle = useCallback((enabled: boolean) => {
    updateDetectionConfig({ enableRotation: enabled });
  }, [updateDetectionConfig]);

  return (
    <div className={cn('space-y-4 p-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5" />
          <h3 className="font-semibold">Detection</h3>
        </div>
        <div className="flex items-center gap-2">
          {modelStatus === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
          {modelStatus === 'ready' && <CheckCircle className="w-4 h-4 text-green-500" />}
          {modelStatus === 'demo' && <Sparkles className="w-4 h-4 text-amber-500" />}
          {modelStatus === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
          <Switch
            checked={detectionEnabled}
            onCheckedChange={handleEnableDetection}
            disabled={isLoading}
          />
        </div>
      </div>

      {modelStatus === 'unloaded' && !detectionEnabled && (
        <p className="text-sm text-muted-foreground">
          Enable detection to load the YOLOv8 model.
        </p>
      )}

      {modelStatus === 'loading' && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading YOLOv8 model...
        </p>
      )}

      {modelStatus === 'error' && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Model Error</AlertTitle>
          <AlertDescription>Failed to load model. Check console for details.</AlertDescription>
        </Alert>
      )}

      {modelStatus === 'demo' && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-600 dark:text-amber-400">Demo Mode — No Model</AlertTitle>
          <AlertDescription className="text-sm">
            <p className="mb-2">Running with simulated detections. For real detection, export YOLOv8 to ONNX:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs mb-3">
              <li>Install ultralytics: <code className="bg-muted px-1 rounded">pip install ultralytics</code></li>
              <li>Export model: <code className="bg-muted px-1 rounded">yolo export model=yolov8n.pt format=onnx</code></li>
              <li>Move <code className="bg-muted px-1 rounded">yolov8n.onnx</code> to <code className="bg-muted px-1 rounded">public/models/</code></li>
              <li>Refresh page and enable detection</li>
            </ol>
            <div className="flex gap-2 mt-2">
              <Button variant="default" size="sm" className="h-7 text-xs"
                onClick={() => window.open('https://docs.ultralytics.com/modes/export/', '_blank')}>
                <ExternalLink className="w-3 h-3 mr-1" /> Export Guide
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                onClick={() => window.open('https://github.com/ultralytics/ultralytics', '_blank')}>
                <ExternalLink className="w-3 h-3 mr-1" /> Ultralytics Repo
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {(modelStatus === 'ready' || modelStatus === 'demo' || detectionEnabled) && (
        <div className="space-y-4">
          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Target FPS</Label>
              <span className="text-sm text-muted-foreground font-mono">{detectionConfig.targetFPS}</span>
            </div>
            <Slider value={[detectionConfig.targetFPS]} onValueChange={handleTargetFPSChange}
              min={1} max={30} step={1} disabled={!detectionEnabled} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Max Frame Size</Label>
              <span className="text-sm text-muted-foreground font-mono">{detectionConfig.maxFrameDimension}px</span>
            </div>
            <Slider value={[detectionConfig.maxFrameDimension]} onValueChange={handleMaxDimensionChange}
              min={160} max={640} step={32} disabled={!detectionEnabled} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Confidence Threshold</Label>
              <span className="text-sm text-muted-foreground font-mono">{Math.round(yoloConfig.confThreshold * 100)}%</span>
            </div>
            <Slider value={[Math.round(yoloConfig.confThreshold * 100)]} onValueChange={handleConfThresholdChange}
              min={10} max={90} step={5} disabled={!detectionEnabled} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Rotating Detection</Label>
              <p className="text-xs text-muted-foreground">Cycle through cells in grid view</p>
            </div>
            <Switch checked={detectionConfig.enableRotation} onCheckedChange={handleRotationToggle}
              disabled={!detectionEnabled} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <div>
                <Label className="text-sm">Face Recognition</Label>
                <p className="text-xs text-muted-foreground">
                  {knownFaces.length > 0
                    ? `${knownFaces.length} known face${knownFaces.length !== 1 ? 's' : ''} enrolled`
                    : 'Identify known people'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {faceRecognitionStatus === 'loading-models' && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              {faceRecognitionStatus === 'ready' && <CheckCircle className="w-3 h-3 text-green-500" />}
              {faceRecognitionStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
              <Switch checked={faceRecognitionEnabled} onCheckedChange={setFaceRecognitionEnabled}
                disabled={!detectionEnabled} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default DetectionControlPanel;
