import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Mic, MicOff, Play, Volume2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface VoiceMessage {
  id: number | string;
  userId: number;
  username: string;
  audio?: string;        // base64 (for real-time messages)
  audioUrl?: string;     // URL (for fetched missed messages)
  mimeType: string;
  duration: number;      // seconds
  timestamp: number;     // Unix ms
  isPlaying?: boolean;
  hasPlayed?: boolean;
}

interface RadioPanelProps {
  isOpen: boolean;
  onClose: () => void;
  wsRef: React.RefObject<WebSocket | null>;
  sessionId: number;
  currentUserId: number;
  currentUsername: string;
  voiceMessages: VoiceMessage[];
  onNewVoiceMessage: (msg: VoiceMessage) => void;
}

const MEMBER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

function getMemberColorByIndex(userId: number, currentUserId: number): string {
  if (userId === currentUserId) return MEMBER_COLORS[0];
  // Simple deterministic color based on userId
  return MEMBER_COLORS[(userId % (MEMBER_COLORS.length - 1)) + 1];
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function playChime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* ignore */ }
}

export async function playVoiceMessage(msg: VoiceMessage): Promise<void> {
  let audioUrl: string;
  let needsRevoke = false;

  if (msg.audio) {
    const audioData = Uint8Array.from(atob(msg.audio), c => c.charCodeAt(0));
    const blob = new Blob([audioData], { type: msg.mimeType });
    audioUrl = URL.createObjectURL(blob);
    needsRevoke = true;
  } else if (msg.audioUrl) {
    audioUrl = msg.audioUrl;
  } else {
    return;
  }

  playChime();
  await new Promise(resolve => setTimeout(resolve, 300));

  return new Promise<void>((resolve) => {
    const audio = new Audio(audioUrl);
    audio.play().then(() => {
      msg.hasPlayed = true;
    }).catch((err) => {
      console.warn('Voice auto-play blocked:', err);
      // Mark as played so it shows in the log for manual replay
      msg.hasPlayed = false;
      if (needsRevoke) URL.revokeObjectURL(audioUrl);
      resolve();
    });
    audio.onended = () => {
      msg.hasPlayed = true;
      if (needsRevoke) URL.revokeObjectURL(audioUrl);
      resolve();
    };
    audio.onerror = () => {
      console.warn('Voice playback error');
      if (needsRevoke) URL.revokeObjectURL(audioUrl);
      resolve();
    };
  });
}

const MAX_RECORDING_SECONDS = 30;

export default function RadioPanel({
  isOpen,
  onClose,
  wsRef,
  sessionId,
  currentUserId,
  currentUsername,
  voiceMessages,
  onNewVoiceMessage,
}: RadioPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [sentFlash, setSentFlash] = useState(false);
  const [playingId, setPlayingId] = useState<number | string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useRef(
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [voiceMessages.length]);

  const startRecording = useCallback(async () => {
    setMicError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;

      // Determine supported mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const duration = Math.round((Date.now() - startTimeRef.current) / 1000);

        // Don't send empty or very short recordings
        if (duration < 1 || blob.size < 100) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];

          // Upload audio via REST (not WebSocket) to avoid proxy message size limits
          fetch(`/api/live-maps/${sessionId}/voice-messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              audio: base64,
              mimeType,
              duration,
              username: currentUsername,
            }),
          }).then(res => {
            if (res.ok) return res.json();
            throw new Error('Upload failed');
          }).then(({ id, timestamp }) => {
            // Add to local message list with server-assigned ID
            onNewVoiceMessage({
              id,
              userId: currentUserId,
              username: currentUsername,
              audioUrl: `/api/voice-messages/${id}/audio`,
              mimeType,
              duration,
              timestamp,
              hasPlayed: true,
            });

            setSentFlash(true);
            setTimeout(() => setSentFlash(false), 1500);
          }).catch(err => {
            console.error('Voice message upload failed:', err);
          });
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDuration(0);

      // Send talking indicator
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'voice:talking', isTalking: true }));
      }

      // Update duration timer
      timerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        setRecordingDuration(elapsed);

        // Auto-stop at max duration
        if (elapsed >= MAX_RECORDING_SECONDS) {
          stopRecording();
        }
      }, 200);
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicError('Microphone access required \u2014 enable in browser settings');
      } else {
        setMicError('Could not access microphone');
      }
    }
  }, [wsRef, currentUsername, currentUserId, onNewVoiceMessage]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Send talking indicator off
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'voice:talking', isTalking: false }));
    }
  }, [wsRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const handlePlayMessage = async (msg: VoiceMessage) => {
    setPlayingId(msg.id);
    await playVoiceMessage(msg);
    setPlayingId(null);
  };

  // Desktop: mouse down/up to record. Mobile: tap to toggle.
  const handleTalkDown = () => {
    if (isMobile.current) return; // Mobile uses tap toggle
    if (!isRecording) startRecording();
  };

  const handleTalkUp = () => {
    if (isMobile.current) return; // Mobile uses tap toggle
    if (isRecording) stopRecording();
  };

  const handleTalkClick = () => {
    if (!isMobile.current) return; // Desktop uses hold
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-gray-900 z-30 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-red-400" />
          Radio
        </h3>
        <Button
          variant="outline"
          className="h-10 px-4 rounded-full hover:bg-gray-700 text-white border-white/30"
          onClick={onClose}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Team Map
        </Button>
      </div>

      {/* Voice Message Log */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {voiceMessages.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              No radio messages yet. Press the talk button to send one!
            </p>
          ) : (
            voiceMessages.map((msg) => {
              const isOwnMessage = msg.userId === currentUserId;
              const color = getMemberColorByIndex(msg.userId, currentUserId);

              return (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    isOwnMessage ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'rounded-xl p-3 max-w-[80%] min-w-[180px]',
                      isOwnMessage ? 'bg-blue-600/80' : 'bg-gray-800'
                    )}
                  >
                    {/* Sender name */}
                    {!isOwnMessage && (
                      <p className="text-xs font-semibold mb-1" style={{ color }}>
                        {msg.username}
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      {/* Play button */}
                      <button
                        onClick={() => handlePlayMessage(msg)}
                        disabled={playingId === msg.id}
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center transition-all',
                          playingId === msg.id
                            ? 'bg-green-500 animate-pulse'
                            : 'bg-white/20 hover:bg-white/30'
                        )}
                      >
                        {playingId === msg.id ? (
                          <Volume2 className="w-4 h-4 text-white" />
                        ) : (
                          <Play className="w-4 h-4 text-white ml-0.5" />
                        )}
                      </button>

                      {/* Duration + waveform placeholder */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-white/30 rounded-full"
                              style={{ width: '100%' }}
                            />
                          </div>
                          <span className="text-xs text-gray-300 whitespace-nowrap">
                            {msg.duration}s
                          </span>
                        </div>
                      </div>

                      {/* Status badge */}
                      {msg.hasPlayed ? (
                        <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
                      ) : !isOwnMessage ? (
                        <span className="text-[9px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">
                          NEW
                        </span>
                      ) : null}
                    </div>

                    {/* Timestamp */}
                    <p className="text-[10px] text-gray-400 mt-1">
                      {formatTimeAgo(msg.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Push-to-Talk Button Area */}
      <div className="p-6 border-t border-gray-700 flex flex-col items-center gap-3">
        {micError && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/30 px-4 py-2 rounded-lg">
            <MicOff className="w-4 h-4" />
            {micError}
          </div>
        )}

        {/* Recording duration counter */}
        {isRecording && (
          <div className="text-white text-sm font-mono">
            <span className="text-red-400 animate-pulse mr-2">\u25CF</span>
            0:{recordingDuration.toString().padStart(2, '0')} / 0:{MAX_RECORDING_SECONDS}
          </div>
        )}

        {/* Sent flash */}
        {sentFlash && (
          <div className="text-green-400 text-sm font-semibold animate-pulse">
            \u2713 Sent!
          </div>
        )}

        {/* Talk button */}
        <button
          onMouseDown={handleTalkDown}
          onMouseUp={handleTalkUp}
          onMouseLeave={() => { if (isRecording && !isMobile.current) stopRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); handleTalkClick(); }}
          onClick={handleTalkClick}
          className={cn(
            'w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg select-none',
            isRecording
              ? 'bg-red-600 scale-110 ring-4 ring-red-400/50 animate-pulse'
              : sentFlash
              ? 'bg-green-500 scale-100'
              : 'bg-red-500 hover:bg-red-400 active:scale-95'
          )}
        >
          <Mic className="w-8 h-8 text-white" />
        </button>

        <p className="text-xs text-gray-500">
          {isRecording
            ? (isMobile.current ? 'Tap to stop' : 'Release to send')
            : (isMobile.current ? 'Tap to talk' : 'Hold to talk')}
        </p>
      </div>
    </div>
  );
}
