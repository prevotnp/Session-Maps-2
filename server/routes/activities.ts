import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { validateRequest, parseId } from "./utils";
import { insertActivitySchema, insertRouteSchema } from "@shared/schema";

export function registerActivityRoutes(app: Express) {
  app.post("/api/activities", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const activityData = { ...req.body, userId: user.id };

      const validation = validateRequest(insertActivitySchema, activityData);
      if (!validation.success || !validation.data) {
        return res.status(400).json({ error: validation.error || "Invalid data" });
      }

      const activity = await dbStorage.createActivity(validation.data);
      res.status(201).json(activity);
    } catch (error) {
      console.error('Error creating activity:', error);
      res.status(500).json({ error: "Failed to create activity" });
    }
  });

  // Get all activities for current user
  app.get("/api/activities", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const activities = await dbStorage.getActivitiesByUser(user.id);
      res.json(activities);
    } catch (error) {
      console.error('Error fetching activities:', error);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  // Get public activities (for explore/discover)
  app.get("/api/activities/public", async (req: Request, res: Response) => {
    try {
      const activities = await dbStorage.getPublicActivities();
      res.json(activities);
    } catch (error) {
      console.error('Error fetching public activities:', error);
      res.status(500).json({ error: "Failed to fetch public activities" });
    }
  });

  // Get single activity by ID
  app.get("/api/activities/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const activityId = parseId(req.params.id);

      if (!activityId) {
        return res.status(400).json({ error: "Invalid activity ID" });
      }

      const activity = await dbStorage.getActivity(activityId);

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      // Check ownership or public access
      if (activity.userId !== user.id && !activity.isPublic) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(activity);
    } catch (error) {
      console.error('Error fetching activity:', error);
      res.status(500).json({ error: "Failed to fetch activity" });
    }
  });

  // Update activity
  app.patch("/api/activities/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const activityId = parseId(req.params.id);

      if (!activityId) {
        return res.status(400).json({ error: "Invalid activity ID" });
      }

      const activity = await dbStorage.getActivity(activityId);

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      if (activity.userId !== user.id) {
        return res.status(403).json({ error: "Not authorized to update this activity" });
      }

      const { name, notes, isPublic, activityType } = req.body;
      const updateData: Record<string, any> = {};
      if (name !== undefined) updateData.name = name;
      if (notes !== undefined) updateData.notes = notes;
      if (isPublic !== undefined) updateData.isPublic = isPublic;
      if (activityType !== undefined) updateData.activityType = activityType;

      const updatedActivity = await dbStorage.updateActivity(activityId, updateData);
      res.json(updatedActivity);
    } catch (error) {
      console.error('Error updating activity:', error);
      res.status(500).json({ error: "Failed to update activity" });
    }
  });

  // Delete activity
  app.delete("/api/activities/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const activityId = parseId(req.params.id);

      if (!activityId) {
        return res.status(400).json({ error: "Invalid activity ID" });
      }

      const activity = await dbStorage.getActivity(activityId);

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      if (activity.userId !== user.id) {
        return res.status(403).json({ error: "Not authorized to delete this activity" });
      }

      await dbStorage.deleteActivity(activityId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting activity:', error);
      res.status(500).json({ error: "Failed to delete activity" });
    }
  });

  app.post("/api/activities/:id/save-as-route", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const activityId = parseId(req.params.id);

      if (!activityId) {
        return res.status(400).json({ error: "Invalid activity ID" });
      }

      const activity = await dbStorage.getActivity(activityId);

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      if (activity.userId !== user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }

      let pathCoordinates = activity.pathCoordinates;
      let waypointCoordinates = "[]";
      if (req.body.waypoints) {
        waypointCoordinates = JSON.stringify(req.body.waypoints);
      }

      const routeData = {
        userId: user.id,
        name: activity.name || `${activity.activityType} - ${new Date(activity.startTime).toLocaleDateString()}`,
        description: `Recorded ${activity.activityType} on ${new Date(activity.startTime).toLocaleDateString()}. Distance: ${activity.distanceMeters ? (parseFloat(activity.distanceMeters) / 1609.34).toFixed(1) + ' mi' : 'unknown'}. Time: ${activity.elapsedTimeSeconds ? Math.round(activity.elapsedTimeSeconds / 60) + ' min' : 'unknown'}.`,
        waypointIds: JSON.stringify([]),
        pathCoordinates: pathCoordinates,
        waypointCoordinates: waypointCoordinates,
        totalDistance: activity.distanceMeters || "0",
        elevationGain: activity.elevationGainMeters || "0",
        elevationLoss: activity.elevationLossMeters || "0",
        estimatedTime: activity.elapsedTimeSeconds ? Math.round(activity.elapsedTimeSeconds / 60) : 0,
        routingMode: "direct" as const,
        isPublic: activity.isPublic ?? false,
      };

      const validation = validateRequest(insertRouteSchema, routeData);
      if (!validation.success || !validation.data) {
        return res.status(400).json({ error: validation.error || "Invalid route data" });
      }

      const newRoute = await dbStorage.createRoute(validation.data);
      res.status(201).json(newRoute);
    } catch (error) {
      console.error('Error converting activity to route:', error);
      res.status(500).json({ error: "Failed to save as route" });
    }
  });
}
