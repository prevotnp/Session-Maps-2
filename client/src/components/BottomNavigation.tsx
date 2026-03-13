import React from 'react';
import { Map, MessageCircle, Route, User, Users, Upload, Compass, Building2 } from 'lucide-react';
import { useLocation, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

interface BottomNavigationProps {
  onTabChange: (tab: string) => void;
}

interface FriendRequest {
  id: number;
  status: string;
}

const BottomNavigation: React.FC<BottomNavigationProps> = ({ onTabChange }) => {
  const [location] = useLocation();
  const { user } = useAuth();
  const isAdmin = (user as any)?.isAdmin;
  
  const { data: pendingRequests = [] } = useQuery<FriendRequest[]>({
    queryKey: ["/api/friend-requests/pending"],
    refetchInterval: 30000,
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 15000,
  });

  const unreadCount = unreadData?.count || 0;

  const { data: myEnterprises = [] } = useQuery<any[]>({
    queryKey: ["/api/my-enterprises"],
    refetchInterval: 60000,
  });
  const hasEnterprise = myEnterprises.length > 0;

  return (
    <div 
      className="bg-dark/95 backdrop-blur-md border-t border-white/10 fixed bottom-0 left-0 right-0 z-50"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      <div className="flex justify-around items-stretch">
        <Link href="/">
          <div
            className={cn(
              "py-3 px-2 sm:px-4 flex flex-col items-center cursor-pointer min-w-[48px] min-h-[48px] active:scale-95 transition-transform",
              location === "/" ? "text-primary" : "text-white/80 hover:text-white"
            )}
            onClick={() => onTabChange('map')}
          >
            <Map className="h-6 w-6 sm:h-7 sm:w-7" />
            <span className="text-[10px] sm:text-xs mt-1 font-medium">Map</span>
          </div>
        </Link>
        
        <button 
          className="py-3 px-2 sm:px-4 flex flex-col items-center text-white/80 hover:text-white relative min-w-[48px] min-h-[48px] active:scale-95 transition-transform"
          onClick={() => onTabChange('messages')}
        >
          <MessageCircle className="h-6 w-6 sm:h-7 sm:w-7" />
          <span className="text-[10px] sm:text-xs mt-1 font-medium">Messages</span>
          {unreadCount > 0 && (
            <div className="absolute top-1 right-0 bg-red-500 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </div>
          )}
        </button>
        
        <Link href="/explore">
          <div
            className={cn(
              "py-3 px-2 sm:px-4 flex flex-col items-center cursor-pointer min-w-[48px] min-h-[48px] active:scale-95 transition-transform",
              location === "/explore" ? "text-primary" : "text-white/80 hover:text-white"
            )}
            data-testid="button-explore"
          >
            <Compass className="h-6 w-6 sm:h-7 sm:w-7" />
            <span className="text-[10px] sm:text-xs mt-1 font-medium">Explore</span>
          </div>
        </Link>
        
        {isAdmin && (
          <Link href="/upload">
            <div
              className={cn(
                "py-3 px-2 sm:px-4 flex flex-col items-center cursor-pointer min-w-[48px] min-h-[48px] active:scale-95 transition-transform",
                location === "/upload" ? "text-primary" : "text-white/80 hover:text-white"
              )}
              data-testid="button-upload-drone"
            >
              <Upload className="h-6 w-6 sm:h-7 sm:w-7" />
              <span className="text-[10px] sm:text-xs mt-1 font-medium text-center leading-tight">Upload</span>
            </div>
          </Link>
        )}
        
        {hasEnterprise && (
          <button
            className="py-3 px-2 sm:px-4 flex flex-col items-center text-white/80 hover:text-white min-w-[48px] min-h-[48px] active:scale-95 transition-transform"
            onClick={() => onTabChange('enterprise')}
          >
            <Building2 className="h-6 w-6 sm:h-7 sm:w-7" />
            <span className="text-[10px] sm:text-xs mt-1 font-medium">Enterprise</span>
          </button>
        )}

        <button
          className="py-3 px-2 sm:px-4 flex flex-col items-center text-white/80 hover:text-white min-w-[48px] min-h-[48px] active:scale-95 transition-transform"
          onClick={() => onTabChange('routes')}
          data-testid="button-routes"
        >
          <Route className="h-6 w-6 sm:h-7 sm:w-7" />
          <span className="text-[10px] sm:text-xs mt-1 font-medium">My Maps</span>
        </button>
        
        <button 
          className="py-3 px-2 sm:px-4 flex flex-col items-center text-white/80 hover:text-white relative min-w-[48px] min-h-[48px] active:scale-95 transition-transform"
          onClick={() => onTabChange('friends')}
          data-testid="button-friends"
        >
          <Users className="h-6 w-6 sm:h-7 sm:w-7" />
          <span className="text-[10px] sm:text-xs mt-1 font-medium">Friends</span>
          {pendingRequests.length > 0 && (
            <div className="absolute top-1 right-0 bg-red-500 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {pendingRequests.length}
            </div>
          )}
        </button>
        
        <Link href="/profile">
          <div
            className={cn(
              "py-3 px-2 sm:px-4 flex flex-col items-center cursor-pointer min-w-[48px] min-h-[48px] active:scale-95 transition-transform",
              location === "/profile" || location === "/login" ? "text-primary" : "text-white/80 hover:text-white"
            )}
            onClick={() => onTabChange('profile')}
          >
            <User className="h-6 w-6 sm:h-7 sm:w-7" />
            <span className="text-[10px] sm:text-xs mt-1 font-medium">Profile</span>
          </div>
        </Link>
      </div>
    </div>
  );
};

export default BottomNavigation;
