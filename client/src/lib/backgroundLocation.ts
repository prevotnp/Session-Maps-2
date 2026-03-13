import { isNative } from '@/lib/capacitor';

let isTracking = false;
let pluginCache: any = null;

interface BackgroundLocationConfig {
  sessionId: number;
  serverUrl: string;
  authToken: string;
}

async function loadPlugin() {
  if (pluginCache) return pluginCache;
  if (!isNative) return null;

  try {
    // Use a variable to prevent Vite from resolving this at build time
    const pkgName = '@transistorsoft/capacitor-background-geolocation';
    const mod = await import(/* @vite-ignore */ pkgName);
    pluginCache = mod.default;
    return pluginCache;
  } catch {
    console.warn('[BackgroundLocation] Plugin not available on this platform');
    return null;
  }
}

export async function startBackgroundTracking(config: BackgroundLocationConfig): Promise<void> {
  if (!isNative || isTracking) return;

  const BackgroundGeolocation = await loadPlugin();
  if (!BackgroundGeolocation) return;

  try {
    await BackgroundGeolocation.ready({
      desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
      distanceFilter: 5,
      stopOnTerminate: false,
      startOnBoot: false,
      locationUpdateInterval: 2000,
      fastestLocationUpdateInterval: 2000,

      url: `${config.serverUrl}/api/live-maps/${config.sessionId}/background-location`,
      headers: {
        'Authorization': `Bearer ${config.authToken}`,
      },
      autoSync: true,
      batchSync: false,
      locationTemplate: '{"latitude":<%= latitude %>,"longitude":<%= longitude %>,"accuracy":<%= accuracy %>,"heading":<%= heading %>,"speed":<%= speed %>}',

      notification: {
        title: 'Session Maps',
        text: 'Sharing location with your team',
      },

      activityType: BackgroundGeolocation.ACTIVITY_TYPE_OTHER,
      pausesLocationUpdatesAutomatically: false,
    });

    await BackgroundGeolocation.start();
    isTracking = true;
  } catch (error) {
    console.error('[BackgroundLocation] Failed to start:', error);
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  if (!isNative || !isTracking) return;

  const BackgroundGeolocation = await loadPlugin();
  if (!BackgroundGeolocation) return;

  try {
    await BackgroundGeolocation.stop();
    await BackgroundGeolocation.removeListeners();
    isTracking = false;
  } catch (error) {
    console.error('[BackgroundLocation] Failed to stop:', error);
  }
}

export function isBackgroundTrackingActive(): boolean {
  return isTracking;
}
