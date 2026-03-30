/**
 * Source Manager Panel
 * ====================
 * UI panel for managing video sources.
 * Supports adding, removing, and editing sources of various types.
 */

'use client';

import { useState, useCallback, memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Plus,
  Trash2,
  Video,
  Radio,
  Upload,
  Webcam,
  Link,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SourceType, NewSourceConfig } from '@/types';

// ============================================================================
// TYPES
// ============================================================================

interface AddSourceFormData {
  type: SourceType;
  name: string;
  url: string;
  file: File | null;
}

const initialFormData: AddSourceFormData = {
  type: 'webcam',
  name: '',
  url: '',
  file: null,
};

// ============================================================================
// SOURCE TYPE CONFIG
// ============================================================================

const SOURCE_TYPES: { type: SourceType; label: string; icon: React.ReactNode; description: string }[] = [
  { type: 'webcam', label: 'Webcam', icon: <Webcam className="w-4 h-4" />, description: 'Local camera device' },
  { type: 'mp4-url', label: 'Video URL', icon: <Video className="w-4 h-4" />, description: 'Direct MP4 video link' },
  { type: 'hls-url', label: 'HLS Stream', icon: <Radio className="w-4 h-4" />, description: 'HLS/M3U8 stream URL' },
  { type: 'local-video', label: 'Local Video', icon: <Upload className="w-4 h-4" />, description: 'Upload a video file' },
  { type: 'local-image', label: 'Local Image', icon: <Upload className="w-4 h-4" />, description: 'Upload an image file' },
];

// ============================================================================
// SOURCE ITEM COMPONENT
// ============================================================================

interface SourceItemProps {
  sourceId: string;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  isSelected: boolean;
  isPrimary: boolean;
}

const SourceItem = memo(function SourceItem({
  sourceId,
  onRemove,
  onSelect,
  isSelected,
  isPrimary,
}: SourceItemProps) {
  const source = useAppStore((state) => state.sources.get(sourceId));
  const setSourceDetectionEnabled = useAppStore((state) => state.setSourceDetectionEnabled);

  if (!source) return null;

  const config = source.config;
  const status = source.status;
  const detectionEnabled = source.detectionEnabled;

  const getSourceTypeIcon = () => {
    switch (config.type) {
      case 'webcam': return <Webcam className="w-4 h-4" />;
      case 'mp4-url': return <Video className="w-4 h-4" />;
      case 'hls-url': return <Radio className="w-4 h-4" />;
      case 'local-video': return <Video className="w-4 h-4" />;
      case 'local-image': return <Upload className="w-4 h-4" />;
      default: return <Link className="w-4 h-4" />;
    }
  };

  const getStatusBadge = () => {
    const statusColors: Record<string, string> = {
      idle: 'bg-gray-500',
      initializing: 'bg-blue-500',
      loading: 'bg-blue-500',
      ready: 'bg-green-500',
      playing: 'bg-green-500',
      paused: 'bg-yellow-500',
      error: 'bg-red-500',
      ended: 'bg-gray-500',
    };

    return (
      <Badge
        variant="secondary"
        className={cn('text-xs', statusColors[status] || 'bg-gray-500')}
      >
        {status}
      </Badge>
    );
  };

  const handleDetectionToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSourceDetectionEnabled(sourceId, !detectionEnabled);
  };

  return (
    <div
      onClick={() => onSelect(sourceId)}
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors',
        'hover:bg-accent',
        isSelected && 'bg-accent',
        isPrimary && 'border border-primary'
      )}
    >
      <div className="flex-shrink-0">{getSourceTypeIcon()}</div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{config.name}</span>
          {isPrimary && (
            <Badge variant="outline" className="text-xs">Primary</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {config.type}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {/* Detection Toggle Button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7',
                  detectionEnabled ? 'text-primary' : 'text-muted-foreground'
                )}
                onClick={handleDetectionToggle}
              >
                {detectionEnabled ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{detectionEnabled ? 'Detection ON' : 'Detection OFF'}</p>
              <p className="text-xs text-muted-foreground">Click to toggle</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {getStatusBadge()}
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 className="w-3 h-3 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Source</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove &quot;{config.name}&quot;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onRemove(sourceId)}
                className="bg-destructive text-destructive-foreground"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
});

// ============================================================================
// ADD SOURCE DIALOG
// ============================================================================

interface AddSourceDialogProps {
  onAddSource: (data: AddSourceFormData) => void;
  isProcessing: boolean;
}

const AddSourceDialog = memo(function AddSourceDialog({
  onAddSource,
  isProcessing,
}: AddSourceDialogProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<AddSourceFormData>(initialFormData);

  const handleTypeChange = (type: SourceType) => {
    setFormData((prev) => ({
      ...prev,
      type,
      name: prev.name || getSourceTypeLabel(type),
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData((prev) => ({
        ...prev,
        file,
        name: prev.name || file.name,
      }));
    }
  };

  const handleSubmit = () => {
    if (!isFormValid()) return;
    onAddSource(formData);
    setFormData(initialFormData);
    setOpen(false);
  };

  const isFormValid = () => {
    switch (formData.type) {
      case 'webcam':
        return formData.name.length > 0;
      case 'mp4-url':
      case 'hls-url':
        return formData.name.length > 0 && formData.url.length > 0;
      case 'local-video':
      case 'local-image':
        return formData.name.length > 0 && formData.file !== null;
      default:
        return false;
    }
  };

  const needsUrl = ['mp4-url', 'hls-url'].includes(formData.type);
  const needsFile = ['local-video', 'local-image'].includes(formData.type);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <Plus className="w-4 h-4" />
          Add Source
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Video Source</DialogTitle>
          <DialogDescription>
            Add a new video source for detection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Source Type */}
          <div className="space-y-2">
            <Label>Source Type</Label>
            <Select value={formData.type} onValueChange={handleTypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map((st) => (
                  <SelectItem key={st.type} value={st.type}>
                    <div className="flex items-center gap-2">
                      {st.icon}
                      <span>{st.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Enter a name for this source"
            />
          </div>

          {/* URL (for URL-based sources) */}
          {needsUrl && (
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                value={formData.url}
                onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
          )}

          {/* File (for local sources) */}
          {needsFile && (
            <div className="space-y-2">
              <Label htmlFor="file">File</Label>
              <Input
                id="file"
                type="file"
                accept={formData.type === 'local-image' ? 'image/*' : 'video/*'}
                onChange={handleFileChange}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isFormValid() || isProcessing}>
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              'Add Source'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// MAIN PANEL COMPONENT
// ============================================================================

interface SourceManagerPanelProps {
  className?: string;
}

export const SourceManagerPanel = memo(function SourceManagerPanel({
  className = '',
}: SourceManagerPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  // Store state
  const sourceOrder = useAppStore((state) => state.sourceOrder);
  const primarySourceId = useAppStore((state) => state.primarySourceId);
  const selectedSourceId = useAppStore((state) => state.selectedSourceId);

  // Store actions
  const addSource = useAppStore((state) => state.addSource);
  const removeSource = useAppStore((state) => state.removeSource);
  const setSelectedSource = useAppStore((state) => state.setSelectedSource);

  // Handle adding a new source
  const handleAddSource = useCallback(async (data: AddSourceFormData) => {
    setIsProcessing(true);

    try {
      let config: NewSourceConfig;

      switch (data.type) {
        case 'webcam':
          config = {
            type: 'webcam',
            name: data.name,
          };
          break;

        case 'mp4-url':
          config = {
            type: 'mp4-url',
            name: data.name,
            url: data.url,
          };
          break;

        case 'hls-url':
          config = {
            type: 'hls-url',
            name: data.name,
            url: data.url,
          };
          break;

        case 'local-video': {
          const videoUrl = data.file ? URL.createObjectURL(data.file) : '';
          config = {
            type: 'local-video',
            name: data.name,
            file: data.file || undefined,
            objectUrl: videoUrl,
          };
          break;
        }

        case 'local-image': {
          const imageUrl = data.file ? URL.createObjectURL(data.file) : '';
          config = {
            type: 'local-image',
            name: data.name,
            file: data.file || undefined,
            objectUrl: imageUrl,
          };
          break;
        }

        default:
          throw new Error(`Unsupported source type: ${data.type}`);
      }

      addSource(config);
    } catch (error) {
      console.error('Failed to add source:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [addSource]);

  // Handle removing a source
  const handleRemoveSource = useCallback((sourceId: string) => {
    removeSource(sourceId);
  }, [removeSource]);

  // Handle selecting a source
  const handleSelectSource = useCallback((sourceId: string) => {
    setSelectedSource(sourceId);
  }, [setSelectedSource]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold">Sources</h2>
        <AddSourceDialog onAddSource={handleAddSource} isProcessing={isProcessing} />
      </div>

      {/* Source list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {sourceOrder.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Video className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No sources added</p>
              <p className="text-xs">Click &quot;Add Source&quot; to get started</p>
            </div>
          ) : (
            sourceOrder.map((sourceId) => (
              <SourceItem
                key={sourceId}
                sourceId={sourceId}
                onRemove={handleRemoveSource}
                onSelect={handleSelectSource}
                isSelected={sourceId === selectedSourceId}
                isPrimary={sourceId === primarySourceId}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer info */}
      {sourceOrder.length > 0 && (
        <div className="p-4 border-t text-xs text-muted-foreground">
          {sourceOrder.length} source{sourceOrder.length !== 1 ? 's' : ''} • Click to select
        </div>
      )}
    </div>
  );
});

// ============================================================================
// HELPERS
// ============================================================================

function getSourceTypeLabel(type: SourceType): string {
  const typeInfo = SOURCE_TYPES.find((st) => st.type === type);
  return typeInfo?.label || type;
}

export default SourceManagerPanel;
