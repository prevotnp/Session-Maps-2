import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Activity, InsertActivity } from '@shared/schema';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useBackgroundResilience } from '@/hooks/useBackgroundResilience';
import { startKeepAlive, stopKeepAlive } from '@/lib/silentAudioKeepAlive';
import { isNative } from '@/lib/capacitor';

export type ActivityType = 'run' | 'ski' | 'hike' | 'bike';

interface TrackPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  timestamp: number;
  speed: number | null;
}

interface RecordingWaypoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  timestamp: number;
  distanceFromStart: number;
}

interface ActivityStats {
  distance: number;
  elapsedTime: number;
  movingTime: number;
  averageSpeed: number;
  maxSpeed: number;
  currentSpeed: number;
  averagePace: number;
  currentPace: number;
  elevationGain: number;
  elevationLoss: number;
  currentAltitude: number | null;
}

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  activityType: ActivityType;
  startTime: Date | null;
  trackPoints: TrackPoint[];
  stats: ActivityStats;
  currentPosition: { latitude: number; longitude: number } | null;
  waypoints: RecordingWaypoint[];
}

const initialStats: ActivityStats = {
  distance: 0,
  elapsedTime: 0,
  movingTime: 0,
  averageSpeed: 0,
  maxSpeed: 0,
  currentSpeed: 0,
  averagePace: 0,
  currentPace: 0,
  elevationGain: 0,
  elevationLoss: 0,
  currentAltitude: null,
};

const MIN_ACCURACY_THRESHOLD = 30;
const MIN_DISTANCE_THRESHOLD = 3;
const STATIONARY_SPEED_THRESHOLD = 0.3;

const RECORDING_STORAGE_KEY = 'sessionmaps_recording_state';

interface PersistedRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  activityType: ActivityType;
  startTime: string;
  trackPoints: TrackPoint[];
  waypoints: RecordingWaypoint[];
  lastSaveTime: number;
}

function persistRecordingState(state: RecordingState): void {
  if (!state.isRecording || !state.startTime) {
    localStorage.removeItem(RECORDING_STORAGE_KEY);
    return;
  }

  try {
    const persisted: PersistedRecordingState = {
      isRecording: state.isRecording,
      isPaused: state.isPaused,
      activityType: state.activityType,
      startTime: state.startTime.toISOString(),
      trackPoints: state.trackPoints,
      waypoints: state.waypoints,
      lastSaveTime: Date.now()
    };
    localStorage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(persisted));
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError' || err?.code === 22) {
      console.warn('localStorage quota exceeded, reducing track point detail...');
      try {
        const reducedPoints = state.trackPoints.map(p => ({
          latitude: Math.round(p.latitude * 1e6) / 1e6,
          longitude: Math.round(p.longitude * 1e6) / 1e6,
          altitude: p.altitude ? Math.round(p.altitude) : undefined,
          timestamp: p.timestamp,
          speed: p.speed ? Math.round(p.speed * 10) / 10 : undefined,
        }));
        
        const reduced: PersistedRecordingState = {
          isRecording: state.isRecording,
          isPaused: state.isPaused,
          activityType: state.activityType,
          startTime: state.startTime!.toISOString(),
          trackPoints: reducedPoints as any,
          waypoints: state.waypoints,
          lastSaveTime: Date.now()
        };
        localStorage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(reduced));
      } catch (retryErr) {
        console.error('Failed to persist even reduced recording state:', retryErr);
        try {
          const lastPoints = state.trackPoints.slice(-1000);
          const minimal = {
            isRecording: state.isRecording,
            isPaused: state.isPaused,
            activityType: state.activityType,
            startTime: state.startTime!.toISOString(),
            trackPoints: lastPoints,
            waypoints: state.waypoints,
            lastSaveTime: Date.now()
          };
          localStorage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(minimal));
        } catch (finalErr) {
          console.error('Cannot persist recording state at all:', finalErr);
        }
      }
    } else {
      console.warn('Failed to persist recording state:', err);
    }
  }
}

function loadPersistedRecordingState(): PersistedRecordingState | null {
  try {
    const raw = localStorage.getItem(RECORDING_STORAGE_KEY);
    if (!raw) return null;

    const persisted: PersistedRecordingState = JSON.parse(raw);

    if (Date.now() - persisted.lastSaveTime > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(RECORDING_STORAGE_KEY);
      return null;
    }

    return persisted;
  } catch {
    localStorage.removeItem(RECORDING_STORAGE_KEY);
    return null;
  }
}

function clearPersistedRecordingState(): void {
  localStorage.removeItem(RECORDING_STORAGE_KEY);
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function useActivityRecording() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const wakeLock = useWakeLock();
  
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    activityType: 'hike',
    startTime: null,
    trackPoints: [],
    stats: initialStats,
    currentPosition: null,
    waypoints: [],
  });

  const [hasPersistedSession, setHasPersistedSession] = useState<boolean>(false);

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidPointRef = useRef<TrackPoint | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const persisted = loadPersistedRecordingState();
    if (persisted && persisted.isRecording) {
      setHasPersistedSession(true);
    }
  }, []);

  useEffect(() => {
    if (state.isRecording && (state.trackPoints.length > 0 || state.waypoints.length > 0)) {
      persistRecordingState(state);
    }
  }, [state.isRecording, state.trackPoints.length, state.waypoints.length, state.isPaused]);

  const saveActivityMutation = useMutation({
    mutationFn: async (activity: Omit<InsertActivity, 'userId'>) => {
      const response = await apiRequest('POST', '/api/activities', activity);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/activities'] });
      toast({
        title: 'Activity saved!',
        description: 'Your activity has been saved successfully.',
      });
    },
    onError: (error) => {
      console.error('Failed to save activity:', error);
      toast({
        title: 'Save failed',
        description: 'Could not save your activity. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const updateStats = useCallback((trackPoints: TrackPoint[], startTime: Date | null) => {
    if (trackPoints.length === 0 || !startTime) {
      return initialStats;
    }

    let totalDistance = 0;
    let movingTime = 0;
    let elevationGain = 0;
    let elevationLoss = 0;
    let maxSpeed = 0;
    let lastAltitude: number | null = null;

    for (let i = 1; i < trackPoints.length; i++) {
      const prev = trackPoints[i - 1];
      const curr = trackPoints[i];

      const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      totalDistance += dist;

      const timeDiff = (curr.timestamp - prev.timestamp) / 1000;
      const speed = dist / timeDiff;

      if (speed > STATIONARY_SPEED_THRESHOLD) {
        movingTime += timeDiff;
      }

      if (curr.speed !== null && curr.speed > maxSpeed) {
        maxSpeed = curr.speed;
      }

      if (curr.altitude !== null && prev.altitude !== null) {
        const altDiff = curr.altitude - prev.altitude;
        if (altDiff > 0) {
          elevationGain += altDiff;
        } else {
          elevationLoss += Math.abs(altDiff);
        }
      }

      if (curr.altitude !== null) {
        lastAltitude = curr.altitude;
      }
    }

    const elapsedTime = (Date.now() - startTime.getTime()) / 1000;
    const averageSpeed = movingTime > 0 ? totalDistance / movingTime : 0;
    const lastPoint = trackPoints[trackPoints.length - 1];
    const currentSpeed = lastPoint?.speed ?? 0;
    const averagePace = averageSpeed > 0 ? 1000 / averageSpeed : 0;
    const currentPace = currentSpeed > 0 ? 1000 / currentSpeed : 0;

    return {
      distance: totalDistance,
      elapsedTime,
      movingTime,
      averageSpeed,
      maxSpeed,
      currentSpeed,
      averagePace,
      currentPace,
      elevationGain,
      elevationLoss,
      currentAltitude: lastAltitude,
    };
  }, []);

  const handlePositionUpdate = useCallback(
    (position: GeolocationPosition) => {
      const { coords, timestamp } = position;

      if (coords.accuracy > MIN_ACCURACY_THRESHOLD) {
        return;
      }

      const newPoint: TrackPoint = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude,
        accuracy: coords.accuracy,
        timestamp,
        speed: coords.speed,
      };

      setState((prev) => {
        if (!prev.isRecording || prev.isPaused) {
          return {
            ...prev,
            currentPosition: { latitude: coords.latitude, longitude: coords.longitude },
          };
        }

        const lastPoint = lastValidPointRef.current;
        
        if (lastPoint) {
          const dist = calculateDistance(
            lastPoint.latitude,
            lastPoint.longitude,
            newPoint.latitude,
            newPoint.longitude
          );
          
          if (dist < MIN_DISTANCE_THRESHOLD) {
            return {
              ...prev,
              currentPosition: { latitude: coords.latitude, longitude: coords.longitude },
            };
          }
        }

        lastValidPointRef.current = newPoint;
        const newTrackPoints = [...prev.trackPoints, newPoint];
        const newStats = updateStats(newTrackPoints, prev.startTime);

        return {
          ...prev,
          trackPoints: newTrackPoints,
          stats: newStats,
          currentPosition: { latitude: coords.latitude, longitude: coords.longitude },
        };
      });
    },
    [updateStats]
  );

  const handlePositionError = useCallback(
    (error: GeolocationPositionError) => {
      console.error('GPS error:', error);
      toast({
        title: 'GPS Error',
        description: error.message || 'Unable to get location',
        variant: 'destructive',
      });
    },
    [toast]
  );

  const isMobilePwa = !isNative && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const handleForegroundResume = useCallback(() => {
    stopKeepAlive();

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handlePositionError,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    );

    setState(prev => {
      if (!prev.isRecording || !prev.startTime) return prev;
      return {
        ...prev,
        stats: {
          ...prev.stats,
          elapsedTime: (Date.now() - prev.startTime.getTime()) / 1000,
        }
      };
    });

    console.log('Activity recording: GPS and timer resumed after foreground return');
  }, [handlePositionUpdate, handlePositionError]);

  const handleBackgroundEnter = useCallback(() => {
    if (isMobilePwa) {
      startKeepAlive();
    }
  }, [isMobilePwa]);

  useBackgroundResilience({
    isActive: state.isRecording,
    onForegroundResume: handleForegroundResume,
    onBackgroundEnter: handleBackgroundEnter,
    label: 'ActivityRecording',
  });

  const startRecording = useCallback((activityType: ActivityType) => {
    if (!navigator.geolocation) {
      toast({
        title: 'GPS Not Available',
        description: 'Your device does not support GPS.',
        variant: 'destructive',
      });
      return;
    }

    const startTime = new Date();

    setState({
      isRecording: true,
      isPaused: false,
      activityType,
      startTime,
      trackPoints: [],
      stats: initialStats,
      currentPosition: null,
      waypoints: [],
    });

    lastValidPointRef.current = null;

    wakeLock.request();

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handlePositionError,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 3000,
      }
    );

    timerRef.current = setInterval(() => {
      setState((prev) => {
        if (!prev.isRecording || prev.isPaused || !prev.startTime) return prev;
        return {
          ...prev,
          stats: {
            ...prev.stats,
            elapsedTime: (Date.now() - prev.startTime.getTime()) / 1000,
          },
        };
      });
    }, 1000);

  }, [handlePositionUpdate, handlePositionError, toast, wakeLock]);

  const pauseRecording = useCallback(() => {
    setState((prev) => ({ ...prev, isPaused: true }));
    toast({
      title: 'Recording paused',
      description: 'Tap resume to continue',
    });
  }, [toast]);

  const resumeRecording = useCallback(() => {
    setState((prev) => ({ ...prev, isPaused: false }));
    toast({
      title: 'Recording resumed',
      description: 'Activity recording continued',
    });
  }, [toast]);

  const resumeRecordingFromPersisted = useCallback(() => {
    const persisted = loadPersistedRecordingState();
    if (!persisted) return;

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const startTime = new Date(persisted.startTime);
    const trackPoints = persisted.trackPoints;
    const stats = updateStats(trackPoints, startTime);

    setState({
      isRecording: true,
      isPaused: persisted.isPaused || false,
      activityType: persisted.activityType,
      startTime,
      trackPoints,
      stats,
      currentPosition: trackPoints.length > 0
        ? { latitude: trackPoints[trackPoints.length - 1].latitude, longitude: trackPoints[trackPoints.length - 1].longitude }
        : null,
      waypoints: persisted.waypoints || [],
    });

    if (trackPoints.length > 0) {
      lastValidPointRef.current = trackPoints[trackPoints.length - 1];
    }

    setHasPersistedSession(false);

    wakeLock.request();

    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePositionUpdate,
        handlePositionError,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
      );
    }

    timerRef.current = setInterval(() => {
      setState((prev) => {
        if (!prev.isRecording || prev.isPaused || !prev.startTime) return prev;
        return {
          ...prev,
          stats: {
            ...prev.stats,
            elapsedTime: (Date.now() - prev.startTime.getTime()) / 1000,
          },
        };
      });
    }, 1000);

    toast({
      title: 'Recording resumed',
      description: `Resumed ${persisted.activityType} with ${trackPoints.length} points`,
    });
  }, [handlePositionUpdate, handlePositionError, updateStats, toast, wakeLock]);

  const dismissPersistedSession = useCallback(() => {
    clearPersistedRecordingState();
    setHasPersistedSession(false);
  }, []);

  const addWaypoint = useCallback((name?: string) => {
    setState((prev) => {
      if (!prev.currentPosition || !prev.isRecording) return prev;
      const lastTrackPoint = prev.trackPoints[prev.trackPoints.length - 1];
      const waypoint: RecordingWaypoint = {
        id: `wp_${Date.now()}`,
        name: name || `Waypoint ${prev.waypoints.length + 1}`,
        latitude: prev.currentPosition.latitude,
        longitude: prev.currentPosition.longitude,
        altitude: lastTrackPoint?.altitude ?? null,
        timestamp: Date.now(),
        distanceFromStart: prev.stats.distance,
      };
      return {
        ...prev,
        waypoints: [...prev.waypoints, waypoint],
      };
    });
    toast({
      title: 'Waypoint added',
      description: `Dropped at your current location`,
    });
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    stopKeepAlive();
    wakeLock.release();

    setState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
    }));
  }, [wakeLock]);

  const discardRecording = useCallback(() => {
    stopRecording();
    clearPersistedRecordingState();
    wakeLock.release();
    setState({
      isRecording: false,
      isPaused: false,
      activityType: 'hike',
      startTime: null,
      trackPoints: [],
      stats: initialStats,
      currentPosition: null,
      waypoints: [],
    });
    lastValidPointRef.current = null;
    toast({
      title: 'Activity discarded',
      description: 'Your recording was discarded',
    });
  }, [stopRecording, toast, wakeLock]);

  const saveRecording = useCallback(
    async (name: string, isPublic: boolean = false) => {
      const currentState = stateRef.current;
      if (currentState.trackPoints.length < 2) {
        toast({
          title: 'Not enough data',
          description: 'Record more track points before saving',
          variant: 'destructive',
        });
        return null;
      }

      const pathCoordinates = currentState.trackPoints.map((p) => [p.longitude, p.latitude]);

      const activity: Omit<InsertActivity, 'userId'> = {
        name,
        activityType: currentState.activityType,
        startTime: currentState.startTime!,
        endTime: new Date(),
        elapsedTimeSeconds: Math.round(currentState.stats.elapsedTime),
        movingTimeSeconds: Math.round(currentState.stats.movingTime),
        distanceMeters: currentState.stats.distance.toFixed(2),
        avgSpeedMps: currentState.stats.averageSpeed.toFixed(4),
        maxSpeedMps: currentState.stats.maxSpeed.toFixed(4),
        paceSecondsPerMile: Math.round(currentState.stats.averagePace * 1.60934),
        elevationGainMeters: currentState.stats.elevationGain.toFixed(2),
        elevationLossMeters: currentState.stats.elevationLoss.toFixed(2),
        pathCoordinates: JSON.stringify(pathCoordinates),
        trackPoints: JSON.stringify(currentState.trackPoints),
        isPublic,
      };

      const MAX_RETRIES = 3;
      let lastError: any = null;
      
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const result = await saveActivityMutation.mutateAsync(activity);

          clearPersistedRecordingState();
          wakeLock.release();

          let waypointsForRoute: Array<{ name: string; lat: number; lng: number; elevation: number | null }> = [];

          if (currentState.waypoints.length > 0) {
            waypointsForRoute = currentState.waypoints.map(wp => ({
              name: wp.name,
              lat: wp.latitude,
              lng: wp.longitude,
              elevation: wp.altitude || null,
            }));
          } else {
            const points = currentState.trackPoints;
            if (points.length >= 2) {
              waypointsForRoute.push({
                name: 'Start',
                lat: points[0].latitude,
                lng: points[0].longitude,
                elevation: points[0].altitude || null,
              });

              const MILE_IN_METERS = 1609.34;
              let accumulatedDistance = 0;
              let mileCount = 1;

              for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const R = 6371000;
                const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
                const dLon = (curr.longitude - prev.longitude) * Math.PI / 180;
                const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
                const segmentDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                accumulatedDistance += segmentDist;

                if (accumulatedDistance >= MILE_IN_METERS * mileCount) {
                  waypointsForRoute.push({
                    name: `Mile ${mileCount}`,
                    lat: curr.latitude,
                    lng: curr.longitude,
                    elevation: curr.altitude || null,
                  });
                  mileCount++;
                }
              }

              const lastPoint = points[points.length - 1];
              waypointsForRoute.push({
                name: 'End',
                lat: lastPoint.latitude,
                lng: lastPoint.longitude,
                elevation: lastPoint.altitude || null,
              });
            }
          }

          let routeSaved = false;
          for (let routeAttempt = 0; routeAttempt < 3; routeAttempt++) {
            try {
              const routeRes = await fetch(`/api/activities/${(result as any).id}/save-as-route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ waypoints: waypointsForRoute }),
              });

              if (routeRes.ok) {
                routeSaved = true;
                queryClient.invalidateQueries({ queryKey: ['/api/routes'] });
                break;
              } else {
                const errData = await routeRes.json().catch(() => ({}));
                console.warn(`Route creation attempt ${routeAttempt + 1}/3 failed:`, routeRes.status, errData);
              }
            } catch (routeErr) {
              console.warn(`Route creation attempt ${routeAttempt + 1}/3 error:`, routeErr);
            }

            if (routeAttempt < 2) {
              await new Promise(resolve => setTimeout(resolve, 1500));
            }
          }

          if (!routeSaved) {
            toast({
              title: 'Activity saved',
              description: 'Your activity was recorded but could not be added to your routes. You can manually create a route from the activity later.',
              variant: 'destructive',
            });
          }

          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          setState({
            isRecording: false,
            isPaused: false,
            activityType: 'hike',
            startTime: null,
            trackPoints: [],
            stats: initialStats,
            currentPosition: null,
            waypoints: [],
          });
          lastValidPointRef.current = null;
          return result as Activity;
          
        } catch (error) {
          lastError = error;
          console.warn(`Save attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error);
          
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
          }
        }
      }
      
      console.error('All save attempts failed:', lastError);
      toast({
        title: 'Save failed',
        description: 'Your activity is saved locally and will be retried. Please check your connection.',
        variant: 'destructive',
      });
      
      persistRecordingState({
        ...currentState,
        isRecording: true,
        isPaused: true,
      });
      
      return null;
    },
    [saveActivityMutation, toast, queryClient, wakeLock]
  );

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    ...state,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    saveRecording,
    addWaypoint,
    isSaving: saveActivityMutation.isPending,
    hasPersistedSession,
    resumeRecordingFromPersisted,
    dismissPersistedSession,
  };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles < 0.1) {
    return `${Math.round(meters * 3.28084)} ft`;
  }
  return `${miles.toFixed(2)} mi`;
}

export function formatSpeed(metersPerSecond: number): string {
  const mph = metersPerSecond * 2.23694;
  return `${mph.toFixed(1)} mph`;
}

export function formatPace(secondsPerKm: number): string {
  if (!isFinite(secondsPerKm) || secondsPerKm === 0) {
    return '--:--';
  }
  const secondsPerMile = secondsPerKm * 1.60934;
  const m = Math.floor(secondsPerMile / 60);
  const s = Math.floor(secondsPerMile % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatElevation(meters: number): string {
  const feet = meters * 3.28084;
  return `${Math.round(feet)} ft`;
}
