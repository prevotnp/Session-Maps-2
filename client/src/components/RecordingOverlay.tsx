import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import {
  useActivityRecording,
  formatDuration,
  formatDistance,
  formatPace,
  formatSpeed,
  formatElevation,
  ActivityType,
} from "@/hooks/useActivityRecording";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Play,
  Pause,
  Square,
  Timer,
  Route as RouteIcon,
  Gauge,
  Footprints,
  Bike,
  Snowflake,
  PersonStanding,
  Loader2,
  Save,
  Trash2,
  MapPin,
  MapPinned,
  ChevronDown,
  Search,
  X,
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import type { Route } from "@shared/schema";

const activityTypes: { type: ActivityType; label: string; icon: React.ReactNode }[] = [
  { type: "run", label: "Run", icon: <Footprints className="w-6 h-6" /> },
  { type: "hike", label: "Hike", icon: <PersonStanding className="w-6 h-6" /> },
  { type: "bike", label: "Bike", icon: <Bike className="w-6 h-6" /> },
  { type: "ski", label: "Ski", icon: <Snowflake className="w-6 h-6" /> },
];

interface RecordingOverlayProps {
  map: mapboxgl.Map | null;
  isVisible: boolean;
  onClose: () => void;
  onDisplayRoute?: (route: any) => void;
  onClearDisplayedRoute?: () => void;
}

export default function RecordingOverlay({ map, isVisible, onClose, onDisplayRoute, onClearDisplayedRoute }: RecordingOverlayProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const {
    isRecording,
    isPaused,
    activityType,
    stats,
    trackPoints,
    currentPosition,
    waypoints,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    saveRecording,
    addWaypoint,
    isSaving,
    hasPersistedSession,
    resumeRecordingFromPersisted,
    dismissPersistedSession,
  } = useActivityRecording();

  const [selectedType, setSelectedType] = useState<ActivityType>("hike");
  const [preRecordName, setPreRecordName] = useState("");
  const [hasStarted, setHasStarted] = useState(false);

  const [showRouteSelector, setShowRouteSelector] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [routeSearchQuery, setRouteSearchQuery] = useState("");

  const { data: userRoutes = [] } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
    enabled: isVisible,
  });

  const filteredRoutes = userRoutes.filter((route) =>
    route.name.toLowerCase().includes(routeSearchQuery.toLowerCase())
  );

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [activityName, setActivityName] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const waypointMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const routeSourceAdded = useRef(false);
  const startMarkerAdded = useRef(false);

  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;

    const coordinates = trackPoints.map((p) => [p.longitude, p.latitude]);

    if (!routeSourceAdded.current) {
      if (coordinates.length === 0) return;

      try {
        if (!map.getSource("recording-track")) {
          map.addSource("recording-track", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            },
          });
        }
        if (!map.getLayer("recording-track-line")) {
          map.addLayer({
            id: "recording-track-line",
            type: "line",
            source: "recording-track",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#3b82f6", "line-width": 2 },
          });
        }
        routeSourceAdded.current = true;
      } catch (e) {
        console.warn("Error adding recording track source:", e);
      }
    } else {
      try {
        const source = map.getSource("recording-track") as mapboxgl.GeoJSONSource;
        if (source) {
          source.setData({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          });
        }
      } catch (e) {
        console.warn("Error updating recording track:", e);
      }
    }

    if (coordinates.length >= 1 && !startMarkerAdded.current) {
      try {
        if (!map.getSource("recording-start-point")) {
          map.addSource("recording-start-point", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: coordinates[0] },
            },
          });
          map.addLayer({
            id: "recording-start-point-layer",
            type: "circle",
            source: "recording-start-point",
            paint: {
              "circle-radius": 8,
              "circle-color": "#3b82f6",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 3,
            },
          });
          startMarkerAdded.current = true;
        }
      } catch (e) {
        console.warn("Error adding start marker:", e);
      }
    }
  }, [map, trackPoints]);

  useEffect(() => {
    if (!map || !currentPosition) return;

    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.innerHTML = `
        <div style="
          width: 20px; height: 20px;
          background: #3b82f6;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        "></div>
      `;
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([currentPosition.longitude, currentPosition.latitude])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([currentPosition.longitude, currentPosition.latitude]);
    }

    if (isRecording && !isPaused) {
      map.easeTo({
        center: [currentPosition.longitude, currentPosition.latitude],
        duration: 500,
      });
    }
  }, [map, currentPosition, isRecording, isPaused]);

  useEffect(() => {
    if (!map) return;
    waypointMarkersRef.current.forEach((m) => m.remove());
    waypointMarkersRef.current = [];
    waypoints.forEach((wp) => {
      const el = document.createElement("div");
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="background: #eab308; color: #000; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-bottom: 2px; white-space: nowrap;">${wp.name}</div>
          <div style="width: 14px; height: 14px; background: #eab308; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>
        </div>
      `;
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([wp.longitude, wp.latitude])
        .addTo(map);
      waypointMarkersRef.current.push(marker);
    });
  }, [map, waypoints]);

  const cleanupMapLayers = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer("recording-track-line")) map.removeLayer("recording-track-line");
      if (map.getSource("recording-track")) map.removeSource("recording-track");
      if (map.getLayer("recording-start-point-layer")) map.removeLayer("recording-start-point-layer");
      if (map.getSource("recording-start-point")) map.removeSource("recording-start-point");
    } catch (e) {
      console.warn("Error cleaning up recording layers:", e);
    }
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
    waypointMarkersRef.current.forEach((m) => m.remove());
    waypointMarkersRef.current = [];
    routeSourceAdded.current = false;
    startMarkerAdded.current = false;
  }, [map]);

  useEffect(() => {
    if (hasPersistedSession && isVisible) {
      setHasStarted(false);
    }
  }, [hasPersistedSession, isVisible]);

  useEffect(() => {
    if (!isVisible || !map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 15,
          duration: 1000,
        });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, [isVisible, map]);

  const handleStart = () => {
    if (selectedRoute && onDisplayRoute) {
      onDisplayRoute(selectedRoute);
    }
    setHasStarted(true);
    startRecording(selectedType);
  };

  const handleStop = () => {
    stopRecording();
    setShowSaveDialog(true);
    if (preRecordName.trim()) {
      setActivityName(preRecordName.trim());
    } else {
      setActivityName(
        `${activityType.charAt(0).toUpperCase() + activityType.slice(1)} - ${new Date().toLocaleDateString()}`
      );
    }
  };

  const handleSave = async () => {
    if (!activityName.trim()) {
      toast({ title: "Name required", description: "Please enter a name for your activity", variant: "destructive" });
      return;
    }
    const result = await saveRecording(activityName, isPublic);
    if (result) {
      setShowSaveDialog(false);
      cleanupMapLayers();
      if (onClearDisplayedRoute) onClearDisplayedRoute();
      resetState();
      onClose();
      setLocation(`/activities/${result.id}`);
    }
  };

  const handleDiscard = () => {
    setShowSaveDialog(false);
    discardRecording();
    cleanupMapLayers();
    if (onClearDisplayedRoute) onClearDisplayedRoute();
    resetState();
    onClose();
  };

  const handleCancel = () => {
    if (isRecording) {
      toast({ title: "Stop recording first", description: "Press the stop button before closing" });
      return;
    }
    cleanupMapLayers();
    if (onClearDisplayedRoute) onClearDisplayedRoute();
    resetState();
    onClose();
  };

  const resetState = () => {
    setHasStarted(false);
    setPreRecordName("");
    setSelectedType("hike");
    setActivityName("");
    setIsPublic(false);
    setSelectedRoute(null);
    setShowRouteSelector(false);
    setRouteSearchQuery("");
  };

  if (!isVisible) return null;

  if (!isRecording && !hasStarted) {
    return (
      <div className="absolute inset-0 z-30 pointer-events-none" style={{ top: 0 }}>
        <div className="flex-1" />

        {hasPersistedSession && (
          <div className="absolute top-20 left-0 right-0 pointer-events-auto px-3" style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="bg-amber-900/95 backdrop-blur-md border border-amber-600 rounded-xl p-4 shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                <h3 className="text-amber-100 font-semibold">Recording in Progress</h3>
              </div>
              <p className="text-amber-200/80 text-sm mb-3">
                You have an unfinished activity recording. Would you like to resume where you left off?
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    resumeRecordingFromPersisted();
                    setHasStarted(true);
                  }}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white"
                  size="sm"
                >
                  <Play className="w-4 h-4 mr-1" /> Resume
                </Button>
                <Button
                  onClick={dismissPersistedSession}
                  variant="outline"
                  className="flex-1 border-amber-600 text-amber-200 hover:bg-amber-800"
                  size="sm"
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Discard
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-40 left-0 right-0 pointer-events-auto">
          <div className="mx-3 bg-slate-800/95 backdrop-blur-md border border-slate-700 rounded-2xl p-5 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-white text-lg font-semibold">Record Activity</h2>
              <button
                onClick={handleCancel}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="activityName" className="text-white text-sm font-medium">
                Activity Name
              </Label>
              <Input
                id="activityName"
                value={preRecordName}
                onChange={(e) => setPreRecordName(e.target.value)}
                placeholder={`${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)} - ${new Date().toLocaleDateString()}`}
                className="bg-slate-700 border-slate-600 text-white h-12 text-base"
              />
            </div>

            <div className="space-y-2">
              <label className="text-white text-sm font-medium">Activity Type</label>
              <div className="grid grid-cols-4 gap-3">
                {activityTypes.map(({ type, label, icon }) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                      selectedType === type
                        ? "border-green-500 bg-green-500/20 text-green-400"
                        : "border-slate-600 bg-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {icon}
                    <span className="mt-1.5 text-sm font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Display Saved Route */}
            <div className="space-y-2">
              {!selectedRoute ? (
                <Button
                  variant="outline"
                  className="w-full h-12 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white justify-between"
                  onClick={() => setShowRouteSelector(!showRouteSelector)}
                >
                  <div className="flex items-center gap-2">
                    <MapPinned className="w-5 h-5 text-blue-400" />
                    <span>Display a Saved Route</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showRouteSelector ? "rotate-180" : ""}`} />
                </Button>
              ) : (
                <div className="flex items-center gap-2 bg-green-500/15 border border-green-500/40 rounded-xl px-4 py-3">
                  <MapPinned className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-green-400 text-xs font-medium">Following Route</div>
                    <div className="text-white text-sm font-semibold truncate">{selectedRoute.name}</div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedRoute(null);
                      setShowRouteSelector(false);
                      if (onClearDisplayedRoute) onClearDisplayedRoute();
                    }}
                    className="text-slate-400 hover:text-white p-1 flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {showRouteSelector && !selectedRoute && (
                <div className="bg-slate-700 border border-slate-600 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-600">
                    <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={routeSearchQuery}
                      onChange={(e) => setRouteSearchQuery(e.target.value)}
                      placeholder="Search routes..."
                      className="bg-transparent text-white text-sm w-full outline-none placeholder:text-slate-400"
                      autoFocus
                    />
                  </div>

                  <div className="max-h-48 overflow-y-auto">
                    {filteredRoutes.length === 0 ? (
                      <div className="text-slate-400 text-sm text-center py-4">
                        {userRoutes.length === 0 ? "No saved routes yet" : "No routes match your search"}
                      </div>
                    ) : (
                      filteredRoutes.map((route) => (
                        <button
                          key={route.id}
                          onClick={() => {
                            setSelectedRoute(route);
                            setShowRouteSelector(false);
                            setRouteSearchQuery("");
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-600 transition-colors border-b border-slate-600/50 last:border-b-0"
                        >
                          <div className="text-white text-sm font-medium truncate">{route.name}</div>
                          <div className="text-slate-400 text-xs mt-0.5 flex items-center gap-3">
                            {route.totalDistance && (
                              <span>{(parseFloat(route.totalDistance) / 1609.34).toFixed(1)} mi</span>
                            )}
                            {route.elevationGain && (
                              <span>↑ {Math.round(parseFloat(route.elevationGain) * 3.28084)} ft</span>
                            )}
                            {route.routingMode && (
                              <span className="capitalize">{route.routingMode}</span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button
              size="lg"
              className="w-full h-14 rounded-2xl bg-green-600 hover:bg-green-700 text-white text-xl font-bold shadow-lg shadow-green-900/30"
              onClick={handleStart}
            >
              <Play className="w-6 h-6 mr-3" />
              START RECORDING
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isRecording && hasStarted) {
    return (
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700">
          <DialogHeader>
            <DialogTitle>Save Activity</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-slate-400 text-xs">Distance</div>
                <div className="text-lg font-semibold">{formatDistance(stats.distance)}</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs">Time</div>
                <div className="text-lg font-semibold">{formatDuration(stats.elapsedTime)}</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs">Avg Pace</div>
                <div className="text-lg font-semibold">{formatPace(stats.averagePace)} /mi</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs">Waypoints</div>
                <div className="text-lg font-semibold">{waypoints.length}</div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Activity Name</Label>
              <Input
                id="name"
                value={activityName}
                onChange={(e) => setActivityName(e.target.value)}
                placeholder="Enter activity name"
                className="bg-slate-700 border-slate-600"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="public">Make Public</Label>
              <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleDiscard} className="border-slate-600">
              <Trash2 className="w-4 h-4 mr-2" />
              Discard
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-green-600 hover:bg-green-700">
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-30 pointer-events-auto" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="bg-slate-800/95 backdrop-blur-md border-b border-slate-700 shadow-2xl">
        <div className="flex items-center justify-center gap-1.5 py-1 bg-red-600">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-white text-xs font-semibold">
            Recording {activityType.charAt(0).toUpperCase() + activityType.slice(1)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 px-3 pt-1.5 pb-1">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-[10px]">
              <Timer className="w-2.5 h-2.5" /> Time
            </div>
            <div className="text-base font-mono font-bold text-white">
              {formatDuration(stats.elapsedTime)}
            </div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-[10px]">
              <RouteIcon className="w-2.5 h-2.5" /> Distance
            </div>
            <div className="text-base font-mono font-bold text-white">
              {formatDistance(stats.distance)}
            </div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-[10px]">
              <Gauge className="w-2.5 h-2.5" /> Speed
            </div>
            <div className="text-base font-mono font-bold text-white">
              {formatSpeed(stats.currentSpeed)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1 px-3 pb-1">
          <div className="text-center">
            <div className="text-slate-400 text-[10px]">Avg Speed</div>
            <div className="text-xs font-semibold text-white">{formatSpeed(stats.averageSpeed)}</div>
          </div>
          <div className="text-center">
            <div className="text-slate-400 text-[10px]">Pace</div>
            <div className="text-xs font-semibold text-white">{formatPace(stats.averagePace)} /mi</div>
          </div>
          <div className="text-center">
            <div className="text-slate-400 text-[10px]">↑ Gain</div>
            <div className="text-xs font-semibold text-green-400">{formatElevation(stats.elevationGain)}</div>
          </div>
          <div className="text-center">
            <div className="text-slate-400 text-[10px]">↓ Loss</div>
            <div className="text-xs font-semibold text-red-400">{formatElevation(stats.elevationLoss)}</div>
          </div>
        </div>

        <div className="flex gap-3 px-3 pb-2 justify-center">
          <Button
            size="sm"
            variant="outline"
            className="h-10 px-2.5 rounded-full border-yellow-500 text-yellow-400 hover:bg-yellow-500/20 flex flex-col items-center gap-0"
            onClick={() => addWaypoint()}
          >
            <MapPin className="w-4 h-4" />
            <span className="text-[8px] leading-tight font-medium">Pin</span>
          </Button>

          <Button
            size="sm"
            variant="destructive"
            className="w-11 h-11 rounded-full"
            onClick={handleStop}
          >
            <Square className="w-5 h-5" />
          </Button>

          {isPaused ? (
            <Button
              size="sm"
              className="w-10 h-10 rounded-full bg-green-600 hover:bg-green-700"
              onClick={resumeRecording}
            >
              <Play className="w-5 h-5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="w-10 h-10 rounded-full"
              onClick={pauseRecording}
            >
              <Pause className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
