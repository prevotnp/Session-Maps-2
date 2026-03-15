import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { X, Plus, Route as RouteIcon, Mountain, Pencil, Sparkles, Wand2, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Waypoint, Route } from '@shared/schema';
import mapboxgl from 'mapbox-gl';

interface RouteBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  map: mapboxgl.Map | null;
  existingWaypoints: Waypoint[];
  onRouteCreated?: (route: Route) => void;
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

const ROUTE_COLORS: Record<string, string> = {
  blue: '#3B82F6',
  orange: '#F97316',
  green: '#22C55E',
};

export default function RouteBuilderModal({
  isOpen,
  onClose,
  map,
  existingWaypoints,
  onRouteCreated
}: RouteBuilderModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Creation form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [routingMode, setRoutingMode] = useState<'direct' | 'road' | 'trail' | 'draw'>('direct');
  const [trailProfile, setTrailProfile] = useState<TrailProfile>('foot-hiking');
  const [isPublic, setIsPublic] = useState(false);
  const [activityType, setActivityType] = useState<'hiking' | 'running' | 'skiing' | 'river' | 'cycling'>('hiking');

  // AI route generation state
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGeneratingAiRoute, setIsGeneratingAiRoute] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
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

  // Waypoints from AI (to include in creation if AI route is applied)
  const [aiWaypoints, setAiWaypoints] = useState<Array<{
    name: string;
    lngLat: [number, number];
    elevation: number | null;
  }>>([]);

  const previewClickHandlersRef = useRef<Map<string, (e: any) => void>>(new Map());
  const previewEnterHandlersRef = useRef<Map<string, () => void>>(new Map());
  const previewLeaveHandlersRef = useRef<Map<string, () => void>>(new Map());

  // Create route mutation — saves to DB and hands off to RouteSummaryPanel
  const createRouteMutation = useMutation({
    mutationFn: async (routeData: any) => {
      const res = await apiRequest("POST", "/api/routes", routeData);
      return await res.json();
    },
    onSuccess: (savedRoute: Route) => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({
        title: "Route created",
        description: aiWaypoints.length > 0
          ? `Route created with ${aiWaypoints.length} AI-generated waypoints.`
          : "Click on the map to add waypoints.",
      });
      handleClose();
      if (onRouteCreated) {
        onRouteCreated(savedRoute);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving route",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Clear AI preview routes from map
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

  // Draw AI preview routes on map
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

  // Generate AI route
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
      if (routingMode === 'road') activityType = 'general';

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
  }, [aiPrompt, routingMode, map, aiConversationHistory, clearPreviewRoutes, drawPreviewRoutes]);

  // Apply an AI-generated route option
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

    // Store AI waypoints to include in creation
    setAiWaypoints(waypointCoordinates);

    // Auto-fill name and description if empty
    if (!name.trim()) setName(option.label || "AI Generated Route");
    if (!description.trim()) setDescription(option.description || "");

    setShowAiPrompt(false);
    setAiPrompt("");
    setAiResponse(null);
    setAiRouteOptions(null);
    setAiConversationHistory([]);

    toast({
      title: "Route applied!",
      description: `${waypointCoordinates.length} waypoints will be added when you save. Click "Save & Add Waypoints" to create the route.`,
    });
  }, [clearPreviewRoutes, name, description, toast]);

  // Save route and transition to waypoint building
  const saveRouteAndAddWaypoints = () => {
    if (!name.trim()) {
      toast({
        title: "Route name required",
        description: "Please enter a name for your route.",
        variant: "destructive",
      });
      return;
    }

    // Build route data — empty waypoints if no AI route, or AI waypoints if applied
    const waypointCoordinates = aiWaypoints.length > 0 ? aiWaypoints : [];
    const pathCoordinates = waypointCoordinates.length >= 2
      ? waypointCoordinates.map(wp => wp.lngLat)
      : [];

    createRouteMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      routingMode,
      trailProfile: routingMode === 'trail' ? trailProfile : undefined,
      activityType,
      isPublic,
      waypointIds: JSON.stringify([]),
      pathCoordinates: JSON.stringify(pathCoordinates),
      waypointCoordinates: JSON.stringify(waypointCoordinates),
      totalDistance: "0",
    });
  };

  // Reset modal state when closed
  const handleClose = () => {
    setName('');
    setDescription('');
    setRoutingMode('direct');
    setTrailProfile('foot-hiking');
    setActivityType('hiking');
    setIsPublic(false);
    setAiWaypoints([]);
    setShowAiPrompt(false);
    setAiPrompt("");
    setAiError(null);
    setIsGeneratingAiRoute(false);
    setAiResponse(null);
    setAiRouteOptions(null);
    setAiConversationHistory([]);
    setAiPreviewRoutes(null);
    clearPreviewRoutes();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="!fixed !left-0 !right-0 !top-0 !h-auto !max-h-[70vh] !w-full !max-w-full !translate-x-0 !translate-y-0 !rounded-none !rounded-b-xl !border-b !border-t-0 !border-l-0 !border-r-0 sm:!left-auto sm:!right-0 sm:!h-full sm:!max-h-full sm:!max-w-md sm:!rounded-none sm:!border-l sm:!border-b-0 sm:!border-r-0 data-[state=open]:!slide-in-from-top sm:data-[state=open]:!slide-in-from-right data-[state=closed]:!slide-out-to-top sm:data-[state=closed]:!slide-out-to-right overflow-y-auto pointer-events-auto">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5" />
            New Route
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Route Name */}
          <div>
            <Label htmlFor="routeName" className="text-xs">Route Name *</Label>
            <Input
              id="routeName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter route name..."
              autoComplete="off"
              className="h-8"
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="routeDescription" className="text-xs">Description</Label>
            <Textarea
              id="routeDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter route description..."
              rows={2}
              autoComplete="off"
              className="text-sm"
            />
          </div>

          {/* Routing Mode */}
          <div>
            <Label className="text-xs">Routing Mode</Label>
            <div className="grid grid-cols-4 gap-1 mt-1">
              <button
                type="button"
                className={`p-2 border rounded text-xs font-medium transition-colors ${
                  routingMode === 'direct'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-border'
                }`}
                onClick={() => setRoutingMode('direct')}
                data-testid="button-routing-direct"
              >
                <RouteIcon className="h-3 w-3 mx-auto mb-0.5" />
                <span>Direct</span>
              </button>
              <button
                type="button"
                className={`p-2 border rounded text-xs font-medium transition-colors ${
                  routingMode === 'road'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-border'
                }`}
                onClick={() => setRoutingMode('road')}
                data-testid="button-routing-road"
              >
                <RouteIcon className="h-3 w-3 mx-auto mb-0.5" />
                <span>Road</span>
              </button>
              <button
                type="button"
                className={`p-2 border rounded text-xs font-medium transition-colors ${
                  routingMode === 'trail'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-border'
                }`}
                onClick={() => setRoutingMode('trail')}
                data-testid="button-routing-trail"
              >
                <Mountain className="h-3 w-3 mx-auto mb-0.5" />
                <span>Trails</span>
              </button>
              <button
                type="button"
                className={`p-2 border rounded text-xs font-medium transition-colors ${
                  routingMode === 'draw'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted border-border'
                }`}
                onClick={() => setRoutingMode('draw')}
                data-testid="button-routing-draw"
              >
                <Pencil className="h-3 w-3 mx-auto mb-0.5" />
                <span>Draw</span>
              </button>
            </div>
            {routingMode === 'trail' && (
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Activity Type</Label>
                <div className="grid grid-cols-3 gap-1 mt-1">
                  {TRAIL_PROFILE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`p-1.5 border rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-1 ${
                        trailProfile === option.value
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-background hover:bg-muted border-border'
                      }`}
                      onClick={() => setTrailProfile(option.value)}
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

          {/* Activity Type */}
          <div>
            <Label className="text-xs">Activity Type</Label>
            <div className="grid grid-cols-5 gap-1 mt-1">
              {([
                { value: 'hiking' as const, label: 'Hiking', icon: '🥾', color: 'bg-yellow-600' },
                { value: 'running' as const, label: 'Running', icon: '🏃', color: 'bg-yellow-600' },
                { value: 'skiing' as const, label: 'Skiing', icon: '⛷️', color: 'bg-blue-600' },
                { value: 'river' as const, label: 'River', icon: '🛶', color: 'bg-red-600' },
                { value: 'cycling' as const, label: 'Cycling', icon: '🚴', color: 'bg-pink-600' },
              ]).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`p-1.5 border rounded text-[11px] font-medium transition-colors flex flex-col items-center justify-center gap-0.5 ${
                    activityType === option.value
                      ? `${option.color} text-white border-transparent`
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                  onClick={() => setActivityType(option.value)}
                  data-testid={`button-activity-${option.value}`}
                >
                  <span className="text-sm">{option.icon}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* AI Route Generation */}
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
                      : routingMode === 'trail'
                      ? "e.g., Build me a hiking loop around Jenny Lake starting from the South Jenny Lake trailhead"
                      : routingMode === 'road'
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
                      {routingMode === 'trail' && "Trail mode: AI searches real trails & community routes, then places waypoints at trail junctions."}
                      {routingMode === 'road' && "Road mode: AI places waypoints at key intersections. Mapbox routes on real roads."}
                      {routingMode === 'direct' && "Direct mode: AI places waypoints along the route. Lines are straight between points."}
                      {routingMode === 'draw' && "Draw mode: AI places waypoints as a starting draft. You can reshape by dragging."}
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

          {/* AI waypoints indicator */}
          {aiWaypoints.length > 0 && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-2.5 text-xs text-purple-300 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{aiWaypoints.length} AI-generated waypoints will be added to this route</span>
            </div>
          )}

          {/* Public toggle */}
          <div className="flex items-center space-x-2">
            <Switch
              id="public-route"
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
            <Label htmlFor="public-route" className="text-xs">Make route public</Label>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} className="flex-1 h-8 text-xs">
                Cancel
              </Button>
              <Button
                onClick={saveRouteAndAddWaypoints}
                disabled={!name.trim() || createRouteMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700 h-8 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                {createRouteMutation.isPending ? 'Saving...' : 'Save & Add Waypoints'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
