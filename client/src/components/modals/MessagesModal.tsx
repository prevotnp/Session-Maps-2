import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft,
  Send,
  Plus,
  Search,
  MessageCircle,
  User,
  Trash2,
} from "lucide-react";

interface MessagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewProfile: (username: string) => void;
  initialUserId?: number | null;
}

interface Conversation {
  otherUser: { id: number; username: string; fullName: string | null };
  lastMessage: { id: number; body: string; senderId: number; createdAt: string | null };
  unreadCount: number;
}

interface DirectMessage {
  id: number;
  senderId: number;
  receiverId: number;
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface SearchUser {
  id: number;
  username: string;
  fullName: string | null;
}

type View = "list" | "conversation" | "new";

export function MessagesModal({ isOpen, onClose, onViewProfile, initialUserId }: MessagesModalProps) {
  const { user } = useAuth();
  const [view, setView] = useState<View>("list");
  const [selectedUser, setSelectedUser] = useState<{ id: number; username: string; fullName: string | null } | null>(null);
  const [messageText, setMessageText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track visual viewport for iOS keyboard handling
  const [vpHeight, setVpHeight] = useState<number | null>(null);
  const [vpOffsetTop, setVpOffsetTop] = useState(0);
  const keyboardOpen = vpHeight !== null;

  useEffect(() => {
    if (!isOpen) {
      setVpHeight(null);
      setVpOffsetTop(0);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      const threshold = 100; // keyboard detection threshold in px
      const isKB = window.innerHeight - vv.height > threshold;
      if (isKB) {
        setVpHeight(vv.height);
        setVpOffsetTop(vv.offsetTop);
      } else {
        setVpHeight(null);
        setVpOffsetTop(0);
      }
    };

    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();

    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, [isOpen]);

  // Scroll to bottom when keyboard opens so latest messages stay visible
  useEffect(() => {
    if (keyboardOpen && view === 'conversation') {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [keyboardOpen, view]);

  useEffect(() => {
    if (isOpen) {
      if (initialUserId) {
        fetch(`/api/messages/conversations`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : [])
          .then((convs: Conversation[]) => {
            const existing = convs.find(c => c.otherUser.id === initialUserId);
            if (existing) {
              setSelectedUser(existing.otherUser);
              setView("conversation");
            } else {
              fetch(`/api/friends/search?query=${initialUserId}`, { credentials: 'include' })
                .then(r => r.ok ? r.json() : [])
                .then((users: SearchUser[]) => {
                  const found = users.find(u => u.id === initialUserId);
                  if (found) {
                    setSelectedUser(found);
                    setView("conversation");
                  } else {
                    setView("list");
                  }
                })
                .catch(() => setView("list"));
            }
          })
          .catch(() => setView("list"));
      } else {
        setView("list");
      }
      setMessageText("");
      setSearchQuery("");
    }
  }, [isOpen, initialUserId]);

  const { data: conversations = [], isLoading: isConvLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/messages/conversations"],
    enabled: isOpen,
    refetchInterval: isOpen ? 10000 : false,
  });

  const { data: messages = [], isLoading: isMsgLoading } = useQuery<DirectMessage[]>({
    queryKey: ["/api/messages", selectedUser?.id],
    queryFn: async () => {
      const res = await fetch(`/api/messages/${selectedUser!.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json();
    },
    enabled: isOpen && view === "conversation" && !!selectedUser,
    refetchInterval: isOpen && view === "conversation" ? 5000 : false,
  });

  const { data: searchResults = [] } = useQuery<SearchUser[]>({
    queryKey: ["/api/friends/search", searchQuery],
    queryFn: async () => {
      const res = await fetch(`/api/friends/search?query=${encodeURIComponent(searchQuery)}`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isOpen && view === "new" && searchQuery.length >= 2,
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: number) => {
      return apiRequest("DELETE", `/api/messages/${messageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", selectedUser?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async ({ receiverId, body }: { receiverId: number; body: string }) => {
      return apiRequest("POST", "/api/messages", { receiverId, body });
    },
    onSuccess: () => {
      setMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/messages", selectedUser?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    },
  });

  useEffect(() => {
    if (view === "conversation" && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, view]);

  const handleSend = () => {
    if (!selectedUser || !messageText.trim()) return;
    sendMutation.mutate({ receiverId: selectedUser.id, body: messageText.trim() });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openConversation = (otherUser: { id: number; username: string; fullName: string | null }) => {
    setSelectedUser(otherUser);
    setView("conversation");
    fetch(`/api/messages/${otherUser.id}/read`, { method: 'PATCH', credentials: 'include' })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
      });
  };

  const selectNewMessageUser = (u: SearchUser) => {
    setSelectedUser(u);
    setView("conversation");
    setSearchQuery("");
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHrs < 24) return `${diffHrs}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getInitials = (name: string | null, username: string) => {
    if (name) return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    return username.substring(0, 2).toUpperCase();
  };

  const sortedMessages = [...messages].sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={`max-w-lg flex flex-col p-0 bg-gray-900 border-gray-700 gap-0 ${
          !keyboardOpen ? 'h-[80vh] max-h-[600px]' : ''
        }`}
        style={keyboardOpen && view === 'conversation' ? {
          height: `${vpHeight! - 16}px`,
          maxHeight: `${vpHeight! - 16}px`,
          top: `${vpOffsetTop + vpHeight! / 2}px`,
        } : undefined}
      >

        {view === "list" && (
          <>
            <div className="flex items-center justify-center p-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">Messages</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-primary ml-2"
                onClick={() => setView("new")}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isConvLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <MessageCircle className="h-12 w-12 mb-3 opacity-30" />
                  <p className="font-medium">No messages yet</p>
                  <p className="text-sm mt-1">Tap + to start a conversation</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {conversations.map((conv) => (
                    <button
                      key={conv.otherUser.id}
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-800/50 active:bg-gray-800 transition-colors"
                      onClick={() => openConversation(conv.otherUser)}
                    >
                      <Avatar className="h-12 w-12 shrink-0">
                        <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${conv.otherUser.username}`} />
                        <AvatarFallback className="bg-primary/20 text-primary text-sm">
                          {getInitials(conv.otherUser.fullName, conv.otherUser.username)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className={`font-medium truncate ${conv.unreadCount > 0 ? 'text-white' : 'text-gray-300'}`}>
                            {conv.otherUser.fullName || conv.otherUser.username}
                          </span>
                          <span className="text-xs text-gray-500 shrink-0 ml-2">
                            {formatTime(conv.lastMessage.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className={`text-sm truncate ${conv.unreadCount > 0 ? 'text-gray-300 font-medium' : 'text-gray-500'}`}>
                            {conv.lastMessage.senderId === user?.id ? 'You: ' : ''}
                            {conv.lastMessage.body}
                          </p>
                          {conv.unreadCount > 0 && (
                            <div className="bg-red-500 text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center shrink-0 ml-2 px-1.5">
                              {conv.unreadCount}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {view === "conversation" && selectedUser && (
          <>
            <div className="flex items-center gap-3 p-4 border-b border-gray-700">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => { setView("list"); setSelectedUser(null); }}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <button
                className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
                onClick={() => onViewProfile(selectedUser.username)}
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${selectedUser.username}`} />
                  <AvatarFallback className="bg-primary/20 text-primary text-xs">
                    {getInitials(selectedUser.fullName, selectedUser.username)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-medium text-white text-sm truncate">
                    {selectedUser.fullName || selectedUser.username}
                  </p>
                  <p className="text-xs text-gray-500">@{selectedUser.username}</p>
                </div>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col">
              {isMsgLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : sortedMessages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <p className="text-sm">Send a message to start the conversation</p>
                </div>
              ) : (
                <>
                  {sortedMessages.map((msg) => {
                    const isMine = msg.senderId === user?.id;
                    return (
                      <div key={msg.id} className={`flex mb-2 items-center gap-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                        {!isMine && (
                          <div className="w-7 shrink-0" />
                        )}
                        <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                          isMine 
                            ? 'bg-primary text-white rounded-br-md' 
                            : 'bg-gray-800 text-gray-100 rounded-bl-md'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                          <p className={`text-[10px] mt-1 ${isMine ? 'text-white/60' : 'text-gray-500'}`}>
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                        {isMine && (
                          <button
                            className="shrink-0 p-1 text-red-500 hover:text-red-400 opacity-40 hover:opacity-100 transition-opacity"
                            onClick={() => deleteMutation.mutate(msg.id)}
                            disabled={deleteMutation.isPending}
                            title="Delete message"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                        {!isMine && (
                          <div className="w-7 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <div className="p-3 border-t border-gray-700 flex gap-2">
              <Input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-gray-800 border-gray-600 text-white placeholder:text-gray-500"
                autoFocus
              />
              <Button
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={handleSend}
                disabled={!messageText.trim() || sendMutation.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {view === "new" && (
          <>
            <div className="flex items-center gap-3 p-4 border-b border-gray-700">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setView("list")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h2 className="text-lg font-semibold text-white">New Message</h2>
            </div>

            <div className="p-4 border-b border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by username or name..."
                  className="pl-10 bg-gray-800 border-gray-600 text-white placeholder:text-gray-500"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {searchQuery.length < 2 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <Search className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Search for a user to message</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <User className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No users found</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-800/50 active:bg-gray-800 transition-colors"
                      onClick={() => selectNewMessageUser(u)}
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${u.username}`} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {getInitials(u.fullName, u.username)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-medium text-white text-sm truncate">
                          {u.fullName || u.username}
                        </p>
                        <p className="text-xs text-gray-500">@{u.username}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
