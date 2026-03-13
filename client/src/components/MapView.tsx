import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapControls from './MapControls';
import UnifiedToolbar from './UnifiedToolbar';
import RecordingOverlay from './RecordingOverlay';
import MapHeader from './MapHeader';
import DrawingTools from './DrawingTools';
import DrawingManagerModal from './modals/DrawingManagerModal';
import LocationSharingModal from './modals/LocationSharingModal';
import RouteBuilderModal from './modals/RouteBuilderModal';
import OfflineModal from './modals/OfflineModal';
import { WaypointEditModal } from './modals/WaypointEditModal';
import DroneAdjustmentControls from './DroneAdjustmentControls';
import { RouteSummaryPanel } from './RouteSummaryPanel';
import LiveMapSessionModal from './modals/LiveMapSessionModal';
import AIRouteAssistPanel from './AIRouteAssistPanel';

import { useMapbox } from '@/hooks/useMapbox';
import { useOutdoorPOIs } from '@/hooks/useOutdoorPOIs';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/hooks/useAuth';
import { sendLocationUpdate } from '@/lib/websocket';
import { DroneImage, Waypoint, Route } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Pencil, Settings2, Route as RouteIcon } from 'lucide-react';

import { useQuery } from '@tanstack/react-query';
import { addTetonCountyImagery, removeTetonCountyImagery, switchToTetonCountyView, addDroneImageryBoundaries } from '@/lib/mapUtils';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface MapViewProps {
  onOpenOfflineModal: () => void;
  onOpenDroneModal: () => void;
  selectedRoute?: Route | null;
  onRouteDisplayed?: () => void;
  editingRoute?: Route | null;
  onRouteEdited?: () => void;
  onSetEditingRoute?: (route: Route) => void;
  routesToDisplayAll?: Route[] | null;
  onAllRoutesDisplayed?: () => void;
  activatedDroneImage?: DroneImage | null;
  onDroneImageActivated?: () => void;
}

const MapView: React.FC<MapViewProps> = ({ 
  onOpenOfflineModal, 
  onOpenDroneModal,
  selectedRoute,
  onRouteDisplayed,
  editingRoute,
  onRouteEdited,
  onSetEditingRoute,
  routesToDisplayAll,
  onAllRoutesDisplayed,
  activatedDroneImage,
  onDroneImageActivated
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [activeDroneLayers, setActiveDroneLayers] = useState<Set<number>>(new Set());
  const [showLocationSharingModal, setShowLocationSharingModal] = useState(false);
  const [showRouteBuilderModal, setShowRouteBuilderModal] = useState(false);
  const [isAIAssistOpen, setIsAIAssistOpen] = useState(false);

  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [showLiveMapModal, setShowLiveMapModal] = useState(false);
  const [selectedOfflineBounds, setSelectedOfflineBounds] = useState<{
    northEast: { lat: number; lng: number };
    southWest: { lat: number; lng: number };
  } | null>(null);
  
  // Route editing state
  const [isEditingDisplayedRoute, setIsEditingDisplayedRoute] = useState(false);
  const [routeBeingEdited, setRouteBeingEdited] = useState<Route | null>(null);
  const [editedWaypoints, setEditedWaypoints] = useState<Array<{
    name: string;
    lngLat: [number, number];
    elevation?: number;
  }>>([]);
  const [isAddingWaypointMode, setIsAddingWaypointMode] = useState(false);
  const [editRoutingMode, setEditRoutingMode] = useState<'direct' | 'road' | 'trail'>('direct');
  const [editedPathCoordinates, setEditedPathCoordinates] = useState<[number, number][]>([]);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  
  // POI (Points of Interest) state
  const [isAddingPOIMode, setIsAddingPOIMode] = useState(false);
  const [pendingPOILocation, setPendingPOILocation] = useState<[number, number] | null>(null);
  const [poiRefreshTrigger, setPoiRefreshTrigger] = useState(0);
  
  // POI view/edit modal state (when viewing a route, not editing)
  const [selectedViewPOI, setSelectedViewPOI] = useState<{
    id: number;
    name: string;
    latitude: string;
    longitude: string;
    elevation: string | null;
    note: string | null;
    photos: string | null;
  } | null>(null);
  
  // POI editing state (for route edit mode)
  const [editingPOIs, setEditingPOIs] = useState<Array<{
    id: number;
    name: string;
    latitude: string;
    longitude: string;
    elevation: string | null;
    note: string | null;
  }>>([]);
  const [selectedEditPOI, setSelectedEditPOI] = useState<{
    id: number;
    name: string;
    elevation: string;
    note: string;
  } | null>(null);
  const editPOIMarkersRef = useRef<mapboxgl.Marker[]>([]);
  
  
  // Recording overlay state
  const [showRecordingOverlay, setShowRecordingOverlay] = useState(false);

  // GPS Activity Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedPath, setRecordedPath] = useState<[number, number][]>([]);
  const [recordedElevations, setRecordedElevations] = useState<number[]>([]);
  const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null);
  const [showSaveRecordingModal, setShowSaveRecordingModal] = useState(false);
  const [recordingName, setRecordingName] = useState('');
  const [recordingWaypoints, setRecordingWaypoints] = useState<Array<{name: string; lngLat: [number, number]; note: string}>>([]);
  const watchIdRef = useRef<number | null>(null);
  const recordingLineSourceRef = useRef<boolean>(false);
  
  const { 
    initializeMap, 
    toggleLayer,
    activeLayers,
    activeTrailOverlays,
    zoomIn, 
    zoomOut, 
    flyToUserLocation,
    toggleTerrain,
    resetNorth,
    activeDroneImagery,
    activeDroneImages,
    addDroneImagery,
    removeDroneImagery,
    removeDroneImageryById,
    isDroneImageryLoading,
    isMapReady,
    map,
    // Location tracking
    startLocationTracking,
    stopLocationTracking,
    userLocation,
    // Drawing related
    startDrawingMode,
    cancelDrawingMode,
    finishDrawing,
    drawingMode,
    currentDrawing,
    userDrawings,
    removeDrawingFromMap,
    // Marker related
    setIsMarkerMode,
    // Route building related
    isRouteBuildingMode,
    routeWaypoints,
    currentRouteName,
    startRouteBuildingMode,
    finishRouteBuilding,
    // Route display
    displayRoute,
    displayEditableRouteWaypoints,
    getEditableWaypointPositions,
    clearEditableRouteWaypoints,
    displayedRoute,
    setDisplayedRoute,
    clearDisplayedRoute,
    // All routes display
    displayAllRoutes,
    clearAllRoutes,
    allRoutesDisplayed,
    clickedRouteInfo,
    setClickedRouteInfo,
    // Edit mode functions
    displayEditModeWaypoints,
    updateEditModeRouteLine,
    updateEditModeRouteLineWithPath,
    updateDisplayedRouteLine,
    clearEditModeWaypoints,
    addEditModeWaypointOnClick,
    // Drone adjustment controls
    isDroneAdjustmentMode,
    setIsDroneAdjustmentMode,
    droneAdjustments,
    updateDroneAdjustments,
    // Distance measurement
    isMeasurementMode,
    setIsMeasurementMode,
    measurementDistance,
    measurementPath,
    measurementElevations,
    clearMeasurementPath,
    // Offline area selection
    isOfflineSelectionMode,
    startOfflineAreaSelection,
    cancelOfflineAreaSelection,
    finishOfflineAreaSelection,
    completeOfflineAreaSelection,
    offlineSelectionBounds,
    offlineSelectionInvalidDrag,
    // Draw route mode
    enableDrawRouteMode,
    disableDrawRouteMode,
    // Trail info loading
    isTrailInfoLoading,
    // Outdoor POIs
    showOutdoorPOIs,
    setShowOutdoorPOIs,
    // ESRI imagery
    esriImageryEnabled,
    toggleEsriImagery
  } = useMapbox(mapContainerRef);
  
  const { isLoading: isOutdoorPOIsLoading } = useOutdoorPOIs(map, showOutdoorPOIs);
  
  // Sync activeDroneLayers with activeDroneImages from useMapbox
  useEffect(() => {
    if (activeDroneImages) {
      const newActiveSet = new Set(activeDroneImages.keys());
      setActiveDroneLayers(newActiveSet);
    }
  }, [activeDroneImages]);
  
  const { 
    locationData, 
    getCurrentLocation, 
    locationName, 
    elevation,
    coordinates,
    shareLocation
  } = useLocation();

  const { user: rawUser } = useAuth();
  const user = rawUser as { id: number; username: string } | undefined;
  
  // Toggle location sharing on/off
  const handleToggleLocationSharing = async () => {
    if (userLocation) {
      // Location is currently being tracked, turn it off
      stopLocationTracking();
      toast({
        title: 'Location sharing stopped',
        description: 'Your location is no longer being shared.',
      });
    } else {
      // Location is not being tracked, turn it on
      if (locationPermissionDenied) {
        alert("Location permission is required. Please enable location services in your device settings.");
        return;
      }
      
      if (navigator.geolocation) {
        // Start location tracking to show the blue dot on the map
        startLocationTracking();
        
        // Share location with other users
        await shareLocation();
      } else {
        toast({
          title: 'Location not supported',
          description: 'Your device does not support location services.',
          variant: 'destructive',
        });
      }
    }
  };
  
  // Center map on current location
  const handleCenterOnLocation = () => {
    if (!userLocation) {
      startLocationTracking();
      flyToUserLocation();
    } else {
      flyToUserLocation();
    }
  };

  // Fetch available drone imagery
  const { data: droneImages = [] } = useQuery<DroneImage[]>({
    queryKey: ['/api/drone-images'],
    enabled: isMapReady
  });
  
  // Fetch user's waypoints for route building
  const { data: waypointsData } = useQuery<{userWaypoints: Waypoint[], sharedWaypoints: Waypoint[]}>({
    queryKey: ['/api/waypoints'],
    enabled: isMapReady && !!user
  });
  
  const userWaypoints = waypointsData?.userWaypoints || [];
  
  const { toast } = useToast();
  
  // Route saving mutation
  const saveRouteMutation = useMutation({
    mutationFn: async (routeData: any) => {
      const response = await apiRequest('POST', '/api/routes', routeData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      toast({
        title: "Route saved successfully!",
        description: "Your route has been saved and can be viewed in the Routes tab.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save route",
        description: error.message,
        variant: "destructive",
      });
    }
  });
  
  // Function to handle saving the current route
  const handleSaveRoute = () => {
    const routeData = finishRouteBuilding();
    
    if (routeData.waypoints.length < 2) {
      toast({
        title: "Insufficient waypoints",
        description: "A route must have at least 2 waypoints.",
        variant: "destructive",
      });
      return;
    }
    
    // Build waypointCoordinates from the original user-placed waypoints
    const waypointCoordinates = routeData.waypoints.map(wp => ({
      name: wp.name,
      lngLat: wp.lngLat,
      elevation: wp.elevation
    }));
    
    const payload = {
      name: routeData.name,
      description: routeData.description,
      waypointIds: JSON.stringify([]),
      pathCoordinates: JSON.stringify(routeData.pathCoordinates),
      waypointCoordinates: JSON.stringify(waypointCoordinates),
      totalDistance: routeData.totalDistance,
      elevationGain: routeData.elevationGain,
      elevationLoss: routeData.elevationLoss,
      estimatedTime: routeData.estimatedTime,
      routingMode: 'direct',
      isPublic: false
    };
    
    saveRouteMutation.mutate(payload);
  };
  
  // POI update mutation for editing POIs during route edit
  const updatePOIMutation = useMutation({
    mutationFn: async ({ routeId, poiId, data }: { routeId: number; poiId: number; data: any }) => {
      const response = await apiRequest('PUT', `/api/routes/${routeId}/pois/${poiId}`, data);
      return response.json();
    },
    onSuccess: (updatedPOI) => {
      setEditingPOIs(prev => prev.map(poi => 
        poi.id === updatedPOI.id ? updatedPOI : poi
      ));
      setSelectedEditPOI(null);
      toast({
        title: "POI updated",
        description: "Point of interest has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update POI",
        description: error.message,
        variant: "destructive",
      });
    }
  });
  
  // Route update mutation for editing existing routes
  const updateRouteMutation = useMutation({
    mutationFn: async ({ routeId, routeData }: { routeId: number; routeData: any }) => {
      const response = await apiRequest('PUT', `/api/routes/${routeId}`, routeData);
      return response.json();
    },
    onSuccess: (updatedRoute) => {
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      
      // Clear edit mode state
      clearEditModeWaypoints();
      setIsEditingDisplayedRoute(false);
      setEditedWaypoints([]);
      setEditedPathCoordinates([]);
      setIsAddingWaypointMode(false);
      setEditRoutingMode('direct');
      setRouteBeingEdited(null);
      // Clear POI editing state
      setEditingPOIs([]);
      setSelectedEditPOI(null);
      editPOIMarkersRef.current.forEach(marker => marker.remove());
      editPOIMarkersRef.current = [];
      
      // Display the updated route on the map
      if (updatedRoute) {
        displayRoute(updatedRoute);
      }
      
      toast({
        title: "Route updated!",
        description: "Your route changes have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update route",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Auto-save mutation for inline waypoint edits (doesn't clear view state)
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveRouteMutation = useMutation({
    mutationFn: async ({ routeId, routeData }: { routeId: number; routeData: any }) => {
      const response = await apiRequest('PUT', `/api/routes/${routeId}`, routeData);
      return response.json();
    },
    onSuccess: (updatedRoute) => {
      setDisplayedRoute(updatedRoute);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save changes",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Handle waypoint drag for auto-save
  const handleViewWaypointDragged = async (
    route: Route,
    waypointIndex: number, 
    newLngLat: [number, number], 
    allWaypoints: any[]
  ) => {
    // Clear any pending auto-save
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Calculate distance from path coordinates
    const calculatePathDistance = (coords: [number, number][]) => {
      if (coords.length < 2) return 0;
      let total = 0;
      for (let i = 1; i < coords.length; i++) {
        const [lng1, lat1] = coords[i - 1];
        const [lng2, lat2] = coords[i];
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        total += R * c;
      }
      return total;
    };
    
    // Calculate path based on routing mode
    const routingMode = (route.routingMode as 'direct' | 'road' | 'trail') || 'direct';
    let pathCoords: [number, number][];
    
    if (routingMode === 'direct') {
      // Direct mode: just connect waypoints
      pathCoords = allWaypoints.map(wp => wp.lngLat);
    } else {
      // Use Mapbox Directions API for road/trail modes
      const coordinatesStr = allWaypoints.map((wp: any) => wp.lngLat.join(',')).join(';');
      const profile = routingMode === 'road' ? 'driving' : 'walking';
      const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinatesStr}?geometries=geojson&overview=full&access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}`;
      
      try {
        const response = await fetch(directionsUrl);
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
          pathCoords = data.routes[0].geometry.coordinates as [number, number][];
          // Update the route line on the map immediately with the calculated path
          updateDisplayedRouteLine(pathCoords);
        } else {
          // Fallback to direct if no route found
          pathCoords = allWaypoints.map(wp => wp.lngLat);
        }
      } catch (error) {
        console.error('Failed to get directions:', error);
        // Fallback to direct if API fails
        pathCoords = allWaypoints.map(wp => wp.lngLat);
      }
    }
    
    const totalDistance = calculatePathDistance(pathCoords);
    
    // Debounce the auto-save by 1 second
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSaveRouteMutation.mutate({
        routeId: route.id,
        routeData: {
          pathCoordinates: JSON.stringify(pathCoords),
          waypointCoordinates: JSON.stringify(allWaypoints),
          totalDistance,
          routingMode
        }
      });
    }, 1000);
  };

  // Handle waypoint deletion for auto-save
  const handleViewWaypointDeleted = async (route: Route, remainingWaypoints: any[]) => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    const calculatePathDistance = (coords: [number, number][]) => {
      if (coords.length < 2) return 0;
      let total = 0;
      for (let i = 1; i < coords.length; i++) {
        const [lng1, lat1] = coords[i - 1];
        const [lng2, lat2] = coords[i];
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        total += R * c;
      }
      return total;
    };

    const routingMode = (route.routingMode as 'direct' | 'road' | 'trail') || 'direct';
    let pathCoords: [number, number][];

    if (routingMode === 'direct') {
      pathCoords = remainingWaypoints.map(wp => wp.lngLat);
    } else {
      const coordinatesStr = remainingWaypoints.map((wp: any) => wp.lngLat.join(',')).join(';');
      const profile = routingMode === 'road' ? 'driving' : 'walking';
      const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinatesStr}?geometries=geojson&overview=full&access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}`;

      try {
        const response = await fetch(directionsUrl);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          pathCoords = data.routes[0].geometry.coordinates as [number, number][];
          updateDisplayedRouteLine(pathCoords);
        } else {
          pathCoords = remainingWaypoints.map(wp => wp.lngLat);
        }
      } catch {
        pathCoords = remainingWaypoints.map(wp => wp.lngLat);
      }
    }

    const totalDistance = calculatePathDistance(pathCoords);

    autoSaveRouteMutation.mutate({
      routeId: route.id,
      routeData: {
        pathCoordinates: JSON.stringify(pathCoords),
        waypointCoordinates: JSON.stringify(remainingWaypoints),
        totalDistance,
        routingMode
      }
    });
  };
  
  // Calculate route path using Mapbox Directions API
  const calculateEditedRoutePath = async (
    waypoints: Array<{ lngLat: [number, number] }>,
    mode: 'direct' | 'road' | 'trail'
  ): Promise<[number, number][]> => {
    if (waypoints.length < 2) return [];
    
    if (mode === 'direct') {
      // Direct mode: just connect waypoints with straight lines
      return waypoints.map(wp => wp.lngLat);
    }
    
    // Use Mapbox Directions API for road/trail modes
    const coordinatesStr = waypoints.map(wp => wp.lngLat.join(',')).join(';');
    const profile = mode === 'road' ? 'driving' : 'walking';
    const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinatesStr}?geometries=geojson&overview=full&access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}`;
    
    try {
      const response = await fetch(directionsUrl);
      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates as [number, number][];
      }
    } catch (error) {
      console.error('Failed to get directions:', error);
    }
    
    // Fallback to direct if API fails
    return waypoints.map(wp => wp.lngLat);
  };

  // Handle entering edit mode for displayed route - opens the full RouteBuilderModal
  const handleEditRoute = () => {
    if (!displayedRoute) return;
    
    // Clear the displayed route first
    clearDisplayedRoute();
    displayedRouteIdRef.current = null;
    
    // Open the RouteBuilderModal with the full editing experience
    if (onSetEditingRoute) {
      onSetEditingRoute(displayedRoute);
    } else {
      // Fallback: just open the route builder modal with the displayed route
      setShowRouteBuilderModal(true);
    }
  };
  
  // Handle cancelling edit mode
  const handleCancelEdit = () => {
    setIsEditingDisplayedRoute(false);
    setEditedWaypoints([]);
    setEditedPathCoordinates([]);
    setIsAddingWaypointMode(false);
    setEditRoutingMode('direct');
    // Clear POI editing state
    setEditingPOIs([]);
    setSelectedEditPOI(null);
    editPOIMarkersRef.current.forEach(marker => marker.remove());
    editPOIMarkersRef.current = [];
    // Re-display the original route
    if (routeBeingEdited) {
      displayRoute(routeBeingEdited);
    }
    setRouteBeingEdited(null);
  };
  
  // Handle saving edited route
  const handleSaveEditedRoute = () => {
    if (!routeBeingEdited || editedWaypoints.length < 2) {
      toast({
        title: "Insufficient waypoints",
        description: "A route must have at least 2 waypoints.",
        variant: "destructive",
      });
      return;
    }
    
    // Calculate distance from path coordinates (the actual route path)
    const calculatePathDistance = (coords: [number, number][]) => {
      if (coords.length < 2) return 0;
      let total = 0;
      for (let i = 1; i < coords.length; i++) {
        const [lng1, lat1] = coords[i - 1];
        const [lng2, lat2] = coords[i];
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        total += R * c;
      }
      return total;
    };
    
    // Use the full path coordinates for the route line
    const pathToSave = editedPathCoordinates.length > 0 
      ? editedPathCoordinates 
      : editedWaypoints.map(wp => wp.lngLat);
    
    updateRouteMutation.mutate({
      routeId: routeBeingEdited.id,
      routeData: {
        pathCoordinates: JSON.stringify(pathToSave),
        waypointCoordinates: JSON.stringify(editedWaypoints),
        totalDistance: calculatePathDistance(pathToSave),
        routingMode: editRoutingMode
      }
    });
  };
  
  // Handle waypoint drag end
  const handleWaypointDragEnd = (index: number, newLngLat: [number, number]) => {
    setEditedWaypoints(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], lngLat: newLngLat };
      return updated;
    });
  };
  
  // Handle adding a new waypoint
  const handleAddWaypoint = (lngLat: [number, number]) => {
    setEditedWaypoints(prev => [
      ...prev,
      { name: `Waypoint ${prev.length + 1}`, lngLat, elevation: undefined }
    ]);
    setIsAddingWaypointMode(false);
  };
  
  // Effect to handle selected route display
  useEffect(() => {
    if (selectedRoute && isMapReady) {
      if (displayedRouteIdRef.current === selectedRoute.id) return;
      displayedRouteIdRef.current = selectedRoute.id;
      
      const isOwner = (user as any)?.id === selectedRoute.userId;
      
      displayRoute(
        selectedRoute,
        isOwner,
        isOwner ? (waypointIndex, newLngLat, allWaypoints) => {
          handleViewWaypointDragged(selectedRoute, waypointIndex, newLngLat, allWaypoints);
        } : undefined,
        isOwner ? (remainingWaypoints) => {
          handleViewWaypointDeleted(selectedRoute, remainingWaypoints);
        } : undefined
      );
      
      if (onRouteDisplayed) {
        onRouteDisplayed();
      }
    } else if (!selectedRoute) {
      displayedRouteIdRef.current = null;
    }
  }, [selectedRoute, isMapReady, displayRoute, onRouteDisplayed, user]);

  // Effect to handle displaying all routes at once
  useEffect(() => {
    if (routesToDisplayAll && routesToDisplayAll.length > 0 && isMapReady) {
      displayAllRoutes(routesToDisplayAll);
      if (onAllRoutesDisplayed) {
        onAllRoutesDisplayed();
      }
    }
  }, [routesToDisplayAll, isMapReady, displayAllRoutes, onAllRoutesDisplayed]);

  // Store POI markers reference for cleanup
  const displayedRouteIdRef = useRef<number | null>(null);
  const poiMarkersRef = useRef<mapboxgl.Marker[]>([]);

  // Effect to display POI markers when viewing a route
  useEffect(() => {
    if (!displayedRoute || !map || isEditingDisplayedRoute) {
      // Clear POI markers when route is closed or editing
      poiMarkersRef.current.forEach(marker => marker.remove());
      poiMarkersRef.current = [];
      return;
    }

    const loadAndDisplayPOIs = async () => {
      try {
        const res = await fetch(`/api/routes/${displayedRoute.id}/pois`, { credentials: 'include' });
        if (!res.ok) return;
        const pois = await res.json();
        
        // Clear existing POI markers
        poiMarkersRef.current.forEach(marker => marker.remove());
        poiMarkersRef.current = [];

        // Add markers for each POI
        pois.forEach((poi: any) => {
          const markerEl = document.createElement('div');
          markerEl.style.width = '20px';
          markerEl.style.height = '20px';
          markerEl.style.cursor = 'pointer';
          markerEl.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#F59E0B" stroke="#FCD34D" stroke-width="1"/>
            </svg>
          `;

          const elevationFt = poi.elevation ? Math.round(parseFloat(poi.elevation) * 3.28084).toLocaleString() : null;
          const photoCount = poi.photos ? JSON.parse(poi.photos).length : 0;
          const popupContent = `
            <div style="padding: 8px; max-width: 220px; position: relative;">
              <button 
                id="close-poi-btn-${poi.id}"
                style="position: absolute; top: -4px; right: -4px; width: 20px; height: 20px; background: #6B7280; color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; line-height: 1;"
                title="Close"
              >&times;</button>
              <h3 style="margin: 0 0 6px 0; font-weight: bold; color: #F59E0B; padding-right: 16px;">${poi.name}</h3>
              ${elevationFt ? `<p style="margin: 4px 0; font-size: 12px; color: #666;">Elevation: ${elevationFt} ft</p>` : ''}
              ${poi.note ? `<p style="margin: 4px 0; font-size: 12px; color: #666;">${poi.note}</p>` : ''}
              ${photoCount > 0 ? `<p style="margin: 4px 0; font-size: 12px; color: #666;">📷 ${photoCount} photo${photoCount > 1 ? 's' : ''}</p>` : ''}
              <button 
                data-testid="button-edit-poi-${poi.id}"
                id="edit-poi-btn-${poi.id}"
                style="margin-top: 8px; padding: 6px 12px; background: #4F46E5; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px;"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                View / Edit
              </button>
            </div>
          `;

          const popup = new mapboxgl.Popup({ offset: 12, maxWidth: '240px' })
            .setHTML(popupContent);

          // Add click handlers for Close and Edit buttons when popup opens
          popup.on('open', () => {
            setTimeout(() => {
              const closeBtn = document.getElementById(`close-poi-btn-${poi.id}`);
              if (closeBtn) {
                closeBtn.onclick = (e) => {
                  e.stopPropagation();
                  popup.remove();
                };
              }
              const editBtn = document.getElementById(`edit-poi-btn-${poi.id}`);
              if (editBtn) {
                editBtn.onclick = (e) => {
                  e.stopPropagation();
                  popup.remove();
                  setSelectedViewPOI({
                    id: poi.id,
                    name: poi.name,
                    latitude: poi.latitude,
                    longitude: poi.longitude,
                    elevation: poi.elevation,
                    note: poi.note,
                    photos: poi.photos
                  });
                };
              }
            }, 50);
          });

          const isOwner = (user as any)?.id === displayedRoute.userId;
          const marker = new mapboxgl.Marker({ element: markerEl, draggable: isOwner })
            .setLngLat([parseFloat(poi.longitude), parseFloat(poi.latitude)])
            .setPopup(popup)
            .addTo(map);

          if (isOwner) {
            markerEl.style.cursor = 'grab';
            marker.on('dragend', () => {
              const lngLat = marker.getLngLat();
              updatePOIMutation.mutate({
                routeId: displayedRoute.id,
                poiId: poi.id,
                data: {
                  latitude: lngLat.lat,
                  longitude: lngLat.lng
                }
              });
            });
          }

          poiMarkersRef.current.push(marker);
        });
      } catch (error) {
        console.error('Error loading POIs:', error);
      }
    };

    loadAndDisplayPOIs();

    return () => {
      poiMarkersRef.current.forEach(marker => marker.remove());
      poiMarkersRef.current = [];
    };
  }, [displayedRoute?.id, map, isEditingDisplayedRoute, poiRefreshTrigger, user]);
  
  // Effect to handle opening route builder for editing
  useEffect(() => {
    if (editingRoute) {
      setShowRouteBuilderModal(true);
    }
  }, [editingRoute]);
  
  // Effect to display edit mode waypoints when entering edit mode
  useEffect(() => {
    if (isEditingDisplayedRoute && editedWaypoints.length > 0 && isMapReady) {
      // Clear the regular route display first
      clearDisplayedRoute();
      displayedRouteIdRef.current = null;
      // Display editable waypoints
      displayEditModeWaypoints(editedWaypoints, handleWaypointDragEnd);
    }
  }, [isEditingDisplayedRoute, isMapReady]);
  
  // Effect to recalculate route path when waypoints or routing mode changes
  useEffect(() => {
    if (isEditingDisplayedRoute && editedWaypoints.length >= 2) {
      setIsCalculatingRoute(true);
      calculateEditedRoutePath(editedWaypoints, editRoutingMode)
        .then(path => {
          setEditedPathCoordinates(path);
          setIsCalculatingRoute(false);
        })
        .catch(() => {
          setEditedPathCoordinates(editedWaypoints.map(wp => wp.lngLat));
          setIsCalculatingRoute(false);
        });
    }
  }, [editedWaypoints, editRoutingMode, isEditingDisplayedRoute]);
  
  // Effect to update route line when path coordinates change
  useEffect(() => {
    if (isEditingDisplayedRoute && editedPathCoordinates.length > 0) {
      // Update the route line with the full path
      updateEditModeRouteLineWithPath(editedPathCoordinates);
      // Re-display waypoint markers
      displayEditModeWaypoints(editedWaypoints, handleWaypointDragEnd);
    }
  }, [editedPathCoordinates, isEditingDisplayedRoute]);
  
  // Effect to clean up edit mode when exiting
  useEffect(() => {
    if (!isEditingDisplayedRoute) {
      clearEditModeWaypoints();
    }
  }, [isEditingDisplayedRoute]);
  
  // Effect to enable map click for adding waypoints
  useEffect(() => {
    if (isAddingWaypointMode && isMapReady) {
      addEditModeWaypointOnClick(handleAddWaypoint);
    }
  }, [isAddingWaypointMode, isMapReady]);
  
  // Effect to display draggable POI markers during route edit mode
  useEffect(() => {
    if (!isEditingDisplayedRoute || !map || !routeBeingEdited) {
      // Clean up markers when not in edit mode
      editPOIMarkersRef.current.forEach(marker => marker.remove());
      editPOIMarkersRef.current = [];
      return;
    }
    
    // Clear existing edit POI markers
    editPOIMarkersRef.current.forEach(marker => marker.remove());
    editPOIMarkersRef.current = [];
    
    // Display POIs as draggable markers
    editingPOIs.forEach((poi) => {
      const markerEl = document.createElement('div');
      markerEl.className = 'edit-poi-marker';
      markerEl.style.width = '32px';
      markerEl.style.height = '32px';
      markerEl.style.cursor = 'grab';
      markerEl.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="#FFD700" stroke="#000" stroke-width="1.5">
          <polygon points="12,2 15,9 22,9.5 17,14 18.5,22 12,18 5.5,22 7,14 2,9.5 9,9" />
        </svg>
      `;
      
      const marker = new mapboxgl.Marker({ 
        element: markerEl,
        draggable: true 
      })
        .setLngLat([parseFloat(poi.longitude), parseFloat(poi.latitude)])
        .addTo(map);
      
      // Handle drag end - update POI position
      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        if (routeBeingEdited) {
          updatePOIMutation.mutate({
            routeId: routeBeingEdited.id,
            poiId: poi.id,
            data: {
              latitude: lngLat.lat,
              longitude: lngLat.lng
            }
          });
        }
      });
      
      // Handle click - open edit popup
      markerEl.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedEditPOI({
          id: poi.id,
          name: poi.name,
          elevation: poi.elevation || '',
          note: poi.note || ''
        });
      });
      
      editPOIMarkersRef.current.push(marker);
    });
    
    return () => {
      editPOIMarkersRef.current.forEach(marker => marker.remove());
      editPOIMarkersRef.current = [];
    };
  }, [isEditingDisplayedRoute, editingPOIs, map, routeBeingEdited]);
  
  const activeDroneImage = droneImages?.find(image => image.isActive);
  
  // Track if we just activated via modal to prevent auto-load from interfering
  const justActivatedViaModalRef = useRef(false);

  // Listen for global drone image activation event (backup to React props)
  useEffect(() => {
    const handleDroneImageActivated = (event: CustomEvent) => {
      const image = event.detail as DroneImage;

      if (isMapReady && addDroneImagery) {
        addDroneImagery(image);
      }
    };
    
    window.addEventListener('droneImageActivated', handleDroneImageActivated as EventListener);
    return () => {
      window.removeEventListener('droneImageActivated', handleDroneImageActivated as EventListener);
    };
  }, [isMapReady, addDroneImagery]);
  
  // Listen for global drone image deactivation event (to remove specific layers)
  useEffect(() => {
    const handleDroneImageDeactivated = (event: CustomEvent) => {
      const { id } = event.detail;

      if (isMapReady && removeDroneImageryById) {
        removeDroneImageryById(id);
      }
    };
    
    window.addEventListener('droneImageDeactivated', handleDroneImageDeactivated as EventListener);
    return () => {
      window.removeEventListener('droneImageDeactivated', handleDroneImageDeactivated as EventListener);
    };
  }, [isMapReady, removeDroneImageryById]);

  // Handle activated drone image from modal (directly fly to and display the image)
  // This runs FIRST and takes priority over auto-load
  useEffect(() => {
    if (!isMapReady || !addDroneImagery || !activatedDroneImage) return;
    
    // Set flag to prevent auto-load from re-flying
    justActivatedViaModalRef.current = true;
    
    addDroneImagery(activatedDroneImage);
    
    // Notify that the image has been activated
    if (onDroneImageActivated) {
      onDroneImageActivated();
    }
    
    // Reset flag after a delay to allow auto-load to work for subsequent changes
    setTimeout(() => {
      justActivatedViaModalRef.current = false;
    }, 2000);
  }, [activatedDroneImage, isMapReady, addDroneImagery, onDroneImageActivated]);

  // Auto-load active drone imagery on initial page load ONLY (not when user clicks View)
  const hasAutoLoadedRef = useRef(false);
  useEffect(() => {
    // Only auto-load once on initial page load, not on subsequent changes
    if (hasAutoLoadedRef.current) {
      return;
    }

    if (!isMapReady || !addDroneImagery) {
      return;
    }

    // Check for image passed via global variable (from Upload page "View on Map" navigation)
    const globalImage = (window as any).__activatedDroneImage;
    if (globalImage) {
      hasAutoLoadedRef.current = true;
      (window as any).__activatedDroneImage = null; // Clear it
      addDroneImagery(globalImage);
      return;
    }

    if (activeDroneImage && !activeDroneImagery) {
      hasAutoLoadedRef.current = true;
      addDroneImagery(activeDroneImage);
    }
  }, [activeDroneImage, isMapReady, activeDroneImagery, addDroneImagery]);

  // Display green dotted boundaries around areas with drone imagery available
  useEffect(() => {
    if (isMapReady && map && droneImages && droneImages.length > 0) {
      addDroneImageryBoundaries(map, droneImages);
    }
  }, [isMapReady, map, droneImages]);

  // Initialize map on component mount
  useEffect(() => {
    if (mapContainerRef.current) {
      initializeMap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start location tracking when map is ready
  useEffect(() => {
    if (!isMapReady) return;
    startLocationTracking();
  }, [isMapReady]);

  // Broadcast location to friends when location sharing is enabled
  useEffect(() => {
    if (!userLocation) return;
    if (!(rawUser as any)?.locationSharingEnabled) return;
    
    sendLocationUpdate({
      latitude: userLocation.lat,
      longitude: userLocation.lng,
      altitude: null
    });
  }, [userLocation, (rawUser as any)?.locationSharingEnabled]);

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };
  
  const searchMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !map) return;

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery.trim())}.json?access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}&limit=1`
      );
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const placeName = data.features[0].place_name;

        if (searchMarkerRef.current) {
          searchMarkerRef.current.remove();
        }

        searchMarkerRef.current = new mapboxgl.Marker({ color: '#ef4444' })
          .setLngLat([lng, lat])
          .addTo(map);

        const bbox = data.features[0].bbox;
        if (bbox) {
          map.fitBounds(
            [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
            { padding: 50, duration: 1500 }
          );
        } else {
          map.flyTo({
            center: [lng, lat],
            zoom: 14,
            duration: 1500,
          });
        }
      }
    } catch (err) {
      console.error('Geocoding failed:', err);
    }
  };
  
  // Toggle map layers
  const handleToggleLayer = (layerType: string) => {
    toggleLayer(layerType);
    
    // Open drone modal if drone layer is toggled
    if (layerType === 'drone') {
      onOpenDroneModal();
    }
  };

  // State for managing drawing UI
  const [showDrawingTools, setShowDrawingTools] = useState(false);
  const [showDrawingManager, setShowDrawingManager] = useState(false);
  
  // For handling drawing deletion
  const handleDeleteDrawing = async (id: number): Promise<boolean> => {
    const result = await removeDrawingFromMap(id);
    return result === true;
  };
  

  // Handle individual drone layer toggle
  const handleToggleDroneLayer = (droneImageId: number, isActive: boolean) => {
    const newActiveLayers = new Set(activeDroneLayers);
    
    if (isActive) {
      newActiveLayers.add(droneImageId);
      // Find and add the drone imagery to the map
      const droneImage = droneImages?.find(img => img.id === droneImageId);
      if (droneImage && addDroneImagery) {
        addDroneImagery(droneImage);
        toast({
          title: "Drone Imagery Added",
          description: `Flying to ${droneImage.name}`,
        });
      } else {
        console.error('Could not add drone imagery:', { droneImage, addDroneImagery: !!addDroneImagery });
      }
    } else {
      newActiveLayers.delete(droneImageId);
      if (removeDroneImageryById) {
        removeDroneImageryById(droneImageId);
      }
    }
    
    setActiveDroneLayers(newActiveLayers);
  };

  // GPS Activity Recording handlers
  const startRecording = () => {
    if (!navigator.geolocation) {
      toast({
        title: "GPS Not Available",
        description: "Your device doesn't support GPS tracking.",
        variant: "destructive"
      });
      return;
    }

    setIsRecording(true);
    setRecordedPath([]);
    setRecordedElevations([]);
    setRecordingWaypoints([]);
    setRecordingStartTime(new Date());

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newPoint: [number, number] = [position.coords.longitude, position.coords.latitude];
        const altitude = position.coords.altitude ?? 0; // meters
        
        setRecordedPath(prev => {
          const updated = [...prev, newPoint];
          updateRecordingLine(updated);
          return updated;
        });
        
        setRecordedElevations(prev => [...prev, altitude]);
      },
      (error) => {
        console.error("GPS error:", error);
        // Clear the watch and reset recording state
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        setIsRecording(false);
        setRecordedPath([]);
        setRecordingStartTime(null);
        clearRecordingLine();
        
        toast({
          title: "GPS Error",
          description: error.code === 1 
            ? "Location permission denied. Please enable GPS access." 
            : "Unable to track your location. Please check GPS settings.",
          variant: "destructive"
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      }
    );

    toast({
      title: "Recording Started",
      description: "Your path is now being tracked."
    });
  };

  const stopRecording = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsRecording(false);
    
    if (recordedPath.length < 2) {
      toast({
        title: "Not Enough Data",
        description: "You need to move more to create a route.",
        variant: "destructive"
      });
      clearRecordingLine();
      setRecordedPath([]);
      return;
    }
    
    // Show save modal
    setShowSaveRecordingModal(true);
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const updateRecordingLine = (path: [number, number][]) => {
    if (!map || path.length < 2) return;

    const sourceId = 'recording-line-source';
    const layerId = 'recording-line-layer';

    try {
      if (!recordingLineSourceRef.current) {
        // Add the source and layer for the first time
        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: path
            }
          }
        });

        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#3b82f6',
            'line-width': 2
          }
        });

        recordingLineSourceRef.current = true;
      } else {
        // Update the existing source
        const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
        if (source) {
          source.setData({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: path
            }
          });
        }
      }
    } catch (error) {
      console.error("Error updating recording line:", error);
    }
  };

  const clearRecordingLine = () => {
    if (!map) return;
    
    const sourceId = 'recording-line-source';
    const layerId = 'recording-line-layer';

    try {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
      recordingLineSourceRef.current = false;
    } catch (error) {
      console.error("Error clearing recording line:", error);
    }
  };

  // Calculate distance between two coordinates using Haversine formula
  const calculateDistance = (coords: [number, number][]): number => {
    if (coords.length < 2) return 0;
    
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      const [lng1, lat1] = coords[i - 1];
      const [lng2, lat2] = coords[i];
      
      const R = 6371000; // Earth's radius in meters
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      total += R * c;
    }
    return total;
  };

  // Calculate elevation gain from recorded elevations
  const calculateElevationGain = (elevations: number[]): number => {
    if (elevations.length < 2) return 0;
    let gain = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) gain += diff;
    }
    return gain;
  };

  // Calculate pace in minutes per mile
  const calculatePace = (distanceMeters: number, startTime: Date | null): string => {
    if (!startTime || distanceMeters < 10) return '--:--';
    const elapsedMinutes = (Date.now() - startTime.getTime()) / 60000;
    const distanceMiles = distanceMeters / 1609.34;
    if (distanceMiles < 0.01) return '--:--';
    const paceMinPerMile = elapsedMinutes / distanceMiles;
    const mins = Math.floor(paceMinPerMile);
    const secs = Math.round((paceMinPerMile - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Convert meters to miles
  const metersToMiles = (meters: number): number => meters / 1609.34;
  
  // Convert meters to feet
  const metersToFeet = (meters: number): number => meters * 3.28084;

  // Save recorded route
  const saveRecordedRoute = async () => {
    if (!recordedPath.length || !recordingName.trim()) return;

    const totalDistance = calculateDistance(recordedPath);
    const elevationGain = calculateElevationGain(recordedElevations);
    const estimatedTime = recordingStartTime 
      ? Math.round((Date.now() - recordingStartTime.getTime()) / 1000) 
      : Math.round(totalDistance / 83.33);

    // Build waypoint coordinates from any waypoints added during recording
    const waypointCoords = recordingWaypoints.map((wp, idx) => ({
      name: wp.name || `Waypoint ${idx + 1}`,
      lngLat: wp.lngLat,
      elevation: 0,
      note: wp.note
    }));

    const routeData = {
      name: recordingName.trim(),
      description: `Recorded activity on ${recordingStartTime?.toLocaleDateString()}`,
      waypointIds: JSON.stringify([]),
      pathCoordinates: JSON.stringify(recordedPath),
      waypointCoordinates: JSON.stringify(waypointCoords),
      totalDistance: totalDistance,
      elevationGain: elevationGain,
      elevationLoss: 0,
      estimatedTime: estimatedTime,
      routingMode: 'recorded',
      isPublic: false
    };

    try {
      const response = await apiRequest('POST', '/api/routes', routeData);
      const savedRoute = await response.json();
      
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      
      toast({
        title: "Route Saved!",
        description: `"${recordingName}" has been saved to your routes.`
      });
      
      // Clean up
      setShowSaveRecordingModal(false);
      setRecordingName('');
      setRecordedPath([]);
      setRecordedElevations([]);
      setRecordingWaypoints([]);
      setRecordingStartTime(null);
      clearRecordingLine();
      
    } catch (error) {
      console.error("Error saving route:", error);
      toast({
        title: "Save Failed",
        description: "Unable to save your recorded route.",
        variant: "destructive"
      });
    }
  };

  // Add waypoint during recording save
  const addRecordingWaypoint = () => {
    if (recordedPath.length === 0) return;
    const lastPoint = recordedPath[recordedPath.length - 1];
    setRecordingWaypoints(prev => [...prev, {
      name: `Waypoint ${prev.length + 1}`,
      lngLat: lastPoint,
      note: ''
    }]);
  };

  const updateRecordingWaypoint = (index: number, field: 'name' | 'note', value: string) => {
    setRecordingWaypoints(prev => prev.map((wp, i) => 
      i === index ? { ...wp, [field]: value } : wp
    ));
  };

  const removeRecordingWaypoint = (index: number) => {
    setRecordingWaypoints(prev => prev.filter((_, i) => i !== index));
  };

  const cancelSaveRecording = () => {
    setShowSaveRecordingModal(false);
    setRecordingName('');
    setRecordingWaypoints([]);
    setRecordedPath([]);
    setRecordingStartTime(null);
    clearRecordingLine();
  };

  // Save drone position permanently
  const saveDronePosition = async () => {
    if (!activeDroneImagery) return;
    
    try {
      const response = await fetch(`/api/drone-images/${activeDroneImagery.id}/position`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(droneAdjustments),
      });
      
      if (response.ok) {
        // Reset adjustments since they're now saved permanently
        updateDroneAdjustments({ scale: 1.0, offsetLat: 0, offsetLng: 0 });
        setIsDroneAdjustmentMode(false);
        
        // Reload the drone imagery to reflect the new permanent position
        setTimeout(() => {
          addDroneImagery(activeDroneImagery);
        }, 100);
      }
    } catch (error) {
      console.error('Error saving drone position:', error);
    }
  };

  // Show feedback when an invalid (too small) drag occurs
  useEffect(() => {
    if (offlineSelectionInvalidDrag) {
      toast({
        title: "Area too small",
        description: "Please draw a larger area on the map. Click and drag to select.",
        variant: "destructive"
      });
    }
  }, [offlineSelectionInvalidDrag, toast]);

  // Handle POI placement mode map clicks
  useEffect(() => {
    if (!map || !isAddingPOIMode) return;
    
    const handlePOIClick = (e: mapboxgl.MapMouseEvent) => {
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      setPendingPOILocation(lngLat);
      
      // Add or update temporary POI marker
      const poiMarkerId = 'pending-poi-marker';
      
      // Remove existing pending marker if any
      const existingMarker = document.getElementById(poiMarkerId);
      if (existingMarker) {
        existingMarker.remove();
      }
      
      // Create marker element
      const markerEl = document.createElement('div');
      markerEl.id = poiMarkerId;
      markerEl.style.width = '24px';
      markerEl.style.height = '24px';
      markerEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#F59E0B" stroke="#FCD34D" stroke-width="1"/>
        </svg>
      `;
      markerEl.style.cursor = 'pointer';
      
      new mapboxgl.Marker({ element: markerEl })
        .setLngLat(lngLat)
        .addTo(map);
    };
    
    map.on('click', handlePOIClick);
    
    return () => {
      map.off('click', handlePOIClick);
      // Clean up pending marker when leaving POI mode
      const existingMarker = document.getElementById('pending-poi-marker');
      if (existingMarker) {
        existingMarker.remove();
      }
    };
  }, [map, isAddingPOIMode]);

  // Start offline area selection
  const handleStartOfflineSelection = () => {
    startOfflineAreaSelection();
    toast({
      title: "Select offline area",
      description: "Click and drag on the map to select an area to download for offline use.",
    });
  };

  return (
    <div className="flex-1 relative">
      {/* Map container */}
      <div ref={mapContainerRef} className="absolute inset-0" />
      
      {/* Map Header with Search */}
      <MapHeader 
        searchQuery={searchQuery} 
        onSearchChange={handleSearchChange} 
        onSearchSubmit={handleSearchSubmit}
      />
      
      {/* Drone Imagery Loading Indicator */}
      {isDroneImageryLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-black/90 backdrop-blur-md rounded-2xl shadow-2xl border border-green-500/30 px-10 py-8 animate-in fade-in duration-300 pointer-events-auto">
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 border-4 border-green-500/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
                <svg className="absolute inset-0 m-auto w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-base">Loading Drone Imagery...</p>
                <p className="text-white/50 text-xs mt-1">Large files may take a moment</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trail Info Loading Indicator */}
      {isTrailInfoLoading && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-dark/90 backdrop-blur-md rounded-2xl shadow-2xl border border-amber-500/20 px-8 py-5 animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-10 h-10">
              <div className="absolute inset-0 border-3 border-amber-500/20 rounded-full" />
              <div className="absolute inset-0 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <svg className="absolute inset-0 m-auto w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <span className="text-white font-medium text-sm">Loading Trail Info...</span>
            <span className="text-white/50 text-xs">Trail names, paths & overlays</span>
          </div>
        </div>
      )}
      
      {/* Distance Measurement Panel - Top Center */}
      {isMeasurementMode && (
        <div
          className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50 bg-dark/95 backdrop-blur-sm rounded-xl shadow-2xl border border-white/20 px-4 py-3 animate-in fade-in duration-300"
          style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
          data-testid="measurement-notification"
        >
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-xs text-white/60 mb-1">
                {measurementPath.length === 0 ? 'Tap on map to start measuring' : `${measurementPath.length} point${measurementPath.length !== 1 ? 's' : ''}`}
              </p>
              <p className="text-lg font-bold text-white">
                {measurementDistance || 'Tap to add points'}
              </p>
              {measurementPath.length >= 2 && measurementElevations.length >= 2 && (() => {
                const firstElev = measurementElevations[0];
                const lastElev = measurementElevations[measurementElevations.length - 1];
                if (firstElev !== null && firstElev !== undefined && lastElev !== null && lastElev !== undefined) {
                  const elevChangeFt = Math.round((lastElev - firstElev) * 3.28084);
                  const sign = elevChangeFt >= 0 ? '+' : '';
                  return (
                    <p className="text-xs text-cyan-400 mt-0.5">
                      Elev change: {sign}{elevChangeFt} ft
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            {measurementPath.length > 0 && (
              <button
                onClick={clearMeasurementPath}
                className="px-3 py-1.5 bg-red-500/80 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
                data-testid="button-clear-measurement"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setIsMeasurementMode(false)}
              className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-medium rounded-lg transition-colors"
              data-testid="button-exit-measurement"
            >
              Done
            </button>
          </div>
        </div>
      )}
      
      {/* Route Summary Panel - appears when viewing a saved route */}
      {displayedRoute && !isEditingDisplayedRoute && (
        <RouteSummaryPanel 
          route={displayedRoute}
          onClose={() => {
            clearDisplayedRoute();
            displayedRouteIdRef.current = null;
            setIsAddingPOIMode(false);
            setPendingPOILocation(null);
          }}
          isOwner={(user as any)?.id === displayedRoute.userId}
          onAddPOIMode={(enabled) => {
            setIsAddingPOIMode(enabled);
            if (enabled) {
              setIsMarkerMode(false);
              setIsAddingWaypointMode(false);
            }
          }}
          pendingPOILocation={pendingPOILocation}
          onClearPendingPOI={() => setPendingPOILocation(null)}
          onPOIsChanged={() => setPoiRefreshTrigger(prev => prev + 1)}
          onOpenPOIEdit={(poi) => {
            setSelectedViewPOI({
              id: poi.id,
              name: poi.name,
              latitude: poi.latitude,
              longitude: poi.longitude,
              elevation: poi.elevation,
              note: poi.note,
              photos: poi.photos
            });
          }}
          onRouteUpdated={(updatedRoute) => {
            const stillOwner = (user as any)?.id === updatedRoute.userId;
            displayRoute(
              updatedRoute,
              stillOwner,
              stillOwner ? (waypointIndex, newLngLat, allWaypoints) => {
                handleViewWaypointDragged(updatedRoute, waypointIndex, newLngLat, allWaypoints);
              } : undefined,
              stillOwner ? (remainingWaypoints) => {
                handleViewWaypointDeleted(updatedRoute, remainingWaypoints);
              } : undefined
            );
          }}
        />
      )}
      
      {/* Route Edit Toolbar - appears when editing a displayed route */}
      {isEditingDisplayedRoute && routeBeingEdited && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 w-[95%] max-w-lg" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="bg-dark/95 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white">
                Editing: {routeBeingEdited.name}
              </h2>
              <span className="text-sm text-white/60">
                {editedWaypoints.length} waypoints
              </span>
            </div>
            
            {/* Routing Mode Toggle */}
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => setEditRoutingMode('direct')}
                disabled={isCalculatingRoute}
                className={`flex-1 py-2 px-2 rounded-lg text-sm font-medium transition-colors ${
                  editRoutingMode === 'direct'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
                data-testid="button-routing-direct"
              >
                Direct
              </button>
              <button
                onClick={() => setEditRoutingMode('road')}
                disabled={isCalculatingRoute}
                className={`flex-1 py-2 px-2 rounded-lg text-sm font-medium transition-colors ${
                  editRoutingMode === 'road'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
                data-testid="button-routing-road"
              >
                Road
              </button>
              <button
                onClick={() => setEditRoutingMode('trail')}
                disabled={isCalculatingRoute}
                className={`flex-1 py-2 px-2 rounded-lg text-sm font-medium transition-colors ${
                  editRoutingMode === 'trail'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
                data-testid="button-routing-trail"
              >
                Trail
              </button>
            </div>
            
            {isCalculatingRoute && (
              <p className="mb-2 text-sm text-blue-400 text-center">
                Calculating route...
              </p>
            )}
            
            <div className="flex gap-2">
              <Button
                onClick={() => setIsAddingWaypointMode(!isAddingWaypointMode)}
                className={`flex-1 ${isAddingWaypointMode ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-600 hover:bg-blue-700'} text-white font-medium`}
                data-testid="button-add-waypoint"
              >
                {isAddingWaypointMode ? 'Click Map to Add' : 'Add Waypoint'}
              </Button>
              <Button
                onClick={handleSaveEditedRoute}
                disabled={updateRouteMutation.isPending || editedWaypoints.length < 2 || isCalculatingRoute}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium"
                data-testid="button-save-route-edit"
              >
                {updateRouteMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                onClick={handleCancelEdit}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-medium"
                data-testid="button-cancel-route-edit"
              >
                Cancel
              </Button>
            </div>
            
            {isAddingWaypointMode && (
              <p className="mt-2 text-sm text-yellow-400 text-center">
                Click anywhere on the map to add a new waypoint
              </p>
            )}
            
            {/* POI count indicator during edit mode */}
            {editingPOIs.length > 0 && (
              <p className="mt-2 text-sm text-yellow-400 text-center">
                {editingPOIs.length} POI{editingPOIs.length !== 1 ? 's' : ''} - Click to edit, drag to move
              </p>
            )}
          </div>
        </div>
      )}
      
      {/* POI Edit Popup - appears when clicking a POI during route edit mode */}
      {selectedEditPOI && routeBeingEdited && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] w-[90%] max-w-sm">
          <div className="bg-dark/95 backdrop-blur-md rounded-xl shadow-2xl border border-yellow-500/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFD700" stroke="#000" strokeWidth="1.5">
                  <polygon points="12,2 15,9 22,9.5 17,14 18.5,22 12,18 5.5,22 7,14 2,9.5 9,9" />
                </svg>
                Edit Point of Interest
              </h3>
              <button
                onClick={() => setSelectedEditPOI(null)}
                className="text-white/60 hover:text-white"
                data-testid="button-close-poi-edit"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-white/70 mb-1">Name</label>
                <input
                  type="text"
                  value={selectedEditPOI.name}
                  onChange={(e) => setSelectedEditPOI(prev => prev ? {...prev, name: e.target.value} : null)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-yellow-500"
                  placeholder="POI name"
                  data-testid="input-poi-name"
                />
              </div>
              
              <div>
                <label className="block text-sm text-white/70 mb-1">Elevation (feet)</label>
                <input
                  type="number"
                  value={selectedEditPOI.elevation}
                  onChange={(e) => setSelectedEditPOI(prev => prev ? {...prev, elevation: e.target.value} : null)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-yellow-500"
                  placeholder="Elevation in feet"
                  data-testid="input-poi-elevation"
                />
              </div>
              
              <div>
                <label className="block text-sm text-white/70 mb-1">Notes</label>
                <textarea
                  value={selectedEditPOI.note}
                  onChange={(e) => setSelectedEditPOI(prev => prev ? {...prev, note: e.target.value} : null)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-yellow-500 resize-none"
                  rows={2}
                  placeholder="Add notes..."
                  data-testid="input-poi-note"
                />
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (selectedEditPOI.name.trim()) {
                      const elevationInMeters = selectedEditPOI.elevation 
                        ? (parseFloat(selectedEditPOI.elevation) / 3.28084).toFixed(2)
                        : null;
                      updatePOIMutation.mutate({
                        routeId: routeBeingEdited.id,
                        poiId: selectedEditPOI.id,
                        data: {
                          name: selectedEditPOI.name,
                          elevation: elevationInMeters,
                          note: selectedEditPOI.note || null
                        }
                      });
                    } else {
                      toast({
                        title: "Name required",
                        description: "Please enter a name for the POI.",
                        variant: "destructive"
                      });
                    }
                  }}
                  disabled={updatePOIMutation.isPending}
                  className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-black font-medium"
                  data-testid="button-save-poi-edit"
                >
                  {updatePOIMutation.isPending ? 'Saving...' : 'Save POI'}
                </Button>
                <Button
                  onClick={() => setSelectedEditPOI(null)}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-medium"
                  data-testid="button-cancel-poi-edit"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Clicked Route Info Popup - appears when clicking a route line in "display all routes" mode */}
      {clickedRouteInfo && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] w-[90%] max-w-sm">
          <div className="bg-dark/95 backdrop-blur-md rounded-xl shadow-2xl border border-white/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div 
                  className="w-4 h-4 rounded-full" 
                  style={{ backgroundColor: clickedRouteInfo.color }}
                />
                <h3 className="text-lg font-bold text-white">{clickedRouteInfo.name}</h3>
              </div>
              <button
                onClick={() => setClickedRouteInfo(null)}
                className="text-white/60 hover:text-white"
                data-testid="button-close-route-info"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {clickedRouteInfo.description && (
              <p className="text-white/70 text-sm mb-3">{clickedRouteInfo.description}</p>
            )}
            
            <div className="grid grid-cols-2 gap-3 text-sm">
              {clickedRouteInfo.totalDistance && (
                <div className="flex items-center gap-2 text-white/80">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.5 12H2.5M21.5 12L15 5.5M21.5 12L15 18.5"/>
                  </svg>
                  <span>
                    {(() => {
                      const dist = parseFloat(clickedRouteInfo.totalDistance);
                      const miles = dist / 1609.34;
                      return miles < 0.1 
                        ? `${Math.round(dist * 3.28084)} ft`
                        : `${miles.toFixed(2)} mi`;
                    })()}
                  </span>
                </div>
              )}
              
              {clickedRouteInfo.estimatedTime && (
                <div className="flex items-center gap-2 text-white/80">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                  <span>
                    {(() => {
                      const time = parseInt(clickedRouteInfo.estimatedTime);
                      return time < 60 ? `${time}min` : `${Math.floor(time / 60)}h ${time % 60}min`;
                    })()}
                  </span>
                </div>
              )}
              
              {clickedRouteInfo.elevationGain && parseFloat(clickedRouteInfo.elevationGain) > 0 && (
                <div className="flex items-center gap-2 text-green-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                  </svg>
                  <span>+{Math.round(parseFloat(clickedRouteInfo.elevationGain) * 3.28084).toLocaleString()} ft</span>
                </div>
              )}
              
              {clickedRouteInfo.elevationLoss && parseFloat(clickedRouteInfo.elevationLoss) > 0 && (
                <div className="flex items-center gap-2 text-red-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12l7 7 7-7"/>
                  </svg>
                  <span>-{Math.round(parseFloat(clickedRouteInfo.elevationLoss) * 3.28084).toLocaleString()} ft</span>
                </div>
              )}
            </div>
            
            <div className="mt-4 pt-3 border-t border-white/20">
              <Button
                onClick={() => setClickedRouteInfo(null)}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="button-dismiss-route-info"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Save Route Button - appears during route building at top center */}
      {isRouteBuildingMode && routeWaypoints.length >= 2 && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          <Button
            className="h-10 px-4 shadow-lg bg-green-600 hover:bg-green-700 text-white border-0"
            onClick={handleSaveRoute}
            disabled={saveRouteMutation.isPending}
            title={`Save route with ${routeWaypoints.length} waypoints`}
          >
            {saveRouteMutation.isPending ? 'Saving...' : `Save Route (${routeWaypoints.length})`}
          </Button>
        </div>
      )}
      
      {/* Offline Selection Controls - appears during offline area selection */}
      {isOfflineSelectionMode && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10 flex gap-2" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          {offlineSelectionBounds && (
            <Button
              className="h-10 px-4 shadow-lg bg-blue-600 hover:bg-blue-700 text-white border-0"
              onClick={() => {
                const bounds = finishOfflineAreaSelection();
                if (bounds) {
                  setSelectedOfflineBounds(bounds);
                  setShowOfflineModal(true);
                  // Don't call completeOfflineAreaSelection here - let modal closure handle it
                } else {
                  toast({
                    title: "No area selected",
                    description: "Please draw a larger area on the map.",
                    variant: "destructive"
                  });
                }
              }}
              data-testid="button-finish-offline-selection"
            >
              Download This Area
            </Button>
          )}
          <Button
            className="h-10 px-4 shadow-lg bg-gray-600 hover:bg-gray-700 text-white border-0"
            onClick={() => {
              cancelOfflineAreaSelection();
              toast({
                title: "Selection cancelled",
                description: "Click Offline again to select a new area.",
              });
            }}
            data-testid="button-cancel-offline-selection"
          >
            Cancel
          </Button>
        </div>
      )}
      
      {/* Drawing Manager Modal */}
      <DrawingManagerModal 
        isOpen={showDrawingManager}
        onClose={() => setShowDrawingManager(false)}
        onDeleteDrawing={handleDeleteDrawing}
      />
      
      {/* Location Sharing Modal */}
      <LocationSharingModal 
        isOpen={showLocationSharingModal}
        onClose={() => setShowLocationSharingModal(false)}
      />
      
      {/* Route Builder Modal */}
      <RouteBuilderModal 
        isOpen={showRouteBuilderModal}
        onClose={() => {
          setShowRouteBuilderModal(false);
          disableDrawRouteMode();
          clearEditableRouteWaypoints();
          if (editingRoute && onRouteEdited) {
            onRouteEdited();
          }
        }}
        map={map}
        existingWaypoints={userWaypoints}
        temporaryWaypoints={routeWaypoints}
        onStartWaypointPlacement={(routeName, routeDescription) => {
          startRouteBuildingMode(routeName, routeDescription);
        }}
        editingRoute={editingRoute || undefined}
        displayEditableRouteWaypoints={displayEditableRouteWaypoints}
        getEditableWaypointPositions={getEditableWaypointPositions}
        clearEditableRouteWaypoints={clearEditableRouteWaypoints}
        enableDrawRouteMode={enableDrawRouteMode}
        disableDrawRouteMode={disableDrawRouteMode}
        onDisplayRouteAfterSave={(route) => {
          displayRoute(route);
        }}
      />
      
      {/* Offline Modal */}
      <OfflineModal 
        isOpen={showOfflineModal}
        onClose={() => {
          setShowOfflineModal(false);
          setSelectedOfflineBounds(null);
          // Complete the offline selection (cleanup) when modal closes
          completeOfflineAreaSelection();
        }}
        bounds={selectedOfflineBounds}
      />
      
      {/* Waypoint Edit Modal for POI viewing/editing */}
      {selectedViewPOI && displayedRoute && (
        <WaypointEditModal
          isOpen={!!selectedViewPOI}
          onClose={() => {
            setSelectedViewPOI(null);
            // Refresh POI markers to show updated data
            setPoiRefreshTrigger(prev => prev + 1);
          }}
          routeId={(displayedRoute as Route).id}
          poi={selectedViewPOI}
          isOwner={(displayedRoute as Route).userId === user?.id}
        />
      )}
      
      {/* Drawing Tools */}
      {showDrawingTools && (
        <div className="absolute top-40 right-4 z-10" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          <DrawingTools 
            isDrawing={!!drawingMode}
            drawingMode={drawingMode}
            onStartDrawingMode={startDrawingMode}
            onCancelDrawing={cancelDrawingMode}
            onFinishDrawing={finishDrawing}
            currentDrawing={currentDrawing}
          />
          
          {/* Saved Drawings Button */}
          <Button
            variant="outline"
            className="mt-2 w-full"
            onClick={() => setShowDrawingManager(true)}
          >
            Saved Drawings
          </Button>
        </div>
      )}
      
      {/* Map Controls */}
      <MapControls 
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onMyLocation={handleCenterOnLocation}
        onResetNorth={resetNorth}
        onToggleTerrain={toggleTerrain}
      />
      
      {/* Unified Toolbar */}
      <UnifiedToolbar 
        onToggleLayer={handleToggleLayer}
        activeLayers={activeLayers}
        activeTrailOverlays={activeTrailOverlays}
        onStartOfflineSelection={handleStartOfflineSelection}
        onToggleDroneLayer={handleToggleDroneLayer}
        activeDroneLayers={activeDroneLayers}
        onOpenRouteBuilder={() => setShowRouteBuilderModal(true)}
        isMeasurementMode={isMeasurementMode}
        onToggleMeasurement={() => setIsMeasurementMode(!isMeasurementMode)}
        isOfflineSelectionMode={isOfflineSelectionMode}
        onOpenRecordActivity={() => setShowRecordingOverlay(true)}
        onOpenLiveMap={() => setShowLiveMapModal(true)}
        isRecordingActive={showRecordingOverlay}
        showOutdoorPOIs={showOutdoorPOIs}
        isOutdoorPOIsLoading={isOutdoorPOIsLoading}
        onToggleOutdoorPOIs={() => setShowOutdoorPOIs(!showOutdoorPOIs)}
        esriImageryEnabled={esriImageryEnabled}
        onToggleEsriImagery={toggleEsriImagery}
        isAIAssistOpen={isAIAssistOpen}
      />

      <AIRouteAssistPanel
        isOpen={isAIAssistOpen}
        onClose={() => setIsAIAssistOpen(false)}
        mapCenter={map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null}
        mapZoom={map ? map.getZoom() : 10}
        onAddWaypoints={(waypoints, routeName) => {
          if (map && waypoints.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            waypoints.forEach(wp => bounds.extend([wp.lng, wp.lat]));
            map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
          }
        }}
      />

      {/* Location tracking is now handled by Mapbox directly with a blue pulsing dot */}

      
      
      
      {/* Drone Adjustment Controls */}
      <DroneAdjustmentControls
        isVisible={isDroneAdjustmentMode}
        onClose={() => setIsDroneAdjustmentMode(false)}
        adjustments={droneAdjustments}
        onAdjustmentsChange={updateDroneAdjustments}
        onSavePosition={saveDronePosition}
      />
      
      {/* Save Recording Modal */}
      <Dialog open={showSaveRecordingModal} onOpenChange={setShowSaveRecordingModal}>
        <DialogContent className="bg-dark border-white/10 max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Save Recorded Activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="route-name" className="text-white/80">Route Name</Label>
              <Input
                id="route-name"
                value={recordingName}
                onChange={(e) => setRecordingName(e.target.value)}
                placeholder="Enter a name for your route"
                className="bg-white border-gray-300 text-black placeholder:text-gray-400"
                data-testid="input-recording-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-white/80 bg-white/5 p-3 rounded-lg">
              <div>
                <span className="text-white/50">Distance</span>
                <p className="font-semibold">{metersToMiles(calculateDistance(recordedPath)).toFixed(2)} mi</p>
              </div>
              <div>
                <span className="text-white/50">Duration</span>
                <p className="font-semibold">{recordingStartTime ? Math.round((Date.now() - recordingStartTime.getTime()) / 60000) : 0} min</p>
              </div>
              <div>
                <span className="text-white/50">Elevation Gain</span>
                <p className="font-semibold">{Math.round(metersToFeet(calculateElevationGain(recordedElevations)))} ft</p>
              </div>
              <div>
                <span className="text-white/50">Avg Pace</span>
                <p className="font-semibold">{calculatePace(calculateDistance(recordedPath), recordingStartTime)} /mi</p>
              </div>
            </div>
            
            {/* Waypoints Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-white/80">Waypoints ({recordingWaypoints.length})</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addRecordingWaypoint}
                  className="h-7 text-xs border-white/20 text-white hover:bg-white/10"
                  data-testid="button-add-waypoint"
                >
                  + Add Waypoint
                </Button>
              </div>
              {recordingWaypoints.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {recordingWaypoints.map((wp, idx) => (
                    <div key={idx} className="bg-white/5 p-2 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={wp.name}
                          onChange={(e) => updateRecordingWaypoint(idx, 'name', e.target.value)}
                          placeholder="Waypoint name"
                          className="h-8 text-sm bg-dark-gray/50 border-white/20 text-white flex-1"
                          data-testid={`input-waypoint-name-${idx}`}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRecordingWaypoint(idx)}
                          className="h-8 w-8 p-0 text-red-400 hover:bg-red-500/20"
                          data-testid={`button-remove-waypoint-${idx}`}
                        >
                          ×
                        </Button>
                      </div>
                      <Input
                        value={wp.note}
                        onChange={(e) => updateRecordingWaypoint(idx, 'note', e.target.value)}
                        placeholder="Add a note..."
                        className="h-8 text-sm bg-dark-gray/50 border-white/20 text-white"
                        data-testid={`input-waypoint-note-${idx}`}
                      />
                    </div>
                  ))}
                </div>
              )}
              {recordingWaypoints.length === 0 && (
                <p className="text-xs text-white/50">Add waypoints to mark important locations on your route</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={cancelSaveRecording}
              className="border-white/20 text-white hover:bg-white/10"
              data-testid="button-cancel-recording"
            >
              Discard
            </Button>
            <Button
              onClick={saveRecordedRoute}
              disabled={!recordingName.trim()}
              className="bg-primary hover:bg-primary/90"
              data-testid="button-save-recording"
            >
              Save Route
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Recording Indicator */}
      {isRecording && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="bg-red-600 text-white px-4 py-3 rounded-xl flex flex-col items-center gap-1 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
              <span className="font-medium">Recording Activity</span>
            </div>
            {recordedPath.length > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <span>{metersToMiles(calculateDistance(recordedPath)).toFixed(2)} mi</span>
                <span>⬆ {Math.round(metersToFeet(calculateElevationGain(recordedElevations)))} ft</span>
                <span>{calculatePace(calculateDistance(recordedPath), recordingStartTime)} /mi</span>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Recording Overlay — uses the MAIN map with all layers */}
      <RecordingOverlay
        map={map}
        isVisible={showRecordingOverlay}
        onClose={() => setShowRecordingOverlay(false)}
        onDisplayRoute={(route) => displayRoute(route)}
        onClearDisplayedRoute={() => clearDisplayedRoute()}
      />

      {/* Live Map Session Modal */}
      <LiveMapSessionModal
        isOpen={showLiveMapModal}
        onClose={() => setShowLiveMapModal(false)}
      />
    </div>
  );
};

export default MapView;
