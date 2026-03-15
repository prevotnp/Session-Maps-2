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
  Loader2,
  ChevronDown,
  Filter,
  Calendar,
  List
} from "lucide-react";
import { useMapbox } from "@/hooks/useMapbox";
import { useOutdoorPOIs } from "@/hooks/useOutdoorPOIs";
import MapControls from "@/components/MapControls";
import UnifiedToolbar from "@/components/UnifiedToolbar";
import { DroneImage } from "@shared/schema";
import mapboxgl from "mapbox-gl";

// Activity-based route colors
const ACTIVITY_COLORS: Record<string, string> = {
  skiing: '#3B82F6',    // Blue
  river: '#EF4444',     // Red
  hiking: '#EAB308',    // Yellow
  running: '#EAB308',   // Yellow
  cycling: '#EC4899',   // Pink
};

const ACTIVITY_OPTIONS = [
  { value: 'hiking', label: 'Hiking', icon: '🥾', color: '#EAB308' },
  { value: 'running', label: 'Running', icon: '🏃', color: '#EAB308' },
  { value: 'skiing', label: 'Skiing', icon: '⛷️', color: '#3B82F6' },
  { value: 'river', label: 'River Trips', icon: '🛶', color: '#EF4444' },
  { value: 'cycling', label: 'Cycling', icon: '🚴', color: '#EC4899' },
];

const DEFAULT_ROUTE_COLOR = '#EAB308'; // Yellow for routes without activity type

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
  activityType: string | null;
  startTime: string | null;
  endTime: string | null;
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
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(ACTIVITY_OPTIONS.map(a => a.value)));
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showRoutesList, setShowRoutesList] = useState(false);

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

  const getRouteColor = (route: PublicRoute) => {
    const activity = route.activityType || 'hiking';
    return ACTIVITY_COLORS[activity] || DEFAULT_ROUTE_COLOR;
  };

  const toggleFilter = (activity: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(activity)) {
        next.delete(activity);
      } else {
        next.add(activity);
      }
      return next;
    });
  };

  // Filter routes by selected activities
  const filteredRoutes = publicRoutes.filter(route => {
    const activity = route.activityType || 'hiking';
    return activeFilters.has(activity);
  });

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

  const formatTripDates = (startTime: string | null, endTime: string | null) => {
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

  // Render filtered routes on the map
  useEffect(() => {
    if (!map || !isMapReady) return;

    const m = map;
    const handlers: { layerId: string; type: string; handler: () => void }[] = [];
    const addedLayers: string[] = [];
    const addedSources: string[] = [];

    const addRoutes = () => {
      filteredRoutes.forEach((route) => {
        const sourceId = `public-route-${route.id}`;
        const layerId = `public-route-line-${route.id}`;
        const color = getRouteColor(route);

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
  }, [filteredRoutes, isMapReady, map]);

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
      <div className="bg-gray-900/95 backdrop-blur-sm px-4 py-3 z-10 border-b border-gray-700" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <div className="flex items-center justify-between">
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
                {routesLoading ? 'Loading...' : `${filteredRoutes.length} of ${publicRoutes.length} routes`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
          {/* Routes list button */}
          <button
            onClick={() => setShowRoutesList(!showRoutesList)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              showRoutesList
                ? 'bg-emerald-600 text-white'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>Routes</span>
          </button>

          {/* Filter dropdown button */}
          <div className="relative">
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeFilters.size < ACTIVITY_OPTIONS.length
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filter</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilterDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showFilterDropdown && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-gray-800 rounded-xl border border-white/10 shadow-2xl overflow-hidden z-50">
                <div className="px-3 py-2 border-b border-white/10">
                  <p className="text-white/60 text-xs font-medium uppercase tracking-wide">Filter by Activity</p>
                </div>
                {ACTIVITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => toggleFilter(option.value)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors"
                  >
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        activeFilters.has(option.value)
                          ? 'border-transparent'
                          : 'border-white/30 bg-transparent'
                      }`}
                      style={activeFilters.has(option.value) ? { backgroundColor: option.color } : {}}
                    >
                      {activeFilters.has(option.value) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <span className="text-lg">{option.icon}</span>
                    <span className="text-white text-sm">{option.label}</span>
                    <div
                      className="w-3 h-3 rounded-full ml-auto"
                      style={{ backgroundColor: option.color }}
                    />
                  </button>
                ))}
                <div className="px-3 py-2 border-t border-white/10 flex gap-2">
                  <button
                    onClick={() => setActiveFilters(new Set(ACTIVITY_OPTIONS.map(a => a.value)))}
                    className="flex-1 text-xs text-white/60 hover:text-white py-1 transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setActiveFilters(new Set())}
                    className="flex-1 text-xs text-white/60 hover:text-white py-1 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Click outside to close filter dropdown */}
      {showFilterDropdown && (
        <div className="fixed inset-0 z-[9]" onClick={() => setShowFilterDropdown(false)} />
      )}

      {/* Route list panel */}
      {showRoutesList && (
        <div className="bg-gray-800/95 backdrop-blur-sm border-b border-gray-700 max-h-[35vh] overflow-y-auto z-10">
          {filteredRoutes.length === 0 ? (
            <div className="p-4 text-center text-gray-400 text-sm">
              {publicRoutes.length === 0 ? 'No public routes available yet. Make your routes public from My Maps!' : 'No routes match the current filters.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-700/50">
              {filteredRoutes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => {
                    setSelectedRoute(route);
                    setShowRouteInfo(true);
                    flyToRoute(route);
                    setShowRoutesList(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getRouteColor(route) }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{route.name}</p>
                    <p className="text-gray-400 text-xs">
                      {route.owner.fullName || route.owner.username} • {formatDistance(route.totalDistance)}
                      {route.activityType && ` • ${route.activityType}`}
                    </p>
                  </div>
                  <Eye className="w-4 h-4 text-gray-500 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {routesLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="text-white flex items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              Loading routes...
            </div>
          </div>
        )}
      </div>

      {/* Right-side map controls (zoom, compass, GPS) — outside map container like MapView */}
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
                    Activity
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: getRouteColor(selectedRoute) }}
                    />
                    <p className="text-white font-semibold capitalize">
                      {selectedRoute.activityType || 'hiking'}
                    </p>
                  </div>
                </div>
              </div>

              {selectedRoute.startTime && (
                <div className="bg-gray-800 rounded-xl p-3 mb-4 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-white text-sm">
                    {formatTripDates(selectedRoute.startTime, selectedRoute.endTime)}
                  </span>
                </div>
              )}

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
                          style={{ backgroundColor: ACTIVITY_COLORS[(route as any).activityType || 'hiking'] || DEFAULT_ROUTE_COLOR }}
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
