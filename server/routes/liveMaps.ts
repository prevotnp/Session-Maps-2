import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { parseId, type WebSocketState } from "./utils";
import { WebSocket } from "ws";
import crypto from "crypto";

function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function registerLiveMapRoutes(app: Express, wsState: WebSocketState) {
  // Create a new live map session
  app.post("/api/live-maps", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: "Name is required" });
      }

      // Generate unique share code
      let shareCode = generateShareCode();
      let existing = await dbStorage.getLiveMapSessionByShareCode(shareCode);
      while (existing) {
        shareCode = generateShareCode();
        existing = await dbStorage.getLiveMapSessionByShareCode(shareCode);
      }

      const session = await dbStorage.createLiveMapSession({
        ownerId: req.user!.id,
        name: name.trim(),
        shareCode,
        isActive: true
      });

      // Add owner as a member
      await dbStorage.addLiveMapMember({
        sessionId: session.id,
        userId: req.user!.id,
        role: 'owner'
      });

      res.status(201).json(session);
    } catch (error) {
      console.error('Error creating live map session:', error);
      res.status(500).json({ error: "Failed to create live map session" });
    }
  });

  // Get user's live map sessions
  app.get("/api/live-maps", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const sessions = await dbStorage.getLiveMapSessionsByUser(req.user!.id);
      res.json(sessions);
    } catch (error) {
      console.error('Error fetching live map sessions:', error);
      res.status(500).json({ error: "Failed to fetch live map sessions" });
    }
  });

  // Get a specific live map session with all data
  app.get("/api/live-maps/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);

    try {
      const session = await dbStorage.getLiveMapSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Check if user is a member
      const isMember = await dbStorage.isLiveMapMember(id, req.user!.id);
      if (!isMember && session.ownerId !== req.user!.id) {
        return res.status(403).json({ error: "You are not a member of this session" });
      }

      // Get all session data
      const members = await dbStorage.getLiveMapMembers(id);
      const pois = await dbStorage.getLiveMapPois(id);
      const routes = await dbStorage.getLiveMapRoutes(id);
      const messages = await dbStorage.getLiveMapMessages(id);

      // Remove passwords from member users
      const safeMembers = members.map(m => ({
        ...m,
        user: { ...m.user, password: undefined }
      }));

      res.json({
        ...session,
        members: safeMembers,
        pois,
        routes,
        messages
      });
    } catch (error) {
      console.error('Error fetching live map session:', error);
      res.status(500).json({ error: "Failed to fetch live map session" });
    }
  });

  // Join a live map session by share code
  app.post("/api/live-maps/join", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { shareCode } = req.body;
      if (!shareCode || typeof shareCode !== 'string') {
        return res.status(400).json({ error: "Share code is required" });
      }

      const session = await dbStorage.getLiveMapSessionByShareCode(shareCode.toUpperCase().trim());
      if (!session) {
        return res.status(404).json({ error: "Session not found. Check the share code and try again." });
      }

      if (!session.isActive) {
        return res.status(400).json({ error: "This session has ended" });
      }

      // Check if already an active member
      const isMember = await dbStorage.isLiveMapMember(session.id, req.user!.id);
      if (isMember) {
        return res.json(session);
      }

      // Check if previously left — rejoin instead of creating new membership
      const hasMembership = await dbStorage.hasLiveMapMembership(session.id, req.user!.id);
      if (hasMembership) {
        await dbStorage.rejoinLiveMapMember(session.id, req.user!.id);

        await dbStorage.createLiveMapMessage({
          sessionId: session.id,
          userId: req.user!.id,
          body: `${req.user!.username} rejoined the map`,
          messageType: 'system'
        });

        wsState.broadcastToSession(session.id, {
          type: 'member:joined',
          data: { userId: req.user!.id, username: req.user!.username }
        });

        return res.json(session);
      }

      // Brand new member — add
      await dbStorage.addLiveMapMember({
        sessionId: session.id,
        userId: req.user!.id,
        role: 'participant'
      });

      // Send system message
      await dbStorage.createLiveMapMessage({
        sessionId: session.id,
        userId: req.user!.id,
        body: `${req.user!.username} joined the map`,
        messageType: 'system'
      });

      // Notify other members via WebSocket
      wsState.broadcastToSession(session.id, {
        type: 'member:joined',
        data: {
          userId: req.user!.id,
          username: req.user!.username
        }
      });

      res.json(session);
    } catch (error) {
      console.error('Error joining live map session:', error);
      res.status(500).json({ error: "Failed to join live map session" });
    }
  });

  // Leave a live map session
  app.post("/api/live-maps/:id/leave", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);

    try {
      const session = await dbStorage.getLiveMapSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Owner cannot leave, only delete
      if (session.ownerId === req.user!.id) {
        return res.status(400).json({ error: "Owner cannot leave. Delete the session instead." });
      }

      await dbStorage.removeLiveMapMember(id, req.user!.id);

      // Send system message
      await dbStorage.createLiveMapMessage({
        sessionId: id,
        userId: req.user!.id,
        body: `${req.user!.username} left the map`,
        messageType: 'system'
      });

      // Notify other members
      wsState.broadcastToSession(id, {
        type: 'member:left',
        data: { userId: req.user!.id }
      });

      res.json({ message: "Left session successfully" });
    } catch (error) {
      console.error('Error leaving live map session:', error);
      res.status(500).json({ error: "Failed to leave session" });
    }
  });

  // End a live map session (owner only) - saves all data as immutable route
  app.delete("/api/live-maps/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);

    try {
      const session = await dbStorage.getLiveMapSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.ownerId !== req.user!.id) {
        return res.status(403).json({ error: "Only the owner can end this session" });
      }

      if (!session.isActive) {
        return res.status(400).json({ error: "Session has already ended" });
      }

      // Gather all session data
      const [members, pois, routes, messages, gpsTracks] = await Promise.all([
        dbStorage.getLiveMapMembers(id),
        dbStorage.getLiveMapPois(id),
        dbStorage.getLiveMapRoutes(id),
        dbStorage.getLiveMapMessages(id),
        dbStorage.getLiveMapGpsTracks(id)
      ]);

      // Build combined path coordinates from all GPS tracks
      const allPathCoordinates: [number, number][] = [];
      const memberTracks: { userId: number; username: string; coordinates: [number, number][] }[] = [];

      for (const track of gpsTracks) {
        const member = members.find(m => m.userId === track.userId);
        const memberUser = member ? await dbStorage.getUser(member.userId) : null;
        try {
          const coords = JSON.parse(track.coordinates) as [number, number][];
          if (coords.length > 0) {
            memberTracks.push({
              userId: track.userId,
              username: memberUser?.username || `User ${track.userId}`,
              coordinates: coords
            });
            allPathCoordinates.push(...coords);
          }
        } catch {}
      }

      // Build waypoints from POIs
      const waypointCoordinates = pois.map(poi => ({
        name: poi.name,
        lngLat: [parseFloat(poi.longitude as string), parseFloat(poi.latitude as string)] as [number, number],
        note: poi.note
      }));

      // Build session notes from messages
      const messageLog = messages.map(m => {
        const msgUser = m.user;
        const timestamp = new Date(m.createdAt!).toLocaleString();
        return `[${timestamp}] ${msgUser?.username || 'Unknown'}: ${m.body}`;
      }).join('\n');

      // Calculate total distance from all tracks
      let totalDistance = 0;
      gpsTracks.forEach(track => {
        if (track.totalDistance) {
          totalDistance += parseFloat(track.totalDistance as string);
        }
      });

      // Create session summary data
      const sessionData = {
        members: memberTracks.map(m => ({ userId: m.userId, username: m.username })),
        pois: waypointCoordinates,
        routes: routes.map(r => {
          let parsedCoords = [];
          try {
            parsedCoords = typeof r.pathCoordinates === 'string' ? JSON.parse(r.pathCoordinates) : r.pathCoordinates;
          } catch {}
          return { name: r.name, pathCoordinates: parsedCoords };
        }),
        messageCount: messages.length
      };

      // Create a saved route for the session
      const savedRoute = await dbStorage.createRoute({
        userId: session.ownerId,
        name: `${session.name} (Live Session)`,
        description: `Live session ended on ${new Date().toLocaleDateString()}. Participants: ${memberTracks.map(m => m.username).join(', ')}`,
        notes: `Session Chat Log:\n${messageLog}\n\n---\nSession Data:\n${JSON.stringify(sessionData, null, 2)}`,
        waypointIds: JSON.stringify([]),
        pathCoordinates: JSON.stringify(allPathCoordinates.length > 0 ? allPathCoordinates : [[0, 0]]),
        waypointCoordinates: JSON.stringify(waypointCoordinates),
        totalDistance: totalDistance.toString(),
        elevationGain: "0",
        elevationLoss: "0",
        estimatedTime: 0,
        routingMode: 'live_session',
        isPublic: false
      });

      // End the session (mark as inactive, link to saved route)
      await dbStorage.endLiveMapSession(id, savedRoute.id);

      // Notify members before ending
      wsState.broadcastToSession(id, {
        type: 'session:ended',
        data: { savedRouteId: savedRoute.id }
      });

      res.json({
        message: "Session ended successfully",
        savedRouteId: savedRoute.id
      });
    } catch (error) {
      console.error('Error ending live map session:', error);
      res.status(500).json({ error: "Failed to end session" });
    }
  });

  // Record GPS track point during a live session
  app.post("/api/live-maps/:id/gps-track", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const { coordinates, totalDistance } = req.body;

      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (!session.isActive) {
        return res.status(400).json({ error: "Session has ended" });
      }

      // Check if user already has a track for this session
      let track = await dbStorage.getLiveMapGpsTrackByUser(sessionId, req.user!.id);

      if (track) {
        // Update existing track
        track = await dbStorage.updateLiveMapGpsTrack(track.id, {
          coordinates: JSON.stringify(coordinates),
          totalDistance: totalDistance?.toString()
        });
      } else {
        // Create new track
        track = await dbStorage.createLiveMapGpsTrack({
          sessionId,
          userId: req.user!.id,
          coordinates: JSON.stringify(coordinates),
          totalDistance: totalDistance?.toString()
        });
      }

      // Broadcast to all members
      wsState.broadcastToSession(sessionId, {
        type: 'gpsTrack:updated',
        data: {
          userId: req.user!.id,
          username: req.user!.username,
          coordinates,
          totalDistance
        }
      });

      res.json(track);
    } catch (error) {
      console.error('Error recording GPS track:', error);
      res.status(500).json({ error: "Failed to record GPS track" });
    }
  });

  // Get GPS tracks for a live session
  app.get("/api/live-maps/:id/gps-tracks", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const tracks = await dbStorage.getLiveMapGpsTracks(sessionId);

      // Add user info to tracks
      const tracksWithUsers = await Promise.all(tracks.map(async (track) => {
        const user = await dbStorage.getUser(track.userId);
        return {
          ...track,
          user: user ? { id: user.id, username: user.username, fullName: user.fullName } : null
        };
      }));

      res.json(tracksWithUsers);
    } catch (error) {
      console.error('Error fetching GPS tracks:', error);
      res.status(500).json({ error: "Failed to fetch GPS tracks" });
    }
  });

  // Generate a background location token for native app background tracking
  app.post("/api/live-maps/:id/background-token", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (!session.isActive) {
        return res.status(400).json({ error: "Session has ended" });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await dbStorage.createBackgroundLocationToken(req.user!.id, sessionId, token, expiresAt);

      res.json({ token, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      console.error('Error generating background location token:', error);
      res.status(500).json({ error: "Failed to generate token" });
    }
  });

  // Receive background location updates from native app (token-based auth)
  app.post("/api/live-maps/:id/background-location", async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    // Authenticate via Bearer token (native background HTTP client may not have session cookies)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const token = authHeader.slice(7);

    try {
      const tokenRecord = await dbStorage.getBackgroundLocationToken(token);
      if (!tokenRecord || tokenRecord.sessionId !== sessionId) {
        return res.status(401).json({ error: "Invalid token" });
      }

      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return res.status(401).json({ error: "Token expired" });
      }

      const { latitude, longitude, accuracy, heading } = req.body;
      if (latitude == null || longitude == null) {
        return res.status(400).json({ error: "latitude and longitude are required" });
      }

      const userId = tokenRecord.userId;

      // Update member location in DB (same as WebSocket handler)
      await dbStorage.updateLiveMapMemberLocation(
        sessionId,
        userId,
        String(latitude),
        String(longitude),
        accuracy != null ? String(accuracy) : undefined,
        heading != null ? String(heading) : undefined
      );

      // Broadcast to all connected WebSocket clients in the session
      wsState.broadcastToSession(sessionId, {
        type: 'member:locationUpdate',
        data: { userId, latitude, longitude, accuracy, heading }
      });

      // Clear any pending disconnect timer for this user
      const timerKey = `${sessionId}:${userId}`;
      const existingTimer = wsState.disconnectTimers.get(timerKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        wsState.disconnectTimers.delete(timerKey);
      }

      res.json({ ok: true });
    } catch (error) {
      console.error('Error processing background location:', error);
      res.status(500).json({ error: "Failed to process location" });
    }
  });

  // Update drone layers for a session
  app.patch("/api/live-maps/:id/drone-layers", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const { activeDroneLayers } = req.body;

      const isMember = await dbStorage.isLiveMapMember(id, req.user!.id);
      const session = await dbStorage.getLiveMapSession(id);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const updated = await dbStorage.updateLiveMapSession(id, {
        activeDroneLayers: JSON.stringify(activeDroneLayers)
      });

      // Broadcast to all members
      wsState.broadcastToSession(id, {
        type: 'droneLayers:updated',
        data: { activeDroneLayers, updatedBy: req.user!.id }
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating drone layers:', error);
      res.status(500).json({ error: "Failed to update drone layers" });
    }
  });

  // Add a POI to a live map
  app.post("/api/live-maps/:id/pois", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const { name, note, latitude, longitude } = req.body;

      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const poi = await dbStorage.createLiveMapPoi({
        sessionId,
        createdBy: req.user!.id,
        name,
        note,
        latitude,
        longitude
      });

      // Broadcast to all members
      wsState.broadcastToSession(sessionId, {
        type: 'poi:created',
        data: { ...poi, createdByUser: { id: req.user!.id, username: req.user!.username } }
      });

      res.status(201).json(poi);
    } catch (error) {
      console.error('Error creating POI:', error);
      res.status(500).json({ error: "Failed to create POI" });
    }
  });

  // Delete a POI from a live map
  app.delete("/api/live-maps/:sessionId/pois/:poiId", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.sessionId);
    const poiId = parseId(req.params.poiId);
    if (!sessionId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      await dbStorage.deleteLiveMapPoi(poiId);

      // Broadcast to all members
      wsState.broadcastToSession(sessionId, {
        type: 'poi:deleted',
        data: { poiId }
      });

      res.json({ message: "POI deleted" });
    } catch (error) {
      console.error('Error deleting POI:', error);
      res.status(500).json({ error: "Failed to delete POI" });
    }
  });

  // Add a route to a live map
  app.post("/api/live-maps/:id/routes", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const { name, pathCoordinates, totalDistance } = req.body;

      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const route = await dbStorage.createLiveMapRoute({
        sessionId,
        createdBy: req.user!.id,
        name,
        pathCoordinates,
        totalDistance
      });

      // Broadcast to all members
      wsState.broadcastToSession(sessionId, {
        type: 'route:created',
        data: { ...route, createdByUser: { id: req.user!.id, username: req.user!.username } }
      });

      res.status(201).json(route);
    } catch (error) {
      console.error('Error creating route:', error);
      res.status(500).json({ error: "Failed to create route" });
    }
  });

  // Update a route on a live map
  app.put("/api/live-maps/:sessionId/routes/:routeId", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.sessionId);
    const routeId = parseId(req.params.routeId);
    if (!sessionId || !routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const { name, pathCoordinates } = req.body;

      if (!pathCoordinates) {
        return res.status(400).json({ error: "pathCoordinates is required" });
      }

      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const existingRoute = await dbStorage.getLiveMapRoute(routeId);
      if (!existingRoute || existingRoute.sessionId !== sessionId) {
        return res.status(404).json({ error: "Route not found in this session" });
      }

      if (existingRoute.createdBy !== req.user!.id && session.ownerId !== req.user!.id) {
        return res.status(403).json({ error: "Only the route creator or session owner can edit this route" });
      }

      const updated = await dbStorage.updateLiveMapRoute(routeId, {
        name,
        pathCoordinates,
      });

      if (!updated) {
        return res.status(404).json({ error: "Route not found" });
      }

      wsState.broadcastToSession(sessionId, {
        type: 'route:updated',
        data: { ...updated, createdByUser: { id: req.user!.id, username: req.user!.username } }
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating route:', error);
      res.status(500).json({ error: "Failed to update route" });
    }
  });

  // Delete a route from a live map
  app.delete("/api/live-maps/:sessionId/routes/:routeId", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.sessionId);
    const routeId = parseId(req.params.routeId);
    if (!sessionId || !routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      await dbStorage.deleteLiveMapRoute(routeId);

      // Broadcast to all members
      wsState.broadcastToSession(sessionId, {
        type: 'route:deleted',
        data: { routeId }
      });

      res.json({ message: "Route deleted" });
    } catch (error) {
      console.error('Error deleting route:', error);
      res.status(500).json({ error: "Failed to delete route" });
    }
  });

  // Send a message to a live map
  app.post("/api/live-maps/:id/messages", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const { body } = req.body;
      if (!body || typeof body !== 'string' || !body.trim()) {
        return res.status(400).json({ error: "Message body is required" });
      }

      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const message = await dbStorage.createLiveMapMessage({
        sessionId,
        userId: req.user!.id,
        body: body.trim(),
        messageType: 'text'
      });

      // Broadcast to all members
      wsState.broadcastToSession(sessionId, {
        type: 'message:new',
        data: {
          ...message,
          user: { id: req.user!.id, username: req.user!.username, fullName: req.user!.fullName }
        }
      });

      res.status(201).json(message);
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Get messages for a live map
  app.get("/api/live-maps/:id/messages", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const messages = await dbStorage.getLiveMapMessages(sessionId);

      // Remove passwords
      const safeMessages = messages.map(m => ({
        ...m,
        user: { ...m.user, password: undefined }
      }));

      res.json(safeMessages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Send live map invite to a friend
  app.post("/api/live-maps/:id/invites", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    const { toUserId } = req.body;

    try {
      if (!toUserId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      const session = await dbStorage.getLiveMapSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Check if sender is owner or member
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      if (session.ownerId !== req.user!.id && !isMember) {
        return res.status(403).json({ error: "Not authorized to invite" });
      }

      // Check if already a member
      const isAlreadyMember = await dbStorage.isLiveMapMember(sessionId, toUserId);
      if (isAlreadyMember || session.ownerId === toUserId) {
        return res.status(400).json({ error: "User is already in session" });
      }

      // Check if pending invite already exists
      const existingInvite = await dbStorage.getPendingInviteForSession(sessionId, toUserId);
      if (existingInvite) {
        return res.status(400).json({ error: "Invite already sent" });
      }

      const invite = await dbStorage.createLiveMapInvite({
        sessionId,
        fromUserId: req.user!.id,
        toUserId,
        status: 'pending'
      });

      res.status(201).json(invite);
    } catch (error) {
      console.error('Error sending invite:', error);
      res.status(500).json({ error: "Failed to send invite" });
    }
  });

  // Get pending live map invites for current user
  app.get("/api/live-map-invites", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const invites = await dbStorage.getLiveMapInvitesForUser(req.user!.id);

      // Remove passwords from user data
      const safeInvites = invites.map(invite => ({
        ...invite,
        fromUser: { ...invite.fromUser, password: undefined }
      }));

      res.json(safeInvites);
    } catch (error) {
      console.error('Error fetching invites:', error);
      res.status(500).json({ error: "Failed to fetch invites" });
    }
  });

  // Accept or decline a live map invite
  app.patch("/api/live-map-invites/:id", isAuthenticated, async (req: Request, res: Response) => {
    const inviteId = parseId(req.params.id);
    if (!inviteId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const { status } = req.body;

    try {
      if (!status || !['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const invites = await dbStorage.getLiveMapInvitesForUser(req.user!.id);
      const invite = invites.find(i => i.id === inviteId);

      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }

      await dbStorage.updateLiveMapInviteStatus(inviteId, status);

      // If accepted, add user to session
      if (status === 'accepted') {
        const hasMembership = await dbStorage.hasLiveMapMembership(invite.sessionId, req.user!.id);
        if (hasMembership) {
          await dbStorage.rejoinLiveMapMember(invite.sessionId, req.user!.id);
        } else {
          await dbStorage.addLiveMapMember({
            sessionId: invite.sessionId,
            userId: req.user!.id,
            role: 'participant'
          });
        }
      }

      res.json({ success: true, sessionId: invite.sessionId });
    } catch (error) {
      console.error('Error updating invite:', error);
      res.status(500).json({ error: "Failed to update invite" });
    }
  });

  // ===== Voice Message Endpoints =====

  // Upload a voice message (audio via REST, then broadcast metadata via WebSocket)
  app.post("/api/live-maps/:id/voice-messages", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const userId = req.user!.id;
      const isMember = await dbStorage.isLiveMapMember(sessionId, userId);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== userId)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { audio, mimeType, duration, username } = req.body;
      if (!audio || !mimeType) {
        return res.status(400).json({ error: "Missing audio or mimeType" });
      }

      const msgTimestamp = Date.now();

      // 1. Store in database
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour TTL
      const voiceMsg = await dbStorage.createVoiceMessage({
        sessionId,
        userId,
        audioStoragePath: '',
        mimeType: mimeType || 'audio/webm',
        durationSeconds: Math.round(duration || 0),
        expiresAt,
      });

      // 2. Store audio in object storage
      try {
        const { storeVoiceMessage } = await import('../voiceStorage');
        const storagePath = await storeVoiceMessage(
          sessionId, voiceMsg.id, audio, mimeType || 'audio/webm'
        );
        await dbStorage.updateVoiceMessagePath(voiceMsg.id, storagePath);
      } catch (storageErr) {
        console.error('Voice storage error:', storageErr);
      }

      // 3. Broadcast SMALL metadata-only notification via WebSocket (no audio data)
      const { clients, sessionRooms } = wsState;
      const room = sessionRooms.get(sessionId);
      const onlineUserIds = room ? new Set(room) : new Set<number>();

      if (room) {
        const sender = await dbStorage.getUser(userId);
        const senderName = username || sender?.fullName || sender?.username || 'Unknown';

        const notificationStr = JSON.stringify({
          type: 'voice:message',
          sessionId,
          data: {
            id: voiceMsg.id,
            userId,
            username: senderName,
            mimeType: mimeType || 'audio/webm',
            duration: duration || 0,
            timestamp: msgTimestamp,
          }
        });

        room.forEach(memberId => {
          if (memberId !== userId) {
            const client = clients.get(memberId);
            if (client && client.readyState === WebSocket.OPEN) {
              client.send(notificationStr);
            }
          }
        });
      }

      // 4. Send push notifications to OFFLINE session members
      try {
        const members = await dbStorage.getLiveMapMembers(sessionId);
        const sender = await dbStorage.getUser(userId);
        const senderName = sender?.fullName || sender?.username || 'Someone';
        const sessionName = session?.name || 'Team Map';

        const { sendPushNotification } = await import('../pushNotifications');

        for (const member of members) {
          if (member.userId === userId) continue;
          if (onlineUserIds.has(member.userId)) continue;

          const tokens = await dbStorage.getActiveDeviceTokensByUser(member.userId);
          for (const token of tokens) {
            if (token.platform === 'web') {
              const sent = await sendPushNotification(token.token, {
                title: `🔊 ${senderName}`,
                body: `Sent a radio message on ${sessionName}`,
                data: {
                  type: 'voice_message',
                  sessionId,
                  voiceMessageId: voiceMsg.id,
                  url: `/live-map/${sessionId}?openRadio=true`,
                }
              });
              if (!sent) {
                await dbStorage.deactivateDeviceToken(token.token);
              }
            }
          }
        }
      } catch (pushErr) {
        console.error('Push notification error:', pushErr);
      }

      res.json({ id: voiceMsg.id, timestamp: msgTimestamp });
    } catch (error) {
      console.error('Error uploading voice message:', error);
      res.status(500).json({ error: "Failed to upload voice message" });
    }
  });

  // Get missed voice messages for a session (since a timestamp)
  app.get("/api/live-maps/:id/voice-messages", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);

      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const since = req.query.since ? new Date(req.query.since as string) : undefined;
      const messages = await dbStorage.getVoiceMessagesBySession(sessionId, since);

      const safeMessages = messages.map(m => ({
        id: m.id,
        userId: m.userId,
        username: m.user?.fullName || m.user?.username || 'Unknown',
        durationSeconds: m.durationSeconds,
        mimeType: m.mimeType,
        createdAt: m.createdAt,
        audioUrl: `/api/voice-messages/${m.id}/audio`,
      }));

      res.json(safeMessages);
    } catch (error) {
      console.error('Error fetching voice messages:', error);
      res.status(500).json({ error: "Failed to fetch voice messages" });
    }
  });

  // Download a specific voice message audio
  app.get("/api/voice-messages/:id/audio", isAuthenticated, async (req: Request, res: Response) => {
    const messageId = parseId(req.params.id);
    if (!messageId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const voiceMsg = await dbStorage.getVoiceMessage(messageId);
      if (!voiceMsg) {
        return res.status(404).json({ error: "Voice message not found" });
      }

      // Verify user is a member of the session
      const isMember = await dbStorage.isLiveMapMember(voiceMsg.sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(voiceMsg.sessionId);
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { getVoiceMessageAudio } = await import('../voiceStorage');
      const audioData = await getVoiceMessageAudio(voiceMsg.audioStoragePath);
      if (!audioData) {
        return res.status(404).json({ error: "Audio file not found" });
      }

      res.set({
        'Content-Type': voiceMsg.mimeType,
        'Content-Length': String(audioData.length),
        'Cache-Control': 'private, max-age=3600',
      });
      res.send(audioData);
    } catch (error) {
      console.error('Error serving voice message audio:', error);
      res.status(500).json({ error: "Failed to serve audio" });
    }
  });

  // Get VAPID public key for push subscription
  app.get("/api/push/vapid-key", async (_req: Request, res: Response) => {
    const { getVapidPublicKey } = await import('../pushNotifications');
    const publicKey = getVapidPublicKey();
    res.json({ publicKey });
  });
}
