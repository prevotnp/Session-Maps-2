import mapboxgl, { LngLatBounds } from 'mapbox-gl';
import { DroneImage } from '@shared/schema';
import { escapeHtml } from '@/lib/escapeHtml';

// Map style constants
export const MAP_STYLES = {
  SATELLITE: 'mapbox://styles/mapbox/satellite-v9', // Higher resolution satellite without streets
  SATELLITE_STREETS: 'mapbox://styles/mapbox/satellite-streets-v12',
  OUTDOORS: 'mapbox://styles/mapbox/outdoors-v12',
  STREETS: 'mapbox://styles/mapbox/streets-v12',
  DARK: 'mapbox://styles/mapbox/dark-v11',
  LIGHT: 'mapbox://styles/mapbox/light-v11'
};

// High-resolution imagery sources
export const IMAGERY_SOURCES = {
  MAPBOX_SATELLITE: {
    id: 'mapbox-satellite',
    type: 'raster' as const,
    url: 'mapbox://mapbox.satellite',
    tileSize: 512 // Higher resolution tiles
  },
  ESRI_WORLD_IMAGERY: {
    id: 'esri-world-imagery',
    type: 'raster' as const,
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ],
    tileSize: 256,
    attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  }
};

// Teton County GIS service endpoints
export const TETON_COUNTY_GIS = {
  // Teton County WMS base URL
  WMS_BASE_URL: 'https://gis.tetoncountywy.gov/arcgis/services',
  // Common service paths
  AERIAL_IMAGERY: '/Imagery/TetonCounty_Imagery_2023/MapServer/WMSServer',
  PARCELS: '/Administrative/Parcels/MapServer/WMSServer',
  ELEVATION: '/Elevation/Elevation_Contours/MapServer/WMSServer'
};

// Default map settings - centered on Jackson, Wyoming (Teton County)
export const DEFAULT_MAP_SETTINGS = {
  zoom: 11,
  center: [-110.7624, 43.4799] as [number, number], // Jackson, Wyoming coordinates
  pitch: 45,
  bearing: 0
};

// Calculate distance between two points using Haversine formula
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in meters
}

// Format distance for display (in miles)
export function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles < 0.1) {
    const feet = meters * 3.28084;
    return `${Math.round(feet)} ft`;
  } else {
    return `${miles.toFixed(2)} mi`;
  }
}

// Calculate total distance for a series of points
export function calculateTotalDistance(points: [number, number][]): number {
  if (points.length < 2) return 0;
  
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const [lng1, lat1] = points[i - 1];
    const [lng2, lat2] = points[i];
    totalDistance += calculateDistance(lat1, lng1, lat2, lng2);
  }
  return totalDistance;
}

// Calculate distances between consecutive points
export function calculateSegmentDistances(points: [number, number][]): number[] {
  if (points.length < 2) return [];
  
  const distances: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const [lng1, lat1] = points[i - 1];
    const [lng2, lat2] = points[i];
    distances.push(calculateDistance(lat1, lng1, lat2, lng2));
  }
  return distances;
}

// Fetch elevation data from Open-Meteo DEM API (accurate to ~1-5m vs Mapbox contour's ~10m intervals)
export async function getElevation(lng: number, lat: number): Promise<number | null> {
  try {
    const response = await fetch(
      `/api/proxy/elevation?latitude=${lat.toFixed(6)}&longitude=${lng.toFixed(6)}`,
      { credentials: 'include' }
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (data.elevation && data.elevation.length > 0) {
      return data.elevation[0];
    }
    return null;
  } catch (error) {
    console.error('Error fetching elevation:', error);
    return null;
  }
}

// Batch fetch elevations for multiple coordinates (single API call)
export async function getBatchElevations(coordinates: [number, number][]): Promise<number[]> {
  try {
    const response = await fetch('/api/proxy/elevation/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ coordinates }),
    });

    if (!response.ok) return coordinates.map(() => 0);

    const data = await response.json();
    return data.elevation || coordinates.map(() => 0);
  } catch (error) {
    console.error('Error fetching batch elevations:', error);
    return coordinates.map(() => 0);
  }
}

// Calculate elevation change for a series of points
export async function calculateElevationChange(points: [number, number][]): Promise<{
  elevations: (number | null)[];
  totalChange: number | null;
  netChange: number | null;
}> {
  if (points.length < 2) {
    return { elevations: [], totalChange: null, netChange: null };
  }

  // Fetch all elevations in a single batch call
  const rawElevations = await getBatchElevations(points);
  const elevations: (number | null)[] = rawElevations.map(e => e ?? null);

  // Calculate total elevation change (sum of all ups and downs)
  let totalChange = 0;
  let validElevations = 0;

  for (let i = 1; i < elevations.length; i++) {
    const prev = elevations[i - 1];
    const curr = elevations[i];
    if (prev !== null && curr !== null) {
      totalChange += Math.abs(curr - prev);
      validElevations++;
    }
  }

  // Calculate net elevation change (end - start)
  const startElevation = elevations.find(e => e !== null);
  const endElevation = elevations[elevations.length - 1];
  const netChange = (startElevation !== null && endElevation !== null && startElevation !== undefined)
    ? endElevation - startElevation
    : null;

  return {
    elevations,
    totalChange: validElevations > 0 ? totalChange : null,
    netChange
  };
}

// Helper to calculate map bounds for drone imagery
export function calculateDroneImageryBounds(droneImage: DroneImage): LngLatBounds {
  return new mapboxgl.LngLatBounds(
    [parseFloat(droneImage.southWestLng as string), parseFloat(droneImage.southWestLat as string)],
    [parseFloat(droneImage.northEastLng as string), parseFloat(droneImage.northEastLat as string)]
  );
}

// Find the first symbol or circle layer in the map style.
// Used to insert raster layers (like drone imagery) below all text labels,
// POI markers, and the GPS location dot.
export function findFirstSymbolOrCircleLayerId(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle().layers || [];
  for (const layer of layers) {
    if (layer.type === 'symbol' || layer.type === 'circle') {
      return layer.id;
    }
  }
  return undefined;
}

// Add drone imagery to map as a raster image layer
export function addDroneImageryToMap(
  map: mapboxgl.Map, 
  droneImage: DroneImage
): void {
  const sourceId = `drone-imagery-${droneImage.id}`;
  const layerId = `drone-imagery-layer-${droneImage.id}`;
  const outlineSourceId = `drone-imagery-outline-source-${droneImage.id}`;
  const outlineLayerId = `drone-imagery-outline-${droneImage.id}`;
  
  // Check if source and layer already exist and remove them
  if (map.getLayer(outlineLayerId)) {
    map.removeLayer(outlineLayerId);
  }
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(outlineSourceId)) {
    map.removeSource(outlineSourceId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
  
  // Determine coordinates - prefer cornerCoordinates if available (exact GeoTIFF corners)
  let imageCoordinates: [number, number][];
  let outlineCoords: [number, number][];
  
  if (droneImage.cornerCoordinates) {
    // Use exact corner coordinates from GeoTIFF
    // Format: [[lng,lat], [lng,lat], [lng,lat], [lng,lat]] for top-left, top-right, bottom-right, bottom-left
    try {
      const corners = JSON.parse(droneImage.cornerCoordinates as string) as [number, number][];
      imageCoordinates = corners;
      // For outline, close the polygon
      outlineCoords = [...corners, corners[0]];
    } catch (e) {
      console.error('Failed to parse corner coordinates, falling back to bounds');
      // Fall back to bounding box
      const swLng = parseFloat(droneImage.southWestLng as string);
      const swLat = parseFloat(droneImage.southWestLat as string);
      const neLng = parseFloat(droneImage.northEastLng as string);
      const neLat = parseFloat(droneImage.northEastLat as string);
      imageCoordinates = [
        [swLng, neLat], // top-left
        [neLng, neLat], // top-right
        [neLng, swLat], // bottom-right
        [swLng, swLat]  // bottom-left
      ];
      outlineCoords = [
        [swLng, swLat],
        [neLng, swLat],
        [neLng, neLat],
        [swLng, neLat],
        [swLng, swLat]
      ];
    }
  } else {
    // Fall back to bounding box coordinates
    const swLng = parseFloat(droneImage.southWestLng as string);
    const swLat = parseFloat(droneImage.southWestLat as string);
    const neLng = parseFloat(droneImage.northEastLng as string);
    const neLat = parseFloat(droneImage.northEastLat as string);
    imageCoordinates = [
      [swLng, neLat], // top-left
      [neLng, neLat], // top-right
      [neLng, swLat], // bottom-right
      [swLng, swLat]  // bottom-left
    ];
    outlineCoords = [
      [swLng, swLat],
      [neLng, swLat],
      [neLng, neLat],
      [swLng, neLat],
      [swLng, swLat]
    ];
  }
  
  // Add raster image source for the actual drone imagery
  const imageUrl = `/api/drone-images/${droneImage.id}/file`;

  map.addSource(sourceId, {
    type: 'image',
    url: imageUrl,
    coordinates: imageCoordinates as [[number, number], [number, number], [number, number], [number, number]]
  });

  // Insert drone imagery below all symbol/circle layers (labels, POIs, GPS dot)
  const beforeId = findFirstSymbolOrCircleLayerId(map);

  // Add raster layer to display the drone imagery
  map.addLayer({
    id: layerId,
    type: 'raster',
    source: sourceId,
    paint: {
      'raster-opacity': 1,
      'raster-fade-duration': 0
    }
  }, beforeId);

  // Add outline source and layer
  const outlineGeojson = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [outlineCoords]
    },
    properties: {
      name: droneImage.name,
      capturedAt: droneImage.capturedAt
    }
  };
  
  map.addSource(outlineSourceId, {
    type: 'geojson',
    data: outlineGeojson as any
  });
  
  // Add outline layer (also below labels)
  map.addLayer({
    id: outlineLayerId,
    type: 'line',
    source: outlineSourceId,
    layout: {},
    paint: {
      'line-color': '#10B981',
      'line-width': 2,
      'line-dasharray': [2, 1]
    }
  }, beforeId);

  // Fly to the drone imagery area
  const bounds = calculateDroneImageryBounds(droneImage);
  map.fitBounds(bounds, {
    padding: { top: 100, bottom: 100, left: 50, right: 50 },
    duration: 1000
  });
}

// Remove drone imagery from map by ID
export function removeDroneImageryFromMap(map: mapboxgl.Map, droneImageId?: number): void {
  // Get all sources and layers to find drone imagery ones
  const style = map.getStyle();
  if (!style) return;
  
  const layersToRemove: string[] = [];
  const sourcesToRemove: string[] = [];
  
  // Find all drone imagery layers and sources
  if (style.layers) {
    style.layers.forEach(layer => {
      if (layer.id.startsWith('drone-imagery-')) {
        if (droneImageId === undefined || layer.id.includes(`-${droneImageId}`)) {
          layersToRemove.push(layer.id);
        }
      }
    });
  }
  
  if (style.sources) {
    Object.keys(style.sources).forEach(sourceId => {
      if (sourceId.startsWith('drone-imagery-')) {
        if (droneImageId === undefined || sourceId.includes(`-${droneImageId}`)) {
          sourcesToRemove.push(sourceId);
        }
      }
    });
  }
  
  // Remove layers first, then sources
  layersToRemove.forEach(layerId => {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  });
  
  sourcesToRemove.forEach(sourceId => {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  });
  
  // Also remove legacy layer/source names for backward compatibility
  if (map.getLayer('drone-imagery-outline')) {
    map.removeLayer('drone-imagery-outline');
  }
  if (map.getLayer('drone-imagery-fill')) {
    map.removeLayer('drone-imagery-fill');
  }
  if (map.getSource('drone-imagery')) {
    map.removeSource('drone-imagery');
  }
}

// Add green dotted boundaries showing where drone imagery is available
export function addDroneImageryBoundaries(map: mapboxgl.Map, droneImages: DroneImage[]): void {
  const sourceId = 'drone-imagery-boundaries';
  const outlineLayerId = 'drone-imagery-boundaries-outline';
  const labelLayerId = 'drone-imagery-boundaries-labels';
  
  if (droneImages.length === 0) {
    return;
  }
  
  const addLayers = () => {
    try {
      // Remove existing layers and sources if they exist
      if (map.getLayer(labelLayerId)) {
        map.removeLayer(labelLayerId);
      }
      if (map.getLayer(outlineLayerId)) {
        map.removeLayer(outlineLayerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
      
      // Build GeoJSON features for all drone imagery boundaries
      const features: any[] = [];
      
      for (const droneImage of droneImages) {
        let outlineCoords: [number, number][];
        let centerLng: number;
        let centerLat: number;
        
        if (droneImage.cornerCoordinates) {
          try {
            const corners = JSON.parse(droneImage.cornerCoordinates as string) as [number, number][];
            outlineCoords = [...corners, corners[0]]; // Close the polygon
            // Calculate center for label
            centerLng = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
            centerLat = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
          } catch (e) {
            // Fall back to bounding box
            const swLng = parseFloat(droneImage.southWestLng as string);
            const swLat = parseFloat(droneImage.southWestLat as string);
            const neLng = parseFloat(droneImage.northEastLng as string);
            const neLat = parseFloat(droneImage.northEastLat as string);
            outlineCoords = [
              [swLng, swLat],
              [neLng, swLat],
              [neLng, neLat],
              [swLng, neLat],
              [swLng, swLat]
            ];
            centerLng = (swLng + neLng) / 2;
            centerLat = (swLat + neLat) / 2;
          }
        } else {
          const swLng = parseFloat(droneImage.southWestLng as string);
          const swLat = parseFloat(droneImage.southWestLat as string);
          const neLng = parseFloat(droneImage.northEastLng as string);
          const neLat = parseFloat(droneImage.northEastLat as string);
          outlineCoords = [
            [swLng, swLat],
            [neLng, swLat],
            [neLng, neLat],
            [swLng, neLat],
            [swLng, swLat]
          ];
          centerLng = (swLng + neLng) / 2;
          centerLat = (swLat + neLat) / 2;
        }
        
        // Add polygon feature for the boundary
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [outlineCoords]
          },
          properties: {
            id: droneImage.id,
            name: droneImage.name,
            label: 'Drone Imagery Available'
          }
        });
        
        // Add point feature for the label at the top edge
        const topLat = Math.max(...outlineCoords.map(c => c[1]));
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [centerLng, topLat]
          },
          properties: {
            id: droneImage.id,
            label: 'Drone Imagery Available',
            edge: 'top'
          }
        });
      }
      
      // Add the GeoJSON source
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features
        }
      });
      
      // Add green dashed outline layer
      map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'line-color': '#22c55e', // Green color
          'line-width': 2,
          'line-dasharray': [3, 2] // Dashed pattern
        }
      });
      
      // Add label layer with green text along the boundary
      map.addLayer({
        id: labelLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['==', '$type', 'Point'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 12,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.5],
          'text-allow-overlap': false,
          'text-ignore-placement': false
        },
        paint: {
          'text-color': '#22c55e', // Green text
          'text-halo-color': 'rgba(0, 0, 0, 0.8)',
          'text-halo-width': 1.5
        }
      });
    } catch (error) {
      console.error('Error adding drone imagery boundaries:', error);
    }
  };
  
  // Check if style is loaded, if not wait for it
  if (map.isStyleLoaded()) {
    addLayers();
  } else {
    map.once('styledata', addLayers);
  }
}

// Remove drone imagery boundaries from map
export function removeDroneImageryBoundaries(map: mapboxgl.Map): void {
  const sourceId = 'drone-imagery-boundaries';
  const outlineLayerId = 'drone-imagery-boundaries-outline';
  const labelLayerId = 'drone-imagery-boundaries-labels';
  
  if (map.getLayer(labelLayerId)) {
    map.removeLayer(labelLayerId);
  }
  if (map.getLayer(outlineLayerId)) {
    map.removeLayer(outlineLayerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

// Add user location marker to map
export interface UserLocation {
  lng: number;
  lat: number;
  accuracy?: number;
}

// Create a pulsing dot marker for user location
export function createPulsingDot(map: mapboxgl.Map, size: number = 100) {
  // This implementation creates a pulsing dot effect
  const pulsingDot = {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),
    
    // When the layer is added to the map,
    // get the rendering context for the map canvas.
    onAdd: function() {
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      this.context = canvas.getContext('2d');
    },
    
    // Call once before every frame where the icon will be used.
    render: function() {
      const duration = 1500;
      const t = (performance.now() % duration) / duration;
      
      const radius = (size / 2) * 0.3;
      const outerRadius = (size / 2) * 0.7 * t + radius;
      const context = this.context;
      
      // Draw the outer circle.
      context.clearRect(0, 0, this.width, this.height);
      context.beginPath();
      context.arc(
        this.width / 2,
        this.height / 2,
        outerRadius,
        0,
        Math.PI * 2
      );
      context.fillStyle = `rgba(37, 99, 235, ${1 - t})`; // Primary color with fading opacity
      context.fill();
      
      // Draw the inner circle.
      context.beginPath();
      context.arc(
        this.width / 2,
        this.height / 2,
        radius,
        0,
        Math.PI * 2
      );
      context.fillStyle = 'rgba(37, 99, 235, 1)'; // Solid primary color
      context.strokeStyle = 'white';
      context.lineWidth = 2;
      context.fill();
      context.stroke();
      
      // Update this image's data with data from the canvas.
      this.data = context.getImageData(
        0,
        0,
        this.width,
        this.height
      ).data;
      
      // Keep this marker image's data updated.
      map.triggerRepaint();
      
      // Return `true` to let the map know that the image was updated.
      return true;
    }
  } as any;
  
  return pulsingDot;
}

// Add user location marker to map
export function addUserLocationToMap(
  map: mapboxgl.Map, 
  location: UserLocation
): void {
  // Wait for map style to be loaded before adding layers
  if (!map.isStyleLoaded()) {
    map.once('styledata', () => addUserLocationToMap(map, location));
    return;
  }
  
  // Check if source and layer already exist
  if (!map.hasImage('pulsing-dot')) {
    map.addImage('pulsing-dot', createPulsingDot(map), { pixelRatio: 2 });
  }
  
  if (map.getSource('user-location')) {
    // Update existing source
    (map.getSource('user-location') as mapboxgl.GeoJSONSource).setData({
      type: 'Point',
      coordinates: [location.lng, location.lat]
    } as any);
  } else {
    // Add new source and layer
    map.addSource('user-location', {
      type: 'geojson',
      data: {
        type: 'Point',
        coordinates: [location.lng, location.lat]
      } as any
    });
    
    // Add the location dot layer - it will appear on top of most other layers
    map.addLayer({
      id: 'user-location',
      type: 'symbol',
      source: 'user-location',
      layout: {
        'icon-image': 'pulsing-dot',
        'icon-size': 1,
        'icon-allow-overlap': true, // Ensure it's visible even if other symbols overlap
        'icon-ignore-placement': true // Don't hide it based on other symbols
      }
    });
  }
  
  // If accuracy is provided, add or update accuracy circle
  if (location.accuracy) {
    const accuracyRadiusKm = location.accuracy / 1000;
    
    if (map.getSource('location-accuracy')) {
      // Update existing accuracy circle
      (map.getSource('location-accuracy') as mapboxgl.GeoJSONSource).setData({
        type: 'Point',
        coordinates: [location.lng, location.lat]
      } as any);
    } else {
      // Add accuracy circle
      map.addSource('location-accuracy', {
        type: 'geojson',
        data: {
          type: 'Point',
          coordinates: [location.lng, location.lat]
        } as any
      });
      
      map.addLayer({
        id: 'location-accuracy',
        type: 'circle',
        source: 'location-accuracy',
        paint: {
          'circle-radius': {
            stops: [
              [0, 0],
              [20, mapboxgl.MercatorCoordinate.fromLngLat({ lng: location.lng, lat: location.lat }, accuracyRadiusKm).x]
            ],
            base: 2
          },
          'circle-color': 'rgba(37, 99, 235, 0.2)', // Primary color with low opacity
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(37, 99, 235, 0.5)'
        }
      }, 'user-location');
    }
  }
}

// Add a location marker with label
export function addLocationMarker(
  map: mapboxgl.Map,
  lng: number,
  lat: number,
  name: string,
  id: string
): mapboxgl.Marker {
  // Create a marker element
  const el = document.createElement('div');
  el.className = 'marker';
  el.style.backgroundImage = 'url(https://docs.mapbox.com/mapbox-gl-js/assets/pin.svg)';
  el.style.width = '30px';
  el.style.height = '40px';
  el.style.backgroundSize = '100%';
  
  // Create popup with location name
  const popup = new mapboxgl.Popup({ offset: 25 })
    .setHTML(`<h3>${escapeHtml(name)}</h3>`);
  
  // Add marker to map
  const marker = new mapboxgl.Marker(el)
    .setLngLat([lng, lat])
    .setPopup(popup)
    .addTo(map);
  
  // Store the marker id on the element for later reference
  (marker as any).id = id;
  
  return marker;
}



// Calculate area of a polygonal region (in square meters)
export function calculateArea(coordinates: [number, number][]): number {
  if (coordinates.length < 3) {
    return 0;
  }
  
  let area = 0;
  for (let i = 0; i < coordinates.length; i++) {
    const j = (i + 1) % coordinates.length;
    area += coordinates[i][0] * coordinates[j][1];
    area -= coordinates[j][0] * coordinates[i][1];
  }
  
  // Convert to square kilometers
  area = Math.abs(area) / 2;
  
  // Convert to actual area using an approximation
  // This is a simplified calculation and may not be accurate for large areas
  const lat = coordinates.reduce((sum, coord) => sum + coord[1], 0) / coordinates.length;
  const correctionFactor = Math.cos(lat * Math.PI / 180);
  
  // 111.32 is approximately the number of kilometers per degree of latitude
  // The correction factor adjusts for the fact that longitudes get closer together as you move away from the equator
  return area * Math.pow(111.32 * correctionFactor, 2);
}

// Add Teton County GIS satellite imagery as WMS layer
export function addTetonCountyImagery(map: mapboxgl.Map): void {
  const wmsUrl = `${TETON_COUNTY_GIS.WMS_BASE_URL}${TETON_COUNTY_GIS.AERIAL_IMAGERY}`;
  
  // Remove existing Teton County imagery if present
  if (map.getLayer('teton-county-imagery')) {
    map.removeLayer('teton-county-imagery');
  }
  if (map.getSource('teton-county-imagery')) {
    map.removeSource('teton-county-imagery');
  }

  // Add Teton County imagery as a raster source
  map.addSource('teton-county-imagery', {
    type: 'raster',
    tiles: [
      `${wmsUrl}?` +
      'SERVICE=WMS&' +
      'VERSION=1.3.0&' +
      'REQUEST=GetMap&' +
      'FORMAT=image/png&' +
      'TRANSPARENT=false&' +
      'LAYERS=0&' +
      'CRS=EPSG:3857&' +
      'STYLES=&' +
      'WIDTH=256&' +
      'HEIGHT=256&' +
      'BBOX={bbox-epsg-3857}'
    ],
    tileSize: 256
  });

  // Add the layer on top of the base map
  map.addLayer({
    id: 'teton-county-imagery',
    type: 'raster',
    source: 'teton-county-imagery',
    paint: {
      'raster-opacity': 0.85
    }
  });
}

// Add Teton County property lines
export function addTetonCountyParcels(map: mapboxgl.Map): void {
  const parcelsUrl = `${TETON_COUNTY_GIS.WMS_BASE_URL}${TETON_COUNTY_GIS.PARCELS}`;
  
  // Remove existing parcels if present
  if (map.getLayer('teton-county-parcels')) {
    map.removeLayer('teton-county-parcels');
  }
  if (map.getSource('teton-county-parcels')) {
    map.removeSource('teton-county-parcels');
  }

  // Add Teton County parcels as a raster source
  map.addSource('teton-county-parcels', {
    type: 'raster',
    tiles: [
      `${parcelsUrl}?` +
      'SERVICE=WMS&' +
      'VERSION=1.3.0&' +
      'REQUEST=GetMap&' +
      'FORMAT=image/png&' +
      'TRANSPARENT=true&' +
      'LAYERS=0&' +
      'CRS=EPSG:3857&' +
      'STYLES=&' +
      'WIDTH=256&' +
      'HEIGHT=256&' +
      'BBOX={bbox-epsg-3857}'
    ],
    tileSize: 256
  });

  // Add the parcels layer on top
  map.addLayer({
    id: 'teton-county-parcels',
    type: 'raster',
    source: 'teton-county-parcels',
    paint: {
      'raster-opacity': 0.7
    }
  });
}

// Remove Teton County property lines
export function removeTetonCountyParcels(map: mapboxgl.Map): void {
  if (map.getLayer('teton-county-parcels')) {
    map.removeLayer('teton-county-parcels');
  }
  if (map.getSource('teton-county-parcels')) {
    map.removeSource('teton-county-parcels');
  }
}

// Remove Teton County imagery layer
export function removeTetonCountyImagery(map: mapboxgl.Map): void {
  if (map.getLayer('teton-county-imagery')) {
    map.removeLayer('teton-county-imagery');
  }
  if (map.getSource('teton-county-imagery')) {
    map.removeSource('teton-county-imagery');
  }
}

// Switch to Teton County focused view
export function switchToTetonCountyView(map: mapboxgl.Map): void {
  map.flyTo({
    center: DEFAULT_MAP_SETTINGS.center,
    zoom: DEFAULT_MAP_SETTINGS.zoom,
    pitch: DEFAULT_MAP_SETTINGS.pitch,
    bearing: DEFAULT_MAP_SETTINGS.bearing,
    duration: 2000
  });
}

// Add Esri World Imagery as high-resolution satellite layer
export function addEsriWorldImagery(map: mapboxgl.Map): void {
  // Remove existing Esri imagery if present
  if (map.getLayer('esri-world-imagery')) {
    map.removeLayer('esri-world-imagery');
  }
  if (map.getSource('esri-world-imagery')) {
    map.removeSource('esri-world-imagery');
  }

  // Add Esri World Imagery source
  map.addSource('esri-world-imagery', {
    type: 'raster',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ],
    tileSize: 256,
    attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  });

  const layers = map.getStyle().layers || [];
  let firstVectorLayerId: string | undefined;
  for (const layer of layers) {
    if (layer.type !== 'background' && layer.type !== 'raster' && layer.type !== 'hillshade') {
      firstVectorLayerId = layer.id;
      break;
    }
  }

  map.addLayer({
    id: 'esri-world-imagery',
    type: 'raster',
    source: 'esri-world-imagery',
    paint: {
      'raster-opacity': 1.0
    }
  }, firstVectorLayerId);
}

// Remove Esri World Imagery layer
export function removeEsriWorldImagery(map: mapboxgl.Map): void {
  if (map.getLayer('esri-world-imagery')) {
    map.removeLayer('esri-world-imagery');
  }
  if (map.getSource('esri-world-imagery')) {
    map.removeSource('esri-world-imagery');
  }
}

// Switch map to use enhanced Mapbox satellite with street labels
export function switchToEnhancedMapboxSatellite(map: mapboxgl.Map): void {
  map.setStyle(MAP_STYLES.SATELLITE_STREETS);
  
  // Wait for style to load before adding trail overlays
  map.once('styledata', () => {
    addBaseTrailLinesAndLabels(map);
  });
}

// Switch map to use Esri World Imagery with street labels
export function switchToEsriImagery(map: mapboxgl.Map): void {
  // Start with satellite-streets style as base, then add Esri imagery on top
  map.setStyle(MAP_STYLES.SATELLITE_STREETS);
  
  // Wait for style to load before adding layers
  map.once('styledata', () => {
    addEsriWorldImagery(map);
    addBaseTrailLinesAndLabels(map);
  });
}

export type TrailOverlayType = 'hiking' | 'cycling' | 'mtb' | 'skating' | 'riding' | 'skiing';

export const TRAIL_OVERLAY_CONFIG: Record<TrailOverlayType, {
  label: string;
  tileUrl: string;
  color: string;
  icon: string;
}> = {
  hiking: {
    label: 'Hiking',
    tileUrl: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    color: '#e74c3c',
    icon: 'footprints',
  },
  cycling: {
    label: 'Cycling',
    tileUrl: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
    color: '#3498db',
    icon: 'bike',
  },
  mtb: {
    label: 'Mountain Biking',
    tileUrl: 'https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png',
    color: '#e67e22',
    icon: 'mountain',
  },
  skating: {
    label: 'Skating',
    tileUrl: 'https://tile.waymarkedtrails.org/skating/{z}/{x}/{y}.png',
    color: '#9b59b6',
    icon: 'circle-dot',
  },
  riding: {
    label: 'Horse Riding',
    tileUrl: 'https://tile.waymarkedtrails.org/riding/{z}/{x}/{y}.png',
    color: '#8B4513',
    icon: 'horse',
  },
  skiing: {
    label: 'Skiing',
    tileUrl: 'https://tile.waymarkedtrails.org/slopes/{z}/{x}/{y}.png',
    color: '#1abc9c',
    icon: 'snowflake',
  },
};

export type TrailGroupType = 'hiking' | 'biking' | 'winter';

export interface TrailGroupConfig {
  label: string;
  color: string;
  icon: string;
  members: TrailOverlayType[];
}

export const TRAIL_GROUP_CONFIG: Record<TrailGroupType, TrailGroupConfig> = {
  hiking: {
    label: 'Hiking Trails',
    color: '#e74c3c',
    icon: 'footprints',
    members: ['hiking', 'riding'],
  },
  biking: {
    label: 'Bike Trails',
    color: '#3498db',
    icon: 'bike',
    members: ['cycling', 'mtb'],
  },
  winter: {
    label: 'Ski & Skate Trails',
    color: '#1abc9c',
    icon: 'snowflake',
    members: ['skiing', 'skating'],
  },
};

export function addTrailGroup(map: mapboxgl.Map, group: TrailGroupType): void {
  const config = TRAIL_GROUP_CONFIG[group];
  config.members.forEach(type => addTrailOverlay(map, type));
}

export function removeTrailGroup(map: mapboxgl.Map, group: TrailGroupType): void {
  const config = TRAIL_GROUP_CONFIG[group];
  config.members.forEach(type => removeTrailOverlay(map, type));
}

export function isTrailGroupActive(activeOverlays: Set<TrailOverlayType>, group: TrailGroupType): boolean {
  return TRAIL_GROUP_CONFIG[group].members.some(type => activeOverlays.has(type));
}

export function addTrailOverlay(map: mapboxgl.Map, type: TrailOverlayType): void {
  const config = TRAIL_OVERLAY_CONFIG[type];
  const sourceId = `waymarked-trails-${type}`;
  const layerId = `waymarked-trails-${type}-overlay`;

  const addLayer = () => {
    try {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [config.tileUrl],
          tileSize: 256,
          attribution: '© <a href="https://waymarkedtrails.org" target="_blank">Waymarked Trails</a> (CC-BY-SA)',
          maxzoom: 18,
        });
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': 0.65,
          },
          minzoom: 8,
        });
      }
    } catch (error) {
      console.error(`Trail overlay error (${type}):`, error);
    }
  };

  if (map.isStyleLoaded()) {
    addLayer();
  } else {
    map.once('load', addLayer);
  }
}

export function removeTrailOverlay(map: mapboxgl.Map, type: TrailOverlayType): void {
  const sourceId = `waymarked-trails-${type}`;
  const layerId = `waymarked-trails-${type}-overlay`;

  try {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  } catch (error) {
    console.error(`Error removing trail overlay (${type}):`, error);
  }
}

export function addBaseTrailLinesAndLabels(map: mapboxgl.Map): void {
  const addLayers = () => {
    try {
      if (!map.getSource('streets-labels')) {
        map.addSource('streets-labels', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-streets-v8'
        });
      }

      if (!map.getLayer('satellite-trails')) {
        map.addLayer({
          id: 'satellite-trails',
          type: 'line',
          source: 'streets-labels',
          'source-layer': 'road',
          filter: ['all',
            ['in', 'class', 'path', 'track', 'pedestrian'],
            ['!=', 'type', 'corridor']
          ],
          paint: {
            'line-color': '#D2691E',
            'line-width': { base: 1.5, stops: [[8, 0.8], [12, 2], [16, 3], [20, 4]] },
            'line-dasharray': [2, 1],
            'line-opacity': { stops: [[8, 0.5], [10, 0.7], [14, 0.85]] }
          },
          minzoom: 8
        });
      }

      if (!map.getLayer('satellite-trail-labels')) {
        map.addLayer({
          id: 'satellite-trail-labels',
          type: 'symbol',
          source: 'streets-labels',
          'source-layer': 'road',
          filter: ['all',
            ['in', 'class', 'path', 'track', 'pedestrian'],
            ['!=', 'type', 'corridor'],
            ['has', 'name']
          ],
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': { base: 1, stops: [[9, 10], [13, 12], [16, 14], [20, 16]] },
            'symbol-placement': 'line',
            'text-rotation-alignment': 'map',
            'text-max-angle': 30
          },
          paint: {
            'text-color': '#FFFFFF',
            'text-halo-color': '#5D4037',
            'text-halo-width': 2,
            'text-opacity': { stops: [[9, 0.7], [12, 1.0]] }
          },
          minzoom: 9
        });
      }

      if (!map.getLayer('water-labels')) {
        map.addLayer({
          id: 'water-labels',
          type: 'symbol',
          source: 'streets-labels',
          'source-layer': 'natural_label',
          filter: ['in', ['get', 'class'], ['literal', ['sea', 'ocean', 'bay', 'lake', 'reservoir', 'river', 'stream', 'canal', 'water']]],
          minzoom: 8,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Open Sans Italic', 'Arial Unicode MS Regular'],
            'text-size': { base: 1, stops: [[8, 10], [12, 12], [16, 14]] },
            'text-letter-spacing': 0.1,
            'text-max-width': 8
          },
          paint: {
            'text-color': '#4FC3F7',
            'text-halo-color': '#000000',
            'text-halo-width': 1.5,
            'text-opacity': 0.9
          }
        });
      }

      if (!map.getLayer('peak-labels')) {
        map.addLayer({
          id: 'peak-labels',
          type: 'symbol',
          source: 'streets-labels',
          'source-layer': 'natural_label',
          filter: ['==', ['get', 'maki'], 'mountain'],
          minzoom: 8,
          layout: {
            'text-field': [
              'case',
              ['has', 'elevation_m'],
              ['concat', '▲ ', ['get', 'name'], '\n', ['number-format', ['round', ['*', ['get', 'elevation_m'], 3.28084]], { 'locale': 'en-US', 'max-fraction-digits': 0 }], ' ft'],
              ['concat', '▲ ', ['get', 'name']]
            ],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': { base: 1, stops: [[8, 11], [12, 13], [16, 15]] },
            'text-anchor': 'top',
            'text-offset': [0, 0.3],
            'text-max-width': 10,
            'text-allow-overlap': false,
            'icon-allow-overlap': false
          },
          paint: {
            'text-color': '#FFD700',
            'text-halo-color': 'rgba(0, 0, 0, 0.85)',
            'text-halo-width': 2,
            'text-opacity': { stops: [[8, 0.7], [10, 0.9], [12, 1.0]] }
          }
        });
      }
    } catch (error) {
      console.error('Base trail lines error:', error);
    }
  };

  if (map.isStyleLoaded()) {
    addLayers();
  } else {
    map.once('load', addLayers);
  }
}

// Add topographic contour lines overlay
export function addTopoContourLines(map: mapboxgl.Map): { cleanup?: () => void } {
  const addLayers = () => {
    if (map.getLayer('contour-lines')) {
      return;
    }

    try {
      if (!map.getSource('mapbox-terrain')) {
        map.addSource('mapbox-terrain', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-terrain-v2'
        });
      }

      map.addLayer({
        id: 'contour-lines',
        type: 'line',
        source: 'mapbox-terrain',
        'source-layer': 'contour',
        minzoom: 9,
        paint: {
          'line-color': '#D4943C',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            9, 0.5,
            12, 0.8,
            14, 1.2,
            16, 1.8,
            18, 2.5
          ],
          'line-opacity': 0.85
        }
      });

      map.addLayer({
        id: 'contour-labels',
        type: 'symbol',
        source: 'mapbox-terrain',
        'source-layer': 'contour',
        minzoom: 11,
        filter: ['==', ['get', 'index'], 5],
        layout: {
          'text-field': ['concat', ['round', ['*', ['get', 'ele'], 3.28084]], ' ft'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 14, 11, 16, 13],
          'symbol-placement': 'line',
          'text-rotation-alignment': 'map'
        },
        paint: {
          'text-color': '#D4943C',
          'text-halo-color': 'rgba(0, 0, 0, 0.7)',
          'text-halo-width': 1.5,
          'text-opacity': 0.9
        }
      });
    } catch (error) {
      console.error('Failed to add topographic contour lines:', error);
    }
  };

  if (map.isStyleLoaded()) {
    addLayers();
    return {};
  } else {
    const wrapper = () => {
      map.off('style.load', wrapper);
      map.off('idle', idleWrapper);
      addLayers();
    };
    const idleWrapper = () => {
      map.off('style.load', wrapper);
      map.off('idle', idleWrapper);
      addLayers();
    };

    map.on('style.load', wrapper);
    map.on('idle', idleWrapper);

    return {
      cleanup: () => {
        map.off('style.load', wrapper);
        map.off('idle', idleWrapper);
      }
    };
  }
}

// Remove topographic contour lines overlay
export function removeTopoContourLines(map: mapboxgl.Map): void {
  try {
    // Check if style is loaded before trying to remove layers
    if (!map.isStyleLoaded()) {
      return;
    }
    
    if (map.getLayer('contour-lines')) {
      map.removeLayer('contour-lines');
    }
    if (map.getLayer('contour-labels')) {
      map.removeLayer('contour-labels');
    }
    if (map.getSource('mapbox-terrain')) {
      map.removeSource('mapbox-terrain');
    }
  } catch (error) {
    console.error('Error removing topographic layers:', error);
  }
}
