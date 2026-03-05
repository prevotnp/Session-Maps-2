import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { X, Plus, Trash2, Save, Route as RouteIcon, Mountain, Timer, Share2, Pencil, ImagePlus, FileText, Sparkles, Wand2, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Waypoint, Route } from '@shared/schema';
import mapboxgl from 'mapbox-gl';
import { ShareRouteModal } from './ShareRouteModal';

interface RouteBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  map: mapboxgl.Map | null;
  existingWaypoints: Waypoint[];
  temporaryWaypoints?: Array<{
    id: string;
    name: string;
    lngLat: [number, number];
    elevation: number | null;
  }>;
  onStartWaypointPlacement?: (routeName: string, routeDescription: string) => void;
  editingRoute?: Route;
  displayEditableRouteWaypoints?: (
    pathCoordinates: [number, number][], 
    onWaypointsUpdate?: (waypoints: Array<{id: string; lngLat: [number, number]}>) => void,
    onWaypointDelete?: (index: number) => void,
    onWaypointEdit?: (index: number, newName: string) => void
  ) => void;
  getEditableWaypointPositions?: () => [number, number][];
  clearEditableRouteWaypoints?: () => void;
  enableDrawRouteMode?: (
    pathCoordinates: [number, number][],
    waypointCoordinates: [number, number][],
    onPathChange: (newPath: [number, number][]) => void
  ) => void;
  disableDrawRouteMode?: () => void;
  onDisplayRouteAfterSave?: (route: Route) => void;
}

interface OriginalWaypoint {
  name: string;
  lngLat: [number, number];
  elevation: number | null;
}

type TrailProfile = 'foot-hiking' | 'foot-walking' | 'cycling-regular' | 'cycling-mountain' | 'cycling-road' | 'cycling-electric';

const TRAIL_PROFILE_OPTIONS: { value: TrailProfile; label: string; icon: string }[] = [
  { value: 'foot-hiking', label: 'Hiking', icon: '🥾' },
  { value: 'foot-walking', label: 'Walking', icon: '🚶' },
  { value: 'cycling-regular', label: 'Cycling', icon: '🚴' },
  { value: 'cycling-mountain', label: 'Mountain Bike', icon: '🚵' },
  { value: 'cycling-road', label: 'Road Bike', icon: '🚲' },
  { value: 'cycling-electric', label: 'E-Bike', icon: '⚡' },
];

interface RouteBuilderState {
  name: string;
  description: string;
  selectedWaypoints: number[];
  isPublic: boolean;
  routingMode: 'direct' | 'road' | 'trail' | 'draw';
  trailProfile: TrailProfile;
  pathCoordinates: [number, number][];
  waypointCoordinates: OriginalWaypoint[];
  totalDistance: number;
  elevationGain: number;
  elevationLoss: number;
  estimatedTime: number;
}

export default function RouteBuilderModal({ 
  isOpen, 
  onClose, 
  map,
  existingWaypoints,
  temporaryWaypoints = [],
  onStartWaypointPlacement,
  editingRoute,
  displayEditableRouteWaypoints,
  getEditableWaypointPositions,
  clearEditableRouteWaypoints,
  enableDrawRouteMode,
  disableDrawRouteMode,
  onDisplayRouteAfterSave
}: RouteBuilderModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [routeState, setRouteState] = useState<RouteBuilderState>({
    name: '',
    description: '',
    selectedWaypoints: [],
    isPublic: false,
    routingMode: 'direct',
    trailProfile: 'foot-hiking',
    pathCoordinates: [],
    waypointCoordinates: [],
    totalDistance: 0,
    elevationGain: 0,
    elevationLoss: 0,
    estimatedTime: 0
  });

  const [isCalculating, setIsCalculating] = useState(false);
  const [routeSourceId, setRouteSourceId] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [routeNotes, setRouteNotes] = useState('');
  const [routePhotos, setRoutePhotos] = useState<string[]>([]);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [waypointsModified, setWaypointsModified] = useState(false);
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingAiRoute, setIsGeneratingAiRoute] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiWaypointsLoaded, setAiWaypointsLoaded] = useState(false);
  const aiMarkersDisplayedRef = useRef(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiRouteOptions, setAiRouteOptions] = useState<Array<{
    label: string;
    source: 'trail_data' | 'community';
    description: string;
    color: string;
    waypoints: Array<{ name: string; lat: number; lng: number; description?: string }>;
    communityRouteId?: number;
    communityAuthor?: string;
  }> | null>(null);
  const [aiConversationHistory, setAiConversationHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [aiPreviewRoutes, setAiPreviewRoutes] = useState<Array<{
    label: string;
    source: 'trail_data' | 'community';
    description: string;
    color: string;
    waypoints: Array<{ name: string; lat: number; lng: number; description?: string }>;
    communityRouteId?: number;
    communityAuthor?: string;
  }> | null>(null);
  const [originalWaypointPositions, setOriginalWaypointPositions] = useState<string>('');

  // Initialize notes and photos when editing
  useEffect(() => {
    if (editingRoute && isOpen) {
      setRouteNotes(editingRoute.notes || '');
      try {
        setRoutePhotos(editingRoute.photos ? JSON.parse(editingRoute.photos) : []);
      } catch {
        setRoutePhotos([]);
      }
    }
  }, [editingRoute, isOpen]);

  // Handle photo upload
  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !editingRoute) return;

    setIsUploadingPhotos(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('photos', files[i]);
      }

      const response = await fetch(`/api/routes/${editingRoute.id}/photos`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Failed to upload photos');
      }

      const result = await response.json();
      setRoutePhotos(result.photos);
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({
        title: "Photos uploaded",
        description: `${files.length} photo(s) added successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload photos",
        variant: "destructive",
      });
    } finally {
      setIsUploadingPhotos(false);
      event.target.value = '';
    }
  };

  // Handle photo delete
  const handleDeletePhoto = async (photoPath: string) => {
    if (!editingRoute) return;

    try {
      const response = await fetch(`/api/routes/${editingRoute.id}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoPath }),
        credentials: 'include'
      });

      if (!response.ok) throw new Error('Failed to delete photo');
      const result = await response.json();
      setRoutePhotos(result.photos);
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({
        title: "Photo deleted",
      });
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error.message || "Failed to delete photo",
        variant: "destructive",
      });
    }
  };

  // Fetch user's routes
  const { data: userRoutes = [] } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
    enabled: isOpen,
  });

  // Create route mutation
  const createRouteMutation = useMutation({
    mutationFn: async (routeData: any) => {
      const res = await apiRequest("POST", "/api/routes", routeData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({
        title: "Route saved",
        description: "Your route has been saved successfully.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving route",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Update route mutation
  const updateRouteMutation = useMutation({
    mutationFn: async (routeData: any) => {
      const res = await apiRequest("PUT", `/api/routes/${editingRoute?.id}`, routeData);
      return await res.json();
    },
    onSuccess: (updatedRoute: Route) => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({
        title: "Route updated",
        description: "Your route has been updated successfully.",
      });
      onClose();
      // Display the updated route on the map
      if (onDisplayRouteAfterSave && updatedRoute) {
        onDisplayRouteAfterSave(updatedRoute);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating route",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  // Initialize state with editing route data
  useEffect(() => {
    if (editingRoute && isOpen) {
      const pathCoordinates = JSON.parse(editingRoute.pathCoordinates || '[]');
      const waypointCoordinates = editingRoute.waypointCoordinates 
        ? JSON.parse(editingRoute.waypointCoordinates) 
        : [];
      
      // Preserve the original routing mode from the saved route
      const savedRoutingMode = editingRoute.routingMode === 'rivers' ? 'trail' : editingRoute.routingMode as 'direct' | 'road' | 'trail' | 'draw' | undefined;
      const routingMode = savedRoutingMode || 'direct';
      
      setRouteState({
        name: editingRoute.name,
        description: editingRoute.description || '',
        selectedWaypoints: [],
        isPublic: editingRoute.isPublic ?? false,
        routingMode: routingMode,
        trailProfile: ((editingRoute as any).trailProfile as TrailProfile) || 'foot-hiking',
        pathCoordinates: pathCoordinates,
        waypointCoordinates: waypointCoordinates,
        totalDistance: parseFloat(String(editingRoute.totalDistance)),
        elevationGain: parseFloat(String(editingRoute.elevationGain || '0')),
        elevationLoss: parseFloat(String(editingRoute.elevationLoss || '0')),
        estimatedTime: parseInt(String(editingRoute.estimatedTime || '0'))
      });
      // Store original positions for comparison
      const originalPositions = JSON.stringify(waypointCoordinates.map((w: OriginalWaypoint) => w.lngLat));
      setOriginalWaypointPositions(originalPositions);
      // Reset modified flag when loading a route
      setWaypointsModified(false);
    }
  }, [editingRoute, isOpen]);
  
  // Detect when waypoints have been modified by comparing to original positions
  useEffect(() => {
    if (editingRoute && originalWaypointPositions) {
      const currentPositions = JSON.stringify(routeState.waypointCoordinates.map(w => w.lngLat));
      if (currentPositions !== originalWaypointPositions) {
        setWaypointsModified(true);
      }
    }
  }, [editingRoute, routeState.waypointCoordinates, originalWaypointPositions]);
  
  // Track whether we've already displayed the editable waypoints for this editing session
  const editMarkersDisplayedRef = useRef(false);
  
  // Reset the ref when modal opens/closes or when editing a different route
  useEffect(() => {
    if (!isOpen) {
      editMarkersDisplayedRef.current = false;
    }
  }, [isOpen, editingRoute?.id]);
  
  // Display editing route on map ONCE when state is initialized
  // Use waypointCoordinates (user's actual waypoints) not pathCoordinates (full route path)
  useEffect(() => {
    // Only display markers once when editing and waypoints are loaded
    if (editingRoute && routeState.waypointCoordinates.length > 0 && map && displayEditableRouteWaypoints && !editMarkersDisplayedRef.current) {
      editMarkersDisplayedRef.current = true;
      
      // Display only the user's actual waypoints, not all points along the path
      const waypointLngLats = routeState.waypointCoordinates.map(w => w.lngLat);
      displayEditableRouteWaypoints(
        waypointLngLats, 
        // Callback for when waypoints are dragged - just mark as modified, don't update React state
        // The actual positions are read from the markers at save time
        () => {
          setWaypointsModified(true);
        },
        // Callback for when a waypoint is deleted (from map popup)
        (indexToDelete) => {
          // Get current positions from map markers BEFORE deleting
          // This preserves any drag adjustments made to other waypoints
          const currentPositions = getEditableWaypointPositions ? getEditableWaypointPositions() : null;
          
          setRouteState(prev => {
            if (currentPositions && currentPositions.length === prev.waypointCoordinates.length) {
              // We have fresh marker positions - use them
              const updatedWaypointCoords = prev.waypointCoordinates.map((wp, idx) => ({
                ...wp,
                lngLat: currentPositions[idx]
              }));
              
              const newWaypoints = updatedWaypointCoords.filter((_, idx) => idx !== indexToDelete);
              
              return {
                ...prev,
                waypointCoordinates: newWaypoints,
                pathCoordinates: newWaypoints.map(w => w.lngLat)
              };
            } else {
              // Fallback - just delete from state
              const newWaypoints = prev.waypointCoordinates.filter((_, idx) => idx !== indexToDelete);
              return {
                ...prev,
                waypointCoordinates: newWaypoints,
                pathCoordinates: newWaypoints.map(w => w.lngLat)
              };
            }
          });
          // Need to re-display markers after deletion
          editMarkersDisplayedRef.current = false;
        },
        // Callback for when a waypoint name is edited
        (indexToEdit, newName) => {
          setRouteState(prev => ({
            ...prev,
            waypointCoordinates: prev.waypointCoordinates.map((wp, idx) => 
              idx === indexToEdit ? { ...wp, name: newName } : wp
            )
          }));
        }
      );
    }
  }, [editingRoute, routeState.waypointCoordinates.length, map, displayEditableRouteWaypoints]);

  useEffect(() => {
    if (!aiWaypointsLoaded || routeState.waypointCoordinates.length < 2 || !map || !displayEditableRouteWaypoints) return;
    if (aiMarkersDisplayedRef.current) return;

    aiMarkersDisplayedRef.current = true;
    setAiWaypointsLoaded(false);

    const waypointLngLats = routeState.waypointCoordinates.map(w => w.lngLat);
    displayEditableRouteWaypoints(
      waypointLngLats,
      () => {
        setWaypointsModified(true);
      },
      (indexToDelete) => {
        const currentPositions = getEditableWaypointPositions ? getEditableWaypointPositions() : null;

        setRouteState(prev => {
          if (currentPositions && currentPositions.length === prev.waypointCoordinates.length) {
            const updatedWaypointCoords = prev.waypointCoordinates.map((wp, idx) => ({
              ...wp,
              lngLat: currentPositions[idx]
            }));
            const newWaypoints = updatedWaypointCoords.filter((_, idx) => idx !== indexToDelete);
            return {
              ...prev,
              waypointCoordinates: newWaypoints,
              pathCoordinates: newWaypoints.map(w => w.lngLat)
            };
          } else {
            const newWaypoints = prev.waypointCoordinates.filter((_, idx) => idx !== indexToDelete);
            return {
              ...prev,
              waypointCoordinates: newWaypoints,
              pathCoordinates: newWaypoints.map(w => w.lngLat)
            };
          }
        });
        aiMarkersDisplayedRef.current = false;
      },
      (indexToEdit, newName) => {
        setRouteState(prev => ({
          ...prev,
          waypointCoordinates: prev.waypointCoordinates.map((wp, idx) =>
            idx === indexToEdit ? { ...wp, name: newName } : wp
          )
        }));
      }
    );

    const lngs = waypointLngLats.map(w => w[0]);
    const lats = waypointLngLats.map(w => w[1]);
    const bounds = new mapboxgl.LngLatBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    );
    map.fitBounds(bounds, { padding: 80, duration: 1500 });

    setTimeout(() => {
      calculateOptimizedRoute();
    }, 500);

  }, [aiWaypointsLoaded, routeState.waypointCoordinates.length, map, displayEditableRouteWaypoints]);

  // Calculate optimized route using Mapbox Directions API or direct lines
  const calculateOptimizedRoute = useCallback(async () => {
    if (!map) return;

    // Use temporary waypoints if available, otherwise use selected existing waypoints, 
    // or use waypoint coordinates from editing route
    const useTemporaryWaypoints = temporaryWaypoints.length >= 2;
    const useExistingWaypoints = routeState.selectedWaypoints.length >= 2;
    const useEditingWaypoints = routeState.waypointCoordinates.length >= 2;
    
    if (!useTemporaryWaypoints && !useExistingWaypoints && !useEditingWaypoints) return;

    setIsCalculating(true);
    
    try {
      let coordinates: [number, number][];
      let waypointsForDisplay: any[];
      
      if (useTemporaryWaypoints) {
        // Use temporary waypoints created by clicking on map
        coordinates = temporaryWaypoints.map(w => w.lngLat);
        waypointsForDisplay = temporaryWaypoints;
      } else if (useExistingWaypoints) {
        // Use existing saved waypoints
        const waypoints = routeState.selectedWaypoints
          .map(id => existingWaypoints.find(w => w.id === id))
          .filter(Boolean) as Waypoint[];
        coordinates = waypoints.map(w => [parseFloat(w.longitude), parseFloat(w.latitude)]);
        waypointsForDisplay = waypoints;
      } else {
        // Use waypoint coordinates from editing route
        coordinates = routeState.waypointCoordinates.map(w => w.lngLat);
        waypointsForDisplay = routeState.waypointCoordinates.map((w, i) => ({
          name: w.name || `Waypoint ${i + 1}`,
          lngLat: w.lngLat,
          elevation: w.elevation
        }));
      }
      
      // Build original waypoint coordinates from the source waypoints
      const originalWaypoints: OriginalWaypoint[] = useTemporaryWaypoints
        ? temporaryWaypoints.map(w => ({ name: w.name, lngLat: w.lngLat, elevation: w.elevation }))
        : useExistingWaypoints
          ? (routeState.selectedWaypoints
              .map(id => existingWaypoints.find(w => w.id === id))
              .filter(Boolean) as Waypoint[])
              .map((w, i) => ({ 
                name: w.name || `Waypoint ${i + 1}`, 
                lngLat: [parseFloat(w.longitude), parseFloat(w.latitude)] as [number, number], 
                elevation: w.elevation ? parseFloat(w.elevation) : null 
              }))
          : routeState.waypointCoordinates;
      
      if (routeState.routingMode === 'direct' || routeState.routingMode === 'draw') {
        // Direct/Draw mode: Connect waypoints with straight lines
        // For draw mode, the path can be further shaped by dragging control points
        const pathCoordinates = coordinates as [number, number][];
        
        // Calculate distance along the path (sum of all segments)
        let totalDistance = 0;
        for (let i = 0; i < pathCoordinates.length - 1; i++) {
          const from = pathCoordinates[i];
          const to = pathCoordinates[i + 1];
          const distance = calculateDistance(from[1], from[0], to[1], to[0]);
          totalDistance += distance;
        }
        
        // Calculate elevation data for the route (non-blocking)
        let elevationData = { gain: 0, loss: 0 };
        try {
          elevationData = await calculateElevationData(pathCoordinates);
        } catch (elevError) {
          console.warn('Elevation calculation failed, using defaults:', elevError);
        }
        
        setRouteState(prev => ({
          ...prev,
          pathCoordinates,
          waypointCoordinates: originalWaypoints,
          totalDistance,
          elevationGain: elevationData.gain,
          elevationLoss: elevationData.loss,
          estimatedTime: Math.round(totalDistance / 83.33) // Assume 5 km/h walking speed (83.33 m/min)
        }));

        // Display route on map - skip fitBounds to allow user to pan and add more waypoints
        displayRouteOnMap(pathCoordinates, waypointsForDisplay, true);
      } else if (routeState.routingMode === 'trail') {
        console.log(`Calculating ${routeState.trailProfile} trail route via ORS...`);

        const trailResponse = await fetch('/api/ors/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ waypoints: coordinates, profile: routeState.trailProfile })
        });

        const trailData = await trailResponse.json();
        console.log('Hiking route response:', trailData);

        if (!trailData.success || !trailData.coordinates || trailData.coordinates.length === 0) {
          console.error('Hiking route failed:', trailData.message);
          toast({
            title: "Trail routing failed",
            description: trailData.message || "Could not find a trail route. Try moving waypoints closer to trails or use Direct mode.",
            variant: "destructive",
          });
          return;
        }

        const pathCoordinates = trailData.coordinates as [number, number][];

        let elevGain = trailData.elevationGain || 0;
        let elevLoss = trailData.elevationLoss || 0;
        if (!elevGain && !elevLoss) {
          try {
            const elevationData = await calculateElevationData(pathCoordinates);
            elevGain = elevationData.gain;
            elevLoss = elevationData.loss;
          } catch (elevError) {
            console.warn('Elevation calculation failed:', elevError);
          }
        }

        const estimatedTime = trailData.duration
          ? Math.round(trailData.duration / 60)
          : Math.round(trailData.distance / 83.33);

        setRouteState(prev => ({
          ...prev,
          pathCoordinates,
          waypointCoordinates: originalWaypoints,
          totalDistance: trailData.distance,
          elevationGain: elevGain,
          elevationLoss: elevLoss,
          estimatedTime
        }));

        displayRouteOnMap(pathCoordinates, waypointsForDisplay, true);

      } else {
        // Road mode: Use Mapbox Directions API with driving profile
        const coordinatesStr = coordinates.map(coord => coord.join(',')).join(';');
        const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesStr}?geometries=geojson&overview=full&steps=true&access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}`;
        
        const response = await fetch(directionsUrl);
        const data = await response.json();
        
        console.log('Mapbox Directions API response:', data);
        
        if (data.code && data.code !== 'Ok') {
          // Mapbox returned an error
          console.error('Mapbox API error:', data);
          toast({
            title: "Route calculation failed",
            description: data.message || `Mapbox error: ${data.code}`,
            variant: "destructive",
          });
          return;
        }
        
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const pathCoordinates = route.geometry.coordinates;
          
          // Calculate elevation data for the route (non-blocking)
          let elevationData = { gain: 0, loss: 0 };
          try {
            elevationData = await calculateElevationData(pathCoordinates);
          } catch (elevError) {
            console.warn('Elevation calculation failed, using defaults:', elevError);
          }
          
          setRouteState(prev => ({
            ...prev,
            pathCoordinates,
            waypointCoordinates: originalWaypoints,
            totalDistance: route.distance,
            elevationGain: elevationData.gain,
            elevationLoss: elevationData.loss,
            estimatedTime: Math.round(route.duration / 60) // Convert seconds to minutes
          }));

          // Display route on map - skip fitBounds to allow user to pan and add more waypoints
          displayRouteOnMap(pathCoordinates, waypointsForDisplay, true);
        } else {
          console.error('No routes returned from Mapbox:', data);
          toast({
            title: "Route calculation failed",
            description: "Could not find a route between waypoints. Try using Direct mode or different locations.",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error('Error calculating route:', error);
      toast({
        title: "Error calculating route",
        description: "Failed to calculate optimized route.",
        variant: "destructive",
      });
    } finally {
      setIsCalculating(false);
    }
  }, [routeState.selectedWaypoints, routeState.routingMode, existingWaypoints, temporaryWaypoints, map, toast]);

  const ROUTE_COLORS: Record<string, string> = {
    blue: '#3B82F6',
    orange: '#F97316',
    green: '#22C55E',
  };

  const previewClickHandlersRef = useRef<Map<string, (e: any) => void>>(new Map());
  const previewEnterHandlersRef = useRef<Map<string, () => void>>(new Map());
  const previewLeaveHandlersRef = useRef<Map<string, () => void>>(new Map());

  const clearPreviewRoutes = useCallback(() => {
    if (!map) return;
    ['blue', 'orange', 'green'].forEach(color => {
      const layerId = `ai-preview-route-${color}`;
      const sourceId = `ai-preview-source-${color}`;
      const outlineId = `ai-preview-outline-${color}`;

      const clickHandler = previewClickHandlersRef.current.get(layerId);
      const enterHandler = previewEnterHandlersRef.current.get(layerId);
      const leaveHandler = previewLeaveHandlersRef.current.get(layerId);
      if (clickHandler) { try { map.off('click', layerId, clickHandler); } catch {} }
      if (enterHandler) { try { map.off('mouseenter', layerId, enterHandler); } catch {} }
      if (leaveHandler) { try { map.off('mouseleave', layerId, leaveHandler); } catch {} }

      try {
        if (map.getLayer(outlineId)) map.removeLayer(outlineId);
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch (e) { /* ignore */ }
    });
    previewClickHandlersRef.current.clear();
    previewEnterHandlersRef.current.clear();
    previewLeaveHandlersRef.current.clear();
    document.querySelectorAll('.ai-preview-marker').forEach(el => el.remove());
  }, [map]);

  const drawPreviewRoutes = useCallback((options: Array<{
    color: string;
    waypoints: Array<{ name: string; lat: number; lng: number; description?: string }>;
    label: string;
    description?: string;
  }>) => {
    if (!map) return;

    clearPreviewRoutes();

    options.forEach((option, optIndex) => {
      const color = option.color || 'blue';
      const hexColor = ROUTE_COLORS[color] || ROUTE_COLORS.blue;
      const layerId = `ai-preview-route-${color}`;
      const sourceId = `ai-preview-source-${color}`;
      const outlineId = `ai-preview-outline-${color}`;

      const coordinates = option.waypoints.map(wp => [wp.lng, wp.lat]);

      const geojson: GeoJSON.Feature = {
        type: 'Feature',
        properties: { label: option.label, color: color },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      };

      map.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
      });

      map.addLayer({
        id: outlineId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000000', 'line-width': 6, 'line-opacity': 0.3 },
      });

      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': hexColor, 'line-width': 4, 'line-opacity': 0.85 },
      });

      const startWp = option.waypoints[0];
      if (startWp) {
        const el = document.createElement('div');
        el.className = 'ai-preview-marker';
        el.style.cssText = `
          width: 28px; height: 28px; border-radius: 50%;
          background: ${hexColor}; border: 3px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 12px; font-weight: bold; color: white;
        `;
        el.textContent = String(optIndex + 1);
        el.title = option.label;

        new mapboxgl.Marker({ element: el })
          .setLngLat([startWp.lng, startWp.lat])
          .addTo(map);
      }
    });

    ['blue', 'orange', 'green'].forEach(color => {
      const layerId = `ai-preview-route-${color}`;
      if (map.getLayer(layerId)) {
        const clickHandler = (e: any) => {
          const label = e.features?.[0]?.properties?.label;
          if (label) {
            const option = options.find(o => o.label === label);
            if (option) {
              new mapboxgl.Popup({ closeButton: true, maxWidth: '250px' })
                .setLngLat(e.lngLat)
                .setHTML(`
                  <div style="font-family: system-ui; font-size: 13px;">
                    <strong style="color: ${ROUTE_COLORS[color] || '#3B82F6'}">${option.label}</strong>
                    <p style="margin: 4px 0; color: #666; font-size: 11px;">${option.description || ''}</p>
                    <p style="margin: 4px 0; font-size: 11px; color: #888;">${option.waypoints.length} waypoints</p>
                  </div>
                `)
                .addTo(map);
            }
          }
        };
        const enterHandler = () => { map.getCanvas().style.cursor = 'pointer'; };
        const leaveHandler = () => { map.getCanvas().style.cursor = ''; };

        map.on('click', layerId, clickHandler);
        map.on('mouseenter', layerId, enterHandler);
        map.on('mouseleave', layerId, leaveHandler);

        previewClickHandlersRef.current.set(layerId, clickHandler);
        previewEnterHandlersRef.current.set(layerId, enterHandler);
        previewLeaveHandlersRef.current.set(layerId, leaveHandler);
      }
    });
  }, [map, clearPreviewRoutes]);

  const generateAiRoute = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    setIsGeneratingAiRoute(true);
    setAiError(null);
    setAiResponse(null);
    setAiRouteOptions(null);
    setAiPreviewRoutes(null);

    clearPreviewRoutes();

    try {
      const mapCenter = map ? map.getCenter() : null;

      let activityType = 'hiking';
      if (routeState.routingMode === 'road') activityType = 'general';

      const response = await fetch('/api/ai/route-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: aiPrompt.trim(),
          activityType,
          mapCenter: {
            lat: mapCenter?.lat || 43.48,
            lng: mapCenter?.lng || -110.76,
          },
          mapZoom: map?.getZoom() || 12,
          conversationHistory: aiConversationHistory,
          existingRoute: routeState.waypointCoordinates.length >= 2 ? {
            name: routeState.name,
            waypoints: routeState.waypointCoordinates.map((wp: any) => ({
              name: wp.name,
              lat: wp.lngLat[1],
              lng: wp.lngLat[0],
              elevation: wp.elevation || undefined,
            })),
            totalDistance: routeState.totalDistance,
            elevationGain: routeState.elevationGain,
            elevationLoss: routeState.elevationLoss,
            routingMode: routeState.routingMode,
          } : undefined,
        }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        setAiError(data.message || data.error || "Failed to get AI response");
        return;
      }

      setAiResponse(data.message);
      setAiRouteOptions(data.routeOptions || null);

      if (data.routeOptions && data.routeOptions.length > 0 && map) {
        setAiPreviewRoutes(data.routeOptions);
        drawPreviewRoutes(data.routeOptions);

        if (data.flyToCenter) {
          map.flyTo({
            center: [data.flyToCenter.lng, data.flyToCenter.lat],
            zoom: 13,
            duration: 2000,
          });
        } else {
          const allWaypoints = data.routeOptions.flatMap((opt: any) => opt.waypoints);
          if (allWaypoints.length >= 2) {
            const lngs = allWaypoints.map((wp: any) => wp.lng);
            const lats = allWaypoints.map((wp: any) => wp.lat);
            const bounds = new mapboxgl.LngLatBounds(
              [Math.min(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.max(...lats)]
            );
            map.fitBounds(bounds, { padding: 80, duration: 2000 });
          }
        }
      }

      setAiConversationHistory(prev => [
        ...prev,
        { role: 'user' as const, content: aiPrompt.trim() },
        { role: 'assistant' as const, content: data.message },
      ]);

      setAiPrompt("");

    } catch (error: any) {
      console.error('AI route generation error:', error);
      setAiError(error.message || "Failed to generate route. Please try again.");
    } finally {
      setIsGeneratingAiRoute(false);
    }
  }, [aiPrompt, routeState, map, aiConversationHistory, clearPreviewRoutes, drawPreviewRoutes]);

  const applyAiRouteOption = useCallback((option: {
    label: string;
    description?: string;
    waypoints: Array<{ name: string; lat: number; lng: number; description?: string }>;
  }) => {
    if (!option.waypoints || option.waypoints.length < 2) {
      setAiError("This route option doesn't have enough waypoints.");
      return;
    }

    clearPreviewRoutes();
    setAiPreviewRoutes(null);

    const waypointCoordinates = option.waypoints.map((wp, index) => ({
      name: wp.name || `Waypoint ${index + 1}`,
      lngLat: [wp.lng, wp.lat] as [number, number],
      elevation: null,
    }));

    if (clearEditableRouteWaypoints) {
      clearEditableRouteWaypoints();
    }

    setRouteState(prev => ({
      ...prev,
      name: prev.name.trim() || option.label || "AI Generated Route",
      description: prev.description.trim() || option.description || "",
      waypointCoordinates,
      pathCoordinates: waypointCoordinates.map((wp: any) => wp.lngLat),
      totalDistance: 0,
      elevationGain: 0,
      elevationLoss: 0,
      estimatedTime: 0,
    }));

    setShowAiPrompt(false);
    setAiPrompt("");
    setAiResponse(null);
    setAiRouteOptions(null);
    setAiConversationHistory([]);

    aiMarkersDisplayedRef.current = false;
    setAiWaypointsLoaded(true);

    toast({
      title: "Route applied!",
      description: `${waypointCoordinates.length} waypoints placed from "${option.label}". ${
        routeState.routingMode === 'trail' ? 'Calculating trail route...' :
        routeState.routingMode === 'road' ? 'Calculating road route...' :
        'Calculating route...'
      }`,
    });
  }, [clearEditableRouteWaypoints, clearPreviewRoutes, routeState.routingMode, toast]);
  
  // Helper function to calculate distance between two points (in meters)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  // Calculate elevation gain/loss using Open-Meteo DEM data via batch API
  const calculateElevationData = async (coordinates: [number, number][]) => {
    try {
      // Smart sampling: take at most 100 evenly distributed points, always including start and end
      const maxSamples = 100;
      let sampledCoords: [number, number][] = [];

      if (coordinates.length <= maxSamples) {
        sampledCoords = coordinates;
      } else {
        const step = (coordinates.length - 1) / (maxSamples - 1);
        for (let i = 0; i < maxSamples; i++) {
          const index = Math.round(i * step);
          sampledCoords.push(coordinates[index]);
        }
      }

      const response = await fetch('/api/proxy/elevation/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ coordinates: sampledCoords }),
      });

      if (!response.ok) {
        console.error('Batch elevation API error:', response.status);
        return { gain: 0, loss: 0 };
      }

      const data = await response.json();
      const elevations: number[] = data.elevation || [];

      let totalGain = 0;
      let totalLoss = 0;

      for (let i = 1; i < elevations.length; i++) {
        const diff = elevations[i] - elevations[i - 1];
        if (diff > 0) {
          totalGain += diff;
        } else {
          totalLoss += Math.abs(diff);
        }
      }

      return { gain: totalGain, loss: totalLoss };
    } catch (error) {
      console.error('Error calculating elevation data:', error);
      return { gain: 0, loss: 0 };
    }
  };

  // Display route on map - never auto-zooms to allow free panning during route building
  const displayRouteOnMap = (pathCoordinates: [number, number][], waypoints: any[], skipFitBounds: boolean = true) => {
    if (!map) return;

    // Remove existing route if any
    if (routeSourceId) {
      if (map.getSource(routeSourceId)) {
        map.removeLayer(`${routeSourceId}-line`);
        map.removeSource(routeSourceId);
      }
    }

    const newRouteSourceId = `route-preview-${Date.now()}`;
    setRouteSourceId(newRouteSourceId);

    // Add route line
    map.addSource(newRouteSourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: pathCoordinates
        }
      }
    });

    map.addLayer({
      id: `${newRouteSourceId}-line`,
      type: 'line',
      source: newRouteSourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#2563eb',
        'line-width': 4,
        'line-opacity': 0.8
      }
    });

    // Never auto-zoom during route building - user controls the map view
    // This allows users to pan around and add more waypoints without the map jumping
  };

  // Add waypoint to route
  const addWaypointToRoute = (waypointId: number) => {
    setRouteState(prev => ({
      ...prev,
      selectedWaypoints: [...prev.selectedWaypoints, waypointId]
    }));
  };

  // Remove waypoint from route
  const removeWaypointFromRoute = (waypointId: number) => {
    setRouteState(prev => ({
      ...prev,
      selectedWaypoints: prev.selectedWaypoints.filter(id => id !== waypointId)
    }));
  };

  // Reorder waypoints
  const moveWaypoint = (fromIndex: number, toIndex: number) => {
    setRouteState(prev => {
      const newWaypoints = [...prev.selectedWaypoints];
      const [moved] = newWaypoints.splice(fromIndex, 1);
      newWaypoints.splice(toIndex, 0, moved);
      return { ...prev, selectedWaypoints: newWaypoints };
    });
  };

  // Save route
  const saveRoute = () => {
    if (!routeState.name.trim()) {
      toast({
        title: "Route name required",
        description: "Please enter a name for your route.",
        variant: "destructive",
      });
      return;
    }

    // When editing, allow routes with temporary waypoints
    const hasWaypoints = editingRoute 
      ? (temporaryWaypoints.length >= 2 || routeState.pathCoordinates.length > 0)
      : routeState.selectedWaypoints.length >= 2;

    if (!hasWaypoints) {
      toast({
        title: "Insufficient waypoints",
        description: "A route must have at least 2 waypoints.",
        variant: "destructive",
      });
      return;
    }

    // Get the current waypoint positions directly from the map markers
    // This avoids stale closure issues
    let currentWaypointCoordinates = routeState.waypointCoordinates;
    let currentPathCoordinates = routeState.pathCoordinates;
    
    if (editingRoute && getEditableWaypointPositions) {
      const markerPositions = getEditableWaypointPositions();
      if (markerPositions.length > 0) {
        // Update waypoint coordinates from marker positions
        currentWaypointCoordinates = markerPositions.map((lngLat, idx) => ({
          name: routeState.waypointCoordinates[idx]?.name || `Waypoint ${idx + 1}`,
          lngLat: lngLat,
          elevation: routeState.waypointCoordinates[idx]?.elevation || null
        }));
        // Also update path coordinates to match
        currentPathCoordinates = markerPositions;
      }
    }

    const routeData = {
      name: routeState.name,
      description: routeState.description || '',
      waypointIds: JSON.stringify(routeState.selectedWaypoints),
      pathCoordinates: JSON.stringify(currentPathCoordinates),
      waypointCoordinates: JSON.stringify(currentWaypointCoordinates),
      totalDistance: Number(routeState.totalDistance) || 0,
      elevationGain: Number(routeState.elevationGain) || 0,
      elevationLoss: Number(routeState.elevationLoss) || 0,
      estimatedTime: Number(routeState.estimatedTime) || 0,
      routingMode: routeState.routingMode,
      isPublic: routeState.isPublic,
      notes: editingRoute ? routeNotes : undefined
    };

    // Use update mutation if editing, otherwise create
    if (editingRoute) {
      updateRouteMutation.mutate(routeData);
    } else {
      createRouteMutation.mutate(routeData);
    }
  };

  // Save route and start waypoint placement mode
  const saveRouteAndAddWaypoints = () => {
    if (!routeState.name.trim()) {
      toast({
        title: "Route name required",
        description: "Please enter a name for your route.",
        variant: "destructive",
      });
      return;
    }

    // Close modal and start waypoint placement
    onClose();
    
    // Start marker/waypoint placement mode on the map
    if (onStartWaypointPlacement) {
      onStartWaypointPlacement(routeState.name, routeState.description);
    }

    toast({
      title: "Route builder started",
      description: "Click on the map to add waypoints to your route.",
      duration: 5000,
    });
  };

  // Reset modal state when closed
  const handleClose = () => {
    setRouteState({
      name: '',
      description: '',
      selectedWaypoints: [],
      isPublic: false,
      routingMode: 'direct',
      trailProfile: 'foot-hiking',
      pathCoordinates: [],
      waypointCoordinates: [],
      totalDistance: 0,
      elevationGain: 0,
      elevationLoss: 0,
      estimatedTime: 0
    });
    setRouteNotes('');
    setRoutePhotos([]);
    setWaypointsModified(false);
    setOriginalWaypointPositions('');
    setShowAiPrompt(false);
    setAiPrompt("");
    setAiError(null);
    setIsGeneratingAiRoute(false);
    setAiWaypointsLoaded(false);
    aiMarkersDisplayedRef.current = false;
    setAiPreviewRoutes(null);
    clearPreviewRoutes();
    
    // Remove route preview from map
    if (routeSourceId && map) {
      try {
        if (map.getSource(routeSourceId)) {
          map.removeLayer(`${routeSourceId}-line`);
          map.removeSource(routeSourceId);
        }
      } catch (error) {
        console.error('Error removing route preview:', error);
      }
    }
    setRouteSourceId(null);
    onClose();
  };

  // Auto-calculate route when waypoints or routing mode change
  // Skip calculation when editing a route - user must manually recalculate if needed
  useEffect(() => {
    // If we're editing an existing route, skip automatic recalculation
    // The user can manually save their waypoint position changes
    if (editingRoute) {
      return;
    }
    
    if (routeState.selectedWaypoints.length >= 2 || temporaryWaypoints.length >= 2) {
      calculateOptimizedRoute();
    }
  }, [routeState.selectedWaypoints, routeState.routingMode, routeState.trailProfile, temporaryWaypoints, calculateOptimizedRoute, editingRoute]);


  // Handle draw mode path changes - recalculates distance along the actual path
  const handleDrawModePathChange = useCallback((newPath: [number, number][]) => {
    // Calculate distance along the full path (sum of all segment distances)
    // This ensures we measure the actual trail/path distance, not straight-line
    let totalDistance = 0;
    for (let i = 0; i < newPath.length - 1; i++) {
      const from = newPath[i];
      const to = newPath[i + 1];
      const distance = calculateDistance(from[1], from[0], to[1], to[0]);
      totalDistance += distance;
    }
    
    setRouteState(prev => ({
      ...prev,
      pathCoordinates: newPath,
      totalDistance,
      estimatedTime: Math.round(totalDistance / 83.33)
    }));
  }, []);

  // Enable/disable draw mode when routing mode changes
  useEffect(() => {
    if (routeState.routingMode === 'draw' && routeState.pathCoordinates.length >= 2) {
      // Enable draw mode when we have a path
      const waypointCoords = routeState.waypointCoordinates.map(w => w.lngLat);
      enableDrawRouteMode?.(routeState.pathCoordinates, waypointCoords, handleDrawModePathChange);
    } else {
      // Disable draw mode when not in draw routing mode
      disableDrawRouteMode?.();
    }
    
    return () => {
      // Cleanup on unmount
      disableDrawRouteMode?.();
    };
  }, [routeState.routingMode, routeState.pathCoordinates.length, enableDrawRouteMode, disableDrawRouteMode, handleDrawModePathChange]);

  // Format distance (in miles)
  const formatDistance = (meters: number) => {
    const miles = meters / 1609.34;
    if (miles < 0.1) {
      const feet = meters * 3.28084;
      return `${Math.round(feet)} ft`;
    }
    return `${miles.toFixed(2)} mi`;
  };

  // Format elevation (in feet)
  const formatElevation = (meters: number) => {
    const feet = meters * 3.28084;
    return `${Math.round(feet)} ft`;
  };

  // Format time
  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose} modal={false}>
      <DialogContent 
        noOverlay={!!editingRoute}
        className="!fixed !left-0 !right-0 !top-0 !h-[25vh] !max-h-[25vh] !w-full !max-w-full !translate-x-0 !translate-y-0 !rounded-none !rounded-b-xl !border-b !border-t-0 !border-l-0 !border-r-0 sm:!left-auto sm:!right-0 sm:!h-full sm:!max-h-full sm:!max-w-md sm:!rounded-none sm:!border-l sm:!border-b-0 sm:!border-r-0 data-[state=open]:!slide-in-from-top sm:data-[state=open]:!slide-in-from-right data-[state=closed]:!slide-out-to-top sm:data-[state=closed]:!slide-out-to-right overflow-y-auto pointer-events-auto">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5" />
            {editingRoute ? 'Edit Route' : 'Route Builder'}
          </DialogTitle>
        </DialogHeader>
        

        <div className="space-y-3">
          {/* Route Information */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="routeName" className="text-xs">Route Name *</Label>
              <Input
                id="routeName"
                value={routeState.name}
                onChange={(e) => setRouteState(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter route name..."
                autoComplete="off"
                className="h-8"
              />
            </div>

            <div>
              <Label htmlFor="routeDescription" className="text-xs">Description</Label>
              <Textarea
                id="routeDescription"
                value={routeState.description}
                onChange={(e) => setRouteState(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Enter route description..."
                rows={2}
                autoComplete="off"
                className="text-sm"
              />
            </div>

            <div>
              <Label className="text-xs">Routing Mode</Label>
              <div className="grid grid-cols-4 gap-1 mt-1">
                <button
                  type="button"
                  className={`p-2 border rounded text-xs font-medium transition-colors ${
                    routeState.routingMode === 'direct'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                  onClick={() => setRouteState(prev => ({ ...prev, routingMode: 'direct' }))}
                  data-testid="button-routing-direct"
                >
                  <RouteIcon className="h-3 w-3 mx-auto mb-0.5" />
                  <span>Direct</span>
                </button>
                <button
                  type="button"
                  className={`p-2 border rounded text-xs font-medium transition-colors ${
                    routeState.routingMode === 'road'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                  onClick={() => setRouteState(prev => ({ ...prev, routingMode: 'road' }))}
                  data-testid="button-routing-road"
                >
                  <RouteIcon className="h-3 w-3 mx-auto mb-0.5" />
                  <span>Road</span>
                </button>
                <button
                  type="button"
                  className={`p-2 border rounded text-xs font-medium transition-colors ${
                    routeState.routingMode === 'trail'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                  onClick={() => setRouteState(prev => ({ ...prev, routingMode: 'trail' }))}
                  data-testid="button-routing-trail"
                >
                  <Mountain className="h-3 w-3 mx-auto mb-0.5" />
                  <span>Trails</span>
                </button>
                <button
                  type="button"
                  className={`p-2 border rounded text-xs font-medium transition-colors ${
                    routeState.routingMode === 'draw'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                  onClick={() => setRouteState(prev => ({ ...prev, routingMode: 'draw' }))}
                  data-testid="button-routing-draw"
                >
                  <Pencil className="h-3 w-3 mx-auto mb-0.5" />
                  <span>Draw</span>
                </button>
              </div>
              {routeState.routingMode === 'trail' && (
                <div className="mt-2">
                  <Label className="text-xs text-muted-foreground">Activity Type</Label>
                  <div className="grid grid-cols-3 gap-1 mt-1">
                    {TRAIL_PROFILE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`p-1.5 border rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-1 ${
                          routeState.trailProfile === option.value
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-background hover:bg-muted border-border'
                        }`}
                        onClick={() => setRouteState(prev => ({ ...prev, trailProfile: option.value }))}
                        data-testid={`button-trail-profile-${option.value}`}
                      >
                        <span>{option.icon}</span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {!editingRoute && (
              <div className="border-t pt-3">
                {!showAiPrompt ? (
                  <Button
                    variant="outline"
                    className="w-full h-10 gap-2 border-dashed border-purple-400/50 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300 hover:border-purple-400"
                    onClick={() => setShowAiPrompt(true)}
                    data-testid="button-ai-route"
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate Route with AI
                  </Button>
                ) : (
                  <div className="space-y-3 bg-purple-500/5 border border-purple-500/20 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-xs font-medium text-purple-300">AI Route Assistant</span>
                      </div>
                      <button
                        onClick={() => {
                          setShowAiPrompt(false);
                          setAiError(null);
                          setAiPrompt("");
                          setAiResponse(null);
                          setAiRouteOptions(null);
                          setAiConversationHistory([]);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {aiResponse && (
                      <div className="space-y-2">
                        <div className="bg-background/80 rounded-md p-2.5 text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {aiResponse}
                        </div>

                        {aiRouteOptions && aiRouteOptions.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                              {aiRouteOptions.length} route option{aiRouteOptions.length !== 1 ? 's' : ''} found
                            </p>
                            {aiRouteOptions.map((option, i) => {
                              const isCommunity = option.source === 'community';
                              const colorHex = ROUTE_COLORS[option.color] || ROUTE_COLORS.blue;
                              return (
                                <div
                                  key={i}
                                  className="rounded-md border border-white/20 bg-white/5 p-2.5"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: colorHex }} />
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                          isCommunity ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
                                        }`}>
                                          {isCommunity ? 'Community' : 'Trail Data'}
                                        </span>
                                      </div>
                                      <p className="text-xs font-semibold text-foreground">
                                        {option.label}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                                        {option.description}
                                      </p>
                                      {isCommunity && option.communityAuthor && (
                                        <p className="text-[10px] text-purple-400/60 mt-0.5">
                                          Route by @{option.communityAuthor}
                                        </p>
                                      )}
                                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                                        {option.waypoints.length} waypoints
                                      </p>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    className="w-full mt-2 h-7 text-xs gap-1.5"
                                    style={{ backgroundColor: colorHex }}
                                    onClick={() => applyAiRouteOption(option)}
                                  >
                                    <Plus className="w-3 h-3" />
                                    Use This Route
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="border-t border-white/10 pt-2">
                          <p className="text-[10px] text-muted-foreground mb-1.5">Ask a follow-up or try a different request:</p>
                        </div>
                      </div>
                    )}

                    <Textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder={
                        aiResponse
                          ? "Ask a follow-up: 'Make it shorter' or 'What about a loop instead?'"
                          : routeState.routingMode === 'trail'
                          ? "e.g., Build me a hiking loop around Jenny Lake starting from the South Jenny Lake trailhead"
                          : routeState.routingMode === 'road'
                          ? "e.g., Create a scenic driving route from Jackson to Yellowstone through the Teton Pass"
                          : "e.g., Plan a route from the town square in Jackson to Snow King summit"
                      }
                      rows={aiResponse ? 2 : 3}
                      className="text-sm resize-none bg-background"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          generateAiRoute();
                        }
                      }}
                      data-testid="input-ai-prompt"
                    />

                    <div className="text-[10px] text-muted-foreground">
                      {!aiResponse && (
                        <>
                          {routeState.routingMode === 'trail' && "Trail mode: AI searches real trails & community routes, then places waypoints at trail junctions."}
                          {routeState.routingMode === 'road' && "Road mode: AI places waypoints at key intersections. Mapbox routes on real roads."}
                          {routeState.routingMode === 'direct' && "Direct mode: AI places waypoints along the route. Lines are straight between points."}
                          {routeState.routingMode === 'draw' && "Draw mode: AI places waypoints as a starting draft. You can reshape by dragging."}
                        </>
                      )}
                    </div>

                    {aiError && (
                      <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{aiError}</p>
                    )}

                    <Button
                      className="w-full gap-2 bg-purple-600 hover:bg-purple-700 h-9"
                      disabled={!aiPrompt.trim() || isGeneratingAiRoute}
                      onClick={generateAiRoute}
                      data-testid="button-generate-ai-route"
                    >
                      {isGeneratingAiRoute ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Searching trails & community routes...
                        </>
                      ) : aiResponse ? (
                        <>
                          <Wand2 className="w-4 h-4" />
                          Send Follow-up
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4" />
                          Generate Route
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center space-x-2">
              <Switch
                id="public-route"
                checked={routeState.isPublic}
                onCheckedChange={(checked) => setRouteState(prev => ({ ...prev, isPublic: checked }))}
              />
              <Label htmlFor="public-route" className="text-xs">Make route public</Label>
            </div>
          </div>

          {/* Notes and Photos Section - Only show when editing */}
          {editingRoute && (
            <div className="space-y-2 border-t pt-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-3 w-3" />
                Notes & Photos
              </h3>
              
              {/* Route Notes */}
              <div>
                <Label htmlFor="routeNotes" className="text-xs">Route Notes</Label>
                <Textarea
                  id="routeNotes"
                  value={routeNotes}
                  onChange={(e) => setRouteNotes(e.target.value)}
                  placeholder="Add notes about this route..."
                  rows={2}
                  className="text-sm"
                  data-testid="textarea-route-notes"
                />
              </div>

              {/* Route Photos */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">Photos ({routePhotos.length})</Label>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      multiple
                      onChange={handlePhotoUpload}
                      className="hidden"
                      data-testid="input-route-photos"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isUploadingPhotos}
                      asChild
                      className="h-7 text-xs"
                    >
                      <span>
                        <ImagePlus className="h-3 w-3 mr-1" />
                        {isUploadingPhotos ? 'Uploading...' : 'Add'}
                      </span>
                    </Button>
                  </label>
                </div>
                
                {routePhotos.length > 0 ? (
                  <div className="grid grid-cols-4 gap-1">
                    {routePhotos.map((photo, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={photo}
                          alt={`Route photo ${index + 1}`}
                          className="w-full h-14 object-cover rounded"
                        />
                        <button
                          data-testid={`button-delete-route-photo-${index}`}
                          onClick={() => handleDeletePhoto(photo)}
                          className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-2 w-2" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2 border rounded">
                    No photos yet
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Route Waypoints - Show when editing to allow inline editing */}
          {editingRoute && routeState.waypointCoordinates.length > 0 && (
            <div className="space-y-2 border-t pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Route Waypoints</h3>
                <span className="text-xs text-muted-foreground bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                  Drag on map to move
                </span>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {routeState.waypointCoordinates.map((waypoint, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 border rounded bg-gray-50">
                    <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </span>
                    <Input
                      value={waypoint.name}
                      onChange={(e) => {
                        setRouteState(prev => ({
                          ...prev,
                          waypointCoordinates: prev.waypointCoordinates.map((wp, idx) => 
                            idx === index ? { ...wp, name: e.target.value } : wp
                          )
                        }));
                      }}
                      className="flex-1 h-7 text-sm"
                      placeholder={`Waypoint ${index + 1}`}
                      data-testid={`input-waypoint-name-${index}`}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        // Get current positions from map markers BEFORE deleting
                        // This preserves any drag adjustments made to other waypoints
                        const currentPositions = getEditableWaypointPositions ? getEditableWaypointPositions() : null;
                        
                        if (currentPositions && currentPositions.length === routeState.waypointCoordinates.length) {
                          // We have fresh marker positions - use them
                          const updatedWaypointCoords = routeState.waypointCoordinates.map((wp, idx) => ({
                            ...wp,
                            lngLat: currentPositions[idx]
                          }));
                          
                          const newWaypointCoords = updatedWaypointCoords.filter((_, idx) => idx !== index);
                          
                          setRouteState(prev => ({
                            ...prev,
                            waypointCoordinates: newWaypointCoords,
                            pathCoordinates: newWaypointCoords.map(w => w.lngLat)
                          }));
                        } else {
                          // Fallback - just delete from state (markers not available)
                          const newWaypointCoords = routeState.waypointCoordinates.filter((_, idx) => idx !== index);
                          setRouteState(prev => ({
                            ...prev,
                            waypointCoordinates: newWaypointCoords,
                            pathCoordinates: newWaypointCoords.map(w => w.lngLat)
                          }));
                        }
                        // Re-display markers after deletion
                        editMarkersDisplayedRef.current = false;
                      }}
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                      data-testid={`button-delete-waypoint-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Waypoint Selection - Hidden when editing since waypoints are already set */}
          {!editingRoute && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Select Waypoints</h3>
                <span className="text-xs text-muted-foreground">
                  {routeState.selectedWaypoints.length} selected
                </span>
              </div>

              <div className="border rounded p-2 max-h-28 overflow-y-auto">
                {existingWaypoints.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    No waypoints available. Create some waypoints first.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {existingWaypoints.map((waypoint) => (
                      <div
                        key={waypoint.id}
                        className="flex items-center justify-between p-1.5 border rounded hover:bg-gray-50"
                      >
                        <div>
                          <span className="text-sm font-medium">{waypoint.name}</span>
                        </div>
                        
                        {routeState.selectedWaypoints.includes(waypoint.id) ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => removeWaypointFromRoute(waypoint.id)}
                            className="h-6 w-6 p-0"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => addWaypointToRoute(waypoint.id)}
                            className="h-6 w-6 p-0"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected Waypoints Order */}
          {routeState.selectedWaypoints.length > 0 && !editingRoute && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Route Order</h3>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {routeState.selectedWaypoints.map((waypointId, index) => {
                  const waypoint = existingWaypoints.find(w => w.id === waypointId);
                  if (!waypoint) return null;

                  return (
                    <div key={waypointId} className="flex items-center gap-2 p-1 border rounded">
                      <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </span>
                      <span className="flex-1 text-sm truncate">{waypoint.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeWaypointFromRoute(waypointId)}
                        className="h-5 w-5 p-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Route Statistics - Show when editing or when waypoints selected */}
          {(routeState.selectedWaypoints.length >= 2 || editingRoute) && (
            <div className="space-y-2 border-t pt-2">
              <h3 className="text-sm font-semibold">Route Statistics</h3>
              {isCalculating ? (
                <div className="text-center py-2">
                  <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  <p className="text-xs text-muted-foreground mt-1">Calculating...</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1">
                  <div className="text-center p-1.5 border rounded">
                    <RouteIcon className="h-3 w-3 mx-auto mb-0.5 text-blue-600" />
                    <div className="text-xs font-medium">{formatDistance(routeState.totalDistance)}</div>
                    <div className="text-[10px] text-muted-foreground">Dist</div>
                  </div>
                  
                  <div className="text-center p-1.5 border rounded">
                    <Mountain className="h-3 w-3 mx-auto mb-0.5 text-green-600" />
                    <div className="text-xs font-medium">{formatElevation(routeState.elevationGain)}</div>
                    <div className="text-[10px] text-muted-foreground">Gain</div>
                  </div>
                  
                  <div className="text-center p-1.5 border rounded">
                    <Mountain className="h-3 w-3 mx-auto mb-0.5 text-red-600 scale-y-[-1]" />
                    <div className="text-xs font-medium">{formatElevation(routeState.elevationLoss)}</div>
                    <div className="text-[10px] text-muted-foreground">Loss</div>
                  </div>
                  
                  <div className="text-center p-1.5 border rounded">
                    <Timer className="h-3 w-3 mx-auto mb-0.5 text-purple-600" />
                    <div className="text-xs font-medium">{formatTime(routeState.estimatedTime)}</div>
                    <div className="text-[10px] text-muted-foreground">Time</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-2 border-t">
            {editingRoute && (
              <Button
                data-testid="button-share-route"
                variant="outline"
                onClick={() => setIsShareModalOpen(true)}
                className="w-full h-8 text-xs"
              >
                <Share2 className="h-3 w-3 mr-1" />
                Share with Friends
              </Button>
            )}
            
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} className="flex-1 h-8 text-xs">
                Cancel
              </Button>
              
              {/* Save Route and Add Waypoints - Primary workflow (only for new routes) */}
              {!editingRoute && (
                <Button
                  onClick={saveRouteAndAddWaypoints}
                  disabled={!routeState.name.trim() || createRouteMutation.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 h-8 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {createRouteMutation.isPending ? 'Saving...' : 'Save & Add Waypoints'}
                </Button>
              )}
              
              {/* Update Route button for editing mode - prominent green color */}
              {editingRoute && (
                <Button
                  onClick={saveRoute}
                  disabled={!routeState.name.trim() || updateRouteMutation.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700 h-10 text-sm font-medium"
                  data-testid="button-save-route-changes"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateRouteMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Share Route Modal */}
      {editingRoute && (
        <ShareRouteModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          routeId={editingRoute.id}
          routeName={editingRoute.name}
        />
      )}
    </Dialog>
  );
}