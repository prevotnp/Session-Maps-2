import { useEffect, useRef, useState, useCallback } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Ruler,
  MapPin,
  Navigation,
  Minus,
  Plus,
  RotateCcw,
  Compass,
  Layers,
  X,
  Maximize,
  Route as RouteIcon,
  List,
  Mountain,
  Loader2,
  Home,
} from 'lucide-react';
import CesiumRouteBuilder from '@/components/CesiumRouteBuilder';

import CesiumRouteSummaryPanel from '@/components/CesiumRouteSummaryPanel';
import type { Route } from '@shared/schema';

interface Cesium3dTileset {
  id: number;
  droneImageId: number | null;
  name: string;
  storagePath: string;
  tilesetJsonUrl: string;
  sizeInMB: number;
  centerLat: string;
  centerLng: string;
  centerAlt: string | null;
  boundingVolume: string | null;
  uploadedAt: string;
  userId: number;
}

const MIN_CAMERA_HEIGHT = 2;
const MAX_CAMERA_HEIGHT = 5000;

let Cesium: any = null;

async function loadCesium(): Promise<any> {
  if (Cesium) return Cesium;

  return new Promise((resolve, reject) => {
    if ((window as any).Cesium) {
      Cesium = (window as any).Cesium;
      resolve(Cesium);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.121/Build/Cesium/Widgets/widgets.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.121/Build/Cesium/Cesium.js';
    script.onload = () => {
      Cesium = (window as any).Cesium;
      resolve(Cesium);
    };
    script.onerror = () => reject(new Error('Failed to load CesiumJS'));
    document.head.appendChild(script);
  });
}

function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet >= 5280) {
    return `${(feet / 5280).toFixed(2)} mi`;
  }
  return `${Math.round(feet)} ft`;
}

export default function CesiumViewer() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/cesium/:id");
  const { user } = useAuth();

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const tilesetRef = useRef<any>(null);
  const gpsEntityRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);
  const measurePointsRef = useRef<any[]>([]);
  const measureEntitiesRef = useRef<any[]>([]);
  const overlayLabelsRef = useRef<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsPosition, setGpsPosition] = useState<{ lat: number; lng: number; alt: number | null } | null>(null);
  const [mapOverlayActive, setMapOverlayActive] = useState(false);
  const [mapOverlayLoading, setMapOverlayLoading] = useState(false);

  const [isRouteBuilderOpen, setIsRouteBuilderOpen] = useState(false);
  const [showControlHints, setShowControlHints] = useState(true);
  const [isRoutesListOpen, setIsRoutesListOpen] = useState(false);
  const [viewingRoute, setViewingRoute] = useState<Route | null>(null);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);


  const tilesetId = params?.id ? parseInt(params.id) : null;

  const urlSearchParams = new URLSearchParams(window.location.search);
  const routeIdFromUrl = urlSearchParams.get('routeId');

  const { data: tileset, isLoading: isFetching } = useQuery<Cesium3dTileset>({
    queryKey: ['/api/cesium-tilesets', tilesetId],
    queryFn: async () => {
      const res = await fetch(`/api/cesium-tilesets/${tilesetId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load 3D map');
      return res.json();
    },
    enabled: !!tilesetId
  });

  const { data: tilesetRoutes = [] } = useQuery<Route[]>({
    queryKey: ['/api/routes'],
    enabled: !!tilesetId && !!user,
  });

  const routesForThisTileset = tilesetRoutes.filter(
    (r: any) => r.cesiumTilesetId === tilesetId
  );

  useEffect(() => {
    if (routeIdFromUrl && tilesetRoutes.length > 0 && !viewingRoute && !isLoading) {
      const routeToView = tilesetRoutes.find((r: Route) => r.id === parseInt(routeIdFromUrl));
      if (routeToView) {
        setViewingRoute(routeToView);
      }
    }
  }, [routeIdFromUrl, tilesetRoutes, viewingRoute, isLoading]);

  useEffect(() => {
    if (!containerRef.current || !tileset) return;

    let viewer: any = null;

    const initCesium = async () => {
      try {
        const C = await loadCesium();

        C.Ion.defaultAccessToken = undefined;

        viewer = new C.Viewer(containerRef.current, {
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          animation: false,
          fullscreenButton: false,
          vrButton: false,
          navigationHelpButton: false,
          infoBox: false,
          creditContainer: document.createElement('div'),
          imageryProvider: false,
          terrainProvider: new C.EllipsoidTerrainProvider(),
          skyBox: false,
          skyAtmosphere: false,
          contextOptions: {
            webgl: {
              alpha: true,
            },
          },
        });

        viewer.scene.backgroundColor = C.Color.fromCssColorString('#1a1a2e');
        viewer.scene.globe.show = false;
        if (viewer.scene.sun) viewer.scene.sun.show = false;
        if (viewer.scene.moon) viewer.scene.moon.show = false;
        if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
        viewerRef.current = viewer;

        const tilesetUrl = tileset.tilesetJsonUrl;
        const loadedTileset = await C.Cesium3DTileset.fromUrl(tilesetUrl, {
          maximumScreenSpaceError: 16,
          maximumMemoryUsage: 512,
        });

        viewer.scene.primitives.add(loadedTileset);
        tilesetRef.current = loadedTileset;

        setTilesLoading(true);
        loadedTileset.allTilesLoaded.addEventListener(() => {
          setTilesLoading(false);
        });
        loadedTileset.loadProgress.addEventListener((numberOfPendingRequests: number, numberOfTilesProcessing: number) => {
          if (numberOfPendingRequests > 0 || numberOfTilesProcessing > 0) {
            setTilesLoading(true);
          }
        });

        await viewer.zoomTo(loadedTileset);

        const boundingSphere = loadedTileset.boundingSphere;
        const tilesetCenter = boundingSphere.center;

        const initialCameraState = {
          position: viewer.camera.position.clone(),
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll,
        };
        (viewerRef as any).__initialCameraState = initialCameraState;
        (viewerRef as any).__tilesetCenter = tilesetCenter.clone();
        (viewerRef as any).__tilesetRadius = boundingSphere.radius;

        const controller = viewer.scene.screenSpaceCameraController;
        controller.minimumZoomDistance = Math.max(2.0, boundingSphere.radius * 0.1);
        controller.maximumZoomDistance = boundingSphere.radius * 6;
        controller.enableLook = false;

        viewer.scene.requestRender();

        setIsLoading(false);
      } catch (err: any) {
        console.error('Cesium initialization error:', err);
        setError(err.message || 'Failed to initialize 3D viewer');
        setIsLoading(false);
      }
    };

    initCesium();

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
      viewerRef.current = null;
      tilesetRef.current = null;
    };
  }, [tileset]);

  useEffect(() => {
    if (showControlHints) {
      const timer = setTimeout(() => setShowControlHints(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [showControlHints]);

  const handleMeasureClick = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium) return;

    if (isMeasuring) {
      measureEntitiesRef.current.forEach(entity => viewer.entities.remove(entity));
      measureEntitiesRef.current = [];
      measurePointsRef.current = [];
      setMeasureDistance(null);
      setIsMeasuring(false);
      return;
    }

    setIsMeasuring(true);
    measurePointsRef.current = [];
    measureEntitiesRef.current = [];
    setMeasureDistance(null);
  }, [isMeasuring]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !Cesium || !isMeasuring) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((click: any) => {
      const ray = viewer.camera.getPickRay(click.position);
      if (!ray) return;

      let position: any;
      const pickedObject = viewer.scene.pick(click.position);
      if (pickedObject && Cesium.defined(pickedObject)) {
        position = viewer.scene.pickPosition(click.position);
      } else {
        position = viewer.scene.globe.pick(ray, viewer.scene);
      }

      if (!position) return;

      measurePointsRef.current.push(position);

      const pointEntity = viewer.entities.add({
        position: position,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString('#FF6B35'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.NONE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: String(measurePointsRef.current.length),
          font: '14px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }
      });
      measureEntitiesRef.current.push(pointEntity);

      if (measurePointsRef.current.length >= 2) {
        const points = measurePointsRef.current;
        const lastTwo = [points[points.length - 2], points[points.length - 1]];

        const lineEntity = viewer.entities.add({
          polyline: {
            positions: lastTwo,
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#FF6B35'),
              dashLength: 16,
            }),
            clampToGround: false,
            depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#FF6B35').withAlpha(0.5),
              dashLength: 16,
            }),
          }
        });
        measureEntitiesRef.current.push(lineEntity);

        let totalDist = 0;
        for (let i = 1; i < points.length; i++) {
          totalDist += Cesium.Cartesian3.distance(points[i - 1], points[i]);
        }
        setMeasureDistance(totalDist);
      }

      viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
    };
  }, [isMeasuring]);

  const toggleGps = useCallback(() => {
    if (gpsActive) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (viewerRef.current && gpsEntityRef.current) {
        viewerRef.current.entities.remove(gpsEntityRef.current);
        gpsEntityRef.current = null;
      }
      setGpsActive(false);
      setGpsPosition(null);
      return;
    }

    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      return;
    }

    setGpsActive(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, altitude } = position.coords;
        setGpsPosition({ lat: latitude, lng: longitude, alt: altitude });

        if (!viewerRef.current || !Cesium) return;

        const cartesian = Cesium.Cartesian3.fromDegrees(
          longitude,
          latitude,
          (altitude || 0) + 2
        );

        if (gpsEntityRef.current) {
          gpsEntityRef.current.position = cartesian;
        } else {
          gpsEntityRef.current = viewerRef.current.entities.add({
            position: cartesian,
            point: {
              pixelSize: 16,
              color: Cesium.Color.fromCssColorString('#3b82f6'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 3,
              heightReference: Cesium.HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: 'You',
              font: 'bold 12px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString('#3b82f6'),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -20),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          });
        }

        viewerRef.current.scene.requestRender();
      },
      (err) => {
        console.error('GPS error:', err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, [gpsActive]);

  const flyToGps = useCallback(() => {
    if (!gpsPosition || !viewerRef.current || !Cesium) return;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        gpsPosition.lng,
        gpsPosition.lat,
        (gpsPosition.alt || 0) + 200
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
      duration: 1.5,
    });
  }, [gpsPosition]);

  const recenterView = useCallback(() => {
    if (!viewerRef.current || !tilesetRef.current) return;
    viewerRef.current.zoomTo(tilesetRef.current);
  }, []);

  const zoomIn = useCallback(() => {
    if (!viewerRef.current) return;
    viewerRef.current.camera.zoomIn(viewerRef.current.camera.positionCartographic.height * 0.25);
    viewerRef.current.scene.requestRender();
  }, []);

  const zoomOut = useCallback(() => {
    if (!viewerRef.current) return;
    viewerRef.current.camera.zoomOut(viewerRef.current.camera.positionCartographic.height * 0.25);
    viewerRef.current.scene.requestRender();
  }, []);

  const lookNorth = useCallback(() => {
    if (!viewerRef.current || !Cesium) return;
    const camera = viewerRef.current.camera;
    camera.setView({
      orientation: {
        heading: 0,
        pitch: camera.pitch,
        roll: 0,
      },
    });
    viewerRef.current.scene.requestRender();
  }, []);

  const toggleMapOverlay = useCallback(async () => {
    if (!viewerRef.current || !tilesetRef.current || mapOverlayLoading) return;
    const viewer = viewerRef.current;
    const C = await loadCesium();
    const newState = !mapOverlayActive;
    setMapOverlayActive(newState);
    if (newState) setMapOverlayLoading(true);

    if (newState) {
      const boundingSphere = tilesetRef.current.boundingSphere;
      const center = C.Cartographic.fromCartesian(boundingSphere.center);
      const lat = C.Math.toDegrees(center.latitude);
      const lon = C.Math.toDegrees(center.longitude);
      const radiusKm = (boundingSphere.radius / 1000) + 1.6;
      const degSpread = radiusKm / 111;
      const south = lat - degSpread;
      const north = lat + degSpread;
      const west = lon - degSpread;
      const east = lon + degSpread;

      console.log('[MapOverlay] Tileset center:', { lat, lon });
      console.log('[MapOverlay] Bounding radius:', boundingSphere.radius, 'meters');
      console.log('[MapOverlay] Query bbox:', { south, west, north, east });

      const MISSING_HEIGHT = -999999;

      const sampleTilesetHeight = async (coords: Array<{lat: number; lon: number}>): Promise<Map<string, number>> => {
        const heightMap = new Map<string, number>();
        const cartographics = coords.map(c => C.Cartographic.fromDegrees(c.lon, c.lat));

        try {
          if (typeof C.sampleHeightMostDetailed === 'function') {
            const updatedPositions = await C.sampleHeightMostDetailed(viewer.scene, cartographics);
            updatedPositions.forEach((carto: any, i: number) => {
              const key = `${coords[i].lat.toFixed(5)},${coords[i].lon.toFixed(5)}`;
              if (carto.height !== undefined && carto.height !== 0) {
                heightMap.set(key, carto.height);
              } else {
                heightMap.set(key, MISSING_HEIGHT);
              }
            });
          } else {
            cartographics.forEach((carto: any, i: number) => {
              const key = `${coords[i].lat.toFixed(5)},${coords[i].lon.toFixed(5)}`;
              const h = viewer.scene.sampleHeight(carto);
              if (h !== undefined && h !== 0) {
                heightMap.set(key, h);
              } else {
                heightMap.set(key, MISSING_HEIGHT);
              }
            });
          }
        } catch (e) {
          console.warn('[MapOverlay] sampleHeightMostDetailed failed, using fallback:', e);
          coords.forEach(c => {
            const key = `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
            heightMap.set(key, MISSING_HEIGHT);
          });
        }

        return heightMap;
      };

      const interpolateGaps = (coords: Array<{lat: number; lon: number}>, heightMap: Map<string, number>) => {
        const keys = coords.map(c => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`);
        const heights = keys.map(k => heightMap.get(k) ?? MISSING_HEIGHT);

        for (let i = 0; i < heights.length; i++) {
          if (heights[i] !== MISSING_HEIGHT) continue;
          let prevIdx = -1;
          for (let p = i - 1; p >= 0; p--) {
            if (heights[p] !== MISSING_HEIGHT) { prevIdx = p; break; }
          }
          let nextIdx = -1;
          for (let n = i + 1; n < heights.length; n++) {
            if (heights[n] !== MISSING_HEIGHT) { nextIdx = n; break; }
          }

          if (prevIdx >= 0 && nextIdx >= 0) {
            const t = (i - prevIdx) / (nextIdx - prevIdx);
            heights[i] = heights[prevIdx] + t * (heights[nextIdx] - heights[prevIdx]);
          } else if (prevIdx >= 0) {
            heights[i] = heights[prevIdx];
          } else if (nextIdx >= 0) {
            heights[i] = heights[nextIdx];
          } else {
            heights[i] = center.height;
          }
          heightMap.set(keys[i], heights[i]);
        }
      };

      const query = `
        [out:json][timeout:45];
        (
          way["highway"~"path|track|footway|cycleway|trail"]["name"](${south},${west},${north},${east});
          way["highway"~"primary|secondary|tertiary|residential|unclassified"]["name"](${south},${west},${north},${east});
          way["piste:type"]["name"](${south},${west},${north},${east});
          node["natural"="peak"]["name"](${south},${west},${north},${east});
          node["natural"="saddle"]["name"](${south},${west},${north},${east});
          node["tourism"~"viewpoint|alpine_hut"]["name"](${south},${west},${north},${east});
          way["waterway"]["name"](${south},${west},${north},${east});
          node["place"~"locality|hamlet"]["name"](${south},${west},${north},${east});
        );
        out body;
        >;
        out skel qt;
      `;

      try {
        const response = await fetch('/api/proxy/overpass', {
          method: 'POST',
          body: JSON.stringify({ query }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
          console.error('[MapOverlay] Overpass proxy returned', response.status);
          return;
        }
        const data = await response.json();
        if (!data.elements) {
          console.error('[MapOverlay] No elements in Overpass response');
          return;
        }

        console.log('[MapOverlay] Overpass response elements:', data.elements.length);

        const nodesMap = new Map<number, { lat: number; lon: number }>();
        data.elements.forEach((el: any) => {
          if (el.type === 'node') {
            nodesMap.set(el.id, { lat: el.lat, lon: el.lon });
          }
        });

        const labeledFeatures: Array<{ name: string; lat: number; lon: number; type: string; ele?: string }> = [];
        const trailPaths: Array<{ name: string; coords: Array<{ lat: number; lon: number }>; type: string }> = [];
        const seenNames = new Set<string>();

        data.elements.forEach((el: any) => {
          if (!el.tags?.name) return;
          const nameKey = el.tags.name;

          if (el.type === 'node') {
            if (seenNames.has(nameKey)) return;
            seenNames.add(nameKey);
            labeledFeatures.push({
              name: el.tags.name,
              lat: el.lat,
              lon: el.lon,
              type: el.tags.natural || el.tags.tourism || el.tags.place || 'point',
              ele: el.tags.ele,
            });
          } else if (el.type === 'way' && el.nodes?.length > 0) {
            const wayType = el.tags['piste:type'] ? 'piste' : (el.tags.highway || el.tags.waterway || 'way');
            const coords: Array<{ lat: number; lon: number }> = [];
            el.nodes.forEach((nodeId: number) => {
              const node = nodesMap.get(nodeId);
              if (node) coords.push(node);
            });

            if (coords.length > 1) {
              trailPaths.push({
                name: el.tags.name,
                coords,
                type: wayType,
              });
            }

            if (!seenNames.has(nameKey)) {
              seenNames.add(nameKey);
              const midIdx = Math.floor(coords.length / 2);
              const midCoord = coords[midIdx] || coords[0];
              if (midCoord) {
                labeledFeatures.push({
                  name: el.tags.name,
                  lat: midCoord.lat,
                  lon: midCoord.lon,
                  type: wayType,
                });
              }
            }
          }
        });

        console.log('[MapOverlay] Labeled features:', labeledFeatures.length, 'Trail paths:', trailPaths.length);

        const allUniqueCoords: Array<{lat: number; lon: number}> = [];
        const coordKeySet = new Set<string>();

        for (const trail of trailPaths) {
          for (const c of trail.coords) {
            const key = `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
            if (!coordKeySet.has(key)) {
              coordKeySet.add(key);
              allUniqueCoords.push(c);
            }
          }
        }
        for (const feature of labeledFeatures) {
          const key = `${feature.lat.toFixed(5)},${feature.lon.toFixed(5)}`;
          if (!coordKeySet.has(key)) {
            coordKeySet.add(key);
            allUniqueCoords.push({ lat: feature.lat, lon: feature.lon });
          }
        }

        console.log('[MapOverlay] Sampling tileset surface height for', allUniqueCoords.length, 'unique coordinates');

        const heightMap = new Map<string, number>();
        const sampleBatchSize = 50;
        for (let b = 0; b < allUniqueCoords.length; b += sampleBatchSize) {
          const batch = allUniqueCoords.slice(b, b + sampleBatchSize);
          const batchResults = await sampleTilesetHeight(batch);
          batchResults.forEach((height, key) => heightMap.set(key, height));
        }

        console.log('[MapOverlay] Height sampling complete:', heightMap.size, 'points');

        for (const trail of trailPaths) {
          interpolateGaps(trail.coords, heightMap);
        }

        const getSurfaceHeight = (lat: number, lon: number, offsetMeters: number): number => {
          const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
          const surfaceH = heightMap.get(key);
          if (surfaceH === undefined || surfaceH === MISSING_HEIGHT) {
            const validHeights = Array.from(heightMap.values()).filter(h => h !== MISSING_HEIGHT);
            const avg = validHeights.length > 0 ? validHeights.reduce((a, b) => a + b, 0) / validHeights.length : center.height;
            return avg + offsetMeters;
          }
          return surfaceH + offsetMeters;
        };

        for (const trail of trailPaths) {
          const isTrail = ['path', 'track', 'footway', 'cycleway', 'trail'].includes(trail.type);
          const isPiste = trail.type === 'piste';
          const isWater = trail.type === 'stream' || trail.type === 'river';

          const positions = trail.coords.flatMap((c) =>
            [c.lon, c.lat, getSurfaceHeight(c.lat, c.lon, 5)]
          );

          let lineColor = C.Color.WHITE.withAlpha(0.9);
          if (isPiste) lineColor = C.Color.fromCssColorString('#FF4444');
          else if (isTrail) lineColor = C.Color.fromCssColorString('#00FF88');
          else if (isWater) lineColor = C.Color.fromCssColorString('#4FC3F7').withAlpha(0.85);

          const dashMaterial = new C.PolylineDashMaterialProperty({
            color: lineColor,
            dashLength: (isTrail || isPiste) ? 16 : 12,
            dashPattern: 255,
          });

          const entity = viewer.entities.add({
            polyline: {
              positions: C.Cartesian3.fromDegreesArrayHeights(positions),
              width: (isTrail || isPiste) ? 6 : 4,
              material: dashMaterial,
              depthFailMaterial: dashMaterial,
              clampToGround: false,
            },
          });
          overlayLabelsRef.current.push(entity);
        }

        for (const feature of labeledFeatures) {
          const isPeak = feature.type === 'peak' || feature.type === 'saddle';
          const isTrail = ['path', 'track', 'footway', 'cycleway', 'trail'].includes(feature.type);
          const isPiste = feature.type === 'piste';
          const isRoad = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified'].includes(feature.type);
          const isWater = feature.type === 'stream' || feature.type === 'river';

          let labelColor = C.Color.WHITE;
          let fontSize = '14px';
          let text = feature.name;

          if (isPeak) {
            labelColor = C.Color.fromCssColorString('#FFD700');
            fontSize = '15px';
            if (feature.ele) {
              const elevFeet = Math.round(parseFloat(feature.ele) * 3.28084);
              text = `▲ ${feature.name} (${elevFeet.toLocaleString()} ft)`;
            } else {
              text = `▲ ${feature.name}`;
            }
          } else if (isPiste) {
            labelColor = C.Color.fromCssColorString('#FF4444');
            fontSize = '13px';
            text = `⛷ ${feature.name}`;
          } else if (isTrail) {
            labelColor = C.Color.fromCssColorString('#00FF88');
            fontSize = '13px';
          } else if (isRoad) {
            labelColor = C.Color.fromCssColorString('#FFFFFF');
            fontSize = '12px';
          } else if (isWater) {
            labelColor = C.Color.fromCssColorString('#4FC3F7');
            fontSize = '12px';
          }

          const offsetMeters = isPeak ? 12 : 8;
          const surfaceHeight = getSurfaceHeight(feature.lat, feature.lon, offsetMeters);
          const position = C.Cartesian3.fromDegrees(feature.lon, feature.lat, surfaceHeight);

          const entity = viewer.entities.add({
            position: position,
            label: {
              text: text,
              font: `bold ${fontSize} sans-serif`,
              fillColor: labelColor,
              outlineColor: C.Color.BLACK,
              outlineWidth: 3,
              style: C.LabelStyle.FILL_AND_OUTLINE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              heightReference: C.HeightReference.NONE,
              verticalOrigin: C.VerticalOrigin.BOTTOM,
              pixelOffset: new C.Cartesian2(0, -8),
              scaleByDistance: new C.NearFarScalar(100, 1.5, 10000, 0.4),
              translucencyByDistance: new C.NearFarScalar(100, 1.0, 15000, 0.1),
              showBackground: true,
              backgroundColor: C.Color.BLACK.withAlpha(0.55),
              backgroundPadding: new C.Cartesian2(8, 5),
            },
          });
          overlayLabelsRef.current.push(entity);

          if (isPeak) {
            const peakDot = viewer.entities.add({
              position: position,
              point: {
                pixelSize: 8,
                color: C.Color.fromCssColorString('#FFD700'),
                outlineColor: C.Color.BLACK,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: C.HeightReference.NONE,
              },
            });
            overlayLabelsRef.current.push(peakDot);
          }
        }
      } catch (err) {
        console.error('Failed to fetch map overlay data:', err);
      } finally {
        setMapOverlayLoading(false);
      }
    } else {
      overlayLabelsRef.current.forEach(entity => {
        try { viewer.entities.remove(entity); } catch (_) {}
      });
      overlayLabelsRef.current = [];
    }
    viewer.scene.requestRender();
  }, [mapOverlayActive, mapOverlayLoading]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const handleOpenRouteBuilder = useCallback(() => {
    if (isMeasuring) handleMeasureClick();
    setViewingRoute(null);
    setEditingRoute(null);
    setIsRoutesListOpen(false);
    setIsRouteBuilderOpen(true);
  }, [isMeasuring, handleMeasureClick]);

  const handleRouteSaved = useCallback((route: Route) => {
    setIsRouteBuilderOpen(false);
    setEditingRoute(null);
    setViewingRoute(route);
  }, []);

  const handleViewRoute = useCallback((route: Route) => {
    setIsRoutesListOpen(false);
    setIsRouteBuilderOpen(false);
    setEditingRoute(null);
    setViewingRoute(route);
  }, []);

  const handleEditRoute = useCallback((route: Route) => {
    setViewingRoute(null);
    setEditingRoute(route);
    setIsRouteBuilderOpen(true);
  }, []);

  const handleCloseRouteView = useCallback(() => {
    setViewingRoute(null);
  }, []);

  const handleCloseRouteBuilder = useCallback(() => {
    setIsRouteBuilderOpen(false);
    setEditingRoute(null);
  }, []);

  const formatRouteDistance = (d: string | number | null | undefined) => {
    if (!d) return '—';
    const m = typeof d === 'string' ? parseFloat(d) : d;
    const miles = m / 1609.34;
    return miles >= 0.1 ? `${miles.toFixed(2)} mi` : `${Math.round(m * 3.28084)} ft`;
  };

  if (isFetching) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white text-lg">Loading 3D map info...</div>
      </div>
    );
  }

  if (!tileset) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">3D map not found</p>
          <Button onClick={() => setLocation("/")} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative bg-gray-900 overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {(isLoading || error) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-50">
          {isLoading && !error && (
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-white text-lg">Loading 3D Map...</p>
              <p className="text-white/60 text-sm mt-1">{tileset.name}</p>
            </div>
          )}
          {error && (
            <div className="text-center">
              <p className="text-red-400 text-lg mb-4">{error}</p>
              <Button onClick={() => setLocation("/")} variant="outline">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Go Back
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="absolute left-4 z-40 flex items-center gap-3" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <Button
          variant="outline"
          size="sm"
          className="bg-gray-900/80 border-white/20 text-white hover:bg-gray-800"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="bg-gray-900/80 border border-white/20 rounded-md px-3 py-1.5">
          <h2 className="text-white text-sm font-medium">{tileset.name}</h2>
          <p className="text-white/50 text-xs">3D Map</p>
        </div>
      </div>

      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-1.5 items-end">
        <button
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-gray-900/80 border text-white hover:bg-gray-800 transition-colors ${isRouteBuilderOpen ? 'ring-2 ring-green-400 border-green-400' : 'border-white/20'}`}
          onClick={handleOpenRouteBuilder}
        >
          <RouteIcon className={`w-5 h-5 mb-0.5 ${isRouteBuilderOpen ? 'text-green-400' : ''}`} />
          <span className="text-[10px] font-medium leading-tight text-center whitespace-pre-line">{'New\nRoute'}</span>
        </button>

        <button
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-gray-900/80 border text-white hover:bg-gray-800 transition-colors ${isRoutesListOpen ? 'ring-2 ring-blue-400 border-blue-400' : 'border-white/20'}`}
          onClick={() => setIsRoutesListOpen(!isRoutesListOpen)}
        >
          <List className={`w-5 h-5 mb-0.5 ${isRoutesListOpen ? 'text-blue-400' : ''}`} />
          <span className="text-[10px] font-medium leading-tight text-center whitespace-pre-line">Routes</span>
        </button>

        <button
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-gray-900/80 border text-white hover:bg-gray-800 transition-colors ${isMeasuring ? 'ring-2 ring-orange-400 border-orange-400' : 'border-white/20'}`}
          onClick={handleMeasureClick}
        >
          {isMeasuring ? <X className="w-5 h-5 mb-0.5" /> : <Ruler className="w-5 h-5 mb-0.5" />}
          <span className="text-[10px] font-medium leading-tight text-center">Measure</span>
        </button>

        <button
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-gray-900/80 border text-white hover:bg-gray-800 transition-colors ${gpsActive ? 'ring-2 ring-blue-400 border-blue-400' : 'border-white/20'}`}
          onClick={toggleGps}
        >
          <Navigation className={`w-5 h-5 mb-0.5 ${gpsActive ? 'text-blue-400' : ''}`} />
          <span className="text-[10px] font-medium leading-tight text-center whitespace-pre-line">{'My\nLocation'}</span>
        </button>

        {gpsActive && gpsPosition && (
          <button
            className="flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-gray-900/80 border border-white/20 text-white hover:bg-gray-800 transition-colors"
            onClick={flyToGps}
          >
            <MapPin className="w-5 h-5 mb-0.5 text-blue-400" />
            <span className="text-[10px] font-medium leading-tight text-center whitespace-pre-line">{'Go to\nGPS'}</span>
          </button>
        )}

        <button
          className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg bg-gray-900/80 border text-white hover:bg-gray-800 transition-colors ${mapOverlayActive ? 'ring-2 ring-emerald-400 border-emerald-400' : 'border-white/20'} ${mapOverlayLoading ? 'opacity-75 cursor-wait' : ''}`}
          onClick={toggleMapOverlay}
          disabled={mapOverlayLoading}
        >
          {mapOverlayLoading ? (
            <Loader2 className="w-5 h-5 mb-0.5 text-emerald-400 animate-spin" />
          ) : (
            <Layers className={`w-5 h-5 mb-0.5 ${mapOverlayActive ? 'text-emerald-400' : ''}`} />
          )}
          <span className="text-[10px] font-medium leading-tight text-center whitespace-pre-line">
            {mapOverlayLoading ? 'Loading...' : 'Map\nOverlay'}
          </span>
        </button>

        <div className="border-t border-white/10 pt-1.5 flex flex-col gap-1.5 w-full">
          <div className="flex gap-1.5 justify-end">
            <Button
              variant="outline"
              size="icon"
              className="w-[44px] h-[44px] bg-gray-900/80 border-white/20 text-white hover:bg-gray-800 active:scale-95 transition-all"
              onClick={zoomIn}
              title="Zoom in"
            >
              <Plus className="w-5 h-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-[44px] h-[44px] bg-gray-900/80 border-white/20 text-white hover:bg-gray-800 active:scale-95 transition-all"
              onClick={zoomOut}
              title="Zoom out"
            >
              <Minus className="w-5 h-5" />
            </Button>
          </div>
          <div className="flex gap-1.5 justify-end">
            <Button
              variant="outline"
              size="icon"
              className="w-[44px] h-[44px] bg-blue-900/80 border-blue-400/40 text-blue-300 hover:bg-blue-800 hover:text-white active:scale-95 transition-all"
              onClick={recenterView}
              title="Re-center view"
            >
              <RotateCcw className="w-5 h-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-[44px] h-[44px] bg-gray-900/80 border-white/20 text-white hover:bg-gray-800 active:scale-95 transition-all"
              onClick={lookNorth}
              title="Look north"
            >
              <Compass className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {!isLoading && !error && (
        <div className="absolute bottom-20 left-4 z-40">
          <button
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-600/90 hover:bg-blue-500 active:scale-95 border border-blue-400/30 text-white font-medium text-sm shadow-lg shadow-blue-900/40 transition-all backdrop-blur-sm"
            onClick={recenterView}
            title="Re-center view — return to the default overview of the 3D model"
          >
            <Home className="w-5 h-5" />
            <span>Re-center</span>
          </button>
        </div>
      )}

      {showControlHints ? (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-black/70 backdrop-blur-sm text-white text-xs px-4 py-2 rounded-full whitespace-nowrap">
          <span className="hidden sm:inline">Drag to orbit • Right-drag or scroll to zoom • Middle-drag to tilt</span>
          <span className="sm:hidden">Drag to orbit • Pinch to zoom • Two-finger drag to tilt</span>
        </div>
      ) : (
        <button
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-8 h-8 rounded-full bg-black/50 text-white/50 hover:text-white hover:bg-black/70 flex items-center justify-center text-sm font-medium transition-colors"
          onClick={() => setShowControlHints(true)}
          title="Show navigation controls"
        >
          ?
        </button>
      )}

      {isRouteBuilderOpen && viewerRef.current && tilesetId && (
        <CesiumRouteBuilder
          isOpen={isRouteBuilderOpen}
          onClose={handleCloseRouteBuilder}
          viewer={viewerRef.current}
          cesiumTilesetId={tilesetId}
          editingRoute={editingRoute}
          onRouteSaved={handleRouteSaved}
        />
      )}


      {viewingRoute && viewerRef.current && (
        <CesiumRouteSummaryPanel
          route={viewingRoute}
          viewer={viewerRef.current}
          onClose={handleCloseRouteView}
          onEdit={handleEditRoute}
          isOwner={viewingRoute.userId === user?.id}
        />
      )}

      {isRoutesListOpen && (
        <div className="absolute left-4 bottom-20 w-80 z-40 pointer-events-auto bg-gray-900/90 backdrop-blur-sm border border-white/20 rounded-lg overflow-hidden flex flex-col" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 80px)' }}>
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <RouteIcon className="w-4 h-4" />
              3D Routes ({routesForThisTileset.length})
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-white/60 hover:text-white hover:bg-white/10"
              onClick={() => setIsRoutesListOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {routesForThisTileset.length === 0 ? (
              <div className="text-center py-8">
                <RouteIcon className="w-10 h-10 mx-auto mb-3 text-white/30" />
                <p className="text-white/50 text-sm">No routes on this 3D map yet</p>
                <Button
                  size="sm"
                  className="mt-3 bg-green-600 hover:bg-green-700 text-white"
                  onClick={handleOpenRouteBuilder}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Build First Route
                </Button>
              </div>
            ) : (
              routesForThisTileset.map((route: Route) => (
                <div
                  key={route.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    viewingRoute?.id === route.id
                      ? 'border-orange-400/50 bg-orange-400/10'
                      : 'border-white/10 hover:border-white/30 hover:bg-white/5'
                  }`}
                  onClick={() => handleViewRoute(route)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-white text-sm font-medium truncate">{route.name}</h4>
                      {route.description && (
                        <p className="text-white/50 text-xs mt-0.5 truncate">{route.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-white/40 text-xs">
                    <span className="flex items-center gap-1">
                      <Ruler className="w-3 h-3" />
                      {formatRouteDistance(route.totalDistance)}
                    </span>
                    {route.elevationGain && parseFloat(String(route.elevationGain)) > 0 && (
                      <span className="flex items-center gap-1">
                        <Mountain className="w-3 h-3" />
                        +{Math.round(parseFloat(String(route.elevationGain)) * 3.28084)} ft
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-white/10">
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              size="sm"
              onClick={handleOpenRouteBuilder}
            >
              <Plus className="w-4 h-4 mr-1" />
              Build New Route
            </Button>
          </div>
        </div>
      )}

      {tilesLoading && !isLoading && !error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <div className="bg-black/60 backdrop-blur-sm rounded-xl px-6 py-4 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
            <span className="text-white text-sm font-medium">Loading imagery...</span>
          </div>
        </div>
      )}

      {isMeasuring && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-gray-900/90 border border-orange-400/50 rounded-lg px-4 py-3 text-center">
            <p className="text-orange-300 text-xs font-medium mb-1">MEASURE MODE</p>
            {measureDistance !== null ? (
              <p className="text-white text-lg font-bold">{formatDistance(measureDistance)}</p>
            ) : (
              <p className="text-white/70 text-sm">Click points on the 3D map to measure</p>
            )}
            <p className="text-white/40 text-xs mt-1">
              {measurePointsRef.current.length} point{measurePointsRef.current.length !== 1 ? 's' : ''} placed
            </p>
          </div>
        </div>
      )}

      {gpsActive && gpsPosition && (
        <div className="absolute bottom-6 right-4 z-40">
          <div className="bg-gray-900/90 border border-blue-400/50 rounded-lg px-3 py-2">
            <p className="text-blue-300 text-xs font-medium">GPS ACTIVE</p>
            <p className="text-white text-xs mt-0.5">
              {gpsPosition.lat.toFixed(6)}, {gpsPosition.lng.toFixed(6)}
            </p>
            {gpsPosition.alt !== null && (
              <p className="text-white/60 text-xs">Alt: {gpsPosition.alt.toFixed(1)}m</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
