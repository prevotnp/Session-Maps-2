import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  X, Send, Sparkles, Loader2, Plus, Users, Map, ChevronDown, ChevronUp
} from 'lucide-react';

interface SuggestedWaypoint {
  name: string;
  lat: number;
  lng: number;
  description?: string;
}

interface RouteOption {
  label: string;
  source: 'trail_data' | 'community';
  description: string;
  waypoints: SuggestedWaypoint[];
  communityRouteId?: number;
  communityAuthor?: string;
  added?: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  routeOptions?: RouteOption[];
}

const ACTIVITY_TYPES = [
  { id: 'hiking', label: 'Hiking', icon: '🥾' },
  { id: 'trail_running', label: 'Trail Run', icon: '🏃' },
  { id: 'downhill_skiing', label: 'Downhill Ski', icon: '⛷️' },
  { id: 'xc_skiing', label: 'XC Ski', icon: '🎿' },
  { id: 'mountain_biking', label: 'MTB', icon: '🚵' },
] as const;

interface AIRouteAssistPanelProps {
  isOpen: boolean;
  onClose: () => void;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  onAddWaypoints?: (waypoints: SuggestedWaypoint[], label: string) => void;
  existingRoute?: {
    name: string;
    waypoints: Array<{ name: string; lat: number; lng: number; elevation?: number }>;
    totalDistance: number;
    elevationGain: number;
    elevationLoss: number;
    routingMode: string;
  };
}

export default function AIRouteAssistPanel({
  isOpen, onClose, mapCenter, mapZoom, onAddWaypoints, existingRoute
}: AIRouteAssistPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activityType, setActivityType] = useState<string>('hiking');
  const [expandedOptions, setExpandedOptions] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const toggleOptionExpanded = (key: string) => {
    setExpandedOptions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsLoading(true);

    try {
      const conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/ai/route-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          activityType,
          mapCenter,
          mapZoom,
          conversationHistory,
          existingRoute: existingRoute || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(err.message || `Error ${response.status}`);
      }

      const data = await response.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message,
        routeOptions: data.routeOptions,
      }]);
    } catch (error: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ ${error.message || 'Something went wrong. Please try again.'}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, activityType, mapCenter, mapZoom, existingRoute]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleAddOption = (msgIndex: number, optIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg.routeOptions || !onAddWaypoints) return;
    const option = msg.routeOptions[optIndex];
    onAddWaypoints(option.waypoints, option.label);
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIndex || !m.routeOptions) return m;
      const updated = [...m.routeOptions];
      updated[optIndex] = { ...updated[optIndex], added: true };
      return { ...m, routeOptions: updated };
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="absolute left-4 top-20 bottom-20 w-96 z-40 pointer-events-auto bg-gray-900/90 backdrop-blur-sm border border-white/20 rounded-lg overflow-hidden flex flex-col">
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-white font-semibold flex items-center gap-2 text-sm">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          AI Route Assistant
        </h3>
        <Button variant="ghost" size="icon" className="w-8 h-8 text-white/60 hover:text-white hover:bg-white/10" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="px-3 py-2 border-b border-white/10 flex gap-1 overflow-x-auto">
        {ACTIVITY_TYPES.map(type => (
          <button
            key={type.id}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              activityType === type.id
                ? 'bg-blue-600 text-white'
                : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
            }`}
            onClick={() => setActivityType(type.id)}
          >
            <span>{type.icon}</span>
            <span>{type.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Sparkles className="w-10 h-10 mx-auto mb-3 text-yellow-400/30" />
            <p className="text-white/50 text-sm mb-2">Describe the route you want to build</p>
            <p className="text-white/30 text-xs leading-relaxed px-4">
              I'll search real trail data AND routes shared by other Session Maps users to find the best options for you.
            </p>
            <div className="mt-4 space-y-1.5 px-4">
              <p className="text-white/20 text-[10px] uppercase tracking-wider">Try asking:</p>
              {[
                "5-mile loop hike with good views",
                "Best beginner ski run nearby",
                "What trails connect to the summit?",
              ].map((suggestion, i) => (
                <button
                  key={i}
                  className="block w-full text-left text-white/40 hover:text-white/70 text-xs py-1.5 px-3 rounded-md hover:bg-white/5 transition-colors"
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                >
                  "{suggestion}"
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/90'
            }`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>

              {msg.role === 'assistant' && msg.routeOptions && msg.routeOptions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {msg.routeOptions.map((option, j) => {
                    const optKey = `${i}-${j}`;
                    const isExpanded = expandedOptions.has(optKey);
                    const isCommunity = option.source === 'community';

                    return (
                      <div key={j} className={`rounded-md border ${
                        isCommunity ? 'border-purple-400/30 bg-purple-400/5' : 'border-blue-400/30 bg-blue-400/5'
                      }`}>
                        <button
                          className="w-full px-3 py-2 flex items-center justify-between text-left"
                          onClick={() => toggleOptionExpanded(optKey)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isCommunity ? (
                              <Users className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                            ) : (
                              <Map className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className={`text-xs font-semibold truncate ${isCommunity ? 'text-purple-300' : 'text-blue-300'}`}>
                                {isCommunity ? '👥 ' : '🗺️ '}{option.label}
                              </p>
                              <p className="text-white/50 text-[10px] truncate">{option.description}</p>
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-white/30 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-white/30 shrink-0" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-2 border-t border-white/5">
                            {isCommunity && option.communityAuthor && (
                              <p className="text-purple-300/60 text-[10px] mt-1.5 mb-1">
                                📍 GPS-verified route by @{option.communityAuthor} on Session Maps
                              </p>
                            )}
                            <div className="space-y-0.5 mt-1">
                              {option.waypoints.map((wp, k) => (
                                <div key={k} className="text-white/40 text-[11px] pl-1 flex items-start gap-1.5">
                                  <span className="text-white/20 shrink-0">{k + 1}.</span>
                                  <div>
                                    <span className="text-white/60">{wp.name}</span>
                                    {wp.description && <span className="text-white/30"> — {wp.description}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <button
                              className={`mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                                option.added
                                  ? 'bg-green-600/20 text-green-300 cursor-default'
                                  : isCommunity
                                    ? 'bg-purple-600 hover:bg-purple-500 text-white active:scale-95'
                                    : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
                              }`}
                              onClick={() => !option.added && handleAddOption(i, j)}
                              disabled={option.added}
                            >
                              {option.added ? (
                                <>✓ Added to Map</>
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  Add This Route to Map
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
              <span className="text-white/50 text-sm">Searching trails & community routes...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-white/10">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the route you want..."
            className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            rows={2}
            disabled={isLoading}
          />
          <Button
            size="icon"
            className="w-10 h-10 bg-blue-600 hover:bg-blue-500 text-white shrink-0 self-end active:scale-95"
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}