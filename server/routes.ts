import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage as dbStorage } from "./storage";
import { setupAuth, sessionMiddleware } from "./auth";
import { WebSocketServer, WebSocket } from "ws";
import { locationShareSchema } from "@shared/schema";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";

// Route modules
import { registerAuthRoutes } from "./routes/auth";
import { registerDroneRoutes } from "./routes/drone";
import { registerCesiumRoutes } from "./routes/cesium";
import { registerLocationRoutes } from "./routes/locations";
import { registerRoutingRoutes } from "./routes/routing";
import { registerTripRoutes } from "./routes/trips";
import { registerSocialRoutes } from "./routes/social";
import { registerMessagingRoutes } from "./routes/messaging";
import { registerLiveMapRoutes } from "./routes/liveMaps";
import { registerActivityRoutes } from "./routes/activities";
import { registerMiscRoutes } from "./routes/misc";
import { registerEnterpriseRoutes } from "./routes/enterprise";

// Shared utilities
import { validateRequest, parseId } from "./routes/utils";
import type { WebSocketState } from "./routes/utils";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  registerObjectStorageRoutes(app);

  // Auth middleware
  setupAuth(app);

  // Setup admin user
  try {
    const existingUser = await dbStorage.getUserByUsername("prevotnp");
    if (existingUser) {
      await dbStorage.setUserAdmin(existingUser.id, true);
    }
  } catch (error) {
    console.error("Admin user setup error:", error);
  }

  // --- WebSocket server for real-time features ---
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }

    const mockRes: any = {
      end: () => {},
      setHeader: () => mockRes,
      getHeader: () => undefined,
      writeHead: () => mockRes,
      on: () => mockRes,
      emit: () => mockRes,
    };

    sessionMiddleware(request as any, mockRes, () => {
      const sess = (request as any).session;
      const authenticatedUserId = sess?.passport?.user;

      if (!authenticatedUserId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).authenticatedUserId = authenticatedUserId;
        wss.emit('connection', ws, request);
      });
    });
  });

  // WebSocket state shared with route modules
  const clients: Map<number, WebSocket> = new Map();
  const sessionRooms: Map<number, Set<number>> = new Map();
  const disconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  function broadcastToSession(sessionId: number, message: any) {
    const room = sessionRooms.get(sessionId);
    if (!room) return;

    const messageStr = JSON.stringify({ ...message, sessionId });
    room.forEach(userId => {
      const client = clients.get(userId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  const wsState: WebSocketState = { clients, sessionRooms, disconnectTimers, broadcastToSession };

  // WebSocket connection handler
  wss.on('connection', (ws: WebSocket) => {
    const userId: number = (ws as any).authenticatedUserId;
    let currentSessionId: number | null = null;

    (ws as any).isAlive = true;

    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    clients.set(userId, ws);

    ws.send(JSON.stringify({
      type: 'auth',
      status: 'success',
      userId: userId,
      message: 'Connected to location sharing service'
    }));

    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message);

        (ws as any).isAlive = true;

        if (data.type === 'auth') return;

        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (data.type === 'session:join' && userId) {
          const sessionId = parseId(String(data.sessionId));
          if (!sessionId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid session ID' }));
            return;
          }

          try {
            const session = await dbStorage.getLiveMapSession(sessionId);
            if (!session || !session.isActive) {
              ws.send(JSON.stringify({ type: 'error', message: 'Session not found or ended' }));
              return;
            }

            const members = await dbStorage.getLiveMapMembers(sessionId);
            const isMember = members.some((m: any) => m.userId === userId) || session.ownerId === userId;

            if (!isMember) {
              ws.send(JSON.stringify({ type: 'error', message: 'Not a member of this session' }));
              return;
            }
          } catch (err) {
            console.error('Error verifying session membership:', err);
          }

          currentSessionId = sessionId;

          const timerKey = `${sessionId}:${userId}`;
          const existingTimer = disconnectTimers.get(timerKey);
          if (existingTimer) {
            clearTimeout(existingTimer);
            disconnectTimers.delete(timerKey);
          }

          if (!sessionRooms.has(sessionId)) {
            sessionRooms.set(sessionId, new Set());
          }
          sessionRooms.get(sessionId)!.add(userId);

          ws.send(JSON.stringify({ type: 'session:joined', sessionId }));
        }

        if (data.type === 'session:leave' && userId && currentSessionId) {
          const room = sessionRooms.get(currentSessionId);
          if (room) {
            room.delete(userId);
            if (room.size === 0) {
              sessionRooms.delete(currentSessionId);
            }
          }
          currentSessionId = null;
        }

        if (data.type === 'session:location' && userId && currentSessionId) {
          const { latitude, longitude, accuracy, heading } = data;

          await dbStorage.updateLiveMapMemberLocation(
            currentSessionId,
            userId,
            String(latitude),
            String(longitude),
            accuracy ? String(accuracy) : undefined,
            heading ? String(heading) : undefined
          );

          broadcastToSession(currentSessionId, {
            type: 'member:locationUpdate',
            data: { userId, latitude, longitude, accuracy, heading }
          });
        }

        // Voice talking indicator
        if (data.type === 'voice:talking' && userId && currentSessionId) {
          broadcastToSession(currentSessionId, {
            type: 'voice:talking',
            data: { userId, isTalking: data.isTalking }
          });
        }

        if (data.type === 'location' && userId) {
          const validation = validateRequest(locationShareSchema, data.location);
          if (!validation.success) {
            ws.send(JSON.stringify({ type: 'error', message: validation.error }));
            return;
          }

          try {
            const sender = await dbStorage.getUser(userId);
            if (!sender || !sender.locationSharingEnabled) return;

            const friendIds = await dbStorage.getFriendIdsForLocationBroadcast(userId);

            friendIds.forEach((friendId: number) => {
              const friendClient = clients.get(friendId);
              if (friendClient && friendClient.readyState === WebSocket.OPEN) {
                friendClient.send(JSON.stringify({
                  type: 'location',
                  userId,
                  location: validation.data
                }));
              }
            });
          } catch (err) {
            console.error('Error broadcasting location:', err);
          }
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      clients.delete(userId);

      if (currentSessionId) {
        const sessionIdForTimer = currentSessionId;
        const timerKey = `${sessionIdForTimer}:${userId}`;

        const existing = disconnectTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          disconnectTimers.delete(timerKey);
          const room = sessionRooms.get(sessionIdForTimer);
          if (room) {
            room.delete(userId);
            if (room.size === 0) {
              sessionRooms.delete(sessionIdForTimer);
            } else {
              broadcastToSession(sessionIdForTimer, {
                type: 'member:disconnected',
                data: { userId }
              });
            }
          }
        }, 30000);

        disconnectTimers.set(timerKey, timer);
      }
    });
  });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) {
        const deadUserId = ws.authenticatedUserId;
        if (deadUserId) {
          clients.delete(deadUserId);

          sessionRooms.forEach((room, sessionId) => {
            if (room.has(deadUserId)) {
              const timerKey = `${sessionId}:${deadUserId}`;
              const existingTimer = disconnectTimers.get(timerKey);
              if (existingTimer) clearTimeout(existingTimer);

              const timer = setTimeout(() => {
                disconnectTimers.delete(timerKey);
                const currentRoom = sessionRooms.get(sessionId);
                if (currentRoom && currentRoom.has(deadUserId)) {
                  currentRoom.delete(deadUserId);
                  if (currentRoom.size === 0) {
                    sessionRooms.delete(sessionId);
                  } else {
                    broadcastToSession(sessionId, {
                      type: 'member:disconnected',
                      data: { userId: deadUserId }
                    });
                  }
                }
              }, 30000);

              disconnectTimers.set(timerKey, timer);
            }
          });
        }

        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  // --- Register all route modules ---
  registerAuthRoutes(app);
  registerDroneRoutes(app);
  registerCesiumRoutes(app);
  registerLocationRoutes(app, clients);
  await registerRoutingRoutes(app);
  registerTripRoutes(app);
  registerSocialRoutes(app);
  registerMessagingRoutes(app, wsState);
  registerLiveMapRoutes(app, wsState);
  registerActivityRoutes(app);
  registerMiscRoutes(app);
  registerEnterpriseRoutes(app);

  return httpServer;
}
