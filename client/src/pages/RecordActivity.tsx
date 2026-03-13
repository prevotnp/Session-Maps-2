import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useActivityRecording, formatDuration, formatDistance, formatPace, formatSpeed, formatElevation, ActivityType } from "@/hooks/useActivityRecording";
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
  ArrowLeft,
  Play,
  Pause,
  Square,
  Timer,
  Route as RouteIcon,
  TrendingUp,
  Gauge,
  Mountain,
  Footprints,
  Bike,
  Snowflake,
  PersonStanding,
  Loader2,
  Save,
  Trash2,
  MapPin,
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const activityTypes: { type: ActivityType; label: string; icon: React.ReactNode }[] = [
  { type: "run", label: "Run", icon: <Footprints className="w-6 h-6" /> },
  { type: "hike", label: "Hike", icon: <PersonStanding className="w-6 h-6" /> },
  { type: "bike", label: "Bike", icon: <Bike className="w-6 h-6" /> },
  { type: "ski", label: "Ski", icon: <Snowflake className="w-6 h-6" /> },
];

export default function RecordActivity() {
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
  } = useActivityRecording();

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [activityName, setActivityName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [selectedType, setSelectedType] = useState<ActivityType>("hike");
  const [preRecordName, setPreRecordName] = useState("");
  const [hasStarted, setHasStarted] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const waypointMarkers = useRef<mapboxgl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-110.8, 43.5],
      zoom: 13,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.current.on("load", () => {
      // Restyle mountain peak labels: saturated blue + elevation in feet
      try {
        if (map.current?.getLayer('natural-point-label')) {
          map.current.setPaintProperty('natural-point-label', 'text-color', '#4A9FE5');
          map.current.setLayoutProperty('natural-point-label', 'text-field', [
            'case',
            ['has', 'elevation_m'],
            ['concat',
              ['get', 'name'],
              '\n',
              ['number-format', ['round', ['*', ['get', 'elevation_m'], 3.28084]], { 'locale': 'en-US' }],
              ' ft'
            ],
            ['get', 'name']
          ]);
        }
      } catch (e) { /* layer may not exist */ }

      map.current!.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [],
          },
        },
      });

      map.current!.addLayer({
        id: "route-outline",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#000000",
          "line-width": 5,
          "line-opacity": 0.4,
        },
      });

      map.current!.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#22c55e",
          "line-width": 3,
        },
      });

      setMapReady(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!map.current || !currentPosition) return;

    if (!userMarker.current) {
      const el = document.createElement("div");
      el.className = "user-location-marker";
      el.innerHTML = `
        <div style="
          width: 20px;
          height: 20px;
          background: #3b82f6;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        "></div>
      `;

      userMarker.current = new mapboxgl.Marker({ element: el })
        .setLngLat([currentPosition.longitude, currentPosition.latitude])
        .addTo(map.current);

      map.current.flyTo({
        center: [currentPosition.longitude, currentPosition.latitude],
        zoom: 16,
      });
    } else {
      userMarker.current.setLngLat([currentPosition.longitude, currentPosition.latitude]);
      if (isRecording && !isPaused) {
        map.current.easeTo({
          center: [currentPosition.longitude, currentPosition.latitude],
          duration: 500,
        });
      }
    }
  }, [currentPosition, isRecording, isPaused]);

  useEffect(() => {
    if (!map.current || !mapReady) return;

    const source = map.current.getSource("route") as mapboxgl.GeoJSONSource;
    if (!source) return;

    const coordinates = trackPoints.map((p) => [p.longitude, p.latitude]);

    source.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates,
      },
    });

    if (coordinates.length >= 1 && !map.current.getLayer('start-point')) {
      map.current.addSource('start-point', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: coordinates[0] },
        },
      });
      map.current.addLayer({
        id: 'start-point',
        type: 'circle',
        source: 'start-point',
        paint: {
          'circle-radius': 8,
          'circle-color': '#22c55e',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });
    }
  }, [trackPoints, mapReady]);

  useEffect(() => {
    if (!map.current) return;
    waypointMarkers.current.forEach(m => m.remove());
    waypointMarkers.current = [];
    waypoints.forEach((wp, index) => {
      const el = document.createElement('div');
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="background: #eab308; color: #000; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-bottom: 2px; white-space: nowrap;">${wp.name}</div>
          <div style="width: 14px; height: 14px; background: #eab308; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>
        </div>
      `;
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([wp.longitude, wp.latitude])
        .addTo(map.current!);
      waypointMarkers.current.push(marker);
    });
  }, [waypoints]);

  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
      if (isRecording && 'wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.warn('Wake Lock failed:', err);
        }
      }
    };
    if (isRecording) {
      requestWakeLock();
    }
    return () => {
      if (wakeLock) {
        wakeLock.release();
      }
    };
  }, [isRecording]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (map.current) {
          map.current.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 15,
            duration: 1000,
          });
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, []);

  const handleStart = () => {
    setHasStarted(true);
    startRecording(selectedType);
  };

  const handleStop = () => {
    stopRecording();
    setShowSaveDialog(true);
    if (preRecordName.trim()) {
      setActivityName(preRecordName.trim());
    } else {
      setActivityName(`${activityType.charAt(0).toUpperCase() + activityType.slice(1)} - ${new Date().toLocaleDateString()}`);
    }
  };

  const handleSave = async () => {
    if (!activityName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a name for your activity",
        variant: "destructive",
      });
      return;
    }

    const result = await saveRecording(activityName, isPublic);
    if (result) {
      setShowSaveDialog(false);
      setLocation(`/activities/${result.id}`);
    }
  };

  const handleDiscard = () => {
    setShowSaveDialog(false);
    discardRecording();
    setHasStarted(false);
    setPreRecordName("");
    setSelectedType("hike");
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-white">Please log in to record activities</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900">
      <div className="flex items-center justify-between p-4 bg-slate-800">
        <Button
          variant="ghost"
          size="icon"
          className="text-white"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-semibold text-white">
          {isRecording
            ? `Recording ${activityType.charAt(0).toUpperCase() + activityType.slice(1)}`
            : hasStarted
            ? 'Activity Complete'
            : 'Record Activity'}
        </h1>
        <div className="w-10" />
      </div>

      <div ref={mapContainer} className="flex-1" />

      {!isRecording && !hasStarted ? (
        <div className="absolute inset-0 z-20 flex flex-col" style={{ top: '56px' }}>
          <div className="flex-1 relative">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          </div>

          <div className="bg-slate-800 border-t border-slate-700 p-6 space-y-6">
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
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                      selectedType === type
                        ? 'border-green-500 bg-green-500/20 text-green-400'
                        : 'border-slate-600 bg-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {icon}
                    <span className="mt-2 text-sm font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <Button
              size="lg"
              className="w-full h-16 rounded-2xl bg-green-600 hover:bg-green-700 text-white text-xl font-bold shadow-lg shadow-green-900/30"
              onClick={handleStart}
            >
              <Play className="w-6 h-6 mr-3" />
              START RECORDING
            </Button>

            <button
              onClick={() => setLocation("/")}
              className="w-full text-center text-slate-400 text-sm py-2 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !isRecording && hasStarted ? (
        null
      ) : (
        <>
          {/* Primary Stats - Large */}
          <div className="grid grid-cols-3 gap-2 p-4 bg-slate-800">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
                <Timer className="w-3 h-3" /> Time
              </div>
              <div className="text-2xl font-mono font-bold text-white">
                {formatDuration(stats.elapsedTime)}
              </div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
                <RouteIcon className="w-3 h-3" /> Distance
              </div>
              <div className="text-2xl font-mono font-bold text-white">
                {formatDistance(stats.distance)}
              </div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
                <Gauge className="w-3 h-3" /> Speed
              </div>
              <div className="text-2xl font-mono font-bold text-white">
                {formatSpeed(stats.currentSpeed)}
              </div>
            </div>
          </div>

          {/* Secondary Stats - Smaller */}
          <div className="grid grid-cols-4 gap-2 px-4 pb-2 bg-slate-800">
            <div className="text-center">
              <div className="text-slate-400 text-xs mb-0.5">Avg Speed</div>
              <div className="text-sm font-semibold text-white">
                {formatSpeed(stats.averageSpeed)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-slate-400 text-xs mb-0.5">Pace</div>
              <div className="text-sm font-semibold text-white">
                {formatPace(stats.averagePace)} /mi
              </div>
            </div>
            <div className="text-center">
              <div className="text-slate-400 text-xs mb-0.5">↑ Gain</div>
              <div className="text-sm font-semibold text-green-400">
                {formatElevation(stats.elevationGain)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-slate-400 text-xs mb-0.5">↓ Loss</div>
              <div className="text-sm font-semibold text-red-400">
                {formatElevation(stats.elevationLoss)}
              </div>
            </div>
          </div>

          <div className="flex gap-4 p-4 pt-0 bg-slate-800 justify-center">
            <Button
              size="lg"
              variant="outline"
              className="w-16 h-16 rounded-full border-yellow-500 text-yellow-400 hover:bg-yellow-500/20"
              onClick={() => addWaypoint()}
            >
              <MapPin className="w-6 h-6" />
            </Button>
            <Button
              size="lg"
              variant="destructive"
              className="w-16 h-16 rounded-full"
              onClick={handleStop}
            >
              <Square className="w-6 h-6" />
            </Button>
            
            {isPaused ? (
              <Button
                size="lg"
                className="w-16 h-16 rounded-full bg-green-600 hover:bg-green-700"
                onClick={resumeRecording}
              >
                <Play className="w-6 h-6" />
              </Button>
            ) : (
              <Button
                size="lg"
                variant="secondary"
                className="w-16 h-16 rounded-full"
                onClick={pauseRecording}
              >
                <Pause className="w-6 h-6" />
              </Button>
            )}
          </div>
        </>
      )}

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
              <Switch
                id="public"
                checked={isPublic}
                onCheckedChange={setIsPublic}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleDiscard}
              className="border-slate-600"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Discard
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
