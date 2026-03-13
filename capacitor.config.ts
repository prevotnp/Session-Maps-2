import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sessionmaps.app',
  appName: 'Session Maps',
  webDir: 'dist/public',
  
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    backgroundColor: '#0a0a0f',
  },
  
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Geolocation: {
      permissions: ['whenInUse', 'always'],
    },
    BackgroundGeolocation: {
      // Background location tracking for live team map sessions
      // License key required for production builds
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a0a0f',
    },
  },
};

export default config;
