import { useEffect, useRef } from 'react';
import { isNative } from '@/lib/capacitor';

interface BackgroundResilienceOptions {
  isActive: boolean;
  onForegroundResume: () => void;
  onBackgroundEnter?: () => void;
  label: string;
}

export function useBackgroundResilience({
  isActive,
  onForegroundResume,
  onBackgroundEnter,
  label,
}: BackgroundResilienceOptions) {
  const lastHiddenTimeRef = useRef<number | null>(null);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    if (!isActive) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenTimeRef.current = Date.now();
        onBackgroundEnter?.();
      } else if (document.visibilityState === 'visible') {
        lastHiddenTimeRef.current = null;

        setTimeout(() => {
          if (isActiveRef.current) {
            onForegroundResume();
          }
        }, 500);
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && isActiveRef.current) {
        setTimeout(() => onForegroundResume(), 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);

    let capacitorCleanup: (() => void) | null = null;

    if (isNative) {
      import('@capacitor/app').then(({ App }) => {
        const listener = App.addListener('appStateChange', ({ isActive: appIsActive }) => {
          if (appIsActive && isActiveRef.current) {
            setTimeout(() => onForegroundResume(), 300);
          } else if (!appIsActive) {
            onBackgroundEnter?.();
          }
        });
        capacitorCleanup = () => {
          listener.then(h => h.remove());
        };
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      if (capacitorCleanup) capacitorCleanup();
    };
  }, [isActive, onForegroundResume, onBackgroundEnter, label]);
}
