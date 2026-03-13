import { useState } from 'react';
import { useLocation } from 'wouter';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Route as RouteIcon, Map, Clock, Ruler, Mountain, X, UserPlus, Trash2, Share2, Box, Search } from 'lucide-react';
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

const RoutesModal: React.FC<RoutesModalProps> = ({ isOpen, onClose, onSelectRoute, onDisplayAllRoutes }) => {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedRouteForSharing, setSelectedRouteForSharing] = useState<RouteWithSharing | null>(null);
  const [friendUsername, setFriendUsername] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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

  // Share route mutation
  const shareMutation = useMutation({
    mutationFn: async ({ routeId, identifier }: { routeId: number; identifier: string }) => {
      return apiRequest('POST', `/api/routes/${routeId}/share`, { identifier });
    },
    onSuccess: () => {
      toast({ title: 'Route shared successfully!' });
      setFriendUsername('');
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

  const handleAddShare = () => {
    if (!friendUsername.trim() || !selectedRouteForSharing) return;
    shareMutation.mutate({ 
      routeId: selectedRouteForSharing.id, 
      identifier: friendUsername.trim() 
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
          
          {/* Display All Routes Button */}
          {routes.length > 0 && onDisplayAllRoutes && (
            <Button
              onClick={() => {
                onDisplayAllRoutes(routes);
                onClose();
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="button-display-all-routes"
            >
              <Map className="h-4 w-4 mr-2" />
              Display All Routes on Map
            </Button>
          )}
          
          <div className="space-y-6">
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
            ) : (
              <>
                {/* My Routes Section */}
                {myRoutes.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">
                      My Maps ({myRoutes.length})
                    </h3>

                    {myRoutes.length > 1 && (
                      <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search maps..."
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
                  </div>
                )}

                {/* Shared with Me Section */}
                {sharedWithMe.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">
                      Maps Shared with Me ({sharedWithMe.length})
                    </h3>
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
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Share Route Modal */}
      <Dialog open={shareModalOpen} onOpenChange={setShareModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Share Route
            </DialogTitle>
          </DialogHeader>
          
          {selectedRouteForSharing && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Share "<span className="font-medium text-foreground">{selectedRouteForSharing.name}</span>" with a friend
              </p>
              
              {/* Add friend input */}
              <div className="flex gap-2">
                <Input
                  placeholder="Friend's username or email"
                  value={friendUsername}
                  onChange={(e) => setFriendUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddShare()}
                  data-testid="input-share-username"
                />
                <Button 
                  onClick={handleAddShare}
                  disabled={!friendUsername.trim() || shareMutation.isPending}
                  data-testid="button-add-share"
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>

              {/* Current shares list */}
              {routeShares.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Currently shared with:</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {routeShares.map((share) => (
                      <div 
                        key={share.id} 
                        className="flex items-center justify-between bg-accent/50 rounded-md px-3 py-2"
                        data-testid={`share-item-${share.id}`}
                      >
                        <span className="text-sm">{share.sharedWithUsername}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRevokeShare(share.id)}
                          disabled={revokeMutation.isPending}
                          data-testid={`button-revoke-share-${share.id}`}
                        >
                          <X className="h-4 w-4 text-destructive" />
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
