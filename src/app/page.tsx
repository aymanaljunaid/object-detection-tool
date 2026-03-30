/**
 * Multi-Source Object Detection App
 * ==================================
 * Main application page combining all components.
 *
 * Features:
 * - Single/Grid view modes
 * - Multiple source types (webcam, URL, HLS, local files)
 * - Real-time YOLOv8 object detection
 * - Detection overlay rendering
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { MultiCameraGrid } from '@/components/camera/MultiCameraGrid';
import { SourceManagerPanel } from '@/components/panels/SourceManagerPanel';
import { DetectionControlPanel } from '@/components/panels/DetectionControlPanel';
import { FaceMemoryPanel } from '@/components/panels/FaceMemoryPanel';
import { DebugPanel } from '@/components/panels/DebugPanel';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  Video,
  PanelLeft,
  Bug,
  Moon,
  Sun,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkerClient } from '@/services/detectionWorkerClient';

export default function HomePage() {
  // Store state
  const sourceOrder = useAppStore((state) => state.sourceOrder);
  const detectionEnabled = useAppStore((state) => state.detectionEnabled);
  const isSourcePanelOpen = useAppStore((state) => state.isSourcePanelOpen);

  // Store actions
  const toggleSourcePanel = useAppStore((state) => state.toggleSourcePanel);
  const toggleDebugPanel = useAppStore((state) => state.toggleDebugPanel);

  // Theme state
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Demo mode state - check on initial render and when detection changes
  const [isDemoMode, setIsDemoMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return getWorkerClient().isDemoMode();
    }
    return false;
  });

  // Update demo mode status when detection is enabled
  useEffect(() => {
    if (detectionEnabled) {
      // Use setTimeout to avoid synchronous setState in effect
      const timer = setTimeout(() => {
        setIsDemoMode(getWorkerClient().isDemoMode());
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [detectionEnabled]);

  // Initialize theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Toggle theme
  const toggleTheme = useCallback(() => {
    setIsDarkMode((prev) => !prev);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Video className="w-6 h-6 text-primary" />
          <h1 className="text-lg font-semibold">Object Detection Dashboard</h1>
          {detectionEnabled && (
            <span className={cn(
              "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
              isDemoMode
                ? "bg-amber-500/20 text-amber-500"
                : "bg-green-500/20 text-green-500"
            )}>
              {isDemoMode ? (
                <>
                  <Sparkles className="w-1.5 h-1.5" />
                  Demo Mode
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  Detecting
                </>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {isDarkMode ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </Button>

          {/* Debug toggle */}
          <Button variant="ghost" size="icon" onClick={toggleDebugPanel}>
            <Bug className="w-5 h-5" />
          </Button>

          {/* Source panel toggle (mobile) */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <PanelLeft className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0 flex flex-col h-full bg-card">
              <SourceManagerPanel className="flex-1 min-h-0" />
              <Separator />
              <div className="overflow-y-auto flex-none max-h-[60vh]">
                <DetectionControlPanel />
                <Separator />
                <FaceMemoryPanel />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar (desktop) */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">

          {/*
           * Bug 1 fix: Conditionally render ResizablePanel instead of using CSS
           * `hidden` on it. When the panel is hidden via className only, the
           * ResizablePanelGroup still allocates its defaultSize (20%) as dead
           * space. Removing it from the DOM entirely collapses that space.
           */}
          {isSourcePanelOpen && (
            <ResizablePanel
              defaultSize={20}
              minSize={15}
              maxSize={30}
              className="hidden md:block"
            >
              <div className="h-full flex flex-col border-r bg-card">
                <SourceManagerPanel className="flex-1" />
                <Separator />
                <DetectionControlPanel />
                <Separator />
                <FaceMemoryPanel />
              </div>
            </ResizablePanel>
          )}

          {/* Toggle button */}
          {isSourcePanelOpen && (
            <ResizableHandle className="hidden md:flex" />
          )}

          {/* Main view */}
          <ResizablePanel defaultSize={80} minSize={50}>
            <div className="h-full flex flex-col">
              {/* Camera grid */}
              <div className="flex-1 relative">
                {sourceOrder.length === 0 ? (
                  <EmptyState />
                ) : (
                  <MultiCameraGrid className="h-full" />
                )}
              </div>

              {/* Debug panel */}
              <DebugPanel />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Floating sidebar toggle (desktop) */}
      {!isSourcePanelOpen && (
        <Button
          variant="secondary"
          size="icon"
          className="fixed left-2 top-1/2 -translate-y-1/2 hidden md:flex z-50 shadow-md"
          onClick={toggleSourcePanel}
        >
          <PanelLeft className="w-5 h-5" />
        </Button>
      )}
    </div>
  );
}

/**
 * Empty state when no sources are added
 */
function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Video className="w-8 h-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">No Sources Added</h2>
      <p className="text-muted-foreground max-w-md mb-4">
        Add a video source to start object detection. You can use a webcam,
        video URL, HLS stream, or upload a local file.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        <SourceHint icon="🎥" label="Webcam" />
        <SourceHint icon="🔗" label="Video URL" />
        <SourceHint icon="📡" label="HLS Stream" />
        <SourceHint icon="📁" label="Local File" />
      </div>
      <p className="text-sm text-muted-foreground mt-6">
        Click &quot;Add Source&quot; in the sidebar to get started
      </p>
    </div>
  );
}

/**
 * Source type hint badge
 */
function SourceHint({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted rounded-full text-sm">
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );
}
