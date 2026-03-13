import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDuration, formatDistance, formatPace, formatSpeed, formatElevation } from "@/hooks/useActivityRecording";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Timer,
  Route as RouteIcon,
  TrendingUp,
  Gauge,
  Mountain,
  Calendar,
  Loader2,
  Trash2,
  Edit,
  Share2,
  Footprints,
  Bike,
  Snowflake,
  PersonStanding,
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Activity, User } from "@shared/schema";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const activityIcons: Record<string, React.ReactNode> = {
  run: <Footprints className="w-5 h-5" />,
  hike: <PersonStanding className="w-5 h-5" />,
  bike: <Bike className="w-5 h-5" />,
  ski: <Snowflake className="w-5 h-5" />,
};

export default function ActivityDetail() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const { user } = useAuth() as { user: User | undefined };
  const { toast } = useToast();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editName, setEditName] = useState("");
  const [editIsPublic, setEditIsPublic] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const { data: activity, isLoading, error } = useQuery<Activity>({
    queryKey: ["/api/activities", params.id],
    queryFn: async () => {
      const res = await fetch(`/api/activities/${params.id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json();
    },
    enabled: !!params.id,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Activity>) => {
      const response = await apiRequest("PATCH", `/api/activities/${params.id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      setShowEditDialog(false);
      toast({
        title: "Activity updated",
        description: "Your changes have been saved",
      });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Could not save changes",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/activities/${params.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      toast({
        title: "Activity deleted",
        description: "Your activity has been removed",
      });
      setLocation("/");
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete activity",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!mapContainer.current || !activity?.pathCoordinates) return;

    let coordinates: [number, number][] = [];
    try {
      coordinates = JSON.parse(activity.pathCoordinates);
    } catch {
      return;
    }

    if (coordinates.length === 0) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: coordinates[0],
      zoom: 14,
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
            coordinates,
          },
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
          "line-width": 4,
        },
      });

      new mapboxgl.Marker({ color: "#22c55e" })
        .setLngLat(coordinates[0])
        .addTo(map.current!);

      new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat(coordinates[coordinates.length - 1])
        .addTo(map.current!);

      const bounds = new mapboxgl.LngLatBounds();
      coordinates.forEach((coord) => bounds.extend(coord));
      map.current!.fitBounds(bounds, { padding: 50 });
    });

    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, [activity?.pathCoordinates]);

  const handleEdit = () => {
    if (!activity) return;
    setEditName(activity.name);
    setEditIsPublic(activity.isPublic || false);
    setShowEditDialog(true);
  };

  const handleSaveEdit = () => {
    updateMutation.mutate({
      name: editName,
      isPublic: editIsPublic,
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-900 text-white">
        <p className="mb-4">Activity not found</p>
        <Button onClick={() => setLocation("/")}>Go Home</Button>
      </div>
    );
  }

  const isOwner = user?.id === activity.userId;
  const distance = parseFloat(activity.distanceMeters || "0");
  const elapsedTime = activity.elapsedTimeSeconds || 0;
  const movingTime = activity.movingTimeSeconds || 0;
  const avgSpeed = parseFloat(activity.avgSpeedMps || "0");
  const maxSpeed = parseFloat(activity.maxSpeedMps || "0");
  const avgPace = (activity.paceSecondsPerMile || 0) / 1.60934;
  const elevGain = parseFloat(activity.elevationGainMeters || "0");
  const elevLoss = parseFloat(activity.elevationLossMeters || "0");

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
        <div className="flex items-center gap-2 text-white">
          {activityIcons[activity.activityType] || <RouteIcon className="w-5 h-5" />}
          <h1 className="text-lg font-semibold">{activity.name}</h1>
        </div>
        {isOwner && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-white"
              onClick={handleEdit}
            >
              <Edit className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>
        )}
      </div>

      <div ref={mapContainer} className="h-64 flex-shrink-0" />

      <div className="flex-1 overflow-auto p-4">
        <div className="flex items-center gap-2 text-slate-400 text-sm mb-4">
          <Calendar className="w-4 h-4" />
          <span>
            {new Date(activity.startTime).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
          <span>at</span>
          <span>
            {new Date(activity.startTime).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
              <RouteIcon className="w-3 h-3" /> Distance
            </div>
            <div className="text-2xl font-bold text-white">
              {formatDistance(distance)}
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
              <Timer className="w-3 h-3" /> Duration
            </div>
            <div className="text-2xl font-bold text-white">
              {formatDuration(elapsedTime)}
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-slate-400 text-xs mb-1">
              <TrendingUp className="w-3 h-3" /> Pace
            </div>
            <div className="text-2xl font-bold text-white">
              {formatPace(avgPace)} /mi
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg p-4 mb-6">
          <h3 className="text-white font-semibold mb-4">Statistics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-slate-400 text-xs mb-1">Moving Time</div>
              <div className="text-white font-semibold">{formatDuration(movingTime)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Average Speed</div>
              <div className="text-white font-semibold">{formatSpeed(avgSpeed)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Max Speed</div>
              <div className="text-white font-semibold">{formatSpeed(maxSpeed)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Activity Type</div>
              <div className="text-white font-semibold capitalize">{activity.activityType}</div>
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-white font-semibold mb-4">Elevation</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1 text-slate-400 text-xs mb-1">
                <Mountain className="w-3 h-3" /> Gain
              </div>
              <div className="text-white font-semibold text-green-400">
                +{formatElevation(elevGain)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-slate-400 text-xs mb-1">
                <Mountain className="w-3 h-3 rotate-180" /> Loss
              </div>
              <div className="text-white font-semibold text-red-400">
                -{formatElevation(elevLoss)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700">
          <DialogHeader>
            <DialogTitle>Edit Activity</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editName">Activity Name</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-slate-700 border-slate-600"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="editPublic">Make Public</Label>
              <Switch
                id="editPublic"
                checked={editIsPublic}
                onCheckedChange={setEditIsPublic}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              className="border-slate-600"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {updateMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-slate-800 text-white border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Activity</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Are you sure you want to delete this activity? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
