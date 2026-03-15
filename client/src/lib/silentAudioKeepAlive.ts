let audioContext: AudioContext | null = null;
let oscillatorNode: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let isActive = false;
let wakeLock: any = null;

/**
 * Start a silent audio loop + Wake Lock to prevent mobile browsers from
 * suspending JavaScript execution when the PWA is backgrounded.
 * Uses a 1 Hz oscillator (below human hearing) with near-zero gain,
 * plus the Screen Wake Lock API as a secondary keep-alive mechanism.
 */
export async function startKeepAlive(): Promise<void> {
  if (isActive) return;

  // 1. Silent audio oscillator to keep the audio context (and JS thread) alive
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {});
    }

    oscillatorNode = audioContext.createOscillator();
    oscillatorNode.frequency.setValueAtTime(1, audioContext.currentTime);

    gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0.001, audioContext.currentTime);

    oscillatorNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillatorNode.start();
    isActive = true;
  } catch (error) {
    console.warn('[KeepAlive] Failed to start silent audio:', error);
  }

  // 2. Screen Wake Lock API — prevents screen from dimming/locking
  // This helps keep the browser process alive on many mobile devices
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch (error) {
    // Wake Lock can fail if the page isn't visible — that's OK
    console.warn('[KeepAlive] Wake Lock not available:', error);
  }
}

/**
 * Stop the silent audio loop and release Wake Lock.
 * Call when the app returns to foreground or when location sharing ends.
 */
export function stopKeepAlive(): void {
  if (!isActive && !wakeLock) return;

  try {
    if (oscillatorNode) {
      oscillatorNode.stop();
      oscillatorNode.disconnect();
      oscillatorNode = null;
    }

    if (gainNode) {
      gainNode.disconnect();
      gainNode = null;
    }

    isActive = false;
  } catch (error) {
    console.warn('[KeepAlive] Failed to stop silent audio:', error);
  }

  try {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  } catch (error) {
    console.warn('[KeepAlive] Failed to release Wake Lock:', error);
  }
}

export function isKeepAliveRunning(): boolean {
  return isActive;
}
