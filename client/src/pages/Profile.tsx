import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import BottomNavigation from '@/components/BottomNavigation';
import { 
  ChevronLeft, 
  ChevronDown, 
  ChevronUp, 
  User, 
  MapPin, 
  LogOut, 
  Route as RouteIcon, 
  Activity, 
  Globe, 
  Lock,
  Eye
} from 'lucide-react';
import type { Route, Activity as ActivityType } from '@shared/schema';

interface ProfileData {
  user: {
    id: number;
    username: string;
    fullName: string | null;
    email?: string;
    locationSharingEnabled?: boolean;
    createdAt: string;
  };
  isFriend: boolean;
  isOwner: boolean;
  publicRouteCount: number;
  publicActivityCount: number;
  routes: Route[];
  activities: ActivityType[];
}

const Profile: React.FC = () => {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [routesExpanded, setRoutesExpanded] = useState(false);
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);

  useEffect(() => {
    if (!user && !isLoggingOut) {
      navigate('/login');
    }
  }, [user, navigate, isLoggingOut]);

  const { data: profile, isLoading: isProfileLoading } = useQuery<ProfileData>({
    queryKey: ['/api/profiles', user?.username],
    queryFn: async () => {
      const response = await fetch(`/api/profiles/${user!.username}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch profile');
      return response.json();
    },
    enabled: !!user,
  });

  const locationToggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PATCH", "/api/user/location-sharing", { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/profiles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
  });

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await apiRequest("POST", "/api/logout");
      queryClient.setQueryData(["/api/auth/user"], null);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Logged out", description: "You have been successfully logged out." });
      navigate('/login');
    } catch (error) {
      toast({ title: "Logout failed", description: "Failed to log out.", variant: "destructive" });
      setIsLoggingOut(false);
    }
  };

  if (!user) return null;

  const userInitials = user.fullName
    ? user.fullName.split(' ').map((name: string) => name[0]).join('').toUpperCase()
    : user.username.substring(0, 2).toUpperCase();

  const locationEnabled = (user as any)?.locationSharingEnabled ?? true;

  const formatDistance = (meters: string | number | null) => {
    if (!meters) return '0 mi';
    const m = typeof meters === 'string' ? parseFloat(meters) : meters;
    return (m / 1609.34).toFixed(1) + ' mi';
  };

  const formatElevation = (meters: string | number | null) => {
    if (!meters) return '0 ft';
    const m = typeof meters === 'string' ? parseFloat(meters) : meters;
    return Math.round(m * 3.28084).toLocaleString() + ' ft';
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="min-h-screen bg-background overflow-y-auto" style={{ 
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))'
    }}>
      <div className="flex justify-between items-center p-4">
        <Button variant="outline" size="icon" className="min-w-[44px] min-h-[44px] border-gray-700" onClick={() => navigate('/')}>
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <h1 className="text-xl font-semibold">Profile</h1>
        <div className="w-[44px]" />
      </div>

      <div className="flex flex-col items-center p-6 pb-8">
        <Avatar className="h-24 w-24 mb-4">
          <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${user.username}`} alt={user.username} />
          <AvatarFallback className="text-2xl bg-primary text-white">{userInitials}</AvatarFallback>
        </Avatar>
        <h2 className="text-xl font-bold text-white">{user.fullName || user.username}</h2>
        <p className="text-gray-400">@{user.username}</p>
        {profile?.user?.email && (
          <p className="text-gray-500 text-sm mt-1">{profile.user.email}</p>
        )}
      </div>

      <div className="px-4 space-y-4">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin className={`h-5 w-5 ${locationEnabled ? 'text-emerald-400' : 'text-gray-500'}`} />
              <div>
                <div className="font-medium text-white">Location Sharing</div>
                <div className="text-xs text-gray-400">
                  {locationEnabled ? 'Friends can see where you are' : 'Your location is hidden from all friends'}
                </div>
              </div>
            </div>
            <Switch
              checked={locationEnabled}
              onCheckedChange={(checked) => locationToggle.mutate(checked)}
              disabled={locationToggle.isPending}
            />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left"
            onClick={() => setRoutesExpanded(!routesExpanded)}
          >
            <div className="flex items-center gap-3">
              <RouteIcon className="h-5 w-5 text-blue-400" />
              <div>
                <div className="font-medium text-white">My Maps</div>
                <div className="text-xs text-gray-400">
                  {profile ? `${profile.publicRouteCount} public · ${profile.routes.length} total` : '—'}
                </div>
              </div>
            </div>
            {routesExpanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
          </button>
          {routesExpanded && (
            <div className="border-t border-gray-700">
              {isProfileLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : !profile?.routes.length ? (
                <div className="text-center py-6 text-gray-500">
                  <RouteIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No routes yet</p>
                </div>
              ) : (
                <ScrollArea className="max-h-80">
                  <div className="divide-y divide-gray-800">
                    {profile.routes.map((route) => (
                      <div key={route.id} className="flex items-center gap-3 p-3 px-4">
                        {route.isPublic ? (
                          <Globe className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <Lock className="h-4 w-4 text-yellow-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{route.name}</div>
                          <div className="text-xs text-gray-500">
                            {formatDistance(route.totalDistance)} · {formatElevation(route.elevationGain)} · <span className="capitalize">{route.routingMode}</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 text-blue-400 hover:text-blue-300 text-xs"
                          onClick={() => navigate(`/?viewRoute=${route.id}`)}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left"
            onClick={() => setActivitiesExpanded(!activitiesExpanded)}
          >
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-orange-400" />
              <div>
                <div className="font-medium text-white">My Activities</div>
                <div className="text-xs text-gray-400">
                  {profile ? `${profile.publicActivityCount} public · ${profile.activities.length} total` : '—'}
                </div>
              </div>
            </div>
            {activitiesExpanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
          </button>
          {activitiesExpanded && (
            <div className="border-t border-gray-700">
              {isProfileLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : !profile?.activities.length ? (
                <div className="text-center py-6 text-gray-500">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No activities yet</p>
                </div>
              ) : (
                <ScrollArea className="max-h-80">
                  <div className="divide-y divide-gray-800">
                    {profile.activities.map((activity) => (
                      <div key={activity.id} className="flex items-center gap-3 p-3 px-4">
                        {activity.isPublic ? (
                          <Globe className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <Lock className="h-4 w-4 text-yellow-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{activity.name}</div>
                          <div className="text-xs text-gray-500">
                            {formatDistance(activity.distanceMeters)} · {formatDuration(activity.elapsedTimeSeconds)} · <span className="capitalize">{activity.activityType}</span>
                          </div>
                        </div>
                        <ChevronDown className="h-4 w-4 text-gray-500 shrink-0 -rotate-90" />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <Button 
          variant="outline" 
          className="w-full h-12 text-destructive border-destructive hover:bg-destructive/10 active:scale-95 transition-transform"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          {isLoggingOut ? 'Logging out...' : 'Log out'}
        </Button>

        <div className="h-4" />
      </div>

      <BottomNavigation onTabChange={(tab) => {
        if (tab === 'map') navigate('/');
      }} />
    </div>
  );
};

export default Profile;
