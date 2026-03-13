import { useEffect, useState, useRef, RefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { DroneImage, MapDrawing } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { escapeHtml } from '@/lib/escapeHtml';
import { addUserLocationToMap, UserLocation, DEFAULT_MAP_SETTINGS, addTetonCountyImagery, removeTetonCountyImagery, addTetonCountyParcels, removeTetonCountyParcels, switchToTetonCountyView, MAP_STYLES, switchToEnhancedMapboxSatellite, switchToEsriImagery, addEsriWorldImagery, removeEsriWorldImagery, addTopoContourLines, removeTopoContourLines, addTrailOverlay, removeTrailOverlay, addBaseTrailLinesAndLabels, addTrailGroup, removeTrailGroup, TrailOverlayType, TrailGroupType, TRAIL_OVERLAY_CONFIG, TRAIL_GROUP_CONFIG } from '@/lib/mapUtils';

// Set mapbox access token
const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
console.log('Mapbox token check:', mapboxToken ? `Token exists (${mapboxToken.substring(0, 8)}...)` : 'Token missing');
mapboxgl.accessToken = mapboxToken || '';

if (!mapboxgl.accessToken) {
  console.error('Mapbox access token is missing. Please check VITE_MAPBOX_ACCESS_TOKEN environment variable.');
} else {
  // Test token validity
  fetch(`https://api.mapbox.com/styles/v1/mapbox/streets-v11?access_token=${mapboxgl.accessToken}`)
    .then(response => {
      if (response.ok) {
        console.log('Mapbox token is valid and working');
      } else {
        console.error('Mapbox token authentication failed:', response.status, response.statusText);
      }
    })
    .catch(error => {
      console.error('Mapbox API test failed:', error);
    });
}

export const useMapbox = (mapContainerRef: RefObject<HTMLDivElement>) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [activeLayers, setActiveLayers] = useState<string[]>(['esri-hd']);
  const [activeTrailOverlays, setActiveTrailOverlays] = useState<Set<TrailOverlayType>>(new Set<TrailOverlayType>(['hiking', 'riding']));
  const [isTerrain3D, setIsTerrain3D] = useState(false);
  const [showOutdoorPOIs, setShowOutdoorPOIs] = useState(false);
  const [esriImageryEnabled, setEsriImageryEnabled] = useState(true);
  const [isTrailInfoLoading, setIsTrailInfoLoading] = useState(false);
  const [activeDroneImagery, setActiveDroneImagery] = useState<DroneImage | null>(null);
  const [activeDroneImages, setActiveDroneImages] = useState<Map<number, DroneImage>>(new Map());
  const [isDroneImageryLoading, setIsDroneImageryLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const watchPositionId = useRef<number | null>(null);
  
  // Drone imagery adjustment state
  const [isDroneAdjustmentMode, setIsDroneAdjustmentMode] = useState(false);
  const [isDragMode, setIsDragMode] = useState(false);
  const [droneAdjustments, setDroneAdjustments] = useState({
    scale: 0.7,
    offsetLat: 0,
    offsetLng: 0
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; lat: number; lng: number } | null>(null);
  
  // Two-finger distance measurement state
  const [isMeasurementMode, setIsMeasurementMode] = useState(false);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<[mapboxgl.LngLat, mapboxgl.LngLat] | null>(null);
  const [measurementDistance, setMeasurementDistance] = useState<string | null>(null);
  const measurementTimerRef = useRef<NodeJS.Timeout | null>(null);
  const measurementDisplayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialTouchPositionsRef = useRef<{x1: number, y1: number, x2: number, y2: number} | null>(null);
  const initialDistanceRef = useRef<number | null>(null);
  
  // Multi-point click measurement state
  const [measurementPath, setMeasurementPath] = useState<mapboxgl.LngLat[]>([]);
  const measurementPathMarkersRef = useRef<mapboxgl.Marker[]>([]);
  
  // Topo layer pending cleanup ref
  const pendingTopoCleanupRef = useRef<(() => void) | null>(null);
  
  // Pin marker state
  const [isMarkerMode, setIsMarkerMode] = useState(false);
  const [markers, setMarkers] = useState<Array<{
    id: string;
    name: string;
    lngLat: [number, number];
    elevation: number | null;
    straightLineDistance: number | null;
    trailDistance: number | null;
  }>>([]);
  const [mapMarkers, setMapMarkers] = useState<Map<string, mapboxgl.Marker>>(new Map());
  
  // Route building state
  const [isRouteBuildingMode, setIsRouteBuildingMode] = useState(false);
  const [currentRouteName, setCurrentRouteName] = useState<string>('');
  const [currentRouteDescription, setCurrentRouteDescription] = useState<string>('');
  const [routeWaypoints, setRouteWaypoints] = useState<Array<{
    id: string;
    name: string;
    lngLat: [number, number];
    elevation: number | null;
  }>>([]);
  
  // Displayed route state (for viewing saved routes)
  const [displayedRoute, setDisplayedRoute] = useState<any | null>(null);
  const displayedRouteMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const displayedWaypointsRef = useRef<any[]>([]);
  const onWaypointDeletedRef = useRef<((remainingWaypoints: any[]) => void) | null>(null);
  
  // All routes display state (for viewing all saved routes at once)
  const [allRoutesDisplayed, setAllRoutesDisplayed] = useState<any[]>([]);
  const allRoutesDisplayedRef = useRef<any[]>([]);
  const [clickedRouteInfo, setClickedRouteInfo] = useState<any | null>(null);
  
  // Offline area selection state
  const [isOfflineSelectionMode, setIsOfflineSelectionMode] = useState(false);
  const [offlineSelectionBounds, setOfflineSelectionBounds] = useState<{
    northEast: { lat: number; lng: number };
    southWest: { lat: number; lng: number };
  } | null>(null);
  const [isDrawingOfflineArea, setIsDrawingOfflineArea] = useState(false);
  const [offlineSelectionInvalidDrag, setOfflineSelectionInvalidDrag] = useState(false);
  const offlineAreaStartPoint = useRef<{ x: number; y: number; lng: number; lat: number } | null>(null);
  
  // Function to update route line on map
  const updateRouteLine = (waypoints: Array<{id: string; name: string; lngLat: [number, number]; elevation: number | null}>) => {
    if (!mapRef.current || waypoints.length < 2) return;
    
    const map = mapRef.current;
    const coordinates = waypoints.map(wp => wp.lngLat);
    
    // Remove existing route line
    if (map.getSource('route-line')) {
      map.removeLayer('route-line');
      map.removeSource('route-line');
    }
    
    // Add new route line
    map.addSource('route-line', {
      type: 'geojson' as const,
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: coordinates
        }
      }
    });
    
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-line',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#4F46E5',
        'line-width': 4,
        'line-opacity': 0.8
      }
    });
  };
  
  // Function to start route building mode
  const startRouteBuildingMode = (routeName: string, routeDescription: string) => {
    setIsRouteBuildingMode(true);
    setCurrentRouteName(routeName);
    setCurrentRouteDescription(routeDescription);
    setRouteWaypoints([]);
    setIsMarkerMode(true);
  };
  
  // Function to finish route building and save
  const finishRouteBuilding = () => {
    return {
      name: currentRouteName,
      description: currentRouteDescription,
      waypoints: routeWaypoints,
      pathCoordinates: routeWaypoints.map(wp => wp.lngLat),
      totalDistance: calculateRouteDistance(routeWaypoints),
      elevationGain: 0, // Could calculate from elevation data
      elevationLoss: 0,
      estimatedTime: Math.round(calculateRouteDistance(routeWaypoints) / 1000 * 15) // 15 min per km estimate
    };
  };
  
  // Helper function to calculate route distance
  const calculateRouteDistance = (waypoints: Array<{lngLat: [number, number]}>) => {
    if (waypoints.length < 2) return 0;
    
    let totalDistance = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const [lng1, lat1] = waypoints[i - 1].lngLat;
      const [lng2, lat2] = waypoints[i].lngLat;
      
      const distance = Math.sqrt(
        Math.pow((lng2 - lng1) * 111000 * Math.cos(lat1 * Math.PI / 180), 2) +
        Math.pow((lat2 - lat1) * 111000, 2)
      );
      totalDistance += distance;
    }
    return totalDistance;
  };
  
  // Function to clear displayed route from map
  const clearDisplayedRoute = () => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Remove route line
    if (map.getLayer('displayed-route')) {
      map.removeLayer('displayed-route');
    }
    if (map.getSource('displayed-route')) {
      map.removeSource('displayed-route');
    }
    
    // Remove all waypoint markers
    displayedRouteMarkersRef.current.forEach(marker => marker.remove());
    displayedRouteMarkersRef.current = [];
    
    // Clear displayed route state
    setDisplayedRoute(null);
  };
  
  // Internal function to clear all routes using ref (for use in click handlers)
  const clearAllRoutesInternal = () => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Remove all all-routes layers and sources using ref
    allRoutesDisplayedRef.current.forEach(route => {
      const layerId = `all-routes-layer-${route.id}`;
      const hitLayerId = `all-routes-hit-${route.id}`;
      const sourceId = `all-routes-${route.id}`;
      
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getLayer(hitLayerId)) {
        map.removeLayer(hitLayerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    });
    
    allRoutesDisplayedRef.current = [];
    setAllRoutesDisplayed([]);
    setClickedRouteInfo(null);
  };
  
  // Color palette for displaying multiple routes
  const routeColors = [
    '#10B981', // emerald
    '#3B82F6', // blue
    '#F59E0B', // amber
    '#EF4444', // red
    '#8B5CF6', // violet
    '#EC4899', // pink
    '#06B6D4', // cyan
    '#F97316', // orange
  ];
  
  // Function to display all routes on the map
  const displayAllRoutes = (routes: any[]) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Clear any existing single displayed route
    clearDisplayedRoute();
    
    // Clear any previously displayed all-routes layers
    clearAllRoutes();
    
    // Store routes for state and ref
    setAllRoutesDisplayed(routes);
    allRoutesDisplayedRef.current = routes;
    
    // Calculate bounds to fit all routes
    const bounds = new mapboxgl.LngLatBounds();
    
    routes.forEach((route, index) => {
      const pathCoordinates = JSON.parse(route.pathCoordinates || '[]');
      if (pathCoordinates.length < 2) return;
      
      const color = routeColors[index % routeColors.length];
      const sourceId = `all-routes-${route.id}`;
      const layerId = `all-routes-layer-${route.id}`;
      
      // Add route source
      map.addSource(sourceId, {
        type: 'geojson' as const,
        data: {
          type: 'Feature',
          properties: {
            routeId: route.id,
            name: route.name,
            description: route.description || '',
            totalDistance: route.totalDistance,
            elevationGain: route.elevationGain,
            elevationLoss: route.elevationLoss,
            estimatedTime: route.estimatedTime
          },
          geometry: {
            type: 'LineString',
            coordinates: pathCoordinates
          }
        }
      });
      
      // Add invisible hit area layer first (wider, for easier tapping)
      const hitLayerId = `all-routes-hit-${route.id}`;
      map.addLayer({
        id: hitLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': color,
          'line-width': 24, // Wide invisible hit area for easy tapping
          'line-opacity': 0
        }
      });
      
      // Add visible route layer on top
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': color,
          'line-width': 4,
          'line-opacity': 0.8
        }
      });
      
      // Extend bounds to include this route
      pathCoordinates.forEach((coord: [number, number]) => {
        bounds.extend(coord);
      });
      
      // Add click handler for the hit area layer - display the full route when clicked
      map.on('click', hitLayerId, () => {
        // Clear all routes first, then display this specific route
        // This will show waypoints, POIs, and the RouteSummaryPanel
        clearAllRoutesInternal();
        displayRoute(route);
      });
      
      // Change cursor on hover for both hit area and visible layer
      map.on('mouseenter', hitLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      
      map.on('mouseleave', hitLayerId, () => {
        map.getCanvas().style.cursor = '';
      });
    });
    
    // Fit map to show all routes with padding
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 100, bottom: 100, left: 50, right: 50 },
        maxZoom: 14
      });
    }
  };
  
  // Function to clear all displayed routes
  const clearAllRoutes = () => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Remove all all-routes layers and sources
    allRoutesDisplayed.forEach(route => {
      const layerId = `all-routes-layer-${route.id}`;
      const hitLayerId = `all-routes-hit-${route.id}`;
      const sourceId = `all-routes-${route.id}`;
      
      // Remove layers first (this also removes attached events)
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getLayer(hitLayerId)) {
        map.removeLayer(hitLayerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    });
    
    setAllRoutesDisplayed([]);
    setClickedRouteInfo(null);
  };

  // Function to display a saved route on the map
  // isDraggable: if true, waypoints can be dragged (for owners)
  // onWaypointDragged: callback when a waypoint is dragged to a new position
  // onWaypointDeleted: callback when a waypoint is deleted from the route
  const displayRoute = (
    route: any, 
    isDraggable: boolean = false, 
    onWaypointDragged?: (waypointIndex: number, newLngLat: [number, number], allWaypoints: any[]) => void,
    onWaypointDeleted?: (remainingWaypoints: any[]) => void
  ) => {
    onWaypointDeletedRef.current = onWaypointDeleted || null;
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    const pathCoordinates = JSON.parse(route.pathCoordinates || '[]');
    
    // Parse original waypoints - these are the user-placed waypoints, not the road-following points
    const waypointCoordinates = route.waypointCoordinates 
      ? JSON.parse(route.waypointCoordinates) 
      : [];
    
    if (pathCoordinates.length < 2) return;
    
    // Clear any existing displayed route first
    clearDisplayedRoute();
    
    // Store the displayed route for the summary panel
    setDisplayedRoute(route);
    
    // Add route line to map (using full path coordinates for the line)
    map.addSource('displayed-route', {
      type: 'geojson' as const,
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
      id: 'displayed-route',
      type: 'line',
      source: 'displayed-route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#10B981', // Green for saved routes
        'line-width': 5,
        'line-opacity': 0.9
      }
    });
    
    // Add waypoint markers only for user-placed waypoints
    const newMarkers: mapboxgl.Marker[] = [];
    
    // Only use waypointCoordinates (user's original waypoints) - don't fall back to pathCoordinates
    // For older routes without waypointCoordinates, we only show the route line (no markers)
    // because pathCoordinates contains road-following points, not the original user waypoints
    const waypointsToDisplay = waypointCoordinates.length > 0 
      ? waypointCoordinates 
      : [];
    
    displayedWaypointsRef.current = [...waypointsToDisplay];
    
    waypointsToDisplay.forEach((waypoint: { name: string; lngLat: [number, number]; elevation: number | null }, index: number) => {
      const isStart = index === 0;
      const isEnd = index === waypointsToDisplay.length - 1;
      const coord = waypoint.lngLat;
      
      // Create marker element
      const markerElement = document.createElement('div');
      markerElement.className = 'route-waypoint-view-marker';
      markerElement.style.cursor = 'pointer';
      
      // Different styling for start, end, and middle waypoints
      let markerColor = '#10B981'; // Green for middle points
      let markerSize = '24px';
      
      if (isStart) {
        markerColor = '#22C55E'; // Bright green for start
        markerSize = '32px';
      } else if (isEnd) {
        markerColor = '#EF4444'; // Red for end
        markerSize = '32px';
      }
      
      markerElement.innerHTML = `
        <div style="
          width: ${markerSize};
          height: ${markerSize};
          background: ${markerColor};
          border: 3px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          font-weight: bold;
          color: white;
          font-size: ${isStart || isEnd ? '14px' : '11px'};
        ">
          ${isStart ? 'S' : isEnd ? 'E' : index + 1}
        </div>
      `;
      
      // Use the stored waypoint name
      const waypointName = waypoint.name || (isStart ? 'Start Point' : isEnd ? 'End Point' : `Waypoint ${index + 1}`);
      
      // If elevation was stored, use it; otherwise show loading state
      const storedElevation = waypoint.elevation;
      const elevationDisplay = storedElevation !== null 
        ? `${Math.round(storedElevation * 3.28084).toLocaleString()} ft`
        : 'Loading...';
      
      const waypointId = `route-waypoint-${index}`;
      const popupContent = `
        <div style="padding: 12px; min-width: 180px;">
          <h3 id="waypoint-name-${waypointId}" style="margin: 0 0 8px 0; color: #1f2937; font-weight: 600; font-size: 14px;">
            ${escapeHtml(waypointName)}
          </h3>
          <div style="font-size: 12px; color: #6b7280;">
            <div style="margin-bottom: 4px;">
              <strong>Coordinates:</strong><br/>
              ${coord[1].toFixed(6)}°N, ${Math.abs(coord[0]).toFixed(6)}°W
            </div>
            <div id="elevation-${index}" style="margin-bottom: 4px;">
              <strong>Elevation:</strong> ${elevationDisplay}
            </div>
          </div>
          <div style="margin-top: 10px; display: flex; gap: 6px;">
            <button 
              onclick="window.editRouteWaypoint('${waypointId}', '${escapeHtml(waypointName).replace(/'/g, "&#39;")}')" 
              style="flex: 1; padding: 6px 10px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;"
            >Edit</button>
            <button 
              onclick="window.deleteRouteWaypoint('${waypointId}')" 
              style="flex: 1; padding: 6px 10px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;"
            >Delete</button>
          </div>
        </div>
      `;
      
      const popup = new mapboxgl.Popup({ 
        offset: 15,
        closeButton: true,
        closeOnClick: false
      }).setHTML(popupContent);
      
      // Fetch elevation when popup opens (only if not already stored)
      if (storedElevation === null) {
        popup.on('open', async () => {
          try {
            const elevationUrl = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/${coord[0]},${coord[1]}.json?layers=contour&limit=50&access_token=${mapboxgl.accessToken}`;
            const response = await fetch(elevationUrl);
            const data = await response.json();
            
            let elevation = 0;
            if (data.features && data.features.length > 0) {
              const elevations = data.features.map((f: any) => f.properties.ele);
              elevation = Math.max(...elevations);
            }
            
            const elevationFeet = Math.round(elevation * 3.28084);
            const elevationElement = document.getElementById(`elevation-${index}`);
            if (elevationElement) {
              elevationElement.innerHTML = `<strong>Elevation:</strong> ${elevationFeet.toLocaleString()} ft`;
            }
          } catch (error) {
            console.error('Error fetching elevation:', error);
            const elevationElement = document.getElementById(`elevation-${index}`);
            if (elevationElement) {
              elevationElement.innerHTML = `<strong>Elevation:</strong> N/A`;
            }
          }
        });
      }
      
      // Create marker with optional draggable functionality for owners
      const marker = new mapboxgl.Marker(markerElement, { draggable: isDraggable })
        .setLngLat(coord)
        .setPopup(popup)
        .addTo(map);
      
      // Add drag handlers for draggable markers
      if (isDraggable) {
        markerElement.style.cursor = 'grab';
        
        marker.on('drag', () => {
          markerElement.style.cursor = 'grabbing';
        });
        
        marker.on('dragend', () => {
          markerElement.style.cursor = 'grab';
          const newLngLat = marker.getLngLat();
          
          displayedWaypointsRef.current[index] = {
            ...displayedWaypointsRef.current[index],
            lngLat: [newLngLat.lng, newLngLat.lat] as [number, number]
          };
          
          const updatedWaypoints = [...displayedWaypointsRef.current];
          
          if (onWaypointDragged) {
            onWaypointDragged(index, [newLngLat.lng, newLngLat.lat], updatedWaypoints);
          }
          
          const source = map.getSource('displayed-route') as mapboxgl.GeoJSONSource;
          if (source) {
            source.setData({
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: displayedWaypointsRef.current.map(wp => wp.lngLat)
              }
            });
          }
        });
      }
      
      // Add explicit click handler to toggle popup (Mapbox custom markers sometimes don't auto-toggle)
      markerElement.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popup.isOpen()) {
          popup.remove();
        } else {
          popup.addTo(map);
        }
      });
      
      newMarkers.push(marker);
    });
    
    displayedRouteMarkersRef.current = newMarkers;
    
    // Fit map to route bounds with extra padding for the summary panel
    const bounds = new mapboxgl.LngLatBounds();
    pathCoordinates.forEach((coord: [number, number]) => {
      bounds.extend(coord);
    });
    
    map.fitBounds(bounds, {
      padding: { top: 200, bottom: 50, left: 50, right: 50 },
      duration: 1000
    });
  };
  
  // Ref to track editable waypoint markers directly (avoids React state timing issues)
  const editableWaypointMarkersRef = useRef<mapboxgl.Marker[]>([]);
  
  // Function to get current waypoint positions directly from markers (no stale closures)
  const getEditableWaypointPositions = (): [number, number][] => {
    return editableWaypointMarkersRef.current.map(marker => {
      const lngLat = marker.getLngLat();
      return [lngLat.lng, lngLat.lat] as [number, number];
    });
  };
  
  // Function to clear editable route waypoints
  const clearEditableRouteWaypoints = () => {
    editableWaypointMarkersRef.current.forEach(marker => marker.remove());
    editableWaypointMarkersRef.current = [];
    setRouteWaypoints([]);
  };
  
  // Function to display editable waypoints for a route
  const displayEditableRouteWaypoints = (
    pathCoordinates: [number, number][], 
    onWaypointsUpdate?: (waypoints: Array<{id: string; lngLat: [number, number]}>) => void,
    onWaypointDelete?: (index: number) => void,
    onWaypointEdit?: (index: number, newName: string) => void
  ) => {
    if (!mapRef.current || pathCoordinates.length === 0) return;
    
    const map = mapRef.current;
    
    // Clear existing editable waypoint markers using ref (not state)
    editableWaypointMarkersRef.current.forEach(marker => marker.remove());
    editableWaypointMarkersRef.current = [];
    
    // Also clear route waypoints state
    setRouteWaypoints([]);
    
    // Convert pathCoordinates to editable waypoints
    const newWaypoints = pathCoordinates.map((lngLat, index) => ({
      id: `edit-waypoint-${Date.now()}-${index}`,
      name: `Waypoint ${index + 1}`,
      lngLat: lngLat as [number, number],
      elevation: null
    }));
    
    setRouteWaypoints(newWaypoints);
    
    // Store callbacks globally for popup buttons
    (window as any).__editWaypointCallbacks = {
      onDelete: onWaypointDelete,
      onEdit: onWaypointEdit
    };
    
    // Create draggable markers for each waypoint
    newWaypoints.forEach((waypoint, index) => {
      const markerElement = document.createElement('div');
      markerElement.className = 'route-waypoint-marker';
      markerElement.style.width = '20px';
      markerElement.style.height = '30px';
      markerElement.style.cursor = 'grab';
      
      markerElement.innerHTML = `
        <svg width="20" height="30" viewBox="0 0 20 30" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
          <path d="M10 0C4.477 0 0 4.477 0 10C0 15.523 10 30 10 30S20 15.523 20 10C20 4.477 15.523 0 10 0Z" fill="#4F46E5" stroke="#FFFFFF" stroke-width="2"/>
          <circle cx="10" cy="10" r="3" fill="#FFFFFF"/>
          <text x="10" y="10" text-anchor="middle" dy="0.35em" style="font-size: 8px; fill: #4F46E5; font-weight: bold;">${index + 1}</text>
        </svg>
      `;
      
      const popup = new mapboxgl.Popup({ offset: 15, closeButton: true }).setHTML(`
        <div style="padding: 10px; background: white; color: black; min-width: 160px;">
          <h3 id="edit-wp-name-${index}" style="margin: 0 0 8px 0; color: #4F46E5; font-size: 14px;">${escapeHtml(waypoint.name)}</h3>
          <p style="margin: 4px 0 10px 0; color: #666; font-size: 12px;">Drag to reposition</p>
          <div style="display: flex; gap: 6px;">
            <button 
              onclick="(function(){
                var cb = window.__editWaypointCallbacks;
                if(cb && cb.onEdit) {
                  var newName = prompt('Enter new name:', '${escapeHtml(waypoint.name)}');
                  if(newName) { cb.onEdit(${index}, newName); document.getElementById('edit-wp-name-${index}').textContent = newName; }
                }
              })()"
              style="flex: 1; padding: 6px 10px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;"
            >Edit</button>
            <button 
              onclick="(function(){
                var cb = window.__editWaypointCallbacks;
                if(cb && cb.onDelete && confirm('Delete this waypoint?')) { cb.onDelete(${index}); }
              })()"
              style="flex: 1; padding: 6px 10px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;"
            >Delete</button>
          </div>
        </div>
      `);
      
      const mapboxMarker = new mapboxgl.Marker(markerElement, { draggable: true })
        .setLngLat(waypoint.lngLat)
        .setPopup(popup)
        .addTo(map);
      
      // Add visual feedback during drag
      mapboxMarker.on('drag', () => {
        markerElement.style.cursor = 'grabbing';
      });
      
      // Handle marker drag to update waypoint position
      mapboxMarker.on('dragend', () => {
        markerElement.style.cursor = 'grab';
        
        const newLngLat = mapboxMarker.getLngLat();
        const newPosition: [number, number] = [newLngLat.lng, newLngLat.lat];
        
        // Update the waypoint position in state
        setRouteWaypoints(prev => {
          const updatedWaypoints = prev.map(wp => 
            wp.id === waypoint.id 
              ? { ...wp, lngLat: newPosition }
              : wp
          );
          
          // Update the route line with new waypoint positions
          updateRouteLine(updatedWaypoints);
          
          // Call the callback to notify parent component
          if (onWaypointsUpdate) {
            onWaypointsUpdate(updatedWaypoints.map(wp => ({ id: wp.id, lngLat: wp.lngLat })));
          }
          
          return updatedWaypoints;
        });
      });
      
      // Store marker in ref for proper cleanup
      editableWaypointMarkersRef.current.push(mapboxMarker);
    });
    
    // Update the route line to connect all waypoints
    updateRouteLine(newWaypoints);
  };
  
  // Edit mode markers storage
  const editModeMarkersRef = useRef<mapboxgl.Marker[]>([]);
  
  // Display edit mode waypoints with callbacks for parent component
  const displayEditModeWaypoints = (
    waypoints: Array<{ name: string; lngLat: [number, number]; elevation?: number }>,
    onWaypointDragEnd: (index: number, newLngLat: [number, number]) => void
  ) => {
    if (!mapRef.current || waypoints.length === 0) return;
    
    const map = mapRef.current;
    
    // Clear existing edit mode markers
    editModeMarkersRef.current.forEach(marker => marker.remove());
    editModeMarkersRef.current = [];
    
    // Create draggable markers for each waypoint
    waypoints.forEach((waypoint, index) => {
      const markerElement = document.createElement('div');
      markerElement.className = 'edit-mode-waypoint-marker';
      markerElement.style.width = '24px';
      markerElement.style.height = '36px';
      markerElement.style.cursor = 'grab';
      
      markerElement.innerHTML = `
        <svg width="24" height="36" viewBox="0 0 24 36" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
          <path d="M12 0C5.4 0 0 5.4 0 12C0 18.6 12 36 12 36S24 18.6 24 12C24 5.4 18.6 0 12 0Z" fill="#3B82F6" stroke="#FFFFFF" stroke-width="2"/>
          <circle cx="12" cy="12" r="4" fill="#FFFFFF"/>
          <text x="12" y="12" text-anchor="middle" dy="0.35em" style="font-size: 10px; fill: #3B82F6; font-weight: bold;">${index + 1}</text>
        </svg>
      `;
      
      const mapboxMarker = new mapboxgl.Marker(markerElement, { draggable: true })
        .setLngLat(waypoint.lngLat)
        .addTo(map);
      
      // Add visual feedback during drag
      mapboxMarker.on('drag', () => {
        markerElement.style.cursor = 'grabbing';
      });
      
      // Handle marker drag to update waypoint position
      mapboxMarker.on('dragend', () => {
        markerElement.style.cursor = 'grab';
        const newLngLat = mapboxMarker.getLngLat();
        onWaypointDragEnd(index, [newLngLat.lng, newLngLat.lat]);
      });
      
      editModeMarkersRef.current.push(mapboxMarker);
    });
    
    // Draw the route line connecting all waypoints
    const lineSourceId = 'edit-mode-route-line';
    const lineLayerId = 'edit-mode-route-line-layer';
    
    // Remove existing line if present
    if (map.getLayer(lineLayerId)) {
      map.removeLayer(lineLayerId);
    }
    if (map.getSource(lineSourceId)) {
      map.removeSource(lineSourceId);
    }
    
    // Add line connecting waypoints
    map.addSource(lineSourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: waypoints.map(wp => wp.lngLat)
        }
      }
    });
    
    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: lineSourceId,
      paint: {
        'line-color': '#3B82F6',
        'line-width': 4,
        'line-dasharray': [2, 1]
      }
    });
  };
  
  // Update the edit mode route line (called when waypoints change)
  const updateEditModeRouteLine = (waypoints: Array<{ lngLat: [number, number] }>) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    const source = map.getSource('edit-mode-route-line') as mapboxgl.GeoJSONSource;
    
    if (source) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: waypoints.map(wp => wp.lngLat)
        }
      });
    }
  };
  
  // Update the edit mode route line with path coordinates directly (for road/trail routing)
  const updateEditModeRouteLineWithPath = (pathCoordinates: [number, number][]) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    const source = map.getSource('edit-mode-route-line') as mapboxgl.GeoJSONSource;
    
    if (source) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: pathCoordinates
        }
      });
    }
  };
  
  // Update the displayed route line with new path coordinates (for road/trail routing when dragging waypoints)
  const updateDisplayedRouteLine = (pathCoordinates: [number, number][]) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    const source = map.getSource('displayed-route') as mapboxgl.GeoJSONSource;
    
    if (source) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: pathCoordinates
        }
      });
    }
  };
  
  // Clear edit mode markers and line
  const clearEditModeWaypoints = () => {
    // Remove markers
    editModeMarkersRef.current.forEach(marker => marker.remove());
    editModeMarkersRef.current = [];
    
    // Remove line
    if (mapRef.current) {
      const map = mapRef.current;
      if (map.getLayer('edit-mode-route-line-layer')) {
        map.removeLayer('edit-mode-route-line-layer');
      }
      if (map.getSource('edit-mode-route-line')) {
        map.removeSource('edit-mode-route-line');
      }
    }
  };
  
  // Add waypoint on map click (for edit mode)
  const addEditModeWaypointOnClick = (
    onAddWaypoint: (lngLat: [number, number]) => void
  ) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    const clickHandler = (e: mapboxgl.MapMouseEvent) => {
      onAddWaypoint([e.lngLat.lng, e.lngLat.lat]);
      map.off('click', clickHandler); // Remove listener after one click
      map.getCanvas().style.cursor = '';
    };
    
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', clickHandler);
  };
  
  // Offline area selection functions
  const startOfflineAreaSelection = () => {
    setIsOfflineSelectionMode(true);
    setOfflineSelectionBounds(null);
    setOfflineSelectionInvalidDrag(false); // Reset invalid drag flag
  };
  
  const cancelOfflineAreaSelection = () => {
    setIsOfflineSelectionMode(false);
    setOfflineSelectionBounds(null);
    setIsDrawingOfflineArea(false);
    offlineAreaStartPoint.current = null;
    
    // Remove selection rectangle from map
    if (mapRef.current) {
      const map = mapRef.current;
      if (map.getLayer('offline-selection-fill')) {
        map.removeLayer('offline-selection-fill');
      }
      if (map.getLayer('offline-selection-outline')) {
        map.removeLayer('offline-selection-outline');
      }
      if (map.getSource('offline-selection')) {
        map.removeSource('offline-selection');
      }
    }
  };
  
  const finishOfflineAreaSelection = () => {
    if (!offlineSelectionBounds) return null;
    
    // Return bounds but don't clear state yet - let caller handle cleanup
    return offlineSelectionBounds;
  };
  
  const completeOfflineAreaSelection = () => {
    // Clean up the selection mode after bounds are captured
    setIsOfflineSelectionMode(false);
    setIsDrawingOfflineArea(false);
    setOfflineSelectionBounds(null);
    offlineAreaStartPoint.current = null;
    
    // Remove selection rectangle from map
    if (mapRef.current) {
      const map = mapRef.current;
      if (map.getLayer('offline-selection-fill')) {
        map.removeLayer('offline-selection-fill');
      }
      if (map.getLayer('offline-selection-outline')) {
        map.removeLayer('offline-selection-outline');
      }
      if (map.getSource('offline-selection')) {
        map.removeSource('offline-selection');
      }
    }
  };
  
  // Add global map click handler for marker placement
  useEffect(() => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    const handleMapClick = async (e: mapboxgl.MapMouseEvent) => {
      // Only place markers when in marker mode
      if (!isMarkerMode) return;
      
      console.log('Map clicked for marker placement');
      
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      
      // Get elevation data (simplified for now)
      let elevation = null;
      try {
        elevation = 2000; // Placeholder elevation
      } catch (error) {
        console.log('Could not get elevation data');
      }
      
      if (isRouteBuildingMode) {
        // Route building mode - add waypoint to route (no prompt for smoother experience)
        const waypointId = `waypoint-${Date.now()}`;
        const markerName = `Waypoint ${routeWaypoints.length + 1}`;
        const newWaypoint = {
          id: waypointId,
          name: markerName,
          lngLat,
          elevation
        };
        
        console.log('Adding route waypoint:', newWaypoint);
        
        // Update route waypoints
        const updatedWaypoints = [...routeWaypoints, newWaypoint];
        setRouteWaypoints(updatedWaypoints);
        
        // Create route waypoint marker with different styling
        const markerElement = document.createElement('div');
        markerElement.className = 'route-waypoint-marker';
        markerElement.style.width = '20px';
        markerElement.style.height = '30px';
        markerElement.style.cursor = 'grab';
        
        markerElement.innerHTML = `
          <svg width="20" height="30" viewBox="0 0 20 30" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
            <path d="M10 0C4.477 0 0 4.477 0 10C0 15.523 10 30 10 30S20 15.523 20 10C20 4.477 15.523 0 10 0Z" fill="#4F46E5" stroke="#FFFFFF" stroke-width="2"/>
            <circle cx="10" cy="10" r="3" fill="#FFFFFF"/>
            <text x="10" y="10" text-anchor="middle" dy="0.35em" style="font-size: 8px; fill: #4F46E5; font-weight: bold;">${updatedWaypoints.length}</text>
          </svg>
        `;
        
        const popup = new mapboxgl.Popup({ offset: 15 }).setHTML(`
          <div style="padding: 8px; background: white; color: black;">
            <h3 style="margin: 0 0 8px 0; color: #4F46E5;">${escapeHtml(newWaypoint.name)}</h3>
            <p style="margin: 4px 0; color: black;">Waypoint ${updatedWaypoints.length}</p>
            <p style="margin: 4px 0; color: black;">Elevation: ${elevation ? `${elevation}ft` : 'Unknown'}</p>
          </div>
        `);
        
        const mapboxMarker = new mapboxgl.Marker(markerElement, { draggable: true })
          .setLngLat(newWaypoint.lngLat)
          .setPopup(popup)
          .addTo(map);
        
        // Add visual feedback during drag
        mapboxMarker.on('drag', () => {
          markerElement.style.cursor = 'grabbing';
        });
        
        // Handle marker drag to update waypoint position
        mapboxMarker.on('dragend', () => {
          markerElement.style.cursor = 'grab';
          
          const newLngLat = mapboxMarker.getLngLat();
          const newPosition: [number, number] = [newLngLat.lng, newLngLat.lat];
          
          // Update the waypoint position in state
          setRouteWaypoints(prev => {
            const updatedWaypoints = prev.map(wp => 
              wp.id === newWaypoint.id 
                ? { ...wp, lngLat: newPosition }
                : wp
            );
            
            // Update the route line with new waypoint positions
            updateRouteLine(updatedWaypoints);
            
            return updatedWaypoints;
          });
        });
        
        setMapMarkers(prev => new Map(prev.set(newWaypoint.id, mapboxMarker)));
        
        // Update route line
        updateRouteLine(updatedWaypoints);
        
        return;
      }
      
      // Regular marker mode
      const markerName = prompt('Enter a name for this pin:') || `Pin ${markers.length + 1}`;
      
      // Calculate straight line distance from user location
      const straightLineDistance = userLocation ? 
        Math.sqrt(
          Math.pow((lngLat[0] - userLocation.lng) * 111000 * Math.cos(lngLat[1] * Math.PI / 180), 2) +
          Math.pow((lngLat[1] - userLocation.lat) * 111000, 2)
        ) : null;
      
      // Trail distance approximation
      const trailDistance = straightLineDistance ? straightLineDistance * 1.2 : null;
      
      // Create marker
      const markerId = `marker-${Date.now()}`;
      const newMarker = {
        id: markerId,
        name: markerName,
        lngLat,
        elevation,
        straightLineDistance,
        trailDistance
      };
      
      console.log('Creating marker:', newMarker);
      
      // Create marker element with SVG pin shape
      const markerElement = document.createElement('div');
      markerElement.className = 'custom-marker';
      markerElement.style.width = '24px';
      markerElement.style.height = '36px';
      markerElement.style.cursor = 'pointer';
      markerElement.style.position = 'relative';
      
      // Create SVG pin
      markerElement.innerHTML = `
        <svg width="24" height="36" viewBox="0 0 24 36" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
          <path d="M12 0C5.373 0 0 5.373 0 12C0 18.627 12 36 12 36S24 18.627 24 12C24 5.373 18.627 0 12 0Z" fill="#FF0000" stroke="#FFFFFF" stroke-width="2"/>
          <circle cx="12" cy="12" r="4" fill="#FFFFFF"/>
        </svg>
      `;
      
      // Create popup content
      const popupContent = `
        <div style="padding: 8px; background: white; color: black; font-family: Arial, sans-serif;">
          <h3 style="margin: 0 0 8px 0; font-weight: bold; color: black;">${escapeHtml(newMarker.name)}</h3>
          ${newMarker.elevation !== null ? `<p style="margin: 4px 0; color: black;"><strong>Elevation:</strong> ${Math.round(newMarker.elevation)}m</p>` : ''}
          ${newMarker.straightLineDistance !== null ? `<p style="margin: 4px 0; color: black;"><strong>Distance:</strong> ${(newMarker.straightLineDistance / 1000).toFixed(2)}km</p>` : ''}
          ${newMarker.trailDistance !== null ? `<p style="margin: 4px 0; color: black;"><strong>Trail Distance:</strong> ${(newMarker.trailDistance / 1000).toFixed(2)}km</p>` : ''}
          <div style="margin-top: 8px; display: flex; gap: 8px;">
            <button onclick="editMarker('${markerId}')" style="padding: 4px 8px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer;">Edit</button>
            <button onclick="removeMarker('${markerId}')" style="padding: 4px 8px; background: #ff4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
          </div>
        </div>
      `;
      
      // Create popup
      const popup = new mapboxgl.Popup({ offset: 25 })
        .setHTML(popupContent);
      
      // Create and add marker
      const mapboxMarker = new mapboxgl.Marker(markerElement)
        .setLngLat(newMarker.lngLat)
        .setPopup(popup)
        .addTo(map);
      
      // Store marker reference
      setMapMarkers(prev => {
        const newMap = new Map(prev);
        newMap.set(markerId, mapboxMarker);
        return newMap;
      });
      
      // Update state
      setMarkers(prev => [...prev, newMarker]);
      
      console.log('Marker added successfully');
    };
    
    map.on('click', handleMapClick);
    
    return () => {
      map.off('click', handleMapClick);
    };
  }, [isMarkerMode, userLocation, markers, mapMarkers]);

  // Offline area selection - mouse/touch event handlers
  useEffect(() => {
    if (!mapRef.current || !isOfflineSelectionMode) return;
    
    const map = mapRef.current;
    const canvas = map.getCanvasContainer();
    
    const handleMouseDown = (e: MouseEvent) => {
      if (!isOfflineSelectionMode) return;
      
      const point = map.unproject([e.clientX, e.clientY]);
      offlineAreaStartPoint.current = {
        x: e.clientX,
        y: e.clientY,
        lng: point.lng,
        lat: point.lat
      };
      setIsDrawingOfflineArea(true);
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawingOfflineArea || !offlineAreaStartPoint.current) return;
      
      const start = offlineAreaStartPoint.current;
      const end = map.unproject([e.clientX, e.clientY]);
      
      // Calculate bounds
      const northEast = {
        lat: Math.max(start.lat, end.lat),
        lng: Math.max(start.lng, end.lng)
      };
      const southWest = {
        lat: Math.min(start.lat, end.lat),
        lng: Math.min(start.lng, end.lng)
      };
      
      setOfflineSelectionBounds({ northEast, southWest });
      
      // Update rectangle on map
      const coordinates = [
        [southWest.lng, southWest.lat],
        [northEast.lng, southWest.lat],
        [northEast.lng, northEast.lat],
        [southWest.lng, northEast.lat],
        [southWest.lng, southWest.lat]
      ];
      
      if (map.getSource('offline-selection')) {
        (map.getSource('offline-selection') as mapboxgl.GeoJSONSource).setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [coordinates]
          }
        } as GeoJSON.Feature);
      } else {
        map.addSource('offline-selection', {
          type: 'geojson' as const,
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [coordinates]
            }
          } as GeoJSON.Feature
        });
        
        map.addLayer({
          id: 'offline-selection-fill',
          type: 'fill',
          source: 'offline-selection',
          paint: {
            'fill-color': '#3b82f6',
            'fill-opacity': 0.2
          }
        });
        
        map.addLayer({
          id: 'offline-selection-outline',
          type: 'line',
          source: 'offline-selection',
          paint: {
            'line-color': '#3b82f6',
            'line-width': 2,
            'line-dasharray': [2, 2]
          }
        });
      }
    };
    
    const handleMouseUp = () => {
      if (isDrawingOfflineArea) {
        // Always validate and cleanup, even if no bounds were set
        if (offlineSelectionBounds) {
          // Validate that a meaningful drag occurred (minimum 0.001 degrees ~ 100m)
          const MIN_DELTA = 0.001;
          const latDiff = Math.abs(offlineSelectionBounds.northEast.lat - offlineSelectionBounds.southWest.lat);
          const lngDiff = Math.abs(offlineSelectionBounds.northEast.lng - offlineSelectionBounds.southWest.lng);
          
          if (latDiff < MIN_DELTA || lngDiff < MIN_DELTA) {
            // Drag was too small, clear the selection
            setOfflineSelectionBounds(null);
            setOfflineSelectionInvalidDrag(true); // Signal to MapView that the drag was invalid
            
            // Remove the rectangle from map
            if (map.getSource('offline-selection')) {
              if (map.getLayer('offline-selection-fill')) {
                map.removeLayer('offline-selection-fill');
              }
              if (map.getLayer('offline-selection-outline')) {
                map.removeLayer('offline-selection-outline');
              }
              map.removeSource('offline-selection');
            }
          } else {
            // Valid drag, clear invalid flag
            setOfflineSelectionInvalidDrag(false);
          }
        }
        
        // Always reset drawing state
        setIsDrawingOfflineArea(false);
        offlineAreaStartPoint.current = null;
      }
    };
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isOfflineSelectionMode, isDrawingOfflineArea]);

  // Initialize map
  const initializeMap = () => {
    if (mapRef.current || !mapContainerRef.current) return;
    
    // Create map instance
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLES.SATELLITE_STREETS, // Start with satellite + streets style for labels
      center: DEFAULT_MAP_SETTINGS.center, // Jackson, Wyoming (Teton County)
      zoom: DEFAULT_MAP_SETTINGS.zoom,
      maxZoom: 24,
      pitch: DEFAULT_MAP_SETTINGS.pitch, // Initial 3D perspective
      bearing: DEFAULT_MAP_SETTINGS.bearing,
      attributionControl: false
    });
    
    // Add attribution control (temporarily in bottom-left for testing)
    map.addControl(new mapboxgl.AttributionControl({ compact: false }), 'bottom-left');
    
    // Save map instance to ref
    mapRef.current = map;
    
    // Add error handling - only show fatal errors, not tile loading issues
    map.on('error', (e) => {
      const errorMessage = e.error?.message || '';
      
      // Only log non-critical errors, don't replace the map
      console.warn('Mapbox warning:', errorMessage);
      
      // Only show the error screen for truly fatal errors (invalid token, style failure)
      const isFatalError = 
        errorMessage.includes('Unauthorized') ||
        errorMessage.includes('401') ||
        errorMessage.includes('Invalid access token') ||
        errorMessage.includes('style') && errorMessage.includes('failed');
      
      if (isFatalError && mapContainerRef.current) {
        mapContainerRef.current.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: #f5f5f5; color: #333; text-align: center; padding: 20px;">
            <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
            <div style="font-size: 18px; margin-bottom: 10px;">Map Loading Error</div>
            <div style="font-size: 14px; color: #666;">Please check your Mapbox access token</div>
          </div>
        `;
      }
    });

    // Wait for map to load
    map.on('load', () => {
      console.log('Map loaded successfully');

      // Restyle mountain peak names to smokey blue
      try {
        if (map.getLayer('natural-point-label')) {
          map.setPaintProperty('natural-point-label', 'text-color', '#7B9DB7');
        }
      } catch (e) {
        console.warn('Could not restyle peak labels:', e);
      }

      // Start with Esri 3D imagery
      addEsriWorldImagery(map);
      setIsTrailInfoLoading(true);
      addTrailGroup(map, 'hiking');
      addBaseTrailLinesAndLabels(map);

      const trailSources = new Set(['streets-labels', 'waymarked-trails-hiking', 'waymarked-trails-riding']);
      const loadedSources = new Set<string>();
      const checkAllLoaded = () => {
        for (const src of trailSources) {
          if (map.getSource(src) && map.isSourceLoaded(src)) {
            loadedSources.add(src);
          }
        }
        if (loadedSources.has('streets-labels') && loadedSources.size >= 2) {
          setIsTrailInfoLoading(false);
          map.off('sourcedata', onSourceData);
        }
      };
      const onSourceData = (e: any) => {
        if (trailSources.has(e.sourceId) && e.isSourceLoaded) {
          loadedSources.add(e.sourceId);
          checkAllLoaded();
        }
      };
      map.on('sourcedata', onSourceData);
      setTimeout(checkAllLoaded, 3000);
      setTimeout(() => { setIsTrailInfoLoading(false); map.off('sourcedata', onSourceData); }, 15000);
      
      // Enable 3D terrain by default
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          'type': 'raster-dem',
          'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
          'tileSize': 512,
          'maxzoom': 14
        });
      }
      map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
      
      // Set initial 3D view angle
      map.easeTo({
        pitch: 45,
        bearing: 0,
        duration: 1000
      });
      
      setIsMapReady(true);
      
      // Do not start tracking location automatically
      // We'll wait for explicit user permission first
    });
  };
  
  // Toggle map layers
  const toggleLayer = (layerType: string) => {
    if (!mapRef.current || !isMapReady) return;
    
    const map = mapRef.current;
    
    // Update active layers
    let newActiveLayers = [...activeLayers];
    
    if (layerType === 'esri-hd') {
      // High-resolution Esri World Imagery 3D
      removeTetonCountyImagery(map);
      newActiveLayers = ['esri-hd'];
      
      // Disable marker mode when switching to 3D
      if (isMarkerMode) {
        setIsMarkerMode(false);
        const mapCanvas = map.getCanvas();
        mapCanvas.style.cursor = '';
        console.log('Marker placement mode disabled due to 3D layer switch');
      }
      
      // Add terrain source if not exists and enable 3D view
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          'type': 'raster-dem',
          'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
          'tileSize': 512,
          'maxzoom': 14
        });
      }
      
      // Enable 3D terrain
      map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
      
      // Smoothly transition to 3D view
      map.easeTo({
        pitch: 45,
        bearing: 0,
        duration: 1000
      });
      
    } else if (layerType === 'esri-2d') {
      // 2D Esri World Imagery (flat, no terrain)
      removeTetonCountyImagery(map);
      newActiveLayers = ['esri-2d'];
      
      // Disable marker mode when switching to 2D
      if (isMarkerMode) {
        setIsMarkerMode(false);
        const mapCanvas = map.getCanvas();
        mapCanvas.style.cursor = '';
        console.log('Marker placement mode disabled due to 2D layer switch');
      }
      
      // Disable 3D terrain
      map.setTerrain(null);
      
      // Smoothly transition to flat view
      map.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 1000
      });
    } else if (layerType === 'topo') {
      // Toggle topographic contour lines overlay on/off
      if (newActiveLayers.includes('topo')) {
        // Cancel any pending operation
        if (pendingTopoCleanupRef.current) {
          pendingTopoCleanupRef.current();
          pendingTopoCleanupRef.current = null;
        }
        
        removeTopoContourLines(map);
        newActiveLayers = newActiveLayers.filter(layer => layer !== 'topo');
        console.log('Topographic contour lines hidden');
      } else {
        const result = addTopoContourLines(map);
        // Store cleanup function so we can cancel if user toggles off before style loads
        if (result.cleanup) {
          pendingTopoCleanupRef.current = result.cleanup;
        }
        newActiveLayers.push('topo');
        console.log('Topographic contour lines displayed');
      }
    } else if (layerType === 'drone') {
      // Handle drone imagery layer
      newActiveLayers = ['drone'];
      
      // Disable marker mode when switching to drone
      if (isMarkerMode) {
        setIsMarkerMode(false);
        const mapCanvas = map.getCanvas();
        mapCanvas.style.cursor = '';
        console.log('Marker placement mode disabled due to drone layer switch');
      }
      
      // Drone layer functionality would be implemented here
      // For now, just set the layer as active
    } else if (layerType === 'property-lines') {
      // Toggle property lines overlay
      if (newActiveLayers.includes('property-lines')) {
        removeTetonCountyParcels(map);
        newActiveLayers = newActiveLayers.filter(layer => layer !== 'property-lines');
      } else {
        addTetonCountyParcels(map);
        newActiveLayers.push('property-lines');
      }
    } else if (layerType.startsWith('trails-')) {
      const groupType = layerType.replace('trails-', '') as TrailGroupType;
      if (TRAIL_GROUP_CONFIG[groupType]) {
        const newOverlays = new Set(activeTrailOverlays);
        const groupConfig = TRAIL_GROUP_CONFIG[groupType];
        const groupIsActive = groupConfig.members.some(t => newOverlays.has(t));
        
        if (groupIsActive) {
          removeTrailGroup(map, groupType);
          groupConfig.members.forEach(t => newOverlays.delete(t));
        } else {
          addTrailGroup(map, groupType);
          groupConfig.members.forEach(t => newOverlays.add(t));
        }
        setActiveTrailOverlays(newOverlays);
      }
    } else if (layerType === 'markers') {
      // Toggle marker placement mode
      setIsMarkerMode(!isMarkerMode);
      
      if (!isMarkerMode) {
        // Enable marker placement mode
        const mapCanvas = map.getCanvas();
        mapCanvas.style.cursor = 'crosshair';
        console.log('Marker placement mode enabled');
      } else {
        // Disable marker placement mode
        const mapCanvas = map.getCanvas();
        mapCanvas.style.cursor = '';
        console.log('Marker placement mode disabled');
      }
    } else {
      // For other layers, toggle their visibility and disable marker mode
      if (newActiveLayers.includes(layerType)) {
        newActiveLayers = newActiveLayers.filter(layer => layer !== layerType);
      } else {
        newActiveLayers.push(layerType);
      }
      
      // Disable marker mode when switching to other map layers
      if (isMarkerMode) {
        setIsMarkerMode(false);
        const mapCanvas = map.getCanvas();
        mapCanvas.style.cursor = '';
        console.log('Marker placement mode disabled due to layer switch');
      }
    }
    
    setActiveLayers(newActiveLayers);
    
    // Restore styles after style change
    map.once('style.load', () => {
      // Restyle mountain peak names to smokey blue
      try {
        if (map.getLayer('natural-point-label')) {
          map.setPaintProperty('natural-point-label', 'text-color', '#7B9DB7');
        }
      } catch (e) {
        // Layer may not exist in all styles
      }

      // Re-add terrain source
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          'type': 'raster-dem',
          'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
          'tileSize': 512,
          'maxzoom': 14
        });
        
        // Re-add 3D terrain
        map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
        
        // Re-add sky layer
        if (!map.getLayer('sky')) {
          map.addLayer({
            'id': 'sky',
            'type': 'sky',
            'paint': {
              'sky-type': 'atmosphere',
              'sky-atmosphere-sun': [0.0, 0.0],
              'sky-atmosphere-sun-intensity': 15
            }
          });
        }
      }
      activeTrailOverlays.forEach((trailType) => {
        addTrailOverlay(map, trailType);
      });
      addBaseTrailLinesAndLabels(map);
      
      if (userLocation) {
        if (map.hasImage('pulsing-dot')) {
          map.removeImage('pulsing-dot');
        }
        addUserLocationToMap(map, userLocation);
      }
    });
  };

  const toggleEsriImagery = () => {
    if (!mapRef.current || !isMapReady) return;
    const map = mapRef.current;
    if (esriImageryEnabled) {
      removeEsriWorldImagery(map);
      setEsriImageryEnabled(false);
    } else {
      addEsriWorldImagery(map);
      setEsriImageryEnabled(true);
    }
  };
  
  // Zoom in
  const zoomIn = () => {
    if (!mapRef.current) return;
    mapRef.current.zoomIn();
  };
  
  // Zoom out
  const zoomOut = () => {
    if (!mapRef.current) return;
    mapRef.current.zoomOut();
  };
  
  // Fly to user's location
  const flyToUserLocation = () => {
    if (!mapRef.current) return;
    
    if (userLocation) {
      mapRef.current.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: Math.max(mapRef.current.getZoom(), 14),
        essential: true
      });
      return;
    }
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { longitude, latitude } = position.coords;
          mapRef.current?.flyTo({
            center: [longitude, latitude],
            zoom: 14,
            essential: true
          });
        },
        (error) => {
          console.error('Error getting location:', error);
        }
      );
    }
  };
  
  // Toggle terrain 3D view
  const toggleTerrain = () => {
    if (!mapRef.current || !isMapReady) return;
    
    const map = mapRef.current;
    const newTerrainState = !isTerrain3D;
    
    // Store current drone imagery before terrain change
    const currentDroneImagery = activeDroneImagery;
    
    if (newTerrainState) {
      // Enable 3D terrain
      map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
      map.setPitch(45); // Set pitch for 3D view
    } else {
      // Disable 3D terrain
      map.setTerrain(null);
      map.setPitch(0); // Reset pitch to 2D view
    }
    
    setIsTerrain3D(newTerrainState);
    
    // Force re-add drone imagery after terrain change with multiple attempts
    if (currentDroneImagery) {
      // Try immediately
      setTimeout(() => {
        addDroneImagery(currentDroneImagery);
      }, 50);
      
      // Try again after a longer delay to ensure terrain is fully loaded
      setTimeout(() => {
        addDroneImagery(currentDroneImagery);
      }, 300);
      
      // Final attempt to ensure it's visible
      setTimeout(() => {
        addDroneImagery(currentDroneImagery);
      }, 800);
    }
  };
  
  // Get elevation at a specific point using Mapbox API
  const getElevationAtPoint = async (lngLat: [number, number]): Promise<number | null> => {
    try {
      const response = await fetch(
        `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/${lngLat[0]},${lngLat[1]}.json?access_token=${mapboxgl.accessToken}`
      );
      
      if (!response.ok) return null;
      
      const data = await response.json();
      
      // Extract elevation from the terrain data
      if (data.features && data.features.length > 0) {
        return data.features[0].properties?.ele || null;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting elevation:', error);
      return null;
    }
  };

  // Calculate straight line distance between two points
  const calculateStraightLineDistance = (point1: UserLocation, point2: { lng: number, lat: number }): number => {
    const lngLat1 = new mapboxgl.LngLat(point1.lng, point1.lat);
    const lngLat2 = new mapboxgl.LngLat(point2.lng, point2.lat);
    return lngLat1.distanceTo(lngLat2);
  };

  // Add marker to map with popup showing details
  const addMarkerToMap = (marker: any) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Create marker element
    const markerElement = document.createElement('div');
    markerElement.className = 'custom-marker';
    markerElement.style.width = '30px';
    markerElement.style.height = '30px';
    markerElement.style.backgroundColor = '#FF0000';
    markerElement.style.borderRadius = '50% 50% 50% 0';
    markerElement.style.transform = 'rotate(-45deg)';
    markerElement.style.border = '3px solid #FFFFFF';
    markerElement.style.cursor = 'pointer';
    
    // Create popup content
    const popupContent = `
      <div style="padding: 8px;">
        <h3 style="margin: 0 0 8px 0; font-weight: bold;">${escapeHtml(marker.name)}</h3>
        ${marker.elevation !== null ? `<p style="margin: 4px 0;"><strong>Elevation:</strong> ${Math.round(marker.elevation)}m</p>` : ''}
        ${marker.straightLineDistance !== null ? `<p style="margin: 4px 0;"><strong>Distance:</strong> ${(marker.straightLineDistance / 1000).toFixed(2)}km</p>` : ''}
        ${marker.trailDistance !== null ? `<p style="margin: 4px 0;"><strong>Trail Distance:</strong> ${(marker.trailDistance / 1000).toFixed(2)}km</p>` : ''}
      </div>
    `;
    
    // Create popup
    const popup = new mapboxgl.Popup({ offset: 25 })
      .setHTML(popupContent);
    
    // Create and add marker
    new mapboxgl.Marker(markerElement)
      .setLngLat(marker.lngLat)
      .setPopup(popup)
      .addTo(map);
  };

  // Edit marker name
  const editMarker = (markerId: string) => {
    console.log('Editing marker:', markerId);
    
    // Find the marker in state
    const marker = markers.find(m => m.id === markerId);
    if (!marker) return;
    
    // Prompt for new name
    const newName = prompt('Enter new name for this waypoint:', marker.name);
    if (!newName || newName === marker.name) return;
    
    // Update marker in state
    setMarkers(prev => prev.map(m => 
      m.id === markerId ? { ...m, name: newName } : m
    ));
    
    // Update the popup content
    const mapboxMarker = mapMarkers.get(markerId);
    if (mapboxMarker) {
      const popup = mapboxMarker.getPopup();
      if (popup) {
        const updatedPopupContent = `
          <div style="padding: 8px; background: white; color: black; font-family: Arial, sans-serif;">
            <h3 style="margin: 0 0 8px 0; font-weight: bold; color: black;">${escapeHtml(newName)}</h3>
            ${marker.elevation !== null ? `<p style="margin: 4px 0; color: black;"><strong>Elevation:</strong> ${Math.round(marker.elevation)}m</p>` : ''}
            ${marker.straightLineDistance !== null ? `<p style="margin: 4px 0; color: black;"><strong>Distance:</strong> ${(marker.straightLineDistance / 1000).toFixed(2)}km</p>` : ''}
            ${marker.trailDistance !== null ? `<p style="margin: 4px 0; color: black;"><strong>Trail Distance:</strong> ${(marker.trailDistance / 1000).toFixed(2)}km</p>` : ''}
            <div style="margin-top: 8px; display: flex; gap: 8px;">
              <button onclick="editMarker('${markerId}')" style="padding: 4px 8px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer;">Edit</button>
              <button onclick="removeMarker('${markerId}')" style="padding: 4px 8px; background: #ff4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
            </div>
          </div>
        `;
        popup.setHTML(updatedPopupContent);
      }
    }
    
    console.log('Marker name updated successfully');
  };

  // Remove marker from map
  const removeMarker = (markerId: string) => {
    console.log('Removing marker:', markerId);
    
    // Remove from mapbox
    const mapboxMarker = mapMarkers.get(markerId);
    if (mapboxMarker) {
      mapboxMarker.remove();
      setMapMarkers(prev => {
        const newMap = new Map(prev);
        newMap.delete(markerId);
        return newMap;
      });
    }
    
    // Remove from state
    setMarkers(prev => prev.filter(marker => marker.id !== markerId));
    
    console.log('Marker removed successfully');
  };

  // Edit route waypoint name
  const editRouteWaypoint = (waypointId: string, currentName: string) => {
    const newName = prompt('Enter new name for this waypoint:', currentName);
    if (!newName || newName === currentName) return;
    
    // Update the waypoint in routeWaypoints state
    setRouteWaypoints(prev => prev.map(wp => 
      wp.id === waypointId ? { ...wp, name: newName } : wp
    ));
    
    // Update the popup content
    const nameElement = document.getElementById(`waypoint-name-${waypointId}`);
    if (nameElement) {
      nameElement.textContent = newName;
    }
  };

  // Delete route waypoint from displayed route
  const deleteRouteWaypoint = (waypointId: string) => {
    if (!confirm('Are you sure you want to delete this waypoint?')) return;
    
    const indexMatch = waypointId.match(/route-waypoint-(\d+)/);
    if (!indexMatch) return;
    const waypointIndex = parseInt(indexMatch[1], 10);
    
    if (waypointIndex < 0 || waypointIndex >= displayedWaypointsRef.current.length) return;
    if (displayedWaypointsRef.current.length <= 2) {
      alert('A route must have at least 2 waypoints.');
      return;
    }
    
    // Remove the marker from the map
    if (waypointIndex < displayedRouteMarkersRef.current.length) {
      displayedRouteMarkersRef.current[waypointIndex].remove();
      displayedRouteMarkersRef.current.splice(waypointIndex, 1);
    }
    
    // Remove from waypoints ref
    displayedWaypointsRef.current.splice(waypointIndex, 1);
    const remainingWaypoints = [...displayedWaypointsRef.current];
    
    // Update the route line on the map
    if (mapRef.current) {
      const source = mapRef.current.getSource('displayed-route') as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: remainingWaypoints.map(wp => wp.lngLat)
          }
        });
      }
    }
    
    // Trigger save callback
    if (onWaypointDeletedRef.current) {
      onWaypointDeletedRef.current(remainingWaypoints);
    }
  };

  // Make marker functions globally accessible
  useEffect(() => {
    (window as any).removeMarker = removeMarker;
    (window as any).editMarker = editMarker;
    (window as any).editRouteWaypoint = editRouteWaypoint;
    (window as any).deleteRouteWaypoint = deleteRouteWaypoint;
    return () => {
      delete (window as any).removeMarker;
      delete (window as any).editMarker;
      delete (window as any).editRouteWaypoint;
      delete (window as any).deleteRouteWaypoint;
    };
  }, [mapMarkers, markers, routeWaypoints]);

  // Reset map bearing to north
  const resetNorth = () => {
    if (!mapRef.current) return;
    
    mapRef.current.easeTo({
      bearing: 0,
      pitch: isTerrain3D ? 45 : 0
    });
  };
  
  // Start tracking user location in real-time
  const startLocationTracking = () => {
    if (!navigator.geolocation) return;
    
    // Clear any existing watch
    if (watchPositionId.current) {
      navigator.geolocation.clearWatch(watchPositionId.current);
    }
    
    // Start watching position
    watchPositionId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;
        
        // Update user location state
        setUserLocation({
          lng: longitude,
          lat: latitude,
          accuracy: accuracy
        });
        
        // Update location marker on map
        if (mapRef.current && isMapReady) {
          addUserLocationToMap(mapRef.current, {
            lng: longitude,
            lat: latitude,
            accuracy: accuracy
          });
        }
      },
      (error) => {
        console.error('Error tracking location:', error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      }
    );
  };
  
  // Stop tracking user location
  const stopLocationTracking = () => {
    // Clear the watch
    if (watchPositionId.current) {
      navigator.geolocation.clearWatch(watchPositionId.current);
      watchPositionId.current = null;
    }
    
    // Clear user location state
    setUserLocation(null);
    
    // Remove location marker from map
    if (mapRef.current && isMapReady) {
      const map = mapRef.current;
      
      if (map.getLayer('user-location')) {
        map.removeLayer('user-location');
      }
      if (map.getLayer('location-accuracy')) {
        map.removeLayer('location-accuracy');
      }
      if (map.getSource('location-accuracy')) {
        map.removeSource('location-accuracy');
      }
      if (map.getSource('user-location')) {
        map.removeSource('user-location');
      }
      if (map.hasImage('pulsing-dot')) {
        map.removeImage('pulsing-dot');
      }
    }
  };
  

  
  // Add drone imagery overlay - supports multiple layers simultaneously
  // Uses raster tile source for full-resolution zoom when tiles are available
  const addDroneImagery = (droneImage: DroneImage) => {
    if (!mapRef.current || !isMapReady) return;
    
    const imageId = droneImage.id;
    const layerId = `drone-imagery-${imageId}`;
    const outlineLayerId = `drone-imagery-outline-${imageId}`;
    
    const map = mapRef.current;
    if (map.getLayer(layerId)) {
      map.fitBounds([
        [parseFloat(droneImage.southWestLng), parseFloat(droneImage.southWestLat)],
        [parseFloat(droneImage.northEastLng), parseFloat(droneImage.northEastLat)]
      ], { padding: 100 });
      return;
    }
    
    setIsDroneImageryLoading(true);
    
    const swLng = parseFloat(droneImage.southWestLng);
    const swLat = parseFloat(droneImage.southWestLat);
    const neLng = parseFloat(droneImage.northEastLng);
    const neLat = parseFloat(droneImage.northEastLat);
    
    let imageCoordinates: [[number, number], [number, number], [number, number], [number, number]];
    
    if (droneImage.cornerCoordinates) {
      try {
        const corners = JSON.parse(droneImage.cornerCoordinates as string) as [[number, number], [number, number], [number, number], [number, number]];
        imageCoordinates = corners;
      } catch (e) {
        imageCoordinates = [
          [swLng, neLat],
          [neLng, neLat],
          [neLng, swLat],
          [swLng, swLat]
        ];
      }
    } else {
      imageCoordinates = [
        [swLng, neLat],
        [neLng, neLat],
        [neLng, swLat],
        [swLng, swLat]
      ];
    }

    const useTiles = (droneImage as any).hasTiles === true;
    
    if (useTiles) {
      const tileMinZoom = (droneImage as any).tileMinZoom || 8;
      const tileMaxZoom = (droneImage as any).tileMaxZoom || 24;
      
      map.addSource(layerId, {
        'type': 'raster',
        'tiles': [`/api/drone-images/${droneImage.id}/tiles/{z}/{x}/{y}.png`],
        'tileSize': 512,
        'bounds': [swLng, swLat, neLng, neLat],
        'minzoom': tileMinZoom,
        'maxzoom': tileMaxZoom,
        'scheme': 'xyz'
      } as any);
      
      map.addLayer({
        'id': layerId,
        'type': 'raster',
        'source': layerId,
        'paint': {
          'raster-opacity': 0.9
        }
      });

      console.log(`Drone imagery loaded as raster tiles (zoom ${tileMinZoom}-${tileMaxZoom}):`, droneImage.name);
    } else {
      const imageUrl = `/api/drone-images/${droneImage.id}/file?t=${Date.now()}`;
      
      map.addSource(layerId, {
        'type': 'image',
        'url': imageUrl,
        'coordinates': imageCoordinates
      });
      
      map.addLayer({
        'id': layerId,
        'type': 'raster',
        'source': layerId,
        'paint': {
          'raster-opacity': 0.8
        }
      });

      console.log('Drone imagery loaded as single image:', droneImage.name);
    }

    const handleSourceData = (e: mapboxgl.MapSourceDataEvent) => {
      if (e.sourceId === layerId && e.isSourceLoaded) {
        setIsDroneImageryLoading(false);
        map.off('sourcedata', handleSourceData);
      }
    };
    map.on('sourcedata', handleSourceData);
    
    setTimeout(() => {
      setIsDroneImageryLoading(false);
    }, 10000);

    map.on('error', (e) => {
      if (e.error && e.error.message && e.error.message.includes(layerId)) {
        console.error('Error loading drone imagery:', e.error);
        setIsDroneImageryLoading(false);
      }
    });
    
    const outlineCoords = [...imageCoordinates, imageCoordinates[0]];
    map.addSource(outlineLayerId, {
      'type': 'geojson',
      'data': {
        'type': 'Feature',
        'geometry': {
          'type': 'Polygon',
          'coordinates': [outlineCoords]
        },
        'properties': {
          'name': droneImage.name
        }
      }
    });
    
    map.addLayer({
      'id': outlineLayerId,
      'type': 'line',
      'source': outlineLayerId,
      'layout': {},
      'paint': {
        'line-color': '#10B981',
        'line-width': 2,
        'line-dasharray': [3, 3]
      }
    });
    
    setActiveDroneImagery(droneImage);
    setActiveDroneImages(prev => new Map(prev).set(imageId, droneImage));
    
    map.fitBounds([
      [swLng, swLat],
      [neLng, neLat]
    ], { padding: 100 });
  };
  
  // Remove a specific drone imagery by ID
  const removeDroneImageryById = (imageId: number) => {
    if (!mapRef.current || !isMapReady) return;
    
    const map = mapRef.current;
    const layerId = `drone-imagery-${imageId}`;
    const outlineLayerId = `drone-imagery-outline-${imageId}`;
    
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getLayer(outlineLayerId)) {
      map.removeLayer(outlineLayerId);
    }
    if (map.getSource(layerId)) {
      map.removeSource(layerId);
    }
    if (map.getSource(outlineLayerId)) {
      map.removeSource(outlineLayerId);
    }
    
    // Remove from active images map
    setActiveDroneImages(prev => {
      const newMap = new Map(prev);
      newMap.delete(imageId);
      return newMap;
    });
    
    // Update single active drone imagery if it was the one removed
    if (activeDroneImagery?.id === imageId) {
      setActiveDroneImagery(null);
    }
    
    console.log('Drone imagery removed from map:', imageId);
  };
  
  // Remove drone imagery overlay
  const removeDroneImagery = () => {
    if (!mapRef.current || !isMapReady) return;
    
    const map = mapRef.current;
    
    if (map.getLayer('drone-imagery')) {
      map.removeLayer('drone-imagery');
    }
    
    if (map.getSource('drone-imagery')) {
      map.removeSource('drone-imagery');
    }
    
    setActiveDroneImagery(null);
  };
  
  // Drawing modes
  const [drawingMode, setDrawingMode] = useState<string | null>(null);
  const [userDrawings, setUserDrawings] = useState<MapDrawing[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<{
    points: [number, number][],
    type: string,
    name: string,
    measurementValue?: number,
    measurementUnit?: string
  } | null>(null);
  
  // Start drawing mode (waypoint, line, polygon, measurement)
  const startDrawingMode = (mode: string) => {
    if (!mapRef.current || !isMapReady) return;
    
    // Exit if already in drawing mode
    if (drawingMode === mode) {
      cancelDrawingMode();
      return;
    }
    
    setDrawingMode(mode);
    setCurrentDrawing({
      points: [],
      type: mode,
      name: `New ${mode.charAt(0).toUpperCase() + mode.slice(1)}`,
    });
    
    // Add the drawing cursor
    const mapCanvas = mapRef.current.getCanvas();
    mapCanvas.style.cursor = 'crosshair';
    
    // Display drawing instructions
    // In a real app, this would be shown in the UI
    console.log(`Drawing mode: ${mode}. Click on the map to add points.`);
  };
  
  // Cancel drawing mode
  const cancelDrawingMode = () => {
    if (!mapRef.current) return;
    
    // Reset cursor
    const mapCanvas = mapRef.current.getCanvas();
    mapCanvas.style.cursor = '';
    
    setDrawingMode(null);
    setCurrentDrawing(null);
  };
  
  // Add a point to the current drawing
  const addDrawingPoint = (lngLat: [number, number]) => {
    if (!currentDrawing) return;
    
    const updatedPoints = [...currentDrawing.points, lngLat];
    
    // Calculate measurement if needed
    let measurementValue;
    let measurementUnit;
    
    if (currentDrawing.type === 'line' || currentDrawing.type === 'measurement') {
      // Calculate distance in meters
      if (updatedPoints.length >= 2) {
        let totalDistance = 0;
        for (let i = 1; i < updatedPoints.length; i++) {
          const start = new mapboxgl.LngLat(updatedPoints[i-1][0], updatedPoints[i-1][1]);
          const end = new mapboxgl.LngLat(updatedPoints[i][0], updatedPoints[i][1]);
          totalDistance += start.distanceTo(end);
        }
        
        // Convert to appropriate unit
        if (totalDistance < 1000) {
          measurementValue = Math.round(totalDistance);
          measurementUnit = 'meters';
        } else {
          measurementValue = Math.round((totalDistance / 1000) * 100) / 100;
          measurementUnit = 'kilometers';
        }
      }
    } else if (currentDrawing.type === 'polygon' && updatedPoints.length >= 3) {
      // Calculate area in square meters
      // This is a simplified calculation and would be more accurate in a real app
      let area = 0;
      const closed = [...updatedPoints, updatedPoints[0]]; // Close the polygon
      for (let i = 0; i < closed.length - 1; i++) {
        area += closed[i][0] * closed[i+1][1] - closed[i+1][0] * closed[i][1];
      }
      area = Math.abs(area) / 2;
      
      // Convert to appropriate unit
      if (area < 10000) {
        measurementValue = Math.round(area);
        measurementUnit = 'sq_meters';
      } else {
        measurementValue = Math.round((area / 10000) * 100) / 100;
        measurementUnit = 'hectares';
      }
    }
    
    setCurrentDrawing({
      ...currentDrawing,
      points: updatedPoints,
      measurementValue,
      measurementUnit
    });
    
    // Update the preview on the map
    updateDrawingPreview(updatedPoints, currentDrawing.type);
  };
  
  // Update the preview of the current drawing on the map
  const updateDrawingPreview = (points: [number, number][], type: string) => {
    if (!mapRef.current || !isMapReady) return;
    
    const map = mapRef.current;
    
    // Remove previous preview
    if (map.getLayer('drawing-preview')) {
      map.removeLayer('drawing-preview');
    }
    if (map.getLayer('drawing-points')) {
      map.removeLayer('drawing-points');
    }
    if (map.getSource('drawing-preview')) {
      map.removeSource('drawing-preview');
    }
    
    if (points.length === 0) return;
    
    let source;
    if (type === 'waypoint') {
      // For waypoints, we just need a point
      source = {
        type: 'geojson' as const,
        data: {
          type: 'Point' as const,
          coordinates: points[0]
        }
      };
      
      map.addSource('drawing-preview', source);
      map.addLayer({
        id: 'drawing-preview',
        type: 'circle',
        source: 'drawing-preview',
        paint: {
          'circle-radius': 8,
          'circle-color': '#FF0000'
        }
      });
    } else if (type === 'line' || type === 'measurement') {
      // For lines, we need a LineString
      source = {
        type: 'geojson' as const,
        data: {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: points
          }
        }
      };
      
      map.addSource('drawing-preview', source);
      map.addLayer({
        id: 'drawing-preview',
        type: 'line',
        source: 'drawing-preview',
        paint: {
          'line-color': '#FF0000',
          'line-width': 3
        }
      });
      
      // Add points
      map.addLayer({
        id: 'drawing-points',
        type: 'circle',
        source: 'drawing-preview',
        paint: {
          'circle-radius': 5,
          'circle-color': '#FFFFFF',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FF0000'
        }
      });
    } else if (type === 'polygon') {
      // For polygons, we need a Polygon
      if (points.length < 3) {
        // If less than 3 points, show as a line
        source = {
          type: 'geojson' as const,
          data: {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: points
            }
          }
        };
      } else {
        // If 3 or more points, close the polygon
        const closedPoints = [...points, points[0]];
        source = {
          type: 'geojson' as const,
          data: {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [closedPoints]
            }
          }
        };
      }
      
      map.addSource('drawing-preview', source);
      
      if (points.length >= 3) {
        map.addLayer({
          id: 'drawing-preview',
          type: 'fill',
          source: 'drawing-preview',
          paint: {
            'fill-color': '#FF0000',
            'fill-opacity': 0.3
          }
        });
      }
      
      // Add outline
      map.addLayer({
        id: 'drawing-outline',
        type: 'line',
        source: 'drawing-preview',
        paint: {
          'line-color': '#FF0000',
          'line-width': 2
        }
      });
      
      // Add points
      map.addLayer({
        id: 'drawing-points',
        type: 'circle',
        source: 'drawing-preview',
        paint: {
          'circle-radius': 5,
          'circle-color': '#FFFFFF',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FF0000'
        }
      });
    }
  };
  
  // Finish and save current drawing
  const finishDrawing = async () => {
    if (!currentDrawing || !mapRef.current || currentDrawing.points.length === 0) {
      cancelDrawingMode();
      return;
    }
    
    try {
      // Prepare the drawing data
      const drawingData = {
        name: currentDrawing.name,
        type: currentDrawing.type,
        coordinates: JSON.stringify(currentDrawing.points),
        properties: JSON.stringify({
          color: '#FF0000'
        }),
        measurementValue: currentDrawing.measurementValue?.toString(),
        measurementUnit: currentDrawing.measurementUnit
      };
      
      // Save drawing to server
      const response = await apiRequest('POST', '/api/map-drawings', drawingData);
      const savedDrawing = await response.json();
      
      // Add to local state
      setUserDrawings(prev => [...prev, savedDrawing]);
      
      // Refresh drawings from server
      queryClient.invalidateQueries({ queryKey: ['/api/map-drawings'] });
      
      // Clear drawing mode
      cancelDrawingMode();
      
      // Convert preview to permanent drawing
      addDrawingToMap(savedDrawing);
      
      return savedDrawing;
    } catch (error) {
      console.error('Error saving drawing:', error);
      return null;
    }
  };
  
  // Load user drawings from server
  const loadUserDrawings = async () => {
    if (!mapRef.current || !isMapReady) return [];
    
    try {
      // Temporarily disable drawing loading to fix map initialization
      setUserDrawings([]);
      return [];
    } catch (error) {
      console.error('Error loading drawings:', error);
      return [];
    }
  };
  
  // Add a drawing to the map
  const addDrawingToMap = (drawing: MapDrawing) => {
    if (!mapRef.current || !isMapReady) return;
    
    const map = mapRef.current;
    
    // Parse the coordinates and properties
    const coordinates = JSON.parse(drawing.coordinates);
    const properties = drawing.properties ? JSON.parse(drawing.properties) : { color: '#FF0000' };
    
    // Create source ID and layer ID
    const sourceId = `drawing-${drawing.id}`;
    const layerId = `drawing-${drawing.id}`;
    const pointsLayerId = `drawing-points-${drawing.id}`;
    
    // Remove if already exists
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getLayer(pointsLayerId)) {
      map.removeLayer(pointsLayerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    
    // Add source and layer based on drawing type
    if (drawing.type === 'waypoint') {
      map.addSource(sourceId, {
        type: 'geojson' as const,
        data: {
          type: 'Point' as const,
          coordinates: coordinates[0]
        }
      });
      
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 8,
          'circle-color': properties.color || '#FF0000'
        }
      });
    } else if (drawing.type === 'line' || drawing.type === 'measurement') {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          }
        }
      });
      
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': properties.color || '#FF0000',
          'line-width': 3
        }
      });
      
      // Add points
      map.addLayer({
        id: pointsLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 5,
          'circle-color': '#FFFFFF',
          'circle-stroke-width': 2,
          'circle-stroke-color': properties.color || '#FF0000'
        }
      });
    } else if (drawing.type === 'polygon') {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [coordinates]
          }
        }
      });
      
      map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': properties.color || '#FF0000',
          'fill-opacity': 0.3
        }
      });
      
      // Add outline
      map.addLayer({
        id: `${layerId}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': properties.color || '#FF0000',
          'line-width': 2
        }
      });
    }
  };
  
  // Remove a drawing from the map
  const removeDrawingFromMap = async (drawingId: number) => {
    if (!mapRef.current || !isMapReady) return;
    
    const map = mapRef.current;
    
    // Remove layers and source
    const layerId = `drawing-${drawingId}`;
    const pointsLayerId = `drawing-points-${drawingId}`;
    const outlineLayerId = `${layerId}-outline`;
    const sourceId = `drawing-${drawingId}`;
    
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getLayer(pointsLayerId)) {
      map.removeLayer(pointsLayerId);
    }
    if (map.getLayer(outlineLayerId)) {
      map.removeLayer(outlineLayerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    
    try {
      // Delete from server
      await apiRequest('DELETE', `/api/map-drawings/${drawingId}`);
      
      // Remove from local state
      setUserDrawings(prev => prev.filter(d => d.id !== drawingId));
      
      // Refresh drawings from server
      queryClient.invalidateQueries({ queryKey: ['/api/map-drawings'] });
      
      return true;
    } catch (error) {
      console.error('Error deleting drawing:', error);
      return false;
    }
  };
  
  // Handle map click for drawing
  useEffect(() => {
    if (!mapRef.current || !drawingMode) return;
    
    const map = mapRef.current;
    
    const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
      if (drawingMode) {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        addDrawingPoint(lngLat);
        
        // If it's a waypoint, finish after one click
        if (drawingMode === 'waypoint' && currentDrawing?.points.length === 1) {
          finishDrawing();
        }
      }
    };
    
    map.on('click', handleMapClick);
    
    return () => {
      map.off('click', handleMapClick);
    };
  }, [drawingMode, currentDrawing]);
  
  // Update drone imagery when active drone image changes
  useEffect(() => {
    // This would be triggered by the API updates through the global state
    // For this prototype, let's leave it as a placeholder
  }, [activeDroneImagery]);
  
  // Load user drawings on map load
  useEffect(() => {
    if (isMapReady) {
      loadUserDrawings();
    }
  }, [isMapReady]);
  
  // Functions to adjust drone imagery
  const updateDroneAdjustments = (newAdjustments: typeof droneAdjustments) => {
    setDroneAdjustments(newAdjustments);
    if (activeDroneImagery) {
      addDroneImagery(activeDroneImagery);
    }
  };

  // Enable drag mode for drone imagery
  const enableDragMode = () => {
    console.log('Toggle drag mode, current state:', isDragMode);
    setIsDragMode(!isDragMode);
    console.log('New drag mode state will be:', !isDragMode);
  };

  // Handle drone imagery dragging
  useEffect(() => {
    if (!mapRef.current || !isMapReady) return;

    const map = mapRef.current;
    
    // Disable/enable map interactions based on drag mode
    if (isDragMode) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.doubleClickZoom.disable();
      if (map.getCanvas) {
        map.getCanvas().style.cursor = 'grab';
      }
    } else {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.boxZoom.enable();
      map.doubleClickZoom.enable();
      if (map.getCanvas) {
        map.getCanvas().style.cursor = '';
      }
    }
  }, [isDragMode, isMapReady]);

  // Separate effect for mouse events to avoid dependency issues
  useEffect(() => {
    if (!mapRef.current || !isDragMode || !activeDroneImagery || !isMapReady) return;

    const map = mapRef.current;
    
    const handleMouseDown = (e: any) => {
      console.log('Mouse down event triggered, drag mode active');
      e.preventDefault();
      e.originalEvent.preventDefault();
      
      setIsDragging(true);
      setDragStart({
        x: e.point.x,
        y: e.point.y,
        lat: droneAdjustments.offsetLat,
        lng: droneAdjustments.offsetLng
      });
      
      console.log('Drag started at:', e.point);
      if (map.getCanvas) {
        map.getCanvas().style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e: any) => {
      if (!isDragging || !dragStart) return;

      const deltaX = e.point.x - dragStart.x;
      const deltaY = e.point.y - dragStart.y;
      
      console.log('Dragging with delta:', { deltaX, deltaY });
      
      // Convert screen pixels to map coordinates
      const zoom = map.getZoom();
      const scaleFactor = 1 / Math.pow(2, zoom) * 360 / 256; // Mapbox coordinate conversion
      
      const latOffset = -deltaY * scaleFactor * 0.5; // Negative because screen Y is inverted
      const lngOffset = deltaX * scaleFactor * 0.5;
      
      const newAdjustments = {
        scale: droneAdjustments.scale,
        offsetLat: dragStart.lat + latOffset,
        offsetLng: dragStart.lng + lngOffset
      };
      
      console.log('New position offsets:', { latOffset, lngOffset });
      console.log('Final adjustments:', newAdjustments);
      
      // Update the state directly to move the image
      setDroneAdjustments(newAdjustments);
    };

    const handleMouseUp = () => {
      console.log('Mouse up - ending drag');
      if (isDragging && dragStart && activeDroneImagery) {
        // Calculate final position and save it
        const deltaX = dragStart.x - dragStart.x; // This will be updated during drag
        const deltaY = dragStart.y - dragStart.y;
        
        // Get the final adjustments from the last mouse move
        const zoom = map.getZoom();
        const scaleFactor = 1 / Math.pow(2, zoom) * 360 / 256;
        
        const finalAdjustments = {
          scale: droneAdjustments.scale,
          offsetLat: droneAdjustments.offsetLat,
          offsetLng: droneAdjustments.offsetLng
        };
        
        console.log('Saving final drone position:', finalAdjustments);
        setDroneAdjustments(finalAdjustments);
      }
      
      setIsDragging(false);
      setDragStart(null);
      if (map.getCanvas) {
        map.getCanvas().style.cursor = 'grab';
      }
    };

    console.log('Adding drag event listeners');
    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', handleMouseUp);

    return () => {
      console.log('Removing drag event listeners');
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
    };
  }, [isDragMode, activeDroneImagery, droneAdjustments, isMapReady]);

  // Two-finger distance measurement - only active when measurement mode is enabled
  useEffect(() => {
    if (!mapRef.current || !isMapReady || !isMeasurementMode) return;
    
    const map = mapRef.current;
    const mapCanvas = map.getCanvas();
    const STATIONARY_THRESHOLD = 10; // pixels
    const HOLD_DURATION = 400; // milliseconds
    const PINCH_THRESHOLD = 20; // pixels - detect pinch even after measurement starts
    
    const handleTouchStart = (e: TouchEvent) => {
      // Only handle two-finger touches
      if (e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        
        // Calculate initial distance between fingers
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        const initialDistance = Math.sqrt(dx * dx + dy * dy);
        
        initialTouchPositionsRef.current = {
          x1: touch1.clientX,
          y1: touch1.clientY,
          x2: touch2.clientX,
          y2: touch2.clientY
        };
        initialDistanceRef.current = initialDistance;
        
        // Start a timer - if fingers stay stationary, activate measurement
        measurementTimerRef.current = setTimeout(() => {
          const rect = mapCanvas.getBoundingClientRect();
          
          // Convert touch coordinates to canvas-relative coordinates
          const canvasX1 = touch1.clientX - rect.left;
          const canvasY1 = touch1.clientY - rect.top;
          const canvasX2 = touch2.clientX - rect.left;
          const canvasY2 = touch2.clientY - rect.top;
          
          const point1 = map.unproject([canvasX1, canvasY1]);
          const point2 = map.unproject([canvasX2, canvasY2]);
          
          setIsMeasuring(true);
          setMeasurementPoints([point1, point2]);
        }, HOLD_DURATION);
      }
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        
        // Calculate current distance between fingers
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        const currentDistance = Math.sqrt(dx * dx + dy * dy);
        
        // Check if this is a pinch gesture (distance changing significantly)
        if (initialDistanceRef.current !== null) {
          const distanceChange = Math.abs(currentDistance - initialDistanceRef.current);
          if (distanceChange > PINCH_THRESHOLD) {
            // This is a pinch gesture - cancel measurement
            if (measurementTimerRef.current) {
              clearTimeout(measurementTimerRef.current);
              measurementTimerRef.current = null;
            }
            if (isMeasuring) {
              setIsMeasuring(false);
              setMeasurementPoints(null);
            }
            initialTouchPositionsRef.current = null;
            initialDistanceRef.current = null;
            return;
          }
        }
        
        // Check if fingers have moved significantly from initial position (but same distance)
        if (initialTouchPositionsRef.current && measurementTimerRef.current) {
          const dx1 = Math.abs(touch1.clientX - initialTouchPositionsRef.current.x1);
          const dy1 = Math.abs(touch1.clientY - initialTouchPositionsRef.current.y1);
          const dx2 = Math.abs(touch2.clientX - initialTouchPositionsRef.current.x2);
          const dy2 = Math.abs(touch2.clientY - initialTouchPositionsRef.current.y2);
          
          if (dx1 > STATIONARY_THRESHOLD || dy1 > STATIONARY_THRESHOLD || 
              dx2 > STATIONARY_THRESHOLD || dy2 > STATIONARY_THRESHOLD) {
            clearTimeout(measurementTimerRef.current);
            measurementTimerRef.current = null;
            initialTouchPositionsRef.current = null;
          }
        }
        
        // If already measuring, update measurement points
        if (isMeasuring) {
          e.preventDefault(); // Only prevent default when actively measuring
          
          const rect = mapCanvas.getBoundingClientRect();
          
          const canvasX1 = touch1.clientX - rect.left;
          const canvasY1 = touch1.clientY - rect.top;
          const canvasX2 = touch2.clientX - rect.left;
          const canvasY2 = touch2.clientY - rect.top;
          
          const point1 = map.unproject([canvasX1, canvasY1]);
          const point2 = map.unproject([canvasX2, canvasY2]);
          
          setMeasurementPoints([point1, point2]);
        }
      }
    };
    
    const handleTouchEnd = (e: TouchEvent) => {
      if (measurementTimerRef.current) {
        clearTimeout(measurementTimerRef.current);
        measurementTimerRef.current = null;
      }
      
      // When measurement ends, show the distance notification
      if (isMeasuring && measurementPoints) {
        const [point1, point2] = measurementPoints;
        const distanceInMeters = point1.distanceTo(point2);
        const distanceInMiles = distanceInMeters * 0.000621371;
        const distanceInFeet = distanceInMeters * 3.28084;
        const distanceInKm = distanceInMeters / 1000;
        
        let distanceText: string;
        if (distanceInMeters < 1000) {
          distanceText = `${Math.round(distanceInMeters)}m / ${Math.round(distanceInFeet)}ft`;
        } else {
          distanceText = `${distanceInKm.toFixed(2)}km / ${distanceInMiles.toFixed(2)}mi`;
        }
        
        // Show notification for 5 seconds
        setMeasurementDistance(distanceText);
        
        // Clear any existing timer
        if (measurementDisplayTimerRef.current) {
          clearTimeout(measurementDisplayTimerRef.current);
        }
        
        // Hide notification after 5 seconds
        measurementDisplayTimerRef.current = setTimeout(() => {
          setMeasurementDistance(null);
        }, 5000);
      }
      
      initialTouchPositionsRef.current = null;
      initialDistanceRef.current = null;
      
      if (e.touches.length < 2) {
        setIsMeasuring(false);
        setMeasurementPoints(null);
      }
    };
    
    mapCanvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    mapCanvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    mapCanvas.addEventListener('touchend', handleTouchEnd, { passive: true });
    mapCanvas.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    
    return () => {
      if (measurementTimerRef.current) {
        clearTimeout(measurementTimerRef.current);
      }
      mapCanvas.removeEventListener('touchstart', handleTouchStart);
      mapCanvas.removeEventListener('touchmove', handleTouchMove);
      mapCanvas.removeEventListener('touchend', handleTouchEnd);
      mapCanvas.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isMapReady, isMeasurementMode, isMeasuring]);
  
  // Display measurement line and distance
  useEffect(() => {
    if (!mapRef.current || !measurementPoints) return;
    
    const map = mapRef.current;
    const [point1, point2] = measurementPoints;
    
    // Calculate distance using Mapbox's built-in method
    const distanceInMeters = point1.distanceTo(point2);
    const distanceInMiles = distanceInMeters * 0.000621371;
    const distanceInFeet = distanceInMeters * 3.28084;
    const distanceInKm = distanceInMeters / 1000;
    
    // Format distance based on magnitude
    let distanceText: string;
    if (distanceInMeters < 1000) {
      distanceText = `${Math.round(distanceInMeters)}m / ${Math.round(distanceInFeet)}ft`;
    } else {
      distanceText = `${distanceInKm.toFixed(2)}km / ${distanceInMiles.toFixed(2)}mi`;
    }
    
    // Create GeoJSON for the measurement line
    const lineGeoJSON = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [point1.lng, point1.lat],
          [point2.lng, point2.lat]
        ]
      }
    };
    
    // Remove existing measurement layers
    if (map.getLayer('measurement-line')) {
      map.removeLayer('measurement-line');
    }
    if (map.getLayer('measurement-points')) {
      map.removeLayer('measurement-points');
    }
    if (map.getSource('measurement-line')) {
      map.removeSource('measurement-line');
    }
    if (map.getSource('measurement-points')) {
      map.removeSource('measurement-points');
    }
    
    // Add measurement line source and layer
    map.addSource('measurement-line', {
      type: 'geojson',
      data: lineGeoJSON
    });
    
    map.addLayer({
      id: 'measurement-line',
      type: 'line',
      source: 'measurement-line',
      paint: {
        'line-color': '#FF6B35',
        'line-width': 3,
        'line-opacity': 0.9
      }
    });
    
    // Add measurement points
    const pointsGeoJSON = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Point' as const,
            coordinates: [point1.lng, point1.lat]
          }
        },
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Point' as const,
            coordinates: [point2.lng, point2.lat]
          }
        }
      ]
    };
    
    map.addSource('measurement-points', {
      type: 'geojson',
      data: pointsGeoJSON
    });
    
    map.addLayer({
      id: 'measurement-points',
      type: 'circle',
      source: 'measurement-points',
      paint: {
        'circle-radius': 6,
        'circle-color': '#FF6B35',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF'
      }
    });
    
    // Create a popup to show the distance at the midpoint
    const midLat = (point1.lat + point2.lat) / 2;
    const midLng = (point1.lng + point2.lng) / 2;
    
    // Remove existing measurement popup if any
    const existingPopup = document.querySelector('.measurement-popup');
    if (existingPopup) {
      existingPopup.remove();
    }
    
    // Create custom popup element
    const popupEl = document.createElement('div');
    popupEl.className = 'measurement-popup';
    popupEl.style.cssText = `
      position: absolute;
      background: rgba(255, 107, 53, 0.95);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-weight: bold;
      font-size: 14px;
      pointer-events: none;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      white-space: nowrap;
    `;
    popupEl.textContent = distanceText;
    
    // Position the popup at the midpoint
    const midPoint = map.project([midLng, midLat]);
    popupEl.style.left = `${midPoint.x}px`;
    popupEl.style.top = `${midPoint.y - 30}px`;
    
    map.getContainer().appendChild(popupEl);
    
    return () => {
      // Cleanup on unmount or when measurement ends
      if (map.getLayer('measurement-line')) {
        map.removeLayer('measurement-line');
      }
      if (map.getLayer('measurement-points')) {
        map.removeLayer('measurement-points');
      }
      if (map.getSource('measurement-line')) {
        map.removeSource('measurement-line');
      }
      if (map.getSource('measurement-points')) {
        map.removeSource('measurement-points');
      }
      
      const popup = document.querySelector('.measurement-popup');
      if (popup) {
        popup.remove();
      }
    };
  }, [measurementPoints]);

  // Cleanup measurement when mode is disabled
  useEffect(() => {
    if (!isMeasurementMode && mapRef.current) {
      const map = mapRef.current;
      
      // Clean up measurement state
      setIsMeasuring(false);
      setMeasurementPoints(null);
      
      // Remove measurement layers and sources
      if (map.getLayer('measurement-line')) {
        map.removeLayer('measurement-line');
      }
      if (map.getLayer('measurement-points')) {
        map.removeLayer('measurement-points');
      }
      if (map.getSource('measurement-line')) {
        map.removeSource('measurement-line');
      }
      if (map.getSource('measurement-points')) {
        map.removeSource('measurement-points');
      }
      
      // Remove measurement popup
      const popup = document.querySelector('.measurement-popup');
      if (popup) {
        popup.remove();
      }
      
      // Clean up multi-point measurement
      setMeasurementPath([]);
      measurementPathMarkersRef.current.forEach(marker => marker.remove());
      measurementPathMarkersRef.current = [];
      
      // Remove multi-point measurement layers
      if (map.getLayer('measurement-path-line')) {
        map.removeLayer('measurement-path-line');
      }
      if (map.getSource('measurement-path-line')) {
        map.removeSource('measurement-path-line');
      }
      // Remove segment labels
      document.querySelectorAll('.measurement-segment-label').forEach(el => el.remove());
    }
  }, [isMeasurementMode]);

  // Multi-point click measurement handler
  useEffect(() => {
    if (!mapRef.current || !isMapReady || !isMeasurementMode) return;
    
    const map = mapRef.current;
    
    const handleMeasurementClick = (e: mapboxgl.MapMouseEvent) => {
      const clickedPoint = e.lngLat;
      setMeasurementPath(prev => [...prev, clickedPoint]);
    };
    
    map.on('click', handleMeasurementClick);
    
    // Change cursor when in measurement mode
    map.getCanvas().style.cursor = 'crosshair';
    
    return () => {
      map.off('click', handleMeasurementClick);
      map.getCanvas().style.cursor = '';
    };
  }, [isMapReady, isMeasurementMode]);

  // Draw multi-point measurement path
  useEffect(() => {
    if (!mapRef.current || measurementPath.length === 0) return;
    
    const map = mapRef.current;
    
    // Calculate distances
    const segmentDistances: number[] = [];
    let totalDistance = 0;
    
    for (let i = 1; i < measurementPath.length; i++) {
      const dist = measurementPath[i - 1].distanceTo(measurementPath[i]);
      segmentDistances.push(dist);
      totalDistance += dist;
    }
    
    // Format total distance
    const formatDistance = (meters: number) => {
      const feet = meters * 3.28084;
      const miles = meters * 0.000621371;
      if (meters < 1000) {
        return `${Math.round(meters)}m / ${Math.round(feet)}ft`;
      }
      return `${(meters / 1000).toFixed(2)}km / ${miles.toFixed(2)}mi`;
    };
    
    // Update total distance display
    if (measurementPath.length >= 2) {
      setMeasurementDistance(`Total: ${formatDistance(totalDistance)}`);
    } else {
      setMeasurementDistance('Tap to add more points');
    }
    
    // Remove existing path layers
    if (map.getLayer('measurement-path-line')) {
      map.removeLayer('measurement-path-line');
    }
    if (map.getSource('measurement-path-line')) {
      map.removeSource('measurement-path-line');
    }
    
    // Only draw line if we have at least 2 points (LineString requires 2+ coords)
    if (measurementPath.length >= 2) {
      const lineGeoJSON = {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: measurementPath.map(p => [p.lng, p.lat])
        }
      };
      
      map.addSource('measurement-path-line', {
        type: 'geojson',
        data: lineGeoJSON
      });
      
      map.addLayer({
        id: 'measurement-path-line',
        type: 'line',
        source: 'measurement-path-line',
        paint: {
          'line-color': '#FF6B35',
          'line-width': 4,
          'line-opacity': 0.9
        }
      });
    }
    
    // Remove existing markers and create new ones
    measurementPathMarkersRef.current.forEach(marker => marker.remove());
    measurementPathMarkersRef.current = [];
    
    measurementPath.forEach((point, index) => {
      const el = document.createElement('div');
      el.className = 'measurement-point-marker';
      el.style.cssText = `
        width: 24px;
        height: 24px;
        background: #FF6B35;
        border: 3px solid white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 11px;
        font-weight: bold;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      `;
      el.textContent = String(index + 1);
      
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      
      measurementPathMarkersRef.current.push(marker);
    });
    
    // Remove existing segment labels
    document.querySelectorAll('.measurement-segment-label').forEach(el => el.remove());
    
    // Add segment distance labels at midpoints
    for (let i = 0; i < segmentDistances.length; i++) {
      const p1 = measurementPath[i];
      const p2 = measurementPath[i + 1];
      const midLng = (p1.lng + p2.lng) / 2;
      const midLat = (p1.lat + p2.lat) / 2;
      
      const labelEl = document.createElement('div');
      labelEl.className = 'measurement-segment-label';
      labelEl.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.75);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        pointer-events: none;
        z-index: 999;
        white-space: nowrap;
      `;
      labelEl.textContent = formatDistance(segmentDistances[i]);
      
      const screenPos = map.project([midLng, midLat]);
      labelEl.style.left = `${screenPos.x}px`;
      labelEl.style.top = `${screenPos.y - 15}px`;
      labelEl.style.transform = 'translate(-50%, -50%)';
      
      map.getContainer().appendChild(labelEl);
    }
    
    // Update label positions on map move
    const updateLabels = () => {
      const labels = document.querySelectorAll('.measurement-segment-label');
      labels.forEach((label, i) => {
        if (i < segmentDistances.length) {
          const p1 = measurementPath[i];
          const p2 = measurementPath[i + 1];
          const midLng = (p1.lng + p2.lng) / 2;
          const midLat = (p1.lat + p2.lat) / 2;
          const screenPos = map.project([midLng, midLat]);
          (label as HTMLElement).style.left = `${screenPos.x}px`;
          (label as HTMLElement).style.top = `${screenPos.y - 15}px`;
        }
      });
    };
    
    map.on('move', updateLabels);
    
    return () => {
      map.off('move', updateLabels);
    };
  }, [measurementPath]);

  // Draw mode state and refs
  const drawModeControlPointsRef = useRef<mapboxgl.Marker[]>([]);
  const drawModePathRef = useRef<[number, number][]>([]);
  const drawModeWaypointsRef = useRef<[number, number][]>([]);
  const drawModeCallbackRef = useRef<((path: [number, number][]) => void) | null>(null);
  const [isDrawRouteMode, setIsDrawRouteMode] = useState(false);

  // Enable draw route mode - allows user to click on line to add control points and drag them
  const enableDrawRouteMode = (
    pathCoordinates: [number, number][],
    waypointCoordinates: [number, number][],
    onPathChange: (newPath: [number, number][]) => void
  ) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Guard: if already in draw mode with same path length, just update the callback
    if (isDrawRouteMode && drawModePathRef.current.length === pathCoordinates.length) {
      drawModeCallbackRef.current = onPathChange;
      return;
    }
    
    // Clean up any existing draw mode state first
    if (isDrawRouteMode) {
      // Remove existing control point markers
      drawModeControlPointsRef.current.forEach(marker => marker.remove());
      drawModeControlPointsRef.current = [];
      
      // Remove existing handlers
      if ((map as any)._drawModeLineClickHandler) {
        try { map.off('click', 'draw-mode-hit-layer', (map as any)._drawModeLineClickHandler); } catch (e) {}
      }
      if ((map as any)._drawModeMouseEnterHandler) {
        try { map.off('mouseenter', 'draw-mode-hit-layer', (map as any)._drawModeMouseEnterHandler); } catch (e) {}
      }
      if ((map as any)._drawModeMouseLeaveHandler) {
        try { map.off('mouseleave', 'draw-mode-hit-layer', (map as any)._drawModeMouseLeaveHandler); } catch (e) {}
      }
    }
    
    setIsDrawRouteMode(true);
    drawModePathRef.current = [...pathCoordinates];
    drawModeWaypointsRef.current = [...waypointCoordinates];
    drawModeCallbackRef.current = onPathChange;
    
    // Create a hit area layer for clicking on the line
    const hitSourceId = 'draw-mode-hit-area';
    const hitLayerId = 'draw-mode-hit-layer';
    const controlSourceId = 'draw-mode-control-points';
    const controlLayerId = 'draw-mode-control-layer';
    
    // Remove existing layers/sources if present
    try {
      if (map.getLayer(hitLayerId)) map.removeLayer(hitLayerId);
      if (map.getSource(hitSourceId)) map.removeSource(hitSourceId);
      if (map.getLayer(controlLayerId)) map.removeLayer(controlLayerId);
      if (map.getSource(controlSourceId)) map.removeSource(controlSourceId);
    } catch (e) {
      console.warn('Error removing existing draw mode layers:', e);
    }
    
    // Add invisible wide hit area over the route line
    map.addSource(hitSourceId, {
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
      id: hitLayerId,
      type: 'line',
      source: hitSourceId,
      paint: {
        'line-color': 'transparent',
        'line-width': 20 // Wide hit area for easier clicking
      }
    });
    
    // Add control points source (initially empty, filled when user clicks on line)
    map.addSource(controlSourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      }
    });
    
    map.addLayer({
      id: controlLayerId,
      type: 'circle',
      source: controlSourceId,
      paint: {
        'circle-radius': 8,
        'circle-color': '#FF6B00',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF'
      }
    });
    
    // Click handler to add control points on the line
    const lineClickHandler = (e: mapboxgl.MapMouseEvent) => {
      const clickPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const currentPath = drawModePathRef.current;
      
      // Find the nearest segment to insert the point
      let minDist = Infinity;
      let insertIndex = 1;
      
      for (let i = 0; i < currentPath.length - 1; i++) {
        const segStart = currentPath[i];
        const segEnd = currentPath[i + 1];
        
        // Calculate distance from click to line segment
        const dist = pointToSegmentDistance(clickPoint, segStart, segEnd);
        if (dist < minDist) {
          minDist = dist;
          insertIndex = i + 1;
        }
      }
      
      // Insert the new control point
      const newPath = [...currentPath];
      newPath.splice(insertIndex, 0, clickPoint);
      drawModePathRef.current = newPath;
      
      // Update the route line on the map
      updateDrawModePath(newPath);
      
      // Create draggable marker for this control point
      addControlPointMarker(clickPoint, insertIndex, newPath);
      
      // Notify callback
      if (drawModeCallbackRef.current) {
        drawModeCallbackRef.current(newPath);
      }
    };
    
    map.on('click', hitLayerId, lineClickHandler);
    
    // Change cursor on hover
    const mouseEnterHandler = () => {
      map.getCanvas().style.cursor = 'crosshair';
    };
    
    const mouseLeaveHandler = () => {
      map.getCanvas().style.cursor = '';
    };
    
    map.on('mouseenter', hitLayerId, mouseEnterHandler);
    map.on('mouseleave', hitLayerId, mouseLeaveHandler);
    
    // Store handlers for cleanup
    (map as any)._drawModeLineClickHandler = lineClickHandler;
    (map as any)._drawModeMouseEnterHandler = mouseEnterHandler;
    (map as any)._drawModeMouseLeaveHandler = mouseLeaveHandler;
  };
  
  // Helper function to calculate point to line segment distance
  const pointToSegmentDistance = (
    point: [number, number],
    segStart: [number, number],
    segEnd: [number, number]
  ): number => {
    const x = point[0], y = point[1];
    const x1 = segStart[0], y1 = segStart[1];
    const x2 = segEnd[0], y2 = segEnd[1];
    
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) param = dot / lenSq;
    
    let xx, yy;
    
    if (param < 0) {
      xx = x1; yy = y1;
    } else if (param > 1) {
      xx = x2; yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    
    const dx = x - xx;
    const dy = y - yy;
    
    return Math.sqrt(dx * dx + dy * dy);
  };
  
  // Add a draggable control point marker
  const addControlPointMarker = (
    lngLat: [number, number],
    pathIndex: number,
    currentPath: [number, number][]
  ) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    const markerElement = document.createElement('div');
    markerElement.className = 'draw-mode-control-point';
    markerElement.style.cssText = `
      width: 16px;
      height: 16px;
      background: #FF6B00;
      border: 2px solid white;
      border-radius: 50%;
      cursor: grab;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;
    
    const marker = new mapboxgl.Marker({ 
      element: markerElement, 
      draggable: true 
    })
      .setLngLat(lngLat)
      .addTo(map);
    
    // Store the path index on the marker element
    (marker as any)._pathIndex = pathIndex;
    
    marker.on('drag', () => {
      markerElement.style.cursor = 'grabbing';
      const newLngLat = marker.getLngLat();
      const index = (marker as any)._pathIndex;
      
      // Update path in real-time
      const newPath = [...drawModePathRef.current];
      newPath[index] = [newLngLat.lng, newLngLat.lat];
      drawModePathRef.current = newPath;
      
      // Update the route line visualization
      updateDrawModePath(newPath);
    });
    
    marker.on('dragend', () => {
      markerElement.style.cursor = 'grab';
      
      // Notify callback with final path
      if (drawModeCallbackRef.current) {
        drawModeCallbackRef.current(drawModePathRef.current);
      }
    });
    
    drawModeControlPointsRef.current.push(marker);
    
    // Re-index all control point markers
    reindexControlPointMarkers();
  };
  
  // Re-index control point markers after path changes
  const reindexControlPointMarkers = () => {
    const path = drawModePathRef.current;
    const waypoints = drawModeWaypointsRef.current;
    
    drawModeControlPointsRef.current.forEach(marker => {
      const markerLngLat = marker.getLngLat();
      
      // Find this marker's position in the current path
      for (let i = 0; i < path.length; i++) {
        if (Math.abs(path[i][0] - markerLngLat.lng) < 0.0001 && 
            Math.abs(path[i][1] - markerLngLat.lat) < 0.0001) {
          (marker as any)._pathIndex = i;
          break;
        }
      }
    });
  };
  
  // Update the draw mode path visualization
  const updateDrawModePath = (path: [number, number][]) => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    
    // Update the edit-mode route line
    const source = map.getSource('edit-mode-route-line') as mapboxgl.GeoJSONSource;
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
    
    // Update the hit area
    const hitSource = map.getSource('draw-mode-hit-area') as mapboxgl.GeoJSONSource;
    if (hitSource) {
      hitSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: path
        }
      });
    }
  };
  
  // Disable draw route mode
  const disableDrawRouteMode = () => {
    if (!mapRef.current) return;
    
    const map = mapRef.current;
    setIsDrawRouteMode(false);
    
    // Remove control point markers
    drawModeControlPointsRef.current.forEach(marker => marker.remove());
    drawModeControlPointsRef.current = [];
    
    // Remove click handler BEFORE removing layers (handler references the layer)
    if ((map as any)._drawModeLineClickHandler) {
      try {
        map.off('click', 'draw-mode-hit-layer', (map as any)._drawModeLineClickHandler);
      } catch (e) {
        // Layer may already be removed
      }
      delete (map as any)._drawModeLineClickHandler;
    }
    
    // Remove mouseenter/mouseleave handlers
    if ((map as any)._drawModeMouseEnterHandler) {
      try {
        map.off('mouseenter', 'draw-mode-hit-layer', (map as any)._drawModeMouseEnterHandler);
      } catch (e) {}
      delete (map as any)._drawModeMouseEnterHandler;
    }
    if ((map as any)._drawModeMouseLeaveHandler) {
      try {
        map.off('mouseleave', 'draw-mode-hit-layer', (map as any)._drawModeMouseLeaveHandler);
      } catch (e) {}
      delete (map as any)._drawModeMouseLeaveHandler;
    }
    
    // Remove layers and sources safely
    try {
      if (map.getLayer('draw-mode-hit-layer')) map.removeLayer('draw-mode-hit-layer');
      if (map.getSource('draw-mode-hit-area')) map.removeSource('draw-mode-hit-area');
      if (map.getLayer('draw-mode-control-layer')) map.removeLayer('draw-mode-control-layer');
      if (map.getSource('draw-mode-control-points')) map.removeSource('draw-mode-control-points');
    } catch (e) {
      console.warn('Error cleaning up draw mode layers:', e);
    }
    
    // Reset cursor
    map.getCanvas().style.cursor = '';
    
    // Clear refs
    drawModePathRef.current = [];
    drawModeWaypointsRef.current = [];
    drawModeCallbackRef.current = null;
  };

  return {
    initializeMap,
    isMapReady,
    map: mapRef.current,
    toggleLayer,
    activeLayers,
    activeTrailOverlays,
    zoomIn,
    zoomOut,
    flyToUserLocation,
    toggleTerrain,
    resetNorth,
    addDroneImagery,
    removeDroneImagery,
    removeDroneImageryById,
    activeDroneImagery,
    activeDroneImages,
    isDroneImageryLoading,
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
    isMarkerMode,
    setIsMarkerMode,
    markers,
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
    isDragMode,
    setIsDragMode,
    droneAdjustments,
    updateDroneAdjustments,
    // Distance measurement
    isMeasurementMode,
    setIsMeasurementMode,
    measurementDistance,
    measurementPath,
    clearMeasurementPath: () => {
      setMeasurementPath([]);
      measurementPathMarkersRef.current.forEach(marker => marker.remove());
      measurementPathMarkersRef.current = [];
      document.querySelectorAll('.measurement-segment-label').forEach(el => el.remove());
      if (mapRef.current) {
        if (mapRef.current.getLayer('measurement-path-line')) {
          mapRef.current.removeLayer('measurement-path-line');
        }
        if (mapRef.current.getSource('measurement-path-line')) {
          mapRef.current.removeSource('measurement-path-line');
        }
      }
      setMeasurementDistance(null);
    },
    // Offline area selection
    isOfflineSelectionMode,
    startOfflineAreaSelection,
    cancelOfflineAreaSelection,
    finishOfflineAreaSelection,
    completeOfflineAreaSelection,
    offlineSelectionBounds,
    offlineSelectionInvalidDrag,
    // Draw route mode
    isDrawRouteMode,
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
  };
};
