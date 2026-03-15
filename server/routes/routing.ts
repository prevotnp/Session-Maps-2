import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated, waypointPhotoUpload, routePhotoUpload, waypointPhotoDir, routePhotoDir } from "./middleware";
import { validateRequest, parseId, safePath } from "./utils";
import { insertRouteSchema } from "@shared/schema";
import path from "path";
import fs from "fs";

export async function registerRoutingRoutes(app: Express) {
  // Create a new route
  app.post("/api/routes", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const requestData = { ...req.body, userId: user.id };

    const validation = validateRequest(insertRouteSchema, requestData);

    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }

    try {
      const newRoute = await dbStorage.createRoute(validation.data!);
      return res.status(201).json(newRoute);
    } catch (error) {
      console.error('Error creating route:', error);
      return res.status(500).json({ message: "Error creating route" });
    }
  });

  // Update an existing route
  app.put("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    const user = req.user as any;

    if (!routeId) {
      return res.status(400).json({ message: "Invalid route ID" });
    }

    try {
      // Verify route exists and user owns it
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Only route owner can update" });
      }

      // Validate request body fields
      const {
        pathCoordinates,
        waypointCoordinates,
        totalDistance,
        name,
        description,
        notes,
        elevationGain,
        elevationLoss,
        estimatedTime,
        routingMode,
        isPublic
      } = req.body;

      if (!pathCoordinates || typeof pathCoordinates !== 'string') {
        return res.status(400).json({ message: "pathCoordinates is required and must be a JSON string" });
      }

      if (!waypointCoordinates || typeof waypointCoordinates !== 'string') {
        return res.status(400).json({ message: "waypointCoordinates is required and must be a JSON string" });
      }

      // Validate JSON format
      try {
        JSON.parse(pathCoordinates);
        JSON.parse(waypointCoordinates);
      } catch {
        return res.status(400).json({ message: "Invalid JSON format in coordinates" });
      }

      // Validate totalDistance is a number
      if (totalDistance !== undefined && typeof totalDistance !== 'number') {
        return res.status(400).json({ message: "totalDistance must be a number" });
      }

      // Parse waypoint coordinates for routing calculations
      let waypointCoordsArray: [number, number][] = [];
      try {
        const parsed = JSON.parse(waypointCoordinates);

        // Handle different waypoint formats
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (typeof parsed[0] === 'object' && !Array.isArray(parsed[0]) && parsed[0].lngLat !== undefined) {
            // Format: [{name, lngLat: [lng, lat], elevation}, ...]
            waypointCoordsArray = parsed.map((wp: any) => wp.lngLat as [number, number]);
          } else if (typeof parsed[0] === 'object' && !Array.isArray(parsed[0]) && parsed[0].lng !== undefined) {
            // Format: [{lng, lat}, ...]
            waypointCoordsArray = parsed.map((wp: any) => [wp.lng, wp.lat] as [number, number]);
          } else if (Array.isArray(parsed[0])) {
            // Format: [[lng, lat], ...]
            waypointCoordsArray = parsed;
          } else {
            waypointCoordsArray = parsed;
          }
        }
      } catch {
        return res.status(400).json({ message: "Invalid waypoint coordinates format" });
      }

      // Calculate actual path based on routing mode
      let finalPathCoordinates = pathCoordinates;
      let finalTotalDistance = totalDistance;

      const effectiveRoutingMode = routingMode || route.routingMode;

      if (effectiveRoutingMode === 'trail' && waypointCoordsArray.length >= 2) {
        try {
          const { calculateTrailRoute } = await import('../trailRouting');
          const trailResult = await calculateTrailRoute(waypointCoordsArray);

          if (trailResult.success && trailResult.coordinates.length > 0) {
            finalPathCoordinates = JSON.stringify(trailResult.coordinates);
            finalTotalDistance = trailResult.distance;
          } else {
            // Fall back to direct path if trail routing fails
          }
        } catch (error) {
          console.error('Trail routing error during save:', error);
          // Continue with direct path if trail routing fails
        }
      }

      // Update the route with all editable fields
      const updateData: any = {
        pathCoordinates: finalPathCoordinates,
        waypointCoordinates,
        totalDistance: finalTotalDistance
      };

      // Add optional fields if provided
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (notes !== undefined) updateData.notes = notes;
      if (elevationGain !== undefined) updateData.elevationGain = elevationGain;
      if (elevationLoss !== undefined) updateData.elevationLoss = elevationLoss;
      if (estimatedTime !== undefined) updateData.estimatedTime = estimatedTime;
      if (routingMode !== undefined) updateData.routingMode = routingMode;
      if (isPublic !== undefined) updateData.isPublic = isPublic;

      const updatedRoute = await dbStorage.updateRoute(routeId, updateData);
      return res.status(200).json(updatedRoute);
    } catch (error) {
      console.error('Error updating route:', error);
      return res.status(500).json({ message: "Error updating route" });
    }
  });

  // Partial update for route (toggle public, etc.)
  app.patch("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    const user = req.user as any;

    if (!routeId) {
      return res.status(400).json({ message: "Invalid route ID" });
    }

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Only route owner can update" });
      }

      const { isPublic, name, description, notes, activityType } = req.body;

      const updateData: any = {};
      if (isPublic !== undefined) updateData.isPublic = isPublic;
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (notes !== undefined) updateData.notes = notes;
      if (activityType !== undefined) updateData.activityType = activityType;

      const updatedRoute = await dbStorage.updateRoute(routeId, updateData);
      return res.status(200).json(updatedRoute);
    } catch (error) {
      console.error('Error updating route:', error);
      return res.status(500).json({ message: "Error updating route" });
    }
  });

  app.get("/api/routes", isAuthenticated, async (req, res) => {
    const user = req.user as any;

    try {
      // Get user's own routes
      const ownRoutes = await dbStorage.getRoutesByUser(user.id);

      // Get routes shared with user
      const sharedRoutes = await dbStorage.getRoutesSharedWithUser(user.id);

      // Get share counts for own routes
      const ownRouteIds = ownRoutes.map(r => r.id);
      const shareCounts = await dbStorage.getRouteShareCounts(ownRouteIds);

      // Combine and mark shared routes
      const allRoutes = [
        ...ownRoutes.map(route => ({
          ...route,
          isOwner: true,
          isShared: false,
          shareCount: shareCounts.get(route.id) || 0
        })),
        ...sharedRoutes.map(route => ({ ...route, isOwner: false, isShared: true, shareCount: 0 }))
      ];

      return res.status(200).json(allRoutes);
    } catch (error) {
      console.error('Error fetching routes:', error);
      return res.status(500).json({ message: "Error fetching routes" });
    }
  });

  app.get("/api/routes/public", async (req, res) => {
    try {
      const publicRoutes = await dbStorage.getPublicRoutesWithOwners();
      return res.status(200).json(publicRoutes);
    } catch (error) {
      console.error('Error fetching public routes:', error);
      return res.status(500).json({ message: "Error fetching public routes" });
    }
  });

  // Get user public profile with their public routes
  app.get("/api/users/:userId/public-profile", async (req, res) => {
    const userId = parseId(req.params.userId);

    if (!userId) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    try {
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const publicRoutes = await dbStorage.getUserPublicRoutes(userId);

      return res.status(200).json({
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        routes: publicRoutes
      });
    } catch (error) {
      console.error('Error fetching user public profile:', error);
      return res.status(500).json({ message: "Error fetching user profile" });
    }
  });

  app.get("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Check if user owns the route or if it's public
      if (route.userId !== user.id && !route.isPublic) {
        return res.status(403).json({ message: "Not authorized to view this route" });
      }

      return res.status(200).json(route);
    } catch (error) {
      console.error('Error fetching route:', error);
      return res.status(500).json({ message: "Error fetching route" });
    }
  });

  app.delete("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only allow deleting user's own routes
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this route" });
      }

      const deleted = await dbStorage.deleteRoute(routeId);
      if (deleted) {
        return res.status(200).json({ message: "Route deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting route" });
      }
    } catch (error) {
      console.error('Error deleting route:', error);
      return res.status(500).json({ message: "Error deleting route" });
    }
  });

  // Route sharing endpoints
  app.post("/api/routes/:id/share", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const { emailOrUsername } = req.body;

    try {
      // Verify route exists and user owns it
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Only route owner can share" });
      }

      // Find user by email or username
      let targetUser = await dbStorage.getUserByEmail(emailOrUsername);
      if (!targetUser) {
        targetUser = await dbStorage.getUserByUsername(emailOrUsername);
      }

      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Don't allow sharing with yourself
      if (targetUser.id === user.id) {
        return res.status(400).json({ message: "Cannot share route with yourself" });
      }

      // Check if already shared
      const isAlreadyShared = await dbStorage.isRouteSharedWithUser(routeId, targetUser.id);
      if (isAlreadyShared) {
        return res.status(400).json({ message: "Route already shared with this user" });
      }

      // Create share
      const share = await dbStorage.shareRoute({
        routeId,
        sharedWithUserId: targetUser.id,
        sharedByUserId: user.id,
      });

      return res.status(201).json({
        message: "Route shared successfully",
        share
      });
    } catch (error) {
      console.error('Error sharing route:', error);
      return res.status(500).json({ message: "Error sharing route" });
    }
  });

  app.get("/api/routes/:id/shares", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can see who route is shared with
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const shares = await dbStorage.getRouteShares(routeId);
      return res.status(200).json(shares);
    } catch (error) {
      console.error('Error fetching route shares:', error);
      return res.status(500).json({ message: "Error fetching shares" });
    }
  });

  app.delete("/api/routes/:id/shares/:shareId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    const shareId = parseId(req.params.shareId);
    if (!routeId || !shareId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can revoke shares
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const revoked = await dbStorage.revokeRouteShare(shareId);
      if (revoked) {
        return res.status(200).json({ message: "Share revoked successfully" });
      } else {
        return res.status(404).json({ message: "Share not found" });
      }
    } catch (error) {
      console.error('Error revoking share:', error);
      return res.status(500).json({ message: "Error revoking share" });
    }
  });

  // Route Notes endpoints
  app.get("/api/routes/:routeId/notes", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      const isOwner = route.userId === user.id;
      const isShared = await dbStorage.isRouteSharedWithUser(routeId, user.id);

      if (!isOwner && !isShared && !route.isPublic) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const notes = await dbStorage.getRouteNotes(routeId);
      return res.status(200).json(notes);
    } catch (error) {
      console.error('Error fetching route notes:', error);
      return res.status(500).json({ message: "Error fetching route notes" });
    }
  });

  app.post("/api/routes/:routeId/notes", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { category, content, position } = req.body;

      if (!category) {
        return res.status(400).json({ message: "Category is required" });
      }

      const note = await dbStorage.createRouteNote({
        routeId,
        category,
        content: content || '',
        position: position || 0,
      });

      return res.status(201).json(note);
    } catch (error) {
      console.error('Error creating route note:', error);
      return res.status(500).json({ message: "Error creating route note" });
    }
  });

  app.put("/api/routes/:routeId/notes/:noteId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const noteId = parseId(req.params.noteId);
    if (!routeId || !noteId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { category, content, position } = req.body;
      const updateData: any = {};
      if (category !== undefined) updateData.category = category;
      if (content !== undefined) updateData.content = content;
      if (position !== undefined) updateData.position = position;

      const updated = await dbStorage.updateRouteNote(noteId, updateData);
      if (!updated) {
        return res.status(404).json({ message: "Note not found" });
      }

      return res.status(200).json(updated);
    } catch (error) {
      console.error('Error updating route note:', error);
      return res.status(500).json({ message: "Error updating route note" });
    }
  });

  app.delete("/api/routes/:routeId/notes/:noteId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const noteId = parseId(req.params.noteId);
    if (!routeId || !noteId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const deleted = await dbStorage.deleteRouteNote(noteId);
      if (!deleted) {
        return res.status(404).json({ message: "Note not found" });
      }

      return res.status(200).json({ message: "Note deleted" });
    } catch (error) {
      console.error('Error deleting route note:', error);
      return res.status(500).json({ message: "Error deleting route note" });
    }
  });

  // Route Points of Interest endpoints
  app.get("/api/routes/:routeId/pois", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Check access (owner or shared with user)
      const isOwner = route.userId === user.id;
      const isShared = await dbStorage.isRouteSharedWithUser(routeId, user.id);

      if (!isOwner && !isShared && !route.isPublic) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const pois = await dbStorage.getRoutePointsOfInterest(routeId);
      return res.status(200).json(pois);
    } catch (error) {
      console.error('Error fetching route POIs:', error);
      return res.status(500).json({ message: "Error fetching points of interest" });
    }
  });

  app.post("/api/routes/:routeId/pois", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can add POIs
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { name, latitude, longitude, elevation, note } = req.body;

      if (!name || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ message: "Name, latitude, and longitude are required" });
      }

      const poi = await dbStorage.createRoutePointOfInterest({
        routeId,
        name,
        latitude: String(latitude),
        longitude: String(longitude),
        elevation: elevation ? String(elevation) : undefined,
        note
      });

      return res.status(201).json(poi);
    } catch (error) {
      console.error('Error creating route POI:', error);
      return res.status(500).json({ message: "Error creating point of interest" });
    }
  });

  app.put("/api/routes/:routeId/pois/:poiId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can edit POIs
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      const { name, latitude, longitude, elevation, note, photos } = req.body;
      const updateData: any = {};

      if (name !== undefined) updateData.name = name;
      if (latitude !== undefined) updateData.latitude = String(latitude);
      if (longitude !== undefined) updateData.longitude = String(longitude);
      if (elevation !== undefined) updateData.elevation = String(elevation);
      if (note !== undefined) updateData.note = note;
      if (photos !== undefined) updateData.photos = photos;

      const updated = await dbStorage.updateRoutePointOfInterest(poiId, updateData);
      return res.status(200).json(updated);
    } catch (error) {
      console.error('Error updating route POI:', error);
      return res.status(500).json({ message: "Error updating point of interest" });
    }
  });

  // Upload photos for a POI
  app.post("/api/routes/:routeId/pois/:poiId/photos", isAuthenticated, waypointPhotoUpload.array('photos', 100), async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const files = req.files as Express.Multer.File[];

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No photos uploaded" });
      }

      // Get existing photos and append new ones
      const existingPhotos: string[] = poi.photos ? JSON.parse(poi.photos) : [];
      const newPhotoPaths = files.map(file => `/api/waypoint-photos/${path.basename(file.path)}`);
      const allPhotos = [...existingPhotos, ...newPhotoPaths];

      const updated = await dbStorage.updateRoutePointOfInterest(poiId, {
        photos: JSON.stringify(allPhotos)
      });

      return res.status(200).json({
        message: "Photos uploaded successfully",
        photos: allPhotos,
        poi: updated
      });
    } catch (error) {
      console.error('Error uploading POI photos:', error);
      if (files) {
        files.forEach(file => fs.unlink(file.path, () => {}));
      }
      return res.status(500).json({ message: "Error uploading photos" });
    }
  });

  // Delete a photo from a POI
  app.delete("/api/routes/:routeId/pois/:poiId/photos", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const { photoPath } = req.body;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      const existingPhotos: string[] = poi.photos ? JSON.parse(poi.photos) : [];
      const updatedPhotos = existingPhotos.filter(p => p !== photoPath);

      // Delete file from disk
      const filename = path.basename(photoPath);
      const filePath = path.join(waypointPhotoDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const updated = await dbStorage.updateRoutePointOfInterest(poiId, {
        photos: JSON.stringify(updatedPhotos)
      });

      return res.status(200).json({
        message: "Photo deleted",
        photos: updatedPhotos,
        poi: updated
      });
    } catch (error) {
      console.error('Error deleting POI photo:', error);
      return res.status(500).json({ message: "Error deleting photo" });
    }
  });

  // Serve waypoint photos
  app.get("/api/waypoint-photos/:filename", (req, res) => {
    const filePath = safePath(waypointPhotoDir, req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid filename" });
    }

    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "Photo not found" });
    }
  });

  // Upload photos for a route
  app.post("/api/routes/:routeId/photos", isAuthenticated, (req, res, next) => {
    routePhotoUpload.array('photos', 100)(req, res, (err) => {
      if (err) {
        console.error('Multer error uploading route photos:', err);
        return res.status(400).json({ message: err.message || "Error uploading files" });
      }
      next();
    });
  }, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const files = req.files as Express.Multer.File[];

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No photos uploaded" });
      }

      // Get existing photos and append new ones
      const existingPhotos: string[] = route.photos ? JSON.parse(route.photos) : [];
      const newPhotoPaths = files.map(file => `/api/route-photos/${path.basename(file.path)}`);
      const allPhotos = [...existingPhotos, ...newPhotoPaths];

      const updated = await dbStorage.updateRoute(routeId, {
        photos: JSON.stringify(allPhotos)
      });

      return res.status(200).json({
        message: "Photos uploaded successfully",
        photos: allPhotos,
        route: updated
      });
    } catch (error) {
      console.error('Error uploading route photos:', error);
      if (files) {
        files.forEach(file => fs.unlink(file.path, () => {}));
      }
      return res.status(500).json({ message: "Error uploading photos" });
    }
  });

  // Delete a photo from a route
  app.delete("/api/routes/:routeId/photos", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const { photoPath } = req.body;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const existingPhotos: string[] = route.photos ? JSON.parse(route.photos) : [];
      const updatedPhotos = existingPhotos.filter(p => p !== photoPath);

      // Delete file from disk
      const filename = path.basename(photoPath);
      const filePath = path.join(routePhotoDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const updated = await dbStorage.updateRoute(routeId, {
        photos: JSON.stringify(updatedPhotos)
      });

      return res.status(200).json({
        message: "Photo deleted",
        photos: updatedPhotos,
        route: updated
      });
    } catch (error) {
      console.error('Error deleting route photo:', error);
      return res.status(500).json({ message: "Error deleting photo" });
    }
  });

  // Serve route photos
  app.get("/api/route-photos/:filename", (req, res) => {
    const filePath = safePath(routePhotoDir, req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid filename" });
    }

    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "Photo not found" });
    }
  });

  app.delete("/api/routes/:routeId/pois/:poiId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can delete POIs
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      const deleted = await dbStorage.deleteRoutePointOfInterest(poiId);
      if (deleted) {
        return res.status(200).json({ message: "Point of interest deleted" });
      } else {
        return res.status(500).json({ message: "Failed to delete" });
      }
    } catch (error) {
      console.error('Error deleting route POI:', error);
      return res.status(500).json({ message: "Error deleting point of interest" });
    }
  });

  // Trail routing endpoints
  const { calculateTrailRoute, getTrailStats, ALLOWED_PROFILES } = await import('../trailRouting');
  type ActivityProfile = typeof ALLOWED_PROFILES[number];

  app.post("/api/ors/hiking-route", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { waypoints } = req.body;

      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({
          success: false,
          message: "At least 2 waypoints required (format: [[lng, lat], [lng, lat], ...])"
        });
      }

      if (waypoints.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Maximum 50 waypoints allowed"
        });
      }

      const orsApiKey = process.env.ORS_API_KEY;
      if (!orsApiKey) {
        console.log('ORS_API_KEY not set, falling back to custom trail router');
        const result = await calculateTrailRoute(waypoints);
        return res.json(result);
      }

      const orsResponse = await fetch('https://api.openrouteservice.org/v2/directions/foot-hiking/geojson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': orsApiKey
        },
        body: JSON.stringify({
          coordinates: waypoints,
          elevation: true,
          instructions: false,
          preference: 'recommended'
        })
      });

      if (!orsResponse.ok) {
        const errorText = await orsResponse.text();
        console.error(`ORS API error ${orsResponse.status}:`, errorText);

        if (orsResponse.status === 429 || orsResponse.status >= 500) {
          console.log('ORS unavailable, falling back to custom trail router');
          const result = await calculateTrailRoute(waypoints);
          return res.json(result);
        }

        return res.status(orsResponse.status).json({
          success: false,
          message: `Hiking route calculation failed: ${errorText}`
        });
      }

      const orsData = await orsResponse.json();

      if (!orsData.features || orsData.features.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No hiking route found between these waypoints. Try moving them closer to trails."
        });
      }

      const feature = orsData.features[0];
      const coordinates = feature.geometry.coordinates;
      const summary = feature.properties.summary;

      const pathCoordinates: [number, number][] = coordinates.map((c: number[]) => [c[0], c[1]]);

      let elevationGain = 0;
      let elevationLoss = 0;
      for (let i = 1; i < coordinates.length; i++) {
        if (coordinates[i].length >= 3 && coordinates[i - 1].length >= 3) {
          const diff = coordinates[i][2] - coordinates[i - 1][2];
          if (diff > 0) elevationGain += diff;
          else elevationLoss += Math.abs(diff);
        }
      }

      return res.json({
        success: true,
        coordinates: pathCoordinates,
        distance: summary.distance,
        duration: summary.duration,
        elevationGain: Math.round(elevationGain * 10) / 10,
        elevationLoss: Math.round(elevationLoss * 10) / 10,
        source: 'openrouteservice'
      });

    } catch (error) {
      console.error('ORS hiking route error:', error);

      try {
        const { waypoints } = req.body;
        const result = await calculateTrailRoute(waypoints);
        return res.json(result);
      } catch (fallbackError) {
        return res.status(500).json({
          success: false,
          message: `Hiking route error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }
  });

  app.post("/api/ors/route", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { waypoints, profile } = req.body;

      if (!profile || !ALLOWED_PROFILES.includes(profile)) {
        return res.status(400).json({
          success: false,
          message: `Invalid profile. Allowed: ${ALLOWED_PROFILES.join(', ')}`
        });
      }

      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({
          success: false,
          message: "At least 2 waypoints required (format: [[lng, lat], [lng, lat], ...])"
        });
      }

      if (waypoints.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Maximum 50 waypoints allowed"
        });
      }

      const orsApiKey = process.env.ORS_API_KEY;
      if (!orsApiKey) {
        console.log(`ORS_API_KEY not set, falling back to custom trail router (profile: ${profile})`);
        const result = await calculateTrailRoute(waypoints, profile);
        return res.json(result);
      }

      const orsUrl = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

      const orsResponse = await fetch(orsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': orsApiKey
        },
        body: JSON.stringify({
          coordinates: waypoints,
          elevation: true,
          instructions: false,
          preference: 'recommended'
        })
      });

      if (!orsResponse.ok) {
        const errorText = await orsResponse.text();
        console.error(`ORS API error ${orsResponse.status} (profile: ${profile}):`, errorText);

        if (orsResponse.status === 429 || orsResponse.status >= 500) {
          console.log(`ORS unavailable, falling back to custom trail router (profile: ${profile})`);
          const result = await calculateTrailRoute(waypoints, profile);
          return res.json(result);
        }

        return res.status(orsResponse.status).json({
          success: false,
          message: `Route calculation failed: ${errorText}`
        });
      }

      const orsData = await orsResponse.json();

      if (!orsData.features || orsData.features.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No route found between these waypoints. Try moving them closer to paths."
        });
      }

      const feature = orsData.features[0];
      const coordinates = feature.geometry.coordinates;
      const summary = feature.properties.summary;

      const pathCoordinates: [number, number][] = coordinates.map((c: number[]) => [c[0], c[1]]);

      let elevationGain = 0;
      let elevationLoss = 0;
      for (let i = 1; i < coordinates.length; i++) {
        if (coordinates[i].length >= 3 && coordinates[i - 1].length >= 3) {
          const diff = coordinates[i][2] - coordinates[i - 1][2];
          if (diff > 0) elevationGain += diff;
          else elevationLoss += Math.abs(diff);
        }
      }

      return res.json({
        success: true,
        coordinates: pathCoordinates,
        distance: summary.distance,
        duration: summary.duration,
        elevationGain: Math.round(elevationGain * 10) / 10,
        elevationLoss: Math.round(elevationLoss * 10) / 10,
        profile,
        source: 'openrouteservice'
      });

    } catch (error) {
      console.error('ORS route error:', error);

      try {
        const { waypoints, profile } = req.body;
        const result = await calculateTrailRoute(waypoints, profile || 'foot-hiking');
        return res.json(result);
      } catch (fallbackError) {
        return res.status(500).json({
          success: false,
          message: `Route error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }
  });

  // Calculate shortest path route on trails
  app.post("/api/trails/route", async (req, res) => {
    try {
      const { waypoints } = req.body;

      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({
          success: false,
          message: "At least 2 waypoints required (format: [[lng, lat], [lng, lat], ...])"
        });
      }

      // Validate waypoint format
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (!Array.isArray(wp) || wp.length !== 2 || typeof wp[0] !== 'number' || typeof wp[1] !== 'number') {
          return res.status(400).json({
            success: false,
            message: `Invalid waypoint format at index ${i}. Expected [longitude, latitude]`
          });
        }
      }

      const result = await calculateTrailRoute(waypoints);

      return res.json(result);
    } catch (error) {
      console.error('Trail routing error:', error);
      return res.status(500).json({
        success: false,
        message: `Trail routing error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  // Get trail statistics for an area
  app.get("/api/trails/stats", async (req, res) => {
    try {
      const { minLat, minLon, maxLat, maxLon } = req.query;

      if (!minLat || !minLon || !maxLat || !maxLon) {
        return res.status(400).json({
          success: false,
          message: "Bounding box required: minLat, minLon, maxLat, maxLon"
        });
      }

      const stats = await getTrailStats(
        parseFloat(minLat as string),
        parseFloat(minLon as string),
        parseFloat(maxLat as string),
        parseFloat(maxLon as string)
      );

      return res.json({ success: true, ...stats });
    } catch (error) {
      console.error('Trail stats error:', error);
      return res.status(500).json({
        success: false,
        message: `Failed to get trail stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  // ============================================
  // Fetch real hiking trail data for an area
  // Used to give AI knowledge of actual trails
  // ============================================
  app.get("/api/trails/named-routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { lat, lng, radius } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({ error: "lat and lng parameters required" });
      }

      const centerLat = parseFloat(lat as string);
      const centerLng = parseFloat(lng as string);
      const searchRadius = parseFloat((radius as string) || '0.15');

      const bbox = `${centerLng - searchRadius},${centerLat - searchRadius},${centerLng + searchRadius},${centerLat + searchRadius}`;

      const wmtResponse = await fetch(
        `https://hiking.waymarkedtrails.org/api/v1/list/by_bbox?bbox=${bbox}&limit=30`,
        { signal: AbortSignal.timeout(10000) }
      );

      let namedRoutes: any[] = [];
      if (wmtResponse.ok) {
        const wmtData = await wmtResponse.json();
        if (wmtData.results) {
          namedRoutes = wmtData.results.map((r: any) => ({
            id: r.id,
            name: r.name || r.ref || 'Unnamed route',
            ref: r.ref || null,
            group: r.group || null,
            type: r.type || 'relation'
          }));
        }
      }

      const overpassQuery = `
        [out:json][timeout:15];
        (
          way["highway"~"path|footway|track"]["name"](${centerLat - searchRadius},${centerLng - searchRadius},${centerLat + searchRadius},${centerLng + searchRadius});
          relation["route"="hiking"](${centerLat - searchRadius},${centerLng - searchRadius},${centerLat + searchRadius},${centerLng + searchRadius});
        );
        out tags;
      `;

      let trailDetails: any[] = [];
      try {
        const overpassResponse = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: AbortSignal.timeout(12000)
        });

        if (overpassResponse.ok) {
          const overpassData = await overpassResponse.json();
          trailDetails = overpassData.elements
            .filter((el: any) => el.tags?.name)
            .map((el: any) => ({
              name: el.tags.name,
              type: el.type,
              highway: el.tags.highway || null,
              sac_scale: el.tags.sac_scale || null,
              surface: el.tags.surface || null,
              trail_visibility: el.tags.trail_visibility || null,
              ref: el.tags.ref || null,
              distance: el.tags.distance || null,
              description: el.tags.description || null
            }));
        }
      } catch (overpassError) {
        console.warn('Overpass query failed (non-critical):', overpassError);
      }

      const allTrails = new Map<string, any>();
      for (const route of namedRoutes) {
        allTrails.set(route.name, { ...route, source: 'waymarkedtrails' });
      }
      for (const trail of trailDetails) {
        if (!allTrails.has(trail.name)) {
          allTrails.set(trail.name, { ...trail, source: 'overpass' });
        } else {
          const existing = allTrails.get(trail.name);
          if (trail.sac_scale) existing.sac_scale = trail.sac_scale;
          if (trail.surface) existing.surface = trail.surface;
          if (trail.description) existing.description = trail.description;
        }
      }

      res.json({
        trails: Array.from(allTrails.values()),
        center: { lat: centerLat, lng: centerLng },
        bbox
      });

    } catch (error) {
      console.error('Named routes error:', error);
      res.json({ trails: [], center: null, bbox: null });
    }
  });
}
