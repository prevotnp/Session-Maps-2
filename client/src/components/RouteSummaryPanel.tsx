import { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { X, ChevronDown, ChevronUp, ChevronRight, MapPin, Mountain, Ruler, FileText, Plus, Trash2, Star, Check, Loader2, Route as RouteIcon, Camera, Upload, Pencil, GripVertical, Calendar, Activity, Clock } from 'lucide-react';
import { Route, RoutePointOfInterest, RouteNote } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

type RoutingMode = 'direct' | 'trail' | 'road' | 'draw';

const ACTIVITY_TYPE_OPTIONS = [
  { value: 'skiing', label: 'Ski', icon: '⛷️', color: '#3B82F6' },
  { value: 'hiking', label: 'Hike/Run', icon: '🥾', color: '#EAB308' },
  { value: 'river', label: 'River Trip', icon: '🛶', color: '#EF4444' },
  { value: 'cycling', label: 'Cycling', icon: '🚴', color: '#EC4899' },
];

const getActivityOption = (activityType: string | null | undefined) => {
  if (!activityType) return ACTIVITY_TYPE_OPTIONS[1];
  const mapped = activityType === 'running' ? 'hiking' : activityType;
  return ACTIVITY_TYPE_OPTIONS.find(a => a.value === mapped) || ACTIVITY_TYPE_OPTIONS[1];
};

const formatTripDates = (startTime: string | Date | null | undefined, endTime: string | Date | null | undefined) => {
  if (!startTime) return null;
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : null;
  const fmtDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const fmtTime = (d: Date) => {
    let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${ap}`;
  };
  if (!end) return `${fmtDate(start)} ${fmtTime(start)}`;
  const sd = fmtDate(start); const ed = fmtDate(end);
  if (sd === ed) return `${sd} · ${fmtTime(start)} - ${fmtTime(end)}`;
  const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  return `${sd} - ${ed} · ${days} day${days !== 1 ? 's' : ''}`;
};

interface RouteSummaryPanelProps {
  route: Route;
  onClose: () => void;
  isOwner?: boolean;
  isAddingWaypoint?: boolean;
  onStartAddWaypointMode?: () => void;
  onStopAddWaypointMode?: () => void;
  onDeleteWaypoint?: (index: number) => void;
  onAddPOIMode?: (enabled: boolean) => void;
  pendingPOILocation?: [number, number] | null;
  onClearPendingPOI?: () => void;
  onPOIsChanged?: () => void;
  onOpenPOIEdit?: (poi: RoutePointOfInterest) => void;
  onRouteUpdated?: (route: Route) => void;
}

export function RouteSummaryPanel({
  route,
  onClose,
  isOwner = false,
  isAddingWaypoint = false,
  onStartAddWaypointMode,
  onStopAddWaypointMode,
  onDeleteWaypoint,
  onAddPOIMode,
  pendingPOILocation,
  onClearPendingPOI,
  onPOIsChanged,
  onOpenPOIEdit,
  onRouteUpdated
}: RouteSummaryPanelProps) {
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);
  const [isPOIsExpanded, setIsPOIsExpanded] = useState(false);
  const [isPhotosExpanded, setIsPhotosExpanded] = useState(false);
  const [isAddingPOI, setIsAddingPOI] = useState(false);
  
  // Inline editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(route.name);
  const [isRoutingModeExpanded, setIsRoutingModeExpanded] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [localNoteContents, setLocalNoteContents] = useState<Record<number, string>>({});
  const [collapsedNoteIds, setCollapsedNoteIds] = useState<Set<number>>(new Set());
  const [editingCategoryNoteId, setEditingCategoryNoteId] = useState<number | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [swipingNoteId, setSwipingNoteId] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStartX = useRef(0);
  const [isChangingRoutingMode, setIsChangingRoutingMode] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [expandedPOIId, setExpandedPOIId] = useState<number | null>(null);
  const [uploadingPOIPhotoId, setUploadingPOIPhotoId] = useState<number | null>(null);
  const [fullScreenMedia, setFullScreenMedia] = useState<string | null>(null);
  const [isWaypointsExpanded, setIsWaypointsExpanded] = useState(false);
  const [editingWaypointIndex, setEditingWaypointIndex] = useState<number | null>(null);
  const [editingWaypointName, setEditingWaypointName] = useState('');
  const [draggedWaypointIndex, setDraggedWaypointIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [showActivityDropdown, setShowActivityDropdown] = useState(false);
  const [isEditingTripDates, setIsEditingTripDates] = useState(false);
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

  const queryClient = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const poiPhotoInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Update local state when route changes - clear any pending saves first
  useEffect(() => {
    // Clear any pending debounced save to prevent cross-route contamination
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setEditedName(route.name);
  }, [route.id, route.name]);
  
  // Parse route photos
  const routePhotos: string[] = (() => {
    try {
      return route.photos ? JSON.parse(route.photos) : [];
    } catch {
      return [];
    }
  })();
  
  const waypointCoordinates = route.waypointCoordinates 
    ? JSON.parse(route.waypointCoordinates) 
    : [];
  const waypointCount = waypointCoordinates.length;

  const { data: pois = [], isLoading: poisLoading } = useQuery<RoutePointOfInterest[]>({
    queryKey: ['/api/routes', route.id, 'pois'],
    queryFn: async () => {
      const res = await fetch(`/api/routes/${route.id}/pois`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch POIs');
      return res.json();
    },
  });

  // Auto-save mutation
  const updateRouteMutation = useMutation({
    mutationFn: async (updates: Partial<Route>) => {
      const res = await apiRequest('PUT', `/api/routes/${route.id}`, {
        pathCoordinates: route.pathCoordinates,
        waypointCoordinates: route.waypointCoordinates,
        totalDistance: typeof route.totalDistance === 'string' ? parseFloat(route.totalDistance) : route.totalDistance,
        ...updates
      });
      return res.json();
    },
    onSuccess: (updatedRoute: Route) => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      onRouteUpdated?.(updatedRoute);
    },
    onError: () => {
      toast({ title: 'Failed to save changes', variant: 'destructive' });
    }
  });

  // Update activity type via PATCH
  const updateActivityMutation = useMutation({
    mutationFn: async (activityType: string) => {
      return apiRequest('PATCH', `/api/routes/${route.id}`, { activityType });
    },
    onSuccess: async () => {
      toast({ title: 'Activity type updated' });
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/routes/public'] });
      setShowActivityDropdown(false);
      // Refresh the displayed route
      const res = await fetch(`/api/routes/${route.id}`, { credentials: 'include' });
      if (res.ok) {
        const updated = await res.json();
        onRouteUpdated?.(updated);
      }
    },
    onError: () => {
      toast({ title: 'Failed to update activity type', variant: 'destructive' });
    }
  });

  // Save trip dates
  const handleSaveTripDates = () => {
    const updates: any = {};
    updates.startTime = editStartTime || null;
    updates.endTime = editEndTime || null;
    updateRouteMutation.mutate(updates);
    setIsEditingTripDates(false);
    toast({ title: 'Trip dates updated' });
  };

  // Format datetime-local value from ISO
  const toDatetimeLocal = (val: string | Date | null | undefined) => {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleWaypointReorder = async (fromIndex: number, toIndex: number) => {
    const routingMode = route.routingMode || 'direct';
    if (routingMode === 'recorded') {
      toast({ title: 'Cannot reorder', description: 'GPS recorded routes cannot be reordered.', variant: 'destructive' });
      return;
    }

    const newWaypoints = [...waypointCoordinates];
    const [moved] = newWaypoints.splice(fromIndex, 1);
    newWaypoints.splice(toIndex, 0, moved);

    let pathCoords: [number, number][];

    if (routingMode === 'road' || routingMode === 'trail') {
      const coordinatesStr = newWaypoints.map((wp: any) => wp.lngLat.join(',')).join(';');
      const profile = routingMode === 'road' ? 'driving' : 'walking';
      const token = (window as any).__MAPBOX_TOKEN || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
      try {
        const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinatesStr}?geometries=geojson&overview=full&access_token=${token}`);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          pathCoords = data.routes[0].geometry.coordinates;
        } else {
          pathCoords = newWaypoints.map((wp: any) => wp.lngLat);
        }
      } catch {
        pathCoords = newWaypoints.map((wp: any) => wp.lngLat);
      }
    } else {
      pathCoords = newWaypoints.map((wp: any) => wp.lngLat);
    }

    let totalDistance = 0;
    for (let i = 1; i < pathCoords.length; i++) {
      const [lng1, lat1] = pathCoords[i - 1];
      const [lng2, lat2] = pathCoords[i];
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      totalDistance += R * c;
    }

    updateRouteMutation.mutate({
      waypointCoordinates: JSON.stringify(newWaypoints),
      pathCoordinates: JSON.stringify(pathCoords),
      totalDistance: String(totalDistance)
    });
  };

  const handleWaypointRename = (index: number, newName: string) => {
    if (!newName.trim()) return;
    const newWaypoints = [...waypointCoordinates];
    newWaypoints[index] = { ...newWaypoints[index], name: newName.trim() };
    
    updateRouteMutation.mutate({
      waypointCoordinates: JSON.stringify(newWaypoints)
    });
  };

  // Debounced auto-save for text fields
  const debouncedSave = useCallback((updates: Partial<Route>) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      updateRouteMutation.mutate(updates);
    }, 1000);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleNameChange = (newName: string) => {
    setEditedName(newName);
  };

  const handleNameBlur = () => {
    setIsEditingName(false);
    if (editedName.trim() && editedName !== route.name) {
      updateRouteMutation.mutate({ name: editedName.trim() });
    } else if (!editedName.trim()) {
      setEditedName(route.name);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameBlur();
    } else if (e.key === 'Escape') {
      setEditedName(route.name);
      setIsEditingName(false);
    }
  };

  const { data: routeNotes = [], isLoading: isLoadingNotes } = useQuery<RouteNote[]>({
    queryKey: [`/api/routes/${route.id}/notes`],
    enabled: isNotesExpanded,
  });

  const hasAutoCreatedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (isNotesExpanded && !isLoadingNotes && routeNotes.length === 0 && isOwner && !hasAutoCreatedRef.current.has(route.id)) {
      hasAutoCreatedRef.current.add(route.id);
      apiRequest('POST', `/api/routes/${route.id}/notes`, { category: 'Untitled', content: '', position: 0 })
        .then(() => queryClient.invalidateQueries({ queryKey: [`/api/routes/${route.id}/notes`] }))
        .catch(() => {});
    }
  }, [isNotesExpanded, isLoadingNotes, routeNotes.length, isOwner, route.id]);

  const createNoteMutation = useMutation({
    mutationFn: async (data: { category: string; content?: string; position?: number }) => {
      const res = await apiRequest('POST', `/api/routes/${route.id}/notes`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/routes/${route.id}/notes`] });
      setNewCategoryName('');
      setIsAddingCategory(false);
    },
    onError: () => {
      toast({ title: 'Failed to create note category', variant: 'destructive' });
    }
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, ...data }: { noteId: number; content?: string; category?: string }) => {
      const res = await apiRequest('PUT', `/api/routes/${route.id}/notes/${noteId}`, data);
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/routes/${route.id}/notes`] });
      if (variables.content !== undefined) {
        setLocalNoteContents(prev => {
          const next = { ...prev };
          delete next[variables.noteId];
          return next;
        });
      }
    },
    onError: (_, variables) => {
      toast({ title: 'Failed to save note', variant: 'destructive' });
      console.error('Note save failed for noteId:', variables.noteId);
    }
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: number) => {
      await apiRequest('DELETE', `/api/routes/${route.id}/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/routes/${route.id}/notes`] });
    },
    onError: () => {
      toast({ title: 'Failed to delete note', variant: 'destructive' });
    }
  });

  const noteSaveTimeoutRef = useRef<Record<number, NodeJS.Timeout>>({});
  const updateNoteMutationRef = useRef(updateNoteMutation);
  useEffect(() => {
    updateNoteMutationRef.current = updateNoteMutation;
  });

  const debouncedNoteSave = useCallback((noteId: number, content: string) => {
    if (noteSaveTimeoutRef.current[noteId]) {
      clearTimeout(noteSaveTimeoutRef.current[noteId]);
    }
    noteSaveTimeoutRef.current[noteId] = setTimeout(() => {
      updateNoteMutationRef.current.mutate({ noteId, content });
      delete noteSaveTimeoutRef.current[noteId];
    }, 1000);
  }, []);

  const getNoteContent = (note: RouteNote) => {
    return localNoteContents[note.id] !== undefined ? localNoteContents[note.id] : (note.content || '');
  };

  const handleNoteContentChange = (noteId: number, value: string) => {
    setLocalNoteContents(prev => ({ ...prev, [noteId]: value }));
    debouncedNoteSave(noteId, value);
  };

  const scanInputRef = useRef<HTMLInputElement>(null);

  const getNextScannedCategory = () => {
    const existing = routeNotes.filter(n => n.category.startsWith('Scanned Text'));
    if (existing.length === 0) return 'Scanned Text';
    let maxNum = 1;
    existing.forEach(n => {
      const match = n.category.match(/^Scanned Text\s*(\d*)$/);
      if (match) {
        const num = match[1] ? parseInt(match[1]) : 1;
        if (num >= maxNum) maxNum = num + 1;
      }
    });
    return `Scanned Text ${maxNum}`;
  };

  const handleScanText = async (file: File) => {
    setIsScanning(true);
    setScanProgress(0);
    
    try {
      const Tesseract = await import('tesseract.js');
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setScanProgress(Math.round(m.progress * 100));
          }
        }
      });
      
      const scannedText = result.data.text.trim();
      if (scannedText) {
        const category = getNextScannedCategory();
        createNoteMutation.mutate({ category, content: scannedText, position: routeNotes.length });
        toast({ title: 'Text scanned successfully' });
      } else {
        toast({ title: 'No text detected in image', variant: 'destructive' });
      }
    } catch (error) {
      console.error('OCR error:', error);
      toast({ title: 'Failed to scan text', variant: 'destructive' });
    } finally {
      setIsScanning(false);
      setScanProgress(0);
    }
  };

  const toggleNoteCollapsed = (noteId: number) => {
    setCollapsedNoteIds(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  const wasSwiping = useRef(false);

  const handleNoteTouchStart = (noteId: number, e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setSwipingNoteId(noteId);
    setSwipeOffset(0);
    wasSwiping.current = false;
  };

  const handleNoteTouchMove = (e: React.TouchEvent) => {
    if (swipingNoteId === null) return;
    const diff = touchStartX.current - e.touches[0].clientX;
    if (diff > 10) {
      wasSwiping.current = true;
    }
    if (diff > 0) {
      setSwipeOffset(diff);
    }
  };

  const handleNoteTouchEnd = (noteId: number) => {
    if (swipeOffset > 100) {
      if (confirm(`Delete this note?`)) {
        deleteNoteMutation.mutate(noteId);
      }
    }
    setSwipingNoteId(null);
    setSwipeOffset(0);
  };

  const defaultCategories = ['Trip Journal', 'Gear List', 'Itinerary'];

  const createPOIMutation = useMutation({
    mutationFn: async (data: { name: string; latitude: number; longitude: number; elevation?: string; note?: string }) => {
      const res = await apiRequest('POST', `/api/routes/${route.id}/pois`, data);
      return res.json();
    },
    onSuccess: (createdPOI: RoutePointOfInterest) => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes', route.id, 'pois'] });
      setIsAddingPOI(false);
      onAddPOIMode?.(false);
      onClearPendingPOI?.();
      onPOIsChanged?.();
      onOpenPOIEdit?.(createdPOI);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add point of interest.', variant: 'destructive' });
    }
  });

  const deletePOIMutation = useMutation({
    mutationFn: async (poiId: number) => {
      await apiRequest('DELETE', `/api/routes/${route.id}/pois/${poiId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes', route.id, 'pois'] });
      onPOIsChanged?.();
      toast({ title: 'POI deleted', description: 'Point of interest removed.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete POI.', variant: 'destructive' });
    }
  });

  // Upload route photos mutation
  const uploadPhotoMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach(file => formData.append('photos', file));
      const res = await fetch(`/api/routes/${route.id}/photos`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!res.ok) throw new Error('Failed to upload photos');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      onRouteUpdated?.(data.route);
      setIsUploadingPhoto(false);
      toast({ title: 'Photos uploaded', description: 'Photos added to route.' });
    },
    onError: () => {
      setIsUploadingPhoto(false);
      toast({ title: 'Error', description: 'Failed to upload photos.', variant: 'destructive' });
    }
  });

  // Delete route photo mutation
  const deletePhotoMutation = useMutation({
    mutationFn: async (photoPath: string) => {
      const res = await apiRequest('DELETE', `/api/routes/${route.id}/photos`, { photoPath });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      onRouteUpdated?.(data.route);
      toast({ title: 'Photo deleted', description: 'Photo removed from route.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete photo.', variant: 'destructive' });
    }
  });

  const handlePhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Copy files to an array before resetting input
      const filesArray = Array.from(e.target.files);
      setIsUploadingPhoto(true);
      uploadPhotoMutation.mutate(filesArray);
      e.target.value = ''; // Reset input to allow uploading same file again
    }
  };

  // Upload POI photos mutation
  const uploadPOIPhotoMutation = useMutation({
    mutationFn: async ({ poiId, files }: { poiId: number; files: File[] }) => {
      const formData = new FormData();
      files.forEach(file => formData.append('photos', file));
      const res = await fetch(`/api/routes/${route.id}/pois/${poiId}/photos`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!res.ok) throw new Error('Failed to upload photos');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes', route.id, 'pois'] });
      setUploadingPOIPhotoId(null);
      toast({ title: 'Photos uploaded', description: 'Photos added to waypoint.' });
    },
    onError: () => {
      setUploadingPOIPhotoId(null);
      toast({ title: 'Error', description: 'Failed to upload photos.', variant: 'destructive' });
    }
  });

  // Delete POI photo mutation
  const deletePOIPhotoMutation = useMutation({
    mutationFn: async ({ poiId, photoPath }: { poiId: number; photoPath: string }) => {
      const res = await apiRequest('DELETE', `/api/routes/${route.id}/pois/${poiId}/photos`, { photoPath });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes', route.id, 'pois'] });
      toast({ title: 'Photo deleted', description: 'Photo removed from waypoint.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete photo.', variant: 'destructive' });
    }
  });

  const handlePOIPhotoUpload = (poiId: number) => (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Copy files to an array before resetting input
      const filesArray = Array.from(e.target.files);
      setUploadingPOIPhotoId(poiId);
      uploadPOIPhotoMutation.mutate({ poiId, files: filesArray });
      e.target.value = ''; // Reset input to allow uploading same file again
    }
  };

  const parsePOIPhotos = (poi: RoutePointOfInterest): string[] => {
    try {
      return poi.photos ? JSON.parse(poi.photos) : [];
    } catch {
      return [];
    }
  };

  const isVideoFile = (path: string): boolean => {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    return videoExtensions.some(ext => path.toLowerCase().endsWith(ext));
  };

  // Change routing mode mutation
  const changeRoutingModeMutation = useMutation({
    mutationFn: async (newMode: RoutingMode) => {
      setIsChangingRoutingMode(true);
      const res = await apiRequest('PUT', `/api/routes/${route.id}`, {
        pathCoordinates: route.pathCoordinates,
        waypointCoordinates: route.waypointCoordinates,
        totalDistance: typeof route.totalDistance === 'string' ? parseFloat(route.totalDistance) : route.totalDistance,
        routingMode: newMode
      });
      return res.json();
    },
    onSuccess: (updatedRoute: Route) => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      onRouteUpdated?.(updatedRoute);
      setIsChangingRoutingMode(false);
      toast({ 
        title: 'Routing mode changed', 
        description: `Route path updated to ${updatedRoute.routingMode || 'direct'} mode.` 
      });
    },
    onError: () => {
      setIsChangingRoutingMode(false);
      toast({ title: 'Failed to change routing mode', variant: 'destructive' });
    }
  });

  const handleRoutingModeChange = (newMode: RoutingMode) => {
    if (newMode === route.routingMode || isChangingRoutingMode) return;
    if (newMode === 'draw') {
      toast({ 
        title: 'Draw mode', 
        description: 'Click "Edit Route" to draw a custom path by clicking on the route line.',
        duration: 5000
      });
      return;
    }
    changeRoutingModeMutation.mutate(newMode);
  };
  
  const formatDistance = (meters: number | string | null | undefined) => {
    if (!meters) return 'N/A';
    const m = typeof meters === 'string' ? parseFloat(meters) : meters;
    const miles = m / 1609.34;
    if (miles < 0.1) {
      const feet = m * 3.28084;
      return `${Math.round(feet)} ft`;
    }
    return `${miles.toFixed(2)} mi`;
  };

  const elevationChange = () => {
    const gain = route.elevationGain ? parseFloat(route.elevationGain as string) : 0;
    const loss = route.elevationLoss ? parseFloat(route.elevationLoss as string) : 0;
    const netChange = gain - loss;
    const netFeet = Math.round(netChange * 3.28084);
    const sign = netFeet >= 0 ? '+' : '';
    return `${sign}${netFeet.toLocaleString()} ft`;
  };

  const handleStartAddPOI = () => {
    setIsAddingPOI(true);
    onAddPOIMode?.(true);
    toast({ 
      title: 'Add Point of Interest', 
      description: 'Click on the map to place your POI pin.',
      duration: 5000
    });
  };

  const handleCancelAddPOI = () => {
    setIsAddingPOI(false);
    onAddPOIMode?.(false);
    onClearPendingPOI?.();
  };

  const hasCreatedPOIRef = useRef(false);

  useEffect(() => {
    if (pendingPOILocation && isAddingPOI && !createPOIMutation.isPending && !hasCreatedPOIRef.current) {
      hasCreatedPOIRef.current = true;
      createPOIMutation.mutate({
        name: `POI ${pois.length + 1}`,
        longitude: pendingPOILocation[0],
        latitude: pendingPOILocation[1]
      });
    }
  }, [pendingPOILocation, isAddingPOI]);

  useEffect(() => {
    if (!isAddingPOI) {
      hasCreatedPOIRef.current = false;
    }
  }, [isAddingPOI]);

  const isSaving = updateRouteMutation.isPending;

  return (
    <div 
      className="absolute top-2 left-2 right-2 sm:left-auto sm:top-4 sm:right-4 z-50 sm:w-72"
      style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      data-testid="route-summary-panel"
    >
      <div className="bg-dark/95 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 overflow-hidden max-h-[33vh] sm:max-h-[calc(100vh-120px)] overflow-y-auto">
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              {isOwner && isEditingName ? (
                <Input
                  value={editedName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  onBlur={handleNameBlur}
                  onKeyDown={handleNameKeyDown}
                  className="text-lg font-bold bg-white/10 border-white/30 text-white h-8"
                  autoFocus
                  data-testid="input-route-name"
                />
              ) : (
                <h2 
                  className={`text-lg font-bold text-white truncate ${isOwner ? 'cursor-pointer hover:bg-white/10 rounded px-1 -mx-1' : ''}`}
                  onClick={() => isOwner && setIsEditingName(true)}
                  data-testid="route-name"
                  title={isOwner ? "Click to edit name" : undefined}
                >
                  {editedName}
                  {isSaving && <Loader2 className="inline-block h-3 w-3 ml-2 animate-spin text-white/60" />}
                </h2>
              )}
              <p className="text-xs text-white/60 mt-0.5">
                {waypointCount} waypoints • {route.routingMode === 'recorded' ? 'GPS recorded' : (route.routingMode || 'direct')}
                {isOwner && <span className="ml-1 text-emerald-400">(drag waypoints to move)</span>}
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-3 p-1.5 hover:bg-white/10 rounded-full transition-colors"
              data-testid="button-close-summary"
            >
              <X className="h-5 w-5 text-white/70" />
            </button>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-white/5 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-emerald-400" />
                <span className="text-sm text-white/60">Distance</span>
              </div>
              <p className="text-sm font-semibold text-white" data-testid="route-distance">
                {formatDistance(route.totalDistance)}
              </p>
            </div>
            
            <div className="flex items-center justify-between bg-white/5 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <Mountain className="h-4 w-4 text-orange-400" />
                <span className="text-sm text-white/60">Elevation</span>
              </div>
              <p className="text-sm font-semibold text-white" data-testid="route-elevation">
                {elevationChange()}
              </p>
            </div>

            {/* Activity Type */}
            <div className="relative">
              <div className="flex items-center justify-between bg-white/5 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-sky-400" />
                  <span className="text-sm text-white/60">Activity</span>
                </div>
                {isOwner ? (
                  <button
                    onClick={() => setShowActivityDropdown(!showActivityDropdown)}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-white/10 transition-colors"
                  >
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getActivityOption(route.activityType).color }} />
                    <span className="text-sm font-semibold text-white">
                      {getActivityOption(route.activityType).icon} {getActivityOption(route.activityType).label}
                    </span>
                    <ChevronDown className="h-3 w-3 text-white/60" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getActivityOption(route.activityType).color }} />
                    <span className="text-sm font-semibold text-white">
                      {getActivityOption(route.activityType).icon} {getActivityOption(route.activityType).label}
                    </span>
                  </div>
                )}
              </div>
              {showActivityDropdown && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-white/10 rounded-lg shadow-lg z-50 overflow-hidden">
                  {ACTIVITY_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateActivityMutation.mutate(option.value)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/10 transition-colors ${
                        getActivityOption(route.activityType).value === option.value ? 'bg-white/5' : ''
                      }`}
                    >
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: option.color }} />
                      <span>{option.icon}</span>
                      <span className="text-white">{option.label}</span>
                      {getActivityOption(route.activityType).value === option.value && (
                        <Check className="h-3.5 w-3.5 ml-auto text-emerald-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Trip Dates */}
            <div className="bg-white/5 rounded-lg p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-pink-400" />
                  <span className="text-sm text-white/60">Trip Dates</span>
                </div>
                {isOwner && !isEditingTripDates ? (
                  <button
                    onClick={() => {
                      setEditStartTime(toDatetimeLocal(route.startTime));
                      setEditEndTime(toDatetimeLocal(route.endTime));
                      setIsEditingTripDates(true);
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    {route.startTime ? 'Edit' : 'Add'}
                  </button>
                ) : !isOwner && !route.startTime ? (
                  <span className="text-sm text-white/40">Not set</span>
                ) : null}
              </div>
              {isEditingTripDates ? (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="text-xs text-white/50 block mb-1">Start</label>
                    <input
                      type="datetime-local"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 block mb-1">End</label>
                    <input
                      type="datetime-local"
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-sm text-white"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveTripDates}
                      className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded py-1.5 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setIsEditingTripDates(false)}
                      className="flex-1 text-xs bg-white/10 hover:bg-white/20 text-white/70 rounded py-1.5 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : route.startTime ? (
                <p className="text-sm font-semibold text-white mt-1">
                  {formatTripDates(route.startTime, route.endTime)}
                </p>
              ) : null}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsWaypointsExpanded(!isWaypointsExpanded)}
                  className="flex-1 flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-lg p-2.5 transition-colors"
                  data-testid="route-waypoints"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-purple-400" />
                    <span className="text-sm text-white/60">Waypoints</span>
                    <span className="text-sm font-semibold text-white">{waypointCount}</span>
                  </div>
                  {isWaypointsExpanded ? (
                    <ChevronUp className="h-4 w-4 text-white/60" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-white/60" />
                  )}
                </button>
                {isOwner && route.routingMode !== 'recorded' && onStartAddWaypointMode && (
                  <button
                    onClick={() => {
                      if (isAddingWaypoint) {
                        onStopAddWaypointMode?.();
                      } else {
                        onStartAddWaypointMode();
                      }
                    }}
                    className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                      isAddingWaypoint
                        ? 'bg-purple-500 text-white'
                        : 'bg-white/5 hover:bg-white/10 text-purple-400'
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isAddingWaypoint ? 'Adding' : 'Add'}
                  </button>
                )}
              </div>
              {isAddingWaypoint && (
                <div className="mt-1.5 flex items-center gap-2">
                  <p className="text-xs text-purple-300 ml-1">Click on the map to add a waypoint</p>
                  <button
                    onClick={() => onStopAddWaypointMode?.()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save Waypoints
                  </button>
                </div>
              )}

              {isWaypointsExpanded && (
                <div className="mt-2 space-y-1">
                  {waypointCoordinates.map((wp: any, index: number) => {
                    const isStart = index === 0;
                    const isEnd = index === waypointCoordinates.length - 1;
                    const wpName = wp.name || (isStart ? 'Start Point' : isEnd ? 'End Point' : `Waypoint ${index + 1}`);
                    const isEditing = editingWaypointIndex === index;
                    const isDragged = draggedWaypointIndex === index;
                    const isDragOver = dragOverIndex === index;
                    
                    return (
                      <div
                        key={`wp-${index}`}
                        data-waypoint-index={index}
                        className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                          isDragged ? 'opacity-50 bg-white/10' : isDragOver ? 'bg-purple-500/20 border border-purple-500/40' : 'bg-white/5'
                        }`}
                        draggable={false}
                        onDragOver={(e) => { e.preventDefault(); if (isOwner) setDragOverIndex(index); }}
                        onDragLeave={() => setDragOverIndex(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!isOwner || draggedWaypointIndex === null || draggedWaypointIndex === index) {
                            setDraggedWaypointIndex(null);
                            setDragOverIndex(null);
                            return;
                          }
                          handleWaypointReorder(draggedWaypointIndex, index);
                          setDraggedWaypointIndex(null);
                          setDragOverIndex(null);
                        }}
                      >
                        {isOwner && route.routingMode !== 'recorded' && (
                          <div
                            draggable
                            onDragStart={(e) => {
                              setDraggedWaypointIndex(index);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDraggedWaypointIndex(null);
                              setDragOverIndex(null);
                            }}
                            onTouchStart={() => {
                              setDraggedWaypointIndex(index);
                              setDragOverIndex(null);
                            }}
                            onTouchMove={(e) => {
                              e.preventDefault();
                              const touch = e.touches[0];
                              const elements = document.elementsFromPoint(touch.clientX, touch.clientY);
                              const waypointRow = elements.find(el => el.getAttribute('data-waypoint-index') !== null);
                              if (waypointRow) {
                                const overIndex = parseInt(waypointRow.getAttribute('data-waypoint-index') || '-1', 10);
                                if (overIndex >= 0) setDragOverIndex(overIndex);
                              }
                            }}
                            onTouchEnd={() => {
                              if (draggedWaypointIndex !== null && dragOverIndex !== null && draggedWaypointIndex !== dragOverIndex) {
                                handleWaypointReorder(draggedWaypointIndex, dragOverIndex);
                              }
                              setDraggedWaypointIndex(null);
                              setDragOverIndex(null);
                            }}
                            className="cursor-grab active:cursor-grabbing touch-none"
                          >
                            <GripVertical className="h-4 w-4 text-white/40" />
                          </div>
                        )}
                        
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                          isStart ? 'bg-green-500' : isEnd ? 'bg-red-500' : 'bg-emerald-600'
                        }`}>
                          {isStart ? 'S' : isEnd ? 'E' : index + 1}
                        </div>
                        
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingWaypointName}
                            onChange={(e) => setEditingWaypointName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleWaypointRename(index, editingWaypointName);
                                setEditingWaypointIndex(null);
                              } else if (e.key === 'Escape') {
                                setEditingWaypointIndex(null);
                              }
                            }}
                            onBlur={() => {
                              handleWaypointRename(index, editingWaypointName);
                              setEditingWaypointIndex(null);
                            }}
                            autoFocus
                            className="flex-1 bg-white/10 border border-purple-500/50 rounded px-2 py-1 text-sm text-white outline-none focus:border-purple-400"
                          />
                        ) : (
                          <span
                            onClick={() => {
                              if (isOwner) {
                                setEditingWaypointIndex(index);
                                setEditingWaypointName(wpName);
                              }
                            }}
                            className={`flex-1 text-sm text-white/80 truncate ${isOwner ? 'cursor-pointer hover:text-white' : ''}`}
                          >
                            {wpName}
                          </span>
                        )}
                        
                        {isOwner && !isEditing && (
                          <Pencil className="h-3 w-3 text-white/30 flex-shrink-0" />
                        )}
                        {isOwner && route.routingMode !== 'recorded' && onDeleteWaypoint && !isEditing && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteWaypoint(index);
                            }}
                            className="flex-shrink-0 p-1 rounded hover:bg-red-500/20 transition-colors"
                            title="Delete waypoint"
                          >
                            <Trash2 className="h-3 w-3 text-red-400/60 hover:text-red-400" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Route Path Section */}
          {isOwner && (
            <div className="mt-3">
              <button
                onClick={() => setIsRoutingModeExpanded(!isRoutingModeExpanded)}
                className="w-full flex items-center justify-between p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                data-testid="button-toggle-routing-mode"
              >
                <div className="flex items-center gap-2">
                  <RouteIcon className="h-4 w-4 text-cyan-400" />
                  <span className="text-sm text-white/80">Route Path</span>
                  <span className="text-xs text-white/50 capitalize">
                    ({route.routingMode === 'recorded' ? 'GPS Recorded' : route.routingMode || 'direct'})
                  </span>
                </div>
                {isRoutingModeExpanded ? (
                  <ChevronUp className="h-4 w-4 text-white/60" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-white/60" />
                )}
              </button>

              {isRoutingModeExpanded && (
                <div className="mt-2 space-y-2">
                  {route.routingMode === 'recorded' ? (
                    <div className="p-2 bg-green-500/20 rounded-lg border border-green-500/30">
                      <p className="text-xs text-green-300">
                        This route was recorded using GPS and follows your exact path. The route cannot be changed to preserve your original track.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-white/50 px-1">Choose how the path is calculated between waypoints:</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(['direct', 'trail', 'road', 'draw'] as RoutingMode[]).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => handleRoutingModeChange(mode)}
                            disabled={isChangingRoutingMode}
                            className={`p-2 rounded-lg text-sm font-medium transition-colors ${
                              route.routingMode === mode || (!route.routingMode && mode === 'direct')
                                ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                                : 'bg-white/5 text-white/70 hover:bg-white/10 border border-transparent'
                            } ${isChangingRoutingMode ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                            data-testid={`button-routing-mode-${mode}`}
                          >
                            {isChangingRoutingMode && route.routingMode !== mode ? (
                              <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                            ) : (
                              <span className="capitalize">{mode}</span>
                            )}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-white/40 px-1">
                        {route.routingMode === 'direct' || !route.routingMode
                          ? 'Straight lines between waypoints'
                          : route.routingMode === 'trail'
                          ? 'Follows hiking trails and paths'
                          : route.routingMode === 'road'
                          ? 'Follows roads and highways'
                          : 'Custom drawn path'}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Points of Interest Section */}
          <div className="mt-3">
            <button
              onClick={() => setIsPOIsExpanded(!isPOIsExpanded)}
              className="w-full flex items-center justify-between p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              data-testid="button-toggle-pois"
            >
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-400" />
                <span className="text-sm text-white/80">Points of Interest ({pois.length})</span>
              </div>
              {isPOIsExpanded ? (
                <ChevronUp className="h-4 w-4 text-white/60" />
              ) : (
                <ChevronDown className="h-4 w-4 text-white/60" />
              )}
            </button>

            {isPOIsExpanded && (
              <div className="mt-2 space-y-2">
                {poisLoading ? (
                  <div className="text-center text-white/60 text-sm py-2">Loading...</div>
                ) : pois.length === 0 && !isAddingPOI ? (
                  <div className="text-center text-white/60 text-sm py-2">
                    No points of interest yet
                  </div>
                ) : (
                  pois.map((poi) => {
                    const poiPhotos = parsePOIPhotos(poi);
                    const isExpanded = expandedPOIId === poi.id;
                    const isUploadingPOIPhoto = uploadingPOIPhotoId === poi.id;
                    
                    return (
                      <div 
                        key={poi.id} 
                        className="bg-white/5 rounded-lg overflow-hidden"
                        data-testid={`poi-item-${poi.id}`}
                      >
                        <div 
                          className="p-2 flex items-start justify-between cursor-pointer hover:bg-white/5"
                          onClick={() => setExpandedPOIId(isExpanded ? null : poi.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Star className="h-3 w-3 text-amber-400 flex-shrink-0" />
                              <span className="text-sm font-medium text-white truncate">{poi.name}</span>
                              {poiPhotos.length > 0 && (
                                <span className="text-xs text-pink-400 flex items-center gap-0.5">
                                  <Camera className="h-3 w-3" />
                                  {poiPhotos.length}
                                </span>
                              )}
                              {isExpanded ? (
                                <ChevronUp className="h-3 w-3 text-white/40" />
                              ) : (
                                <ChevronDown className="h-3 w-3 text-white/40" />
                              )}
                            </div>
                            {poi.elevation && (
                              <p className="text-xs text-white/60 mt-0.5 ml-5">
                                Elevation: {Math.round(parseFloat(poi.elevation) * 3.28084).toLocaleString()} ft
                              </p>
                            )}
                            {!isExpanded && poi.note && (
                              <p className="text-xs text-white/60 mt-0.5 ml-5 line-clamp-1">{poi.note}</p>
                            )}
                          </div>
                          {isOwner && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deletePOIMutation.mutate(poi.id);
                              }}
                              className="p-1 hover:bg-red-500/20 rounded transition-colors ml-2"
                              data-testid={`button-delete-poi-${poi.id}`}
                            >
                              <Trash2 className="h-3 w-3 text-red-400" />
                            </button>
                          )}
                        </div>
                        
                        {isExpanded && (
                          <div className="px-2 pb-2 space-y-2">
                            {poi.note && (
                              <p className="text-xs text-white/60 ml-5">{poi.note}</p>
                            )}
                            
                            {/* POI Photos */}
                            <div className="ml-5 space-y-2">
                              {poiPhotos.length > 0 && (
                                <div className="grid grid-cols-3 gap-1">
                                  {poiPhotos.map((media, idx) => (
                                    <div key={idx} className="relative group">
                                      {isVideoFile(media) ? (
                                        <video
                                          src={media}
                                          className="w-full h-12 object-cover rounded cursor-pointer hover:opacity-80"
                                          onClick={() => setFullScreenMedia(media)}
                                          data-testid={`poi-video-${poi.id}-${idx}`}
                                          muted
                                          playsInline
                                        />
                                      ) : (
                                        <img
                                          src={media}
                                          alt={`${poi.name} photo ${idx + 1}`}
                                          className="w-full h-12 object-cover rounded cursor-pointer hover:opacity-80"
                                          onClick={() => setFullScreenMedia(media)}
                                          data-testid={`poi-photo-${poi.id}-${idx}`}
                                        />
                                      )}
                                      {isOwner && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deletePOIPhotoMutation.mutate({ poiId: poi.id, photoPath: media });
                                          }}
                                          className="absolute top-0.5 right-0.5 p-0.5 bg-red-500/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                          data-testid={`button-delete-poi-media-${poi.id}-${idx}`}
                                        >
                                          <Trash2 className="h-2.5 w-2.5 text-white" />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              
                              {isOwner && (
                                <div>
                                  <input
                                    type="file"
                                    accept="image/*,video/*"
                                    multiple
                                    className="hidden"
                                    id={`poi-photo-input-${poi.id}`}
                                    onChange={handlePOIPhotoUpload(poi.id)}
                                    data-testid={`input-poi-photos-${poi.id}`}
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => document.getElementById(`poi-photo-input-${poi.id}`)?.click()}
                                    disabled={isUploadingPOIPhoto}
                                    className="h-6 text-xs border-white/20 text-white hover:bg-white/10"
                                    data-testid={`button-upload-poi-photos-${poi.id}`}
                                  >
                                    {isUploadingPOIPhoto ? (
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    ) : (
                                      <Camera className="h-3 w-3 mr-1" />
                                    )}
                                    {isUploadingPOIPhoto ? 'Uploading...' : 'Add Media'}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {isAddingPOI && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <p className="text-xs text-amber-300 mb-2">
                      {createPOIMutation.isPending 
                        ? 'Creating POI...'
                        : 'Click on the map to place your POI'
                      }
                    </p>
                    <Button
                      onClick={handleCancelAddPOI}
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs"
                      data-testid="button-cancel-poi"
                      disabled={createPOIMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {isOwner && !isAddingPOI && (
                  <Button
                    onClick={handleStartAddPOI}
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    data-testid="button-add-poi"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Point of Interest
                  </Button>
                )}
              </div>
            )}
          </div>
          
          {/* Route Notes Section */}
          <div className="mt-3">
            <button
              onClick={() => setIsNotesExpanded(!isNotesExpanded)}
              className="w-full flex items-center justify-between p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              data-testid="button-toggle-notes"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-yellow-400" />
                <span className="text-sm text-white/80">Route Notes</span>
              </div>
              {isNotesExpanded ? (
                <ChevronUp className="h-4 w-4 text-white/60" />
              ) : (
                <ChevronDown className="h-4 w-4 text-white/60" />
              )}
            </button>
            
            {isNotesExpanded && (
              <div className="mt-2">
                <input
                  type="file"
                  ref={scanInputRef}
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleScanText(file);
                    e.target.value = '';
                  }}
                />
                {isLoadingNotes ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-white/60" />
                  </div>
                ) : (
                  <>
                    {isOwner && (
                      <div className="flex flex-wrap items-center gap-1.5 mb-3">
                        {isAddingCategory ? (
                          <div className="flex gap-1.5 w-full">
                            <Input
                              value={newCategoryName}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                              placeholder="Subject name..."
                              className="bg-white/5 border-white/10 text-white text-sm h-7 flex-1"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newCategoryName.trim()) {
                                  createNoteMutation.mutate({ category: newCategoryName.trim(), position: routeNotes.length });
                                } else if (e.key === 'Escape') {
                                  setIsAddingCategory(false);
                                  setNewCategoryName('');
                                }
                              }}
                              autoFocus
                            />
                            <button
                              className="h-7 px-2 text-yellow-400 hover:bg-white/5 rounded transition-colors disabled:opacity-30"
                              onClick={() => {
                                if (newCategoryName.trim()) {
                                  createNoteMutation.mutate({ category: newCategoryName.trim(), position: routeNotes.length });
                                }
                              }}
                              disabled={!newCategoryName.trim() || createNoteMutation.isPending}
                            >
                              {createNoteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              className="h-7 px-2 text-white/40 hover:bg-white/5 rounded transition-colors"
                              onClick={() => {
                                setIsAddingCategory(false);
                                setNewCategoryName('');
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              className="text-xs px-2.5 py-1 text-white/40 hover:text-white/60 bg-white/5 hover:bg-white/10 rounded-md transition-colors"
                              onClick={() => setIsAddingCategory(true)}
                            >
                              <Plus className="h-3 w-3 inline mr-0.5" />
                              Add subject
                            </button>
                            <button
                              className="text-xs px-2.5 py-1 text-white/40 hover:text-white/60 bg-white/5 hover:bg-white/10 rounded-md transition-colors disabled:opacity-30"
                              onClick={() => scanInputRef.current?.click()}
                              disabled={isScanning}
                              title="Scan text from photo"
                            >
                              <Camera className="h-3 w-3 inline mr-0.5" />
                              {isScanning ? `${scanProgress}%` : 'Scan'}
                            </button>
                            {defaultCategories
                              .filter(cat => !routeNotes.some(n => n.category === cat))
                              .map(cat => (
                                <button
                                  key={cat}
                                  onClick={() => createNoteMutation.mutate({ category: cat, position: routeNotes.length })}
                                  className="text-xs px-2.5 py-1 text-yellow-400/70 hover:text-yellow-400 bg-white/5 hover:bg-white/10 rounded-md transition-colors"
                                >
                                  + {cat}
                                </button>
                              ))}
                          </>
                        )}
                      </div>
                    )}

                    {isScanning && (
                      <div className="flex items-center gap-2 mb-3 px-1">
                        <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                        <span className="text-xs text-white/50">Scanning text... {scanProgress}%</span>
                      </div>
                    )}

                    {routeNotes.map((note) => {
                      const isCollapsed = collapsedNoteIds.has(note.id);
                      const isSwiping = swipingNoteId === note.id;
                      const currentOffset = isSwiping ? swipeOffset : 0;
                      const showDeleteBg = currentOffset > 60;

                      return (
                        <div key={note.id} className="mb-2 overflow-hidden rounded-lg">
                          <div className="relative">
                            {showDeleteBg && (
                              <div
                                className="absolute inset-0 bg-red-500/80 flex items-center justify-end pr-4 rounded-lg"
                              >
                                <Trash2 className="h-4 w-4 text-white" />
                              </div>
                            )}
                            <div
                              style={{
                                transform: currentOffset > 0 ? `translateX(-${currentOffset}px)` : 'translateX(0)',
                                transition: isSwiping ? 'none' : 'transform 0.3s ease'
                              }}
                              className="relative bg-white/5 rounded-lg"
                              onTouchStart={(e) => isOwner && handleNoteTouchStart(note.id, e)}
                              onTouchMove={(e) => isOwner && handleNoteTouchMove(e)}
                              onTouchEnd={() => isOwner && handleNoteTouchEnd(note.id)}
                            >
                              <div className="w-full flex items-center gap-2 p-2.5">
                                <button
                                  onClick={() => {
                                    if (!wasSwiping.current) toggleNoteCollapsed(note.id);
                                  }}
                                  className="flex-shrink-0"
                                >
                                  <ChevronRight
                                    className="h-3.5 w-3.5 text-white/40 transition-transform duration-200"
                                    style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                                  />
                                </button>
                                {editingCategoryNoteId === note.id && isOwner ? (
                                  <input
                                    type="text"
                                    value={editingCategoryValue}
                                    onChange={(e) => setEditingCategoryValue(e.target.value)}
                                    onBlur={() => {
                                      const trimmed = editingCategoryValue.trim();
                                      if (trimmed && trimmed !== note.category) {
                                        updateNoteMutation.mutate({ noteId: note.id, category: trimmed });
                                      }
                                      setEditingCategoryNoteId(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLInputElement).blur();
                                      } else if (e.key === 'Escape') {
                                        setEditingCategoryNoteId(null);
                                      }
                                    }}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    onTouchMove={(e) => e.stopPropagation()}
                                    onTouchEnd={(e) => e.stopPropagation()}
                                    className="flex-1 text-sm font-medium text-white bg-white/10 border border-white/20 rounded px-1.5 py-0.5 outline-none focus:border-yellow-400/50"
                                    autoFocus
                                  />
                                ) : (
                                  <span
                                    className={`text-sm font-medium text-white/80 flex-1 flex items-center gap-1.5 ${isOwner ? 'cursor-text hover:text-white group/cat' : ''}`}
                                    onTouchEnd={(e) => {
                                      if (isOwner && !wasSwiping.current) {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        setEditingCategoryNoteId(note.id);
                                        setEditingCategoryValue(note.category);
                                      }
                                    }}
                                    onClick={(e) => {
                                      if (isOwner) {
                                        e.stopPropagation();
                                        setEditingCategoryNoteId(note.id);
                                        setEditingCategoryValue(note.category);
                                      }
                                    }}
                                  >
                                    {note.category || <span className="text-white/30 italic">Untitled</span>}
                                    {isOwner && <Pencil className="h-2.5 w-2.5 text-white/20 group-hover/cat:text-white/50 flex-shrink-0" />}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {!isCollapsed && (
                            <div className="px-1 pt-1 pb-1">
                              {isOwner ? (
                                <div>
                                  <Textarea
                                    value={getNoteContent(note)}
                                    onChange={(e) => handleNoteContentChange(note.id, e.target.value)}
                                    placeholder="Write here..."
                                    className="bg-transparent border-white/5 text-white text-sm min-h-[60px] resize-y focus-visible:ring-0 focus-visible:border-white/15"
                                    data-testid={`input-route-note-${note.id}`}
                                  />
                                  <p className="text-[10px] text-white/20 mt-0.5 text-right">auto-saves</p>
                                </div>
                              ) : (
                                <div className="text-sm text-white/70 whitespace-pre-wrap py-1 px-2">
                                  {note.content || <span className="text-white/30 italic">Empty</span>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {routeNotes.length === 0 && !isOwner && (
                      <p className="text-xs text-white/30 text-center py-3">No notes for this route</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Photos Section */}
          <div className="mt-3">
            <button
              onClick={() => setIsPhotosExpanded(!isPhotosExpanded)}
              className="w-full flex items-center justify-between p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              data-testid="button-toggle-photos"
            >
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-pink-400" />
                <span className="text-sm text-white/80">Media ({routePhotos.length})</span>
              </div>
              {isPhotosExpanded ? (
                <ChevronUp className="h-4 w-4 text-white/60" />
              ) : (
                <ChevronDown className="h-4 w-4 text-white/60" />
              )}
            </button>
            
            {isPhotosExpanded && (
              <div className="mt-2 space-y-2">
                {routePhotos.length === 0 ? (
                  <div className="text-center text-white/60 text-sm py-2">
                    No media yet
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {routePhotos.map((media, index) => (
                      <div key={index} className="relative group">
                        {isVideoFile(media) ? (
                          <video
                            src={media}
                            className="w-full h-20 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                            data-testid={`route-video-${index}`}
                            onClick={() => setFullScreenMedia(media)}
                            muted
                            playsInline
                          />
                        ) : (
                          <img
                            src={media}
                            alt={`Route photo ${index + 1}`}
                            className="w-full h-20 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                            data-testid={`route-photo-${index}`}
                            onClick={() => setFullScreenMedia(media)}
                          />
                        )}
                        {isOwner && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePhotoMutation.mutate(media);
                            }}
                            className="absolute top-1 right-1 p-1 bg-red-500/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-delete-media-${index}`}
                          >
                            <Trash2 className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                {isOwner && (
                  <div className="pt-2">
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={handlePhotoUpload}
                      data-testid="input-route-photos"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={isUploadingPhoto}
                      className="w-full border-white/20 text-white hover:bg-white/10"
                      data-testid="button-upload-route-photos"
                    >
                      {isUploadingPhoto ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      {isUploadingPhoto ? 'Uploading...' : 'Add Media'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Screen Media Viewer */}
      {fullScreenMedia && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
          onClick={() => setFullScreenMedia(null)}
          data-testid="fullscreen-media-overlay"
        >
          <button
            onClick={() => setFullScreenMedia(null)}
            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors z-10"
            data-testid="button-close-fullscreen"
          >
            <X className="h-6 w-6 text-white" />
          </button>
          
          {isVideoFile(fullScreenMedia) ? (
            <video
              src={fullScreenMedia}
              className="max-w-[90vw] max-h-[90vh] object-contain"
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
              data-testid="fullscreen-video"
            />
          ) : (
            <img
              src={fullScreenMedia}
              alt="Full screen view"
              className="max-w-[90vw] max-h-[90vh] object-contain"
              onClick={(e) => e.stopPropagation()}
              data-testid="fullscreen-image"
            />
          )}
        </div>
      )}
    </div>
  );
}
