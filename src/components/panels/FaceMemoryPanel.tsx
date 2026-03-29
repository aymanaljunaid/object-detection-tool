/**
 * Face Memory Panel Component
 * ============================
 * UI for managing enrolled faces for recognition.
 * 
 * Features:
 * - Add new person with name
 * - Capture face from webcam
 * - Upload face images
 * - View, rename, delete known faces
 * - Privacy notice about local storage
 */

'use client';

import React, {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  UserPlus,
  Camera,
  Upload,
  Trash2,
  Edit2,
  Users,
  ChevronDown,
  Shield,
  AlertCircle,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import type { FaceIdentity } from '@/types/face';
import {
  createIdentity,
  addSample,
  deleteIdentity,
  updateIdentityName,
  getAllIdentities,
  getIdentityCount,
} from '@/lib/faceStorage';
import { getFaceRecognizer } from '@/services/faceRecognizer';
import { toast } from '@/hooks/use-toast';

// ============================================================================
// TYPES
// ============================================================================

interface EnrollmentState {
  step: 'name' | 'capture' | 'processing' | 'complete' | 'error';
  name: string;
  error: string | null;
  faceDetected: boolean;
  processing: boolean;
}

// ============================================================================
// FACE MEMORY PANEL COMPONENT
// ============================================================================

export const FaceMemoryPanel = memo(function FaceMemoryPanel({
  className,
}: {
  className?: string;
}) {
  // Store state
  const knownFaces = useAppStore((state) => state.knownFaces);
  const setKnownFaces = useAppStore((state) => state.setKnownFaces);
  const faceRecognitionStatus = useAppStore((state) => state.faceRecognitionStatus);

  // Local state
  const [isEnrollmentOpen, setIsEnrollmentOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<EnrollmentState>({
    step: 'name',
    name: '',
    error: null,
    faceDetected: false,
    processing: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load known faces on mount - use ref to avoid dependency issues
  const setKnownFacesRef = useRef(setKnownFaces);
  setKnownFacesRef.current = setKnownFaces;

  // Reload function that can be called from callbacks
  const reloadKnownFaces = useCallback(async () => {
    try {
      setIsLoading(true);
      const identities = await getAllIdentities();
      setKnownFacesRef.current(identities);
    } catch (error) {
      console.error('Failed to load known faces:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    reloadKnownFaces();
  }, [reloadKnownFaces]);

  // Start webcam for enrollment
  const startWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      setEnrollment((prev) => ({
        ...prev,
        step: 'error',
        error: 'Failed to access camera. Please allow camera permission.',
      }));
    }
  }, []);

  // Stop webcam
  const stopWebcam = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Handle enrollment dialog close
  const handleEnrollmentClose = useCallback(() => {
    stopWebcam();
    setIsEnrollmentOpen(false);
    setEnrollment({
      step: 'name',
      name: '',
      error: null,
      faceDetected: false,
      processing: false,
    });
  }, [stopWebcam]);

  // Move to capture step
  const handleNameSubmit = useCallback(() => {
    if (!enrollment.name.trim()) {
      setEnrollment((prev) => ({ ...prev, error: 'Please enter a name' }));
      return;
    }
    setEnrollment((prev) => ({ ...prev, step: 'capture', error: null }));
    startWebcam();
  }, [enrollment.name, startWebcam]);

  // Capture face from webcam
  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !enrollment.name.trim()) return;

    setEnrollment((prev) => ({ ...prev, step: 'processing', processing: true }));

    try {
      const recognizer = getFaceRecognizer();
      
      // Initialize if not ready
      if (!recognizer.isReady()) {
        await recognizer.loadModels();
      }

      // Create canvas and capture frame
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');
      ctx.drawImage(videoRef.current, 0, 0);

      // Detect face and extract embedding
      const result = await recognizer.detectAndExtractEmbedding(canvas);

      if (!result) {
        setEnrollment((prev) => ({
          ...prev,
          step: 'capture',
          processing: false,
          error: 'No face detected. Please ensure your face is visible and well-lit.',
        }));
        return;
      }

      // Create identity and add sample
      const identity = await createIdentity(enrollment.name.trim());
      const thumbnail = canvas.toDataURL('image/jpeg', 0.5);
      await addSample(identity.id, result.embedding, thumbnail, 'webcam');

      // Reload known faces
      await reloadKnownFaces();

      setEnrollment((prev) => ({
        ...prev,
        step: 'complete',
        processing: false,
      }));

      toast({
        title: 'Face enrolled successfully',
        description: `${enrollment.name} has been added to known faces.`,
      });
    } catch (error) {
      console.error('Enrollment failed:', error);
      setEnrollment((prev) => ({
        ...prev,
        step: 'capture',
        processing: false,
        error: error instanceof Error ? error.message : 'Failed to enroll face',
      }));
    }
  }, [enrollment.name, reloadKnownFaces]);

  // Handle file upload
  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0 || !enrollment.name.trim()) return;

      setEnrollment((prev) => ({ ...prev, step: 'processing', processing: true }));

      try {
        const recognizer = getFaceRecognizer();

        if (!recognizer.isReady()) {
          await recognizer.loadModels();
        }

        // Create identity first
        const identity = await createIdentity(enrollment.name.trim());
        let successCount = 0;

        for (const file of Array.from(files)) {
          // Load image
          const img = new window.Image();
          img.src = URL.createObjectURL(file);

          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });

          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(img, 0, 0);

          // Detect and extract
          const result = await recognizer.detectAndExtractEmbedding(canvas);
          if (result) {
            const thumbnail = canvas.toDataURL('image/jpeg', 0.5);
            await addSample(identity.id, result.embedding, thumbnail, 'upload');
            successCount++;
          }

          URL.revokeObjectURL(img.src);
        }

        if (successCount === 0) {
          await deleteIdentity(identity.id);
          setEnrollment((prev) => ({
            ...prev,
            step: 'capture',
            processing: false,
            error: 'No valid faces found in the uploaded images.',
          }));
          return;
        }

        await reloadKnownFaces();
        setEnrollment((prev) => ({
          ...prev,
          step: 'complete',
          processing: false,
        }));

        toast({
          title: 'Face enrolled successfully',
          description: `${enrollment.name} has been added with ${successCount} sample(s).`,
        });
      } catch (error) {
        console.error('Upload enrollment failed:', error);
        setEnrollment((prev) => ({
          ...prev,
          step: 'capture',
          processing: false,
          error: error instanceof Error ? error.message : 'Failed to process images',
        }));
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [enrollment.name, reloadKnownFaces]
  );

  // Handle rename
  const handleRename = useCallback(
    async (identityId: string) => {
      if (!editingName.trim()) return;

      try {
        await updateIdentityName(identityId, editingName.trim());
        await reloadKnownFaces();
        setEditingId(null);
        setEditingName('');
        toast({
          title: 'Name updated',
          description: 'The person name has been changed.',
        });
      } catch (error) {
        console.error('Rename failed:', error);
        toast({
          title: 'Rename failed',
          description: 'Failed to update name. Please try again.',
          variant: 'destructive',
        });
      }
    },
    [editingName, reloadKnownFaces]
  );

  // Handle delete
  const handleDelete = useCallback(
    async (identityId: string) => {
      try {
        await deleteIdentity(identityId);
        await reloadKnownFaces();
        setDeleteConfirmId(null);
        toast({
          title: 'Face deleted',
          description: 'The person has been removed from known faces.',
        });
      } catch (error) {
        console.error('Delete failed:', error);
        toast({
          title: 'Delete failed',
          description: 'Failed to delete. Please try again.',
          variant: 'destructive',
        });
      }
    },
    [reloadKnownFaces]
  );

  return (
    <div className={cn('flex flex-col', className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <button
            className="flex items-center justify-between w-full p-3 hover:bg-accent/50 rounded-t-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm">Known Faces</span>
              {knownFaces.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {knownFaces.length}
                </Badge>
              )}
            </div>
            <ChevronDown
              className={cn(
                'w-4 h-4 transition-transform',
                isExpanded && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3 pt-0 space-y-3">
            {/* Privacy notice */}
            <div className="flex items-start gap-2 p-2 bg-muted/50 rounded text-xs text-muted-foreground">
              <Shield className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                Face data is stored locally on this device and never uploaded.
              </span>
            </div>

            {/* Add face button */}
            <Button
              onClick={() => setIsEnrollmentOpen(true)}
              className="w-full"
              size="sm"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Add Person
            </Button>

            {/* Face list */}
            <ScrollArea className="h-40 rounded border">
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </div>
              ) : knownFaces.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No faces enrolled yet
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {knownFaces.map((face) => (
                    <div
                      key={face.id}
                      className="flex items-center gap-2 p-2 bg-card rounded border"
                    >
                      {/* Thumbnail */}
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-muted flex-shrink-0">
                        {face.samples[0]?.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={face.samples[0].thumbnail}
                            alt={face.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Users className="w-5 h-5" />
                          </div>
                        )}
                      </div>

                      {/* Name and samples count */}
                      <div className="flex-1 min-w-0">
                        {editingId === face.id ? (
                          <div className="flex gap-1">
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="h-7 text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename(face.id);
                                if (e.key === 'Escape') {
                                  setEditingId(null);
                                  setEditingName('');
                                }
                              }}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => handleRename(face.id)}
                            >
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditingId(null);
                                setEditingName('');
                              }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-medium truncate">
                              {face.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {face.samples.length} sample
                              {face.samples.length !== 1 ? 's' : ''}
                            </p>
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      {editingId !== face.id && (
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingId(face.id);
                              setEditingName(face.name);
                            }}
                            title="Rename"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirmId(face.id)}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Enrollment Dialog */}
      <Dialog open={isEnrollmentOpen} onOpenChange={handleEnrollmentClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Person</DialogTitle>
          </DialogHeader>

          {/* Step: Name */}
          {enrollment.step === 'name' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="Enter person's name"
                  value={enrollment.name}
                  onChange={(e) =>
                    setEnrollment((prev) => ({
                      ...prev,
                      name: e.target.value,
                      error: null,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleNameSubmit();
                  }}
                  autoFocus
                />
                {enrollment.error && (
                  <p className="text-sm text-destructive">{enrollment.error}</p>
                )}
              </div>
            </div>
          )}

          {/* Step: Capture */}
          {enrollment.step === 'capture' && (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  Enrolling: <strong>{enrollment.name}</strong>
                </p>
              </div>

              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
              </div>

              {enrollment.error && (
                <div className="flex items-center gap-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  {enrollment.error}
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleCapture} className="flex-1">
                  <Camera className="w-4 h-4 mr-2" />
                  Capture
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </div>
          )}

          {/* Step: Processing */}
          {enrollment.step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Processing face...</p>
            </div>
          )}

          {/* Step: Complete */}
          {enrollment.step === 'complete' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-500" />
              </div>
              <p className="text-sm font-medium">Face enrolled successfully!</p>
            </div>
          )}

          {/* Step: Error */}
          {enrollment.step === 'error' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-sm text-destructive font-medium border border-destructive/20">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{enrollment.error || 'An unknown error occurred.'}</span>
              </div>
            </div>
          )}

          <DialogFooter>
            {enrollment.step === 'name' && (
              <>
                <Button variant="outline" onClick={handleEnrollmentClose}>
                  Cancel
                </Button>
                <Button onClick={handleNameSubmit}>Next</Button>
              </>
            )}
            {(enrollment.step === 'capture' ||
              enrollment.step === 'complete' ||
              enrollment.step === 'error') && (
              <Button
                onClick={handleEnrollmentClose}
                className="w-full"
              >
                {enrollment.step === 'complete' ? 'Done' : 'Close'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={() => setDeleteConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Face</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this person from known faces. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

export default FaceMemoryPanel;