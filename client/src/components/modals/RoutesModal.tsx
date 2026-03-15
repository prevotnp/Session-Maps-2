import { useState } from 'react';
import { useLocation } from 'wouter';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Route as RouteIcon, Map, Clock, Ruler, Mountain, X, UserPlus, Trash2, Share2, Box, Search, Check, Calendar, ChevronDown, Activity } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Route } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface RoutesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRoute: (route: Route) => void;
  onDisplayAllRoutes?: (routes: Route[]) => void;
}

interface RouteWithSharing extends Route {
  isOwner?: boolean;
  isShared?: boolean;
  shareCount?: number;
}

interface ShareInfo {
  id: number;
  sharedWithUserId: number;
  sharedWithUsername: string;
  sharedAt: string;
}

const ACTIVITY_TYPE_OPTIONS = [
  { value: 'skiing', label: 'Ski', icon: '⛷️', color: '#3B82F6' },
  { value: 'hiking', label: 'Hike/Run', icon: '🥾', color: '#EAB308' },
  { value: 'river', label: 'River Trip', icon: '🛶', color: '#EF4444' },
  { value: 'cycling', label: 'Cycling', icon: '🚴', color: '#EC4899' },
];

const getActivityLabel = (activityType: string | null | undefined) => {
  if (!activityType) return ACTIVITY_TYPE_OPTIONS[1]; // default to Hike/Run
  // Map 'running' to 'hiking' option (Hike/Run)
  const mappedType = activityType === 'running' ? 'hiking' : activityType;
  return ACTIVITY_TYPE_OPTIONS.find(a => a.value === mappedType) || ACTIVITY_TYPE_OPTIONS[1];
};

const RoutesModal: React.FC<RoutesModalProps> = ({ isOpen, onClose, onSelectRoute, onDisplayAllRoutes }) => {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedRouteForSharing, setSelectedRouteForSharing] = useState<RouteWithSharing | null>(null);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'my-maps' | 'shared'>('my-maps');
  const [activityDropdownRouteId, setActivityDropdownRouteId] = useState<number | null>(null);

  // Fetch saved routes
  const { data: routes = [], isLoading } = useQuery<RouteWithSharing[]>({
    queryKey: ['/api/routes'],
    enabled: isOpen
  });

  // Fetch shares for selected route
  const { data: routeShares = [] } = useQuery<ShareInfo[]>({
    queryKey: ['/api/routes', selectedRouteForSharing?.id, 'shares'],
    enabled: shareModalOpen && !!selectedRouteForSharing,
  });

  // Fetch user's friends list for the share modal
  const { data: friendsList = [] } = useQuery<Array<{ id: number; friend: { id: number; username: string; fullName: string | null } }>>({
    queryKey: ['/api/friends'],
    enabled: shareModalOpen,
  });

  // Filter friends by search and exclude already-shared users
  const alreadySharedIds = new Set(routeShares.map(s => s.sharedWithUserId));
  const availableFriends = friendsList
    .map(f => f.friend)
    .filter(f => !alreadySharedIds.has(f.id))
    .filter(f => {
      if (!friendSearchQuery.trim()) return true;
      const q = friendSearchQuery.toLowerCase();
      return f.username.toLowerCase().includes(q) || (f.fullName?.toLowerCase().includes(q) ?? false);
    });

  // Share route mutation
  const shareMutation = useMutation({
    mutationFn: async ({ routeId, identifier }: { routeId: number; identifier: string }) => {
      return apiRequest('POST', `/api/routes/${routeId}/share`, { emailOrUsername: identifier });
    },
    onSuccess: () => {
      toast({ title: 'Route shared successfully!' });
      setFriendSearchQuery('');
      queryClient.invalidateQueries({ queryKey: ['/api/routes', selectedRouteForSharing?.id, 'shares'] });
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
    },
    onError: (error: any) => {
      toast({ 
        title: 'Failed to share route', 
        description: error.message || 'Could not find user with that username or email',
        variant: 'destructive' 
      });
    }
  });

  // Revoke share mutation
  const revokeMutation = useMutation({
    mutationFn: async ({ routeId, shareId }: { routeId: number; shareId: number }) => {
      return apiRequest('DELETE', `/api/routes/${routeId}/shares/${shareId}`);
    },
    onSuccess: () => {
      toast({ title: 'Share revoked' });
      queryClient.invalidateQueries({ queryKey: ['/api/routes', selectedRouteForSharing?.id, 'shares'] });
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
    },
    onError: () => {
      toast({ title: 'Failed to revoke share', variant: 'destructive' });
    }
  });

  // Delete route mutation
  const deleteMutation = useMutation({
    mutationFn: async (routeId: number) => {
      return apiRequest('DELETE', `/api/routes/${routeId}`);
    },
    onSuccess: () => {
      toast({ title: 'Route deleted' });
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
    },
    onError: () => {
      toast({ title: 'Failed to delete route', variant: 'destructive' });
    }
  });

  // Toggle public mutation
  const togglePublicMutation = useMutation({
    mutationFn: async ({ routeId, isPublic }: { routeId: number; isPublic: boolean }) => {
      return apiRequest('PATCH', `/api/routes/${routeId}`, { isPublic });
    },
    onSuccess: (_, variables) => {
      toast({ 
        title: variables.isPublic ? 'Route is now public' : 'Route is now private',
        description: variables.isPublic ? 'Anyone can see this route on Explore' : 'Only you and shared friends can see this route'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/routes/public'] });
    },
    onError: () => {
      toast({ title: 'Failed to update route visibility', variant: 'destructive' });
    }
  });

  // Update activity type mutation
  const updateActivityMutation = useMutation({
    mutationFn: async ({ routeId, activityType }: { routeId: number; activityType: string }) => {
      return apiRequest('PATCH', `/api/routes/${routeId}`, { activityType });
    },
    onSuccess: () => {
      toast({ title: 'Activity type updated' });
      queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/routes/public'] });
      setActivityDropdownRouteId(null);
    },
    onError: () => {
      toast({ title: 'Failed to update activity type', variant: 'destructive' });
    }
  });

  const handleTogglePublic = (route: RouteWithSharing, e: React.MouseEvent) => {
    e.stopPropagation();
    togglePublicMutation.mutate({ routeId: route.id, isPublic: !route.isPublic });
  };

  const handleDeleteRoute = (route: RouteWithSharing, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete "${route.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(route.id);
    }
  };

  // Separate routes into owned and shared
  const myRoutes = routes.filter(r => r.isOwner !== false);
  const sharedWithMe = routes.filter(r => r.isShared === true);

  const sortRoutesBySearch = (routeList: RouteWithSharing[]) => {
    if (!searchQuery.trim()) return routeList;
    const query = searchQuery.toLowerCase().trim();
    const matches: RouteWithSharing[] = [];
    const nonMatches: RouteWithSharing[] = [];
    for (const route of routeList) {
      const nameMatch = route.name?.toLowerCase().includes(query);
      const descMatch = route.description?.toLowerCase().includes(query);
      if (nameMatch || descMatch) {
        matches.push(route);
      } else {
        nonMatches.push(route);
      }
    }
    matches.sort((a, b) => {
      const aNameMatch = a.name?.toLowerCase().includes(query) ? 0 : 1;
      const bNameMatch = b.name?.toLowerCase().includes(query) ? 0 : 1;
      return aNameMatch - bNameMatch;
    });
    return [...matches, ...nonMatches];
  };

  const filteredMyRoutes = sortRoutesBySearch(myRoutes);
  const filteredSharedRoutes = sortRoutesBySearch(sharedWithMe);

  const matchingRouteIds = new Set<number>();
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    for (const route of routes) {
      if (
        route.name?.toLowerCase().includes(query) ||
        route.description?.toLowerCase().includes(query)
      ) {
        matchingRouteIds.add(route.id);
      }
    }
  }

  const formatDistance = (distance: string | number) => {
    const distanceNum = typeof distance === 'string' ? parseFloat(distance) : distance;
    const miles = distanceNum / 1609.34;
    if (miles < 0.1) {
      const feet = distanceNum * 3.28084;
      return `${Math.round(feet)} ft`;
    }
    return `${miles.toFixed(2)} mi`;
  };

  const formatTime = (time: string | number) => {
    const timeNum = typeof time === 'string' ? parseInt(time) : time;
    if (timeNum < 60) {
      return `${timeNum}min`;
    }
    return `${Math.floor(timeNum / 60)}h ${timeNum % 60}min`;
  };

  const formatElevation = (elevation: string | number) => {
    const elevationNum = typeof elevation === 'string' ? parseFloat(elevation) : elevation;
    const feet = elevationNum * 3.28084;
    return `${Math.round(feet)} ft`;
  };

  const formatTripDates = (startTime: string | Date | null | undefined, endTime: string | Date | null | undefined) => {
    if (!startTime) return null;
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : null;

    const formatDate = (d: Date) => {
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    };
    const formatTime12 = (d: Date) => {
      let h = d.getHours();
      const m = d.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    if (!end) {
      return `${formatDate(start)} ${formatTime12(start)}`;
    }

    const startDate = formatDate(start);
    const endDate = formatDate(end);

    if (startDate === endDate) {
      // Same day
      return `${startDate} · ${formatTime12(start)} - ${formatTime12(end)}`;
    }

    // Multi-day: calculate duration
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return `${startDate} - ${endDate} · ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  };

  const handleRouteClick = (route: Route) => {
    if ((route as any).cesiumTilesetId) {
      navigate(`/cesium/${(route as any).cesiumTilesetId}?routeId=${route.id}`);
      onClose();
      return;
    }
    onSelectRoute(route);
    onClose();
  };

  const handleShareRoute = (route: RouteWithSharing, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRouteForSharing(route);
    setShareModalOpen(true);
  };

  const handleShareWithFriend = (username: string) => {
    if (!selectedRouteForSharing) return;
    shareMutation.mutate({
      routeId: selectedRouteForSharing.id,
      identifier: username
    });
  };

  const handleRevokeShare = (shareId: number) => {
    if (!selectedRouteForSharing) return;
    revokeMutation.mutate({ 
      routeId: selectedRouteForSharing.id, 
      shareId 
    });
  };

  const RouteCard = ({ route, isSharedRoute = false }: { route: RouteWithSharing; isSharedRoute?: boolean }) => {
    const pathCoordinates = JSON.parse(route.pathCoordinates || '[]');
    const waypointCount = pathCoordinates.length;
    
    const getVisibilityLabel = () => {
      if (route.isPublic) return { text: 'Public', className: 'text-green-600 dark:text-green-400' };
      if ((route.shareCount || 0) > 0) return { text: 'Shared with Friends', className: 'text-blue-600 dark:text-blue-400' };
      return { text: 'Private', className: 'text-gray-500 dark:text-gray-400' };
    };
    
    const visibility = getVisibilityLabel();
    
    return (
      <div
        key={route.id}
        className="border rounded-lg p-4 hover:bg-accent/50 cursor-pointer transition-colors"
        onClick={() => handleRouteClick(route)}
        data-testid={`route-card-${route.id}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-lg">{route.name}</h3>
              {(route as any).cesiumTilesetId && (
                <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-xs">
                  <Box className="w-3 h-3 mr-1" />
                  3D
                </Badge>
              )}
              <span className={`text-sm ${visibility.className}`}>• {visibility.text}</span>
            </div>
            {route.description && (
              <p className="text-muted-foreground text-sm mt-1">
                {route.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-2">
            {isSharedRoute && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                Shared with You
              </Badge>
            )}
            {!isSharedRoute && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={(e) => handleDeleteRoute(route, e)}
                data-testid={`button-delete-route-${route.id}`}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete Route
              </Button>
            )}
          </div>
        </div>
        
        {/* Activity type selector */}
        <div className="flex items-center gap-2 text-sm mb-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Activity:</span>
          {!isSharedRoute ? (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActivityDropdownRouteId(activityDropdownRouteId === route.id ? null : route.id);
                }}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent/50 hover:bg-accent transition-colors"
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: getActivityLabel(route.activityType).color }}
                />
                <span className="font-medium">{getActivityLabel(route.activityType).icon} {getActivityLabel(route.activityType).label}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
              {activityDropdownRouteId === route.id && (
                <div className="absolute left-0 top-full mt-1 w-44 bg-background border rounded-lg shadow-lg z-50 overflow-hidden">
                  {ACTIVITY_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateActivityMutation.mutate({ routeId: route.id, activityType: option.value });
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors ${
                        getActivityLabel(route.activityType).value === option.value ? 'bg-accent/50 font-medium' : ''
                      }`}
                    >
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: option.color }} />
                      <span>{option.icon}</span>
                      <span>{option.label}</span>
                      {getActivityLabel(route.activityType).value === option.value && (
                        <Check className="h-3.5 w-3.5 ml-auto text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: getActivityLabel(route.activityType).color }}
              />
              <span className="font-medium">{getActivityLabel(route.activityType).icon} {getActivityLabel(route.activityType).label}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-muted-foreground" />
            <span>{waypointCount} waypoints</span>
          </div>

          {route.totalDistance && (
            <div className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-muted-foreground" />
              <span>{formatDistance(route.totalDistance)}</span>
            </div>
          )}

          {route.estimatedTime && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>{formatTime(route.estimatedTime)}</span>
            </div>
          )}

          {route.elevationGain && parseFloat(route.elevationGain) > 0 && (
            <div className="flex items-center gap-2">
              <Mountain className="h-4 w-4 text-muted-foreground" />
              <span>+{formatElevation(route.elevationGain)}</span>
            </div>
          )}
        </div>

        {/* Trip dates */}
        {route.startTime && (
          <div className="flex items-center gap-2 mt-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{formatTripDates(route.startTime, route.endTime)}</span>
          </div>
        )}
        
        <div className="mt-3 pt-3 border-t flex flex-wrap gap-2">
          <Button 
            size="sm" 
            className="flex-1 min-w-[100px] bg-blue-600 hover:bg-blue-700 text-white"
            onClick={(e) => {
              e.stopPropagation();
              handleRouteClick(route);
            }}
            data-testid={`button-show-route-${route.id}`}
          >
            Show on Map
          </Button>
          {!isSharedRoute && (
            <>
              <Button 
                size="sm" 
                className="flex-1 min-w-[100px] bg-blue-600 hover:bg-blue-700 text-white"
                onClick={(e) => handleShareRoute(route, e)}
                data-testid={`button-share-route-${route.id}`}
              >
                Share
              </Button>
              <div 
                className="flex items-center gap-1 flex-1 min-w-[140px]"
                onClick={(e) => e.stopPropagation()}
              >
                <span className={`text-xs font-medium ${!route.isPublic ? 'text-yellow-500' : 'text-gray-400'}`}>Private</span>
                <button
                  onClick={(e) => handleTogglePublic(route, e)}
                  disabled={togglePublicMutation.isPending}
                  className={`relative w-12 h-6 rounded-full transition-colors ${route.isPublic ? 'bg-green-500' : 'bg-yellow-500'}`}
                  data-testid={`button-make-public-${route.id}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${route.isPublic ? 'right-1' : 'left-1'}`} />
                </button>
                <span className={`text-xs font-medium ${route.isPublic ? 'text-green-500' : 'text-gray-400'}`}>Public</span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) {
          setSearchQuery('');
          setActivityDropdownRouteId(null);
          onClose();
        }
      }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RouteIcon className="h-5 w-5" />
              Saved Maps
            </DialogTitle>
          </DialogHeader>
          
          {/* Tab Selector */}
          {!isLoading && routes.length > 0 && (
            <div className="flex rounded-lg bg-muted p-1 gap-1">
              <button
                onClick={() => { setActiveTab('my-maps'); setSearchQuery(''); }}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'my-maps'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                My Maps ({myRoutes.length})
              </button>
              <button
                onClick={() => { setActiveTab('shared'); setSearchQuery(''); }}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'shared'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Shared With Me ({sharedWithMe.length})
              </button>
            </div>
          )}

          {/* Display All Routes Button — only on My Maps tab */}
          {activeTab === 'my-maps' && myRoutes.length > 0 && onDisplayAllRoutes && (
            <Button
              onClick={() => {
                onDisplayAllRoutes(myRoutes);
                onClose();
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="button-display-all-routes"
            >
              <Map className="h-4 w-4 mr-2" />
              Display All Routes on Map
            </Button>
          )}

          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading maps...
              </div>
            ) : routes.length === 0 ? (
              <div className="text-center py-8">
                <RouteIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">No maps saved yet</p>
                <p className="text-sm text-muted-foreground">
                  Create your first map using the Route Builder tool
                </p>
              </div>
            ) : activeTab === 'my-maps' ? (
              <>
                {myRoutes.length === 0 ? (
                  <div className="text-center py-8">
                    <RouteIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground mb-4">No maps created yet</p>
                    <p className="text-sm text-muted-foreground">
                      Create your first map using the Route Builder tool
                    </p>
                  </div>
                ) : (
                  <>
                    {myRoutes.length > 1 && (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search my maps..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 pr-9 h-10 w-full"
                          data-testid="input-search-routes"
                        />
                        {searchQuery && (
                          <button
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setSearchQuery('')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        {searchQuery.trim() && (
                          <p className="text-xs text-muted-foreground mt-1.5 ml-1">
                            {matchingRouteIds.size} {matchingRouteIds.size === 1 ? 'match' : 'matches'} found
                          </p>
                        )}
                      </div>
                    )}
                    <div className="space-y-4">
                      {filteredMyRoutes.map((route) => (
                        <div
                          key={route.id}
                          className={searchQuery.trim() && !matchingRouteIds.has(route.id) ? 'opacity-40' : ''}
                        >
                          <RouteCard route={route} isSharedRoute={false} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {sharedWithMe.length === 0 ? (
                  <div className="text-center py-8">
                    <Share2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground mb-4">No maps shared with you yet</p>
                    <p className="text-sm text-muted-foreground">
                      When friends share their maps with you, they'll appear here
                    </p>
                  </div>
                ) : (
                  <>
                    {sharedWithMe.length > 1 && (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search shared maps..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 pr-9 h-10 w-full"
                          data-testid="input-search-shared-routes"
                        />
                        {searchQuery && (
                          <button
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setSearchQuery('')}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        {searchQuery.trim() && (
                          <p className="text-xs text-muted-foreground mt-1.5 ml-1">
                            {matchingRouteIds.size} {matchingRouteIds.size === 1 ? 'match' : 'matches'} found
                          </p>
                        )}
                      </div>
                    )}
                    <div className="space-y-4">
                      {filteredSharedRoutes.map((route) => (
                        <div
                          key={route.id}
                          className={searchQuery.trim() && !matchingRouteIds.has(route.id) ? 'opacity-40' : ''}
                        >
                          <RouteCard route={route} isSharedRoute={true} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Share Route Modal */}
      <Dialog open={shareModalOpen} onOpenChange={(open) => {
        setShareModalOpen(open);
        if (!open) setFriendSearchQuery('');
      }}>
        <DialogContent className="max-w-sm max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Share Map
            </DialogTitle>
          </DialogHeader>

          {selectedRouteForSharing && (
            <div className="flex flex-col gap-4 min-h-0 flex-1">
              <p className="text-sm text-muted-foreground">
                Share "<span className="font-medium text-foreground">{selectedRouteForSharing.name}</span>" with friends
              </p>

              {/* Friend search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search friends..."
                  value={friendSearchQuery}
                  onChange={(e) => setFriendSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-share-search"
                />
              </div>

              {/* Friends list to share with */}
              <div className="overflow-y-auto min-h-0 flex-1 space-y-1">
                {availableFriends.length === 0 && friendsList.length > 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {friendSearchQuery.trim() ? 'No matching friends found' : 'Already shared with all friends'}
                  </p>
                )}
                {friendsList.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Add friends first to share maps with them
                  </p>
                )}
                {availableFriends.map((friend) => (
                  <div
                    key={friend.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-accent/50 transition-colors"
                    data-testid={`share-friend-${friend.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {friend.fullName || friend.username}
                      </p>
                      {friend.fullName && (
                        <p className="text-xs text-muted-foreground">@{friend.username}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => handleShareWithFriend(friend.username)}
                      disabled={shareMutation.isPending}
                      data-testid={`button-share-with-${friend.id}`}
                    >
                      <Share2 className="h-3.5 w-3.5 mr-1.5" />
                      Share
                    </Button>
                  </div>
                ))}
              </div>

              {/* Currently shared with */}
              {routeShares.length > 0 && (
                <div className="border-t pt-3 space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Shared with ({routeShares.length})
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {routeShares.map((share) => (
                      <div
                        key={share.id}
                        className="flex items-center justify-between rounded-md px-3 py-2 bg-accent/30"
                        data-testid={`share-item-${share.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          <span className="text-sm truncate">{share.sharedWithUsername}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleRevokeShare(share.id)}
                          disabled={revokeMutation.isPending}
                          title="Remove share"
                          data-testid={`button-revoke-share-${share.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RoutesModal;
