import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  X,
  UserPlus,
  MapPin,
  Route as RouteIcon,
  Clock,
  TrendingUp,
  Eye,
  User,
  Check,
  Loader2
} from "lucide-react";
import { useMapbox } from "@/hooks/useMapbox";
import { useOutdoorPOIs } from "@/hooks/useOutdoorPOIs";
import MapControls from "@/components/MapControls";
import UnifiedToolbar from "@/components/UnifiedToolbar";
import { DroneImage } from "@shared/schema";
import mapboxgl from "mapbox-gl";

const ROUTE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e'
];

interface RouteOwner {
  id: number;
  username: string;
  fullName: string | null;
}

interface PublicRoute {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  pathCoordinates: string;
  totalDistance: string | null;
  elevationGain: string | null;
  elevationLoss: string | null;
  estimatedTime: number | null;
  routingMode: string;
  createdAt: string;
  owner: RouteOwner;
}

interface UserProfile {
  id: number;
  username: string;
  fullName: string | null;
  routes: PublicRoute[];
}

interface FriendData {
  id: number;
  friend: {
    id: number;
    username: string;
    fullName: string | null;
  };
}

export default function Explore() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [selectedRoute, setSelectedRoute] = useState<PublicRoute | null>(null);
  const [selectedUserProfile, setSelectedUserProfile] = useState<UserProfile | null>(null);
  const [showRouteInfo, setShowRouteInfo] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [activeDroneLayers, setActiveDroneLayers] = useState<Set<number>>(new Set());

  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Use the same map infrastructure as the base map
  const {
    initializeMap,
    isMapReady,
    map,
    toggleLayer,
    activeLayers,
    activeTrailOverlays,
    zoomIn,
    zoomOut,
    flyToUserLocation,
    toggleTerrain,
    resetNorth,
    addDroneImagery,
    removeDroneImageryById,
    activeDroneImages,
    startLocationTracking,
    isMeasurementMode,
    setIsMeasurementMode,
    isOfflineSelectionMode,
    startOfflineAreaSelection,
    showOutdoorPOIs,
    setShowOutdoorPOIs,
    esriImageryEnabled,
    toggleEsriImagery,
  } = useMapbox(mapContainerRef);

  const { isLoading: isOutdoorPOIsLoading } = useOutdoorPOIs(map, showOutdoorPOIs);

  // Initialize map on mount
  useEffect(() => {
    initializeMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start location tracking when map is ready
  useEffect(() => {
    if (isMapReady) {
      startLocationTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMapReady]);

  // Sync activeDroneLayers with activeDroneImages from useMapbox
  useEffect(() => {
    if (activeDroneImages) {
      const newActiveSet = new Set(activeDroneImages.keys());
      setActiveDroneLayers(newActiveSet);
    }
  }, [activeDroneImages]);

  // Drone images query
  const { data: droneImages = [] } = useQuery<DroneImage[]>({
    queryKey: ['/api/drone-images'],
    enabled: isMapReady
  });

  const { data: publicRoutes = [], isLoading: routesLoading } = useQuery<PublicRoute[]>({
    queryKey: ['/api/routes/public']
  });

  const { data: friends = [] } = useQuery<FriendData[]>({
    queryKey: ['/api/friends']
  });

  const { data: pendingRequests = [] } = useQuery<any[]>({
    queryKey: ['/api/friend-requests/pending']
  });

  const { data: sentRequests = [] } = useQuery<any[]>({
    queryKey: ['/api/friend-requests/sent']
  });

  const isFriend = (userId: number) => friends.some(f => f.friend.id === userId);
  const hasSentRequest = (userId: number) => sentRequests.some((r: any) => r.toUserId === userId);

  const sendFriendRequestMutation = useMutation({
    mutationFn: async (toUserId: number) => {
      return apiRequest('POST', '/api/friend-requests', { toUserId });
    },
    onSuccess: () => {
      toast({ title: "Friend request sent!" });
      queryClient.invalidateQueries({ queryKey: ['/api/friend-requests/sent'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send request",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const fetchUserProfile = async (userId: number) => {
    try {
      const response = await fetch(`/api/users/${userId}/public-profile`);
      if (response.ok) {
        const profile = await response.json();
        setSelectedUserProfile(profile);
        setShowUserProfile(true);
      }
    } catch (error) {
      toast({ title: "Failed to load profile", variant: "destructive" });
    }
  };

  const getRouteColor = (index: number) => ROUTE_COLORS[index % ROUTE_COLORS.length];

  const formatDistance = (meters: string | null) => {
    if (!meters) return 'N/A';
    const m = parseFloat(meters);
    if (m < 1000) return `${Math.round(m)}m`;
    return `${(m / 1000).toFixed(1)}km`;
  };

  const formatTime = (minutes: number | null) => {
    if (!minutes) return 'N/A';
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  // Handle drone layer toggling (same pattern as MapView)
  const handleToggleDroneLayer = (droneImageId: number, isActive: boolean) => {
    const newActiveLayers = new Set(activeDroneLayers);

    if (isActive) {
      newActiveLayers.add(droneImageId);
      const droneImage = droneImages?.find((img: DroneImage) => img.id === droneImageId);
      if (droneImage && addDroneImagery) {
        addDroneImagery(droneImage);
        toast({
          title: "Drone Imagery Added",
          description: `Flying to ${droneImage.name}`,
        });
      }
    } else {
      newActiveLayers.delete(droneImageId);
      if (removeDroneImageryById) {
        removeDroneImageryById(droneImageId);
      }
    }

    setActiveDroneLayers(newActiveLayers);
  };

  // Render public routes on the map
  useEffect(() => {
    if (!map || !isMapReady || publicRoutes.length === 0) return;

    const m = map;
    const handlers: { layerId: string; type: string; handler: () => void }[] = [];
    const addedLayers: string[] = [];
    const addedSources: string[] = [];

    const addRoutes = () => {
      publicRoutes.forEach((route, index) => {
        const sourceId = `public-route-${route.id}`;
        const layerId = `public-route-line-${route.id}`;
        const color = getRouteColor(index);

        try {
          const pathData = JSON.parse(route.pathCoordinates);
          const coordinates = pathData.map((p: any) => [p.lng, p.lat]);

          if (coordinates.length < 2) return;

          if (m.getLayer(layerId)) {
            m.removeLayer(layerId);
          }
          if (m.getSource(sourceId)) {
            m.removeSource(sourceId);
          }

          m.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: { routeId: route.id },
              geometry: { type: 'LineString', coordinates }
            }
          });
          addedSources.push(sourceId);

          m.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-color': color,
              'line-width': 4,
              'line-opacity': 0.8
            }
          });
          addedLayers.push(layerId);

          const clickHandler = () => {
            setSelectedRoute(route);
            setShowRouteInfo(true);
          };

          const mouseEnterHandler = () => {
            m.getCanvas().style.cursor = 'pointer';
            if (m.getLayer(layerId)) {
              m.setPaintProperty(layerId, 'line-width', 6);
            }
          };

          const mouseLeaveHandler = () => {
            m.getCanvas().style.cursor = '';
            if (m.getLayer(layerId)) {
              m.setPaintProperty(layerId, 'line-width', 4);
            }
          };

          m.on('click', layerId, clickHandler);
          m.on('mouseenter', layerId, mouseEnterHandler);
          m.on('mouseleave', layerId, mouseLeaveHandler);

          handlers.push({ layerId, type: 'click', handler: clickHandler });
          handlers.push({ layerId, type: 'mouseenter', handler: mouseEnterHandler });
          handlers.push({ layerId, type: 'mouseleave', handler: mouseLeaveHandler });
        } catch (error) {
          console.error(`Error parsing route ${route.id}:`, error);
        }
      });
    };

    if (m.isStyleLoaded()) {
      addRoutes();
    } else {
      m.on('load', addRoutes);
    }

    return () => {
      if (!m) return;
      handlers.forEach(({ layerId, type, handler }) => {
        m.off(type as any, layerId, handler);
      });
      addedLayers.forEach(layerId => {
        if (m.getLayer(layerId)) {
          m.removeLayer(layerId);
        }
      });
      addedSources.forEach(sourceId => {
        if (m.getSource(sourceId)) {
          m.removeSource(sourceId);
        }
      });
    };
  }, [publicRoutes, isMapReady, map]);

  const flyToRoute = (route: PublicRoute) => {
    if (!map) return;

    try {
      const pathData = JSON.parse(route.pathCoordinates);
      if (pathData.length === 0) return;

      const bounds = new mapboxgl.LngLatBounds();
      pathData.forEach((p: any) => bounds.extend([p.lng, p.lat]));

      map.fitBounds(bounds, { padding: 50 });
    } catch (error) {
      console.error('Error flying to route:', error);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900">
      <div className="bg-gray-900/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between z-10 border-b border-gray-700" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </Button>
          <div>
            <h1 className="text-white font-semibold text-lg">Explore Routes</h1>
            <p className="text-gray-400 text-sm">
              {routesLoading ? 'Loading...' : `${publicRoutes.length} public routes`}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {routesLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white flex items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              Loading routes...
            </div>
          </div>
        )}

        {/* Right-side map controls (zoom, compass, GPS) */}
        <MapControls
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onMyLocation={flyToUserLocation}
          onResetNorth={resetNorth}
          onToggleTerrain={toggleTerrain}
        />

        {/* Bottom toolbar — Explore section only (2D/3D, Layers, Drone, Measure) */}
        <UnifiedToolbar
          onToggleLayer={toggleLayer}
          activeLayers={activeLayers}
          activeTrailOverlays={activeTrailOverlays}
          onStartOfflineSelection={startOfflineAreaSelection}
          onToggleDroneLayer={handleToggleDroneLayer}
          activeDroneLayers={activeDroneLayers}
          onOpenRouteBuilder={() => {}}
          isMeasurementMode={isMeasurementMode}
          onToggleMeasurement={() => setIsMeasurementMode(!isMeasurementMode)}
          isOfflineSelectionMode={isOfflineSelectionMode}
          isRecordingActive={true}
          showOutdoorPOIs={showOutdoorPOIs}
          isOutdoorPOIsLoading={isOutdoorPOIsLoading}
          onToggleOutdoorPOIs={() => setShowOutdoorPOIs(!showOutdoorPOIs)}
          esriImageryEnabled={esriImageryEnabled}
          onToggleEsriImagery={toggleEsriImagery}
        />
      </div>

      {/* Route info bottom sheet */}
      {showRouteInfo && selectedRoute && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center">
          <div className="bg-gray-900 w-full max-w-lg rounded-t-3xl max-h-[70vh] overflow-hidden">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-white font-semibold text-lg">{selectedRoute.name}</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowRouteInfo(false)}
              >
                <X className="w-5 h-5 text-white" />
              </Button>
            </div>

            <ScrollArea className="p-4 max-h-[50vh]">
              {selectedRoute.description && (
                <p className="text-gray-400 text-sm mb-4">{selectedRoute.description}</p>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-gray-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                    <RouteIcon className="w-3 h-3" />
                    Distance
                  </div>
                  <p className="text-white font-semibold">
                    {formatDistance(selectedRoute.totalDistance)}
                  </p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                    <Clock className="w-3 h-3" />
                    Est. Time
                  </div>
                  <p className="text-white font-semibold">
                    {formatTime(selectedRoute.estimatedTime)}
                  </p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                    <TrendingUp className="w-3 h-3" />
                    Elevation Gain
                  </div>
                  <p className="text-white font-semibold">
                    {selectedRoute.elevationGain ? `${parseFloat(selectedRoute.elevationGain).toFixed(0)}m` : 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                    <MapPin className="w-3 h-3" />
                    Mode
                  </div>
                  <p className="text-white font-semibold capitalize">
                    {selectedRoute.routingMode}
                  </p>
                </div>
              </div>

              <div className="bg-gray-800 rounded-xl p-4 mb-4">
                <p className="text-gray-400 text-xs mb-2">Created by</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                      {selectedRoute.owner.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-medium">
                        {selectedRoute.owner.fullName || selectedRoute.owner.username}
                      </p>
                      <p className="text-gray-400 text-sm">@{selectedRoute.owner.username}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        fetchUserProfile(selectedRoute.owner.id);
                        setShowRouteInfo(false);
                      }}
                      data-testid="button-view-profile"
                    >
                      <User className="w-4 h-4 mr-1" />
                      Profile
                    </Button>
                    {selectedRoute.owner.id !== (user as any)?.id && (
                      isFriend(selectedRoute.owner.id) ? (
                        <Button variant="secondary" size="sm" disabled>
                          <Check className="w-4 h-4 mr-1" />
                          Friends
                        </Button>
                      ) : hasSentRequest(selectedRoute.owner.id) ? (
                        <Button variant="secondary" size="sm" disabled>
                          Pending
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => sendFriendRequestMutation.mutate(selectedRoute.owner.id)}
                          disabled={sendFriendRequestMutation.isPending}
                          data-testid="button-add-friend"
                        >
                          <UserPlus className="w-4 h-4 mr-1" />
                          Add Friend
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => {
                  flyToRoute(selectedRoute);
                  setShowRouteInfo(false);
                }}
                data-testid="button-view-on-map"
              >
                <Eye className="w-4 h-4 mr-2" />
                View on Map
              </Button>
            </ScrollArea>
          </div>
        </div>
      )}

      {/* User profile modal */}
      {showUserProfile && selectedUserProfile && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 w-full max-w-lg rounded-2xl max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-white font-semibold text-lg">User Profile</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowUserProfile(false)}
              >
                <X className="w-5 h-5 text-white" />
              </Button>
            </div>

            <div className="p-4">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-2xl">
                  {selectedUserProfile.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-white font-semibold text-lg">
                    {selectedUserProfile.fullName || selectedUserProfile.username}
                  </p>
                  <p className="text-gray-400">@{selectedUserProfile.username}</p>
                  <p className="text-gray-500 text-sm">
                    {selectedUserProfile.routes.length} public route{selectedUserProfile.routes.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {selectedUserProfile.id !== (user as any)?.id && (
                  isFriend(selectedUserProfile.id) ? (
                    <Button variant="secondary" size="sm" disabled>
                      <Check className="w-4 h-4 mr-1" />
                      Friends
                    </Button>
                  ) : hasSentRequest(selectedUserProfile.id) ? (
                    <Button variant="secondary" size="sm" disabled>
                      Pending
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => sendFriendRequestMutation.mutate(selectedUserProfile.id)}
                      disabled={sendFriendRequestMutation.isPending}
                    >
                      <UserPlus className="w-4 h-4 mr-1" />
                      Add Friend
                    </Button>
                  )
                )}
              </div>

              <h3 className="text-white font-medium mb-3">Public Routes</h3>
              <ScrollArea className="max-h-[40vh]">
                <div className="space-y-2">
                  {selectedUserProfile.routes.map((route, index) => (
                    <div
                      key={route.id}
                      className="bg-gray-800 rounded-xl p-3 cursor-pointer hover:bg-gray-700 transition-colors"
                      onClick={() => {
                        setSelectedRoute({ ...route, owner: selectedUserProfile } as PublicRoute);
                        setShowUserProfile(false);
                        setShowRouteInfo(true);
                      }}
                      data-testid={`route-${route.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: getRouteColor(index) }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{route.name}</p>
                          <p className="text-gray-400 text-sm">
                            {formatDistance(route.totalDistance)} • {route.routingMode}
                          </p>
                        </div>
                        <RouteIcon className="w-4 h-4 text-gray-500" />
                      </div>
                    </div>
                  ))}
                  {selectedUserProfile.routes.length === 0 && (
                    <p className="text-gray-500 text-center py-4">No public routes yet</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
