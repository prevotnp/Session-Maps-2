import { Express, Request, Response } from "express";
import { WebSocket } from "ws";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { validateRequest, parseId } from "./utils";
import {
  insertLocationSchema,
  insertOfflineMapAreaSchema,
  insertWaypointSchema,
  insertMapDrawingSchema,
  locationShareSchema,
} from "@shared/schema";

export function registerLocationRoutes(app: Express, clients: Map<number, WebSocket>) {
  // Location routes
  app.post("/api/locations", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertLocationSchema, { ...req.body, userId: user.id });

    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }

    try {
      const newLocation = await dbStorage.createLocation(validation.data!);
      return res.status(201).json(newLocation);
    } catch (error) {
      return res.status(500).json({ message: "Error saving location" });
    }
  });

  app.get("/api/locations", isAuthenticated, async (req, res) => {
    const user = req.user as any;

    try {
      const locations = await dbStorage.getLocationsByUser(user.id);
      return res.status(200).json(locations);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching locations" });
    }
  });

  // Offline map areas routes
  app.post("/api/offline-maps", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertOfflineMapAreaSchema, { ...req.body, userId: user.id });

    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }

    try {
      const newOfflineMapArea = await dbStorage.createOfflineMapArea(validation.data!);
      return res.status(201).json(newOfflineMapArea);
    } catch (error) {
      return res.status(500).json({ message: "Error creating offline map area" });
    }
  });

  app.get("/api/offline-maps", isAuthenticated, async (req, res) => {
    const user = req.user as any;

    try {
      const offlineMapAreas = await dbStorage.getOfflineMapAreasByUser(user.id);
      return res.status(200).json(offlineMapAreas);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching offline map areas" });
    }
  });

  app.delete("/api/offline-maps/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const offlineMapAreaId = parseId(req.params.id);
    if (!offlineMapAreaId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      // Verify the offline map area belongs to the user
      const offlineMapArea = await dbStorage.getOfflineMapArea(offlineMapAreaId);
      if (!offlineMapArea) {
        return res.status(404).json({ message: "Offline map area not found" });
      }

      if (offlineMapArea.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this offline map area" });
      }

      const deleted = await dbStorage.deleteOfflineMapArea(offlineMapAreaId);

      if (deleted) {
        return res.status(200).json({ message: "Offline map area deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting offline map area" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error deleting offline map area" });
    }
  });

  // Waypoint routes
  app.post("/api/waypoints", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertWaypointSchema, { ...req.body, userId: user.id });

    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }

    try {
      const newWaypoint = await dbStorage.createWaypoint(validation.data!);
      return res.status(201).json(newWaypoint);
    } catch (error) {
      return res.status(500).json({ message: "Error creating waypoint" });
    }
  });

  app.get("/api/waypoints", isAuthenticated, async (req, res) => {
    const user = req.user as any;

    try {
      const userWaypoints = await dbStorage.getWaypointsByUser(user.id);
      const sharedWaypoints = await dbStorage.getSharedWaypoints(user.id);

      return res.status(200).json({
        userWaypoints,
        sharedWaypoints
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching waypoints" });
    }
  });

  app.put("/api/waypoints/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const waypointId = parseId(req.params.id);
    if (!waypointId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      // Verify the waypoint belongs to the user
      const waypoint = await dbStorage.getWaypoint(waypointId);
      if (!waypoint) {
        return res.status(404).json({ message: "Waypoint not found" });
      }

      if (waypoint.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to update this waypoint" });
      }

      const updatedWaypoint = await dbStorage.updateWaypoint(waypointId, req.body);

      if (updatedWaypoint) {
        return res.status(200).json(updatedWaypoint);
      } else {
        return res.status(500).json({ message: "Error updating waypoint" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error updating waypoint" });
    }
  });

  app.delete("/api/waypoints/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const waypointId = parseId(req.params.id);
    if (!waypointId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      // Verify the waypoint belongs to the user
      const waypoint = await dbStorage.getWaypoint(waypointId);
      if (!waypoint) {
        return res.status(404).json({ message: "Waypoint not found" });
      }

      if (waypoint.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this waypoint" });
      }

      const deleted = await dbStorage.deleteWaypoint(waypointId);

      if (deleted) {
        return res.status(200).json({ message: "Waypoint deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting waypoint" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error deleting waypoint" });
    }
  });

  // User Map Drawing routes
  app.post("/api/map-drawings", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertMapDrawingSchema, { ...req.body, userId: user.id });

    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }

    try {
      const newMapDrawing = await dbStorage.createMapDrawing(validation.data!);
      return res.status(201).json(newMapDrawing);
    } catch (error) {
      return res.status(500).json({ message: "Error creating map drawing" });
    }
  });

  app.get("/api/map-drawings", isAuthenticated, async (req, res) => {
    const user = req.user as any;

    try {
      const mapDrawings = await dbStorage.getMapDrawingsByUser(user.id);
      return res.status(200).json(mapDrawings);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching map drawings" });
    }
  });

  app.get("/api/map-drawings/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const drawingId = parseId(req.params.id);

    try {
      const drawing = await dbStorage.getMapDrawing(drawingId);
      if (!drawing) {
        return res.status(404).json({ message: "Map drawing not found" });
      }

      // Only allow access to the user's own drawings
      if (drawing.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to access this drawing" });
      }

      return res.status(200).json(drawing);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching map drawing" });
    }
  });

  app.put("/api/map-drawings/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const drawingId = parseId(req.params.id);

    try {
      const drawing = await dbStorage.getMapDrawing(drawingId);
      if (!drawing) {
        return res.status(404).json({ message: "Map drawing not found" });
      }

      // Only allow updating the user's own drawings
      if (drawing.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to modify this drawing" });
      }

      const updatedDrawing = await dbStorage.updateMapDrawing(drawingId, req.body);
      return res.status(200).json(updatedDrawing);
    } catch (error) {
      return res.status(500).json({ message: "Error updating map drawing" });
    }
  });

  app.delete("/api/map-drawings/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const drawingId = parseId(req.params.id);

    try {
      const drawing = await dbStorage.getMapDrawing(drawingId);
      if (!drawing) {
        return res.status(404).json({ message: "Map drawing not found" });
      }

      // Only allow deleting the user's own drawings
      if (drawing.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this drawing" });
      }

      const deleted = await dbStorage.deleteMapDrawing(drawingId);
      if (deleted) {
        return res.status(200).json({ message: "Map drawing deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting map drawing" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error deleting map drawing" });
    }
  });

  // Location sharing API routes

  // Send location share request by username
  app.post('/api/location-shares', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { username } = req.body;

    try {
      // Find the target user by username
      const targetUser = await dbStorage.getUserByUsername(username);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      if (targetUser.id === user.id) {
        return res.status(400).json({ message: "Cannot share location with yourself" });
      }

      // Check if share request already exists
      const existingShare = await dbStorage.findLocationShareByUsers(user.id, targetUser.id);
      if (existingShare) {
        return res.status(400).json({ message: "Location share request already exists" });
      }

      // Create location share request
      const locationShare = await dbStorage.createLocationShare({
        fromUserId: user.id,
        toUserId: targetUser.id,
        status: "pending"
      });

      return res.status(201).json({
        message: `Location share request sent to ${username}`,
        share: locationShare
      });
    } catch (error) {
      console.error('Error creating location share:', error);
      return res.status(500).json({ message: "Error sending location share request" });
    }
  });

  // Get pending location share requests for current user
  app.get('/api/location-shares/pending', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;

    try {
      const pendingShares = await dbStorage.getPendingLocationShares(user.id);

      // Get usernames for the from users
      const sharesWithUsernames = await Promise.all(
        pendingShares.map(async (share) => {
          const fromUser = await dbStorage.getUser(share.fromUserId);
          return {
            ...share,
            fromUsername: fromUser?.username || 'Unknown User'
          };
        })
      );

      return res.status(200).json(sharesWithUsernames);
    } catch (error) {
      console.error('Error fetching pending shares:', error);
      return res.status(500).json({ message: "Error fetching pending location shares" });
    }
  });

  // Accept or reject location share request
  app.patch('/api/location-shares/:id', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const shareId = parseId(req.params.id);
    if (!shareId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const { status } = req.body; // 'accepted' or 'rejected'

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ message: "Status must be 'accepted' or 'rejected'" });
    }

    try {
      const locationShare = await dbStorage.getLocationShare(shareId);
      if (!locationShare) {
        return res.status(404).json({ message: "Location share request not found" });
      }

      // Only the recipient can accept/reject
      if (locationShare.toUserId !== user.id) {
        return res.status(403).json({ message: "Not authorized to modify this share request" });
      }

      if (locationShare.status !== 'pending') {
        return res.status(400).json({ message: "Share request has already been responded to" });
      }

      const updatedShare = await dbStorage.updateLocationShareStatus(shareId, status, new Date());

      return res.status(200).json({
        message: `Location share request ${status}`,
        share: updatedShare
      });
    } catch (error) {
      console.error('Error updating location share:', error);
      return res.status(500).json({ message: "Error updating location share request" });
    }
  });

  // Get current user's location shares (both sent and received)
  app.get('/api/location-shares', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;

    try {
      const allShares = await dbStorage.getLocationSharesByUser(user.id);

      // Get usernames for both from and to users
      const sharesWithUsernames = await Promise.all(
        allShares.map(async (share) => {
          const fromUser = await dbStorage.getUser(share.fromUserId);
          const toUser = await dbStorage.getUser(share.toUserId);
          return {
            ...share,
            fromUsername: fromUser?.username || 'Unknown User',
            toUsername: toUser?.username || 'Unknown User'
          };
        })
      );

      return res.status(200).json(sharesWithUsernames);
    } catch (error) {
      console.error('Error fetching location shares:', error);
      return res.status(500).json({ message: "Error fetching location shares" });
    }
  });

  // Update current user's location
  app.post('/api/user-location', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { latitude, longitude, accuracy, heading, speed } = req.body;

    try {
      const userLocation = await dbStorage.upsertUserLocation({
        userId: user.id,
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        accuracy: accuracy?.toString(),
        heading: heading?.toString(),
        speed: speed?.toString(),
        isActive: true
      });

      // Broadcast location update via WebSocket
      const locationData = {
        type: 'location-update',
        userId: user.id,
        username: user.username,
        latitude: parseFloat(userLocation.latitude),
        longitude: parseFloat(userLocation.longitude),
        accuracy: userLocation.accuracy ? parseFloat(userLocation.accuracy) : null,
        heading: userLocation.heading ? parseFloat(userLocation.heading) : null,
        speed: userLocation.speed ? parseFloat(userLocation.speed) : null,
        lastUpdated: userLocation.lastUpdated
      };

      // Send to all connected clients who have accepted location shares
      const acceptedShares = await dbStorage.getLocationSharesByUser(user.id);
      const connectedFriends = acceptedShares
        .filter((share: any) => share.status === 'accepted')
        .map((share: any) => share.fromUserId === user.id ? share.toUserId : share.fromUserId)
        .filter((friendId: any) => clients.has(friendId));

      connectedFriends.forEach(friendId => {
        const friendWs = clients.get(friendId);
        if (friendWs && friendWs.readyState === WebSocket.OPEN) {
          friendWs.send(JSON.stringify(locationData));
        }
      });

      return res.status(200).json(userLocation);
    } catch (error) {
      console.error('Error updating user location:', error);
      return res.status(500).json({ message: "Error updating location" });
    }
  });

  // Get shared locations from friends
  app.get('/api/shared-locations', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;

    try {
      const sharedLocations = await dbStorage.getSharedLocations(user.id);

      // Convert string coordinates back to numbers for the frontend
      const formattedLocations = sharedLocations.map((location: any) => ({
        ...location,
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        accuracy: location.accuracy ? parseFloat(location.accuracy) : null,
        heading: location.heading ? parseFloat(location.heading) : null,
        speed: location.speed ? parseFloat(location.speed) : null
      }));

      return res.status(200).json(formattedLocations);
    } catch (error) {
      console.error('Error fetching shared locations:', error);
      return res.status(500).json({ message: "Error fetching shared locations" });
    }
  });

  // Delete location share
  app.delete('/api/location-shares/:id', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const shareId = parseId(req.params.id);

    try {
      const locationShare = await dbStorage.getLocationShare(shareId);
      if (!locationShare) {
        return res.status(404).json({ message: "Location share not found" });
      }

      // Only the creator or recipient can delete
      if (locationShare.fromUserId !== user.id && locationShare.toUserId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this location share" });
      }

      const deleted = await dbStorage.deleteLocationShare(shareId);
      if (deleted) {
        return res.status(200).json({ message: "Location share deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting location share" });
      }
    } catch (error) {
      console.error('Error deleting location share:', error);
      return res.status(500).json({ message: "Error deleting location share" });
    }
  });
}
