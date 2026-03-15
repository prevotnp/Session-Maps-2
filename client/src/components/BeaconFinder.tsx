import { useState, useEffect, useRef, useCallback } from 'react';
import { LiveMapMember } from '@shared/schema';

interface BeaconFinderProps {
  isOpen: boolean;
  onClose: () => void;
  targetUserId: number;
  targetUsername: string;
  targetColor: string;
  userLocationRef: React.RefObject<{ lng: number; lat: number } | null>;
  sessionMembers: LiveMapMember[];
  memberLocationsRef: React.RefObject<Map<number, { lat: number; lng: number; accuracy?: number }>>;
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const toDeg = (rad: number) => rad * 180 / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function BeaconFinder({
  isOpen,
  onClose,
  targetUserId,
  targetUsername,
  targetColor,
  userLocationRef,
  sessionMembers,
  memberLocationsRef,
}: BeaconFinderProps) {
  const [compassHeading, setCompassHeading] = useState(0);
  const [compassPermission, setCompassPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [hasCompass, setHasCompass] = useState(true);
  const [bearing, setBearing] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [targetAccuracy, setTargetAccuracy] = useState(0);
  const [targetAvailable, setTargetAvailable] = useState(true);
  const [now, setNow] = useState(Date.now());
  const compassListenerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);

  const getTargetLocation = useCallback(() => {
    const wsLocation = memberLocationsRef.current?.get(targetUserId);
    if (wsLocation) return wsLocation;

    const member = sessionMembers.find(m => m.userId === targetUserId);
    if (member?.latitude && member?.longitude) {
      return {
        lat: parseFloat(member.latitude as string),
        lng: parseFloat(member.longitude as string),
        accuracy: member.accuracy ? parseFloat(member.accuracy as string) : undefined,
      };
    }
    return null;
  }, [targetUserId, sessionMembers, memberLocationsRef]);

  // Check compass availability on mount
  useEffect(() => {
    if (!isOpen) return;

    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      // iOS — needs user gesture, start as 'unknown'
      setCompassPermission('unknown');
    } else {
      // Android / desktop — try listening
      let received = false;
      const testHandler = (event: DeviceOrientationEvent) => {
        if (event.alpha !== null || (event as any).webkitCompassHeading !== undefined) {
          received = true;
          setCompassPermission('granted');
          setHasCompass(true);
        }
      };
      window.addEventListener('deviceorientation', testHandler, true);

      // If no event fires within 1s, assume no compass
      const timeout = setTimeout(() => {
        window.removeEventListener('deviceorientation', testHandler, true);
        if (!received) {
          setHasCompass(false);
          setCompassPermission('granted'); // skip permission flow
        }
      }, 1000);

      return () => {
        clearTimeout(timeout);
        window.removeEventListener('deviceorientation', testHandler, true);
      };
    }
  }, [isOpen]);

  // Start compass listener once permission is granted
  useEffect(() => {
    if (!isOpen || compassPermission !== 'granted' || !hasCompass) return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let heading = 0;
      if ((event as any).webkitCompassHeading !== undefined) {
        heading = (event as any).webkitCompassHeading; // iOS
      } else if (event.alpha !== null) {
        heading = (360 - event.alpha!) % 360; // Android
      }
      setCompassHeading(heading);
    };

    compassListenerRef.current = handleOrientation;
    window.addEventListener('deviceorientation', handleOrientation, true);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      compassListenerRef.current = null;
    };
  }, [isOpen, compassPermission, hasCompass]);

  // 2-second refresh for bearing and distance
  useEffect(() => {
    if (!isOpen) return;

    const update = () => {
      const myLoc = userLocationRef.current;
      const targetLoc = getTargetLocation();

      if (!myLoc || !targetLoc) {
        setTargetAvailable(false);
        return;
      }

      setTargetAvailable(true);
      setBearing(calculateBearing(myLoc.lat, myLoc.lng, targetLoc.lat, targetLoc.lng));
      setDistanceMeters(calculateDistance(myLoc.lat, myLoc.lng, targetLoc.lat, targetLoc.lng));
      setTargetAccuracy(targetLoc.accuracy || 0);
      setLastUpdated(Date.now());
    };

    update(); // immediate first update
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [isOpen, getTargetLocation, userLocationRef]);

  // Tick for "Updated Xs ago"
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const requestCompass = async () => {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const result = await (DeviceOrientationEvent as any).requestPermission();
        if (result === 'granted') {
          setCompassPermission('granted');
          setHasCompass(true);
        } else {
          setCompassPermission('denied');
        }
      } catch {
        setCompassPermission('denied');
      }
    } else {
      setCompassPermission('granted');
    }
  };

  if (!isOpen) return null;

  const arrowRotation = bearing - compassHeading;
  const distanceFeet = Math.round(distanceMeters * 3.28084);
  const secondsAgo = Math.round((now - lastUpdated) / 1000);
  const userAccuracy = 15;
  const combinedAccuracy = Math.sqrt(userAccuracy ** 2 + targetAccuracy ** 2);
  const accuracyFeet = Math.round(combinedAccuracy * 3.28084);
  const weakSignal = combinedAccuracy > 100;

  return (
    <div className="absolute inset-0 z-40 bg-gray-950/95 flex flex-col">
      {/* Top bar */}
      <div
        className="flex items-center justify-between p-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: targetColor }} />
          <span className="text-white text-lg font-semibold">{targetUsername}</span>
        </div>
        <button
          onClick={onClose}
          className="bg-red-600 hover:bg-red-700 active:scale-95 text-white font-semibold px-4 py-2 rounded-full transition-all"
        >
          Exit Beacon
        </button>
      </div>

      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
        {/* Compass permission button (iOS) */}
        {compassPermission === 'unknown' && (
          <button
            onClick={requestCompass}
            className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-6 py-3 rounded-full font-medium transition-all mb-4"
          >
            Tap to Enable Compass
          </button>
        )}

        {compassPermission === 'denied' && (
          <p className="text-yellow-400 text-sm mb-2">Compass permission denied. Arrow shows geographic direction.</p>
        )}

        {!hasCompass && (
          <p className="text-white/40 text-xs mb-2">Compass not available — arrow shows geographic direction.</p>
        )}

        {targetAvailable ? (
          <>
            {/* Arrow */}
            <svg
              width="200"
              height="200"
              viewBox="0 0 200 200"
              style={{
                transform: `rotate(${arrowRotation}deg)`,
                transition: 'transform 0.3s ease-out',
              }}
            >
              <polygon
                points="100,10 140,120 100,95 60,120"
                fill={targetColor}
                stroke="white"
                strokeWidth="3"
              />
              <rect
                x="88"
                y="95"
                width="24"
                height="80"
                rx="4"
                fill={targetColor}
                stroke="white"
                strokeWidth="2"
              />
            </svg>

            {/* Distance */}
            <p className="text-white text-5xl font-bold tracking-tight">
              {distanceFeet >= 1000 ? distanceFeet.toLocaleString() : distanceFeet} ft
            </p>

            {/* Accuracy */}
            <p className="text-white/50 text-sm">
              {weakSignal ? (
                <span className="text-yellow-400">&#9888;&#65039; GPS signal weak</span>
              ) : (
                <>GPS accuracy: &plusmn;{accuracyFeet} ft</>
              )}
            </p>

            {/* Last updated */}
            <p className="text-white/30 text-xs">
              Updated {secondsAgo < 5 ? 'just now' : `${secondsAgo}s ago`}
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <svg width="200" height="200" viewBox="0 0 200 200" className="opacity-20">
              <polygon points="100,10 140,120 100,95 60,120" fill="#666" stroke="#999" strokeWidth="3" />
              <rect x="88" y="95" width="24" height="80" rx="4" fill="#666" stroke="#999" strokeWidth="2" />
            </svg>
            <p className="text-white/50 text-lg">Location unavailable</p>
            <p className="text-white/30 text-sm">Waiting for {targetUsername}'s GPS signal...</p>
          </div>
        )}
      </div>
    </div>
  );
}
