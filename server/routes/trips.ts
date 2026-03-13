import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { validateRequest, parseId } from "./utils";
import { insertTripSchema, insertCalendarEventSchema } from "@shared/schema";

export function registerTripRoutes(app: Express) {
  app.post("/api/trips", isAuthenticated, async (req: Request, res: Response) => {
    const { success, data, error } = validateRequest(insertTripSchema, req.body);
    if (!success || !data) {
      return res.status(400).json({ error: error || "Invalid trip data" });
    }

    try {
      const trip = await dbStorage.createTrip({ ...data, userId: req.user!.id });
      res.status(201).json(trip);
    } catch (error) {
      console.error('Error creating trip:', error);
      res.status(500).json({ error: "Failed to create trip" });
    }
  });

  app.get("/api/trips", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const trips = await dbStorage.getTripsByUser(req.user!.id);
      res.json(trips);
    } catch (error) {
      console.error('Error fetching trips:', error);
      res.status(500).json({ error: "Failed to fetch trips" });
    }
  });

  app.get("/api/trips/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);

    try {
      const trip = await dbStorage.getTrip(id);
      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      // Check if user owns the trip or if it's public
      if (trip.userId !== req.user!.id && !trip.isPublic) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(trip);
    } catch (error) {
      console.error('Error fetching trip:', error);
      res.status(500).json({ error: "Failed to fetch trip" });
    }
  });

  app.put("/api/trips/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const existingTrip = await dbStorage.getTrip(id);
      if (!existingTrip || existingTrip.userId !== req.user!.id) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const trip = await dbStorage.updateTrip(id, req.body);
      res.json(trip);
    } catch (error) {
      console.error('Error updating trip:', error);
      res.status(500).json({ error: "Failed to update trip" });
    }
  });

  app.delete("/api/trips/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const existingTrip = await dbStorage.getTrip(id);
      if (!existingTrip || existingTrip.userId !== req.user!.id) {
        return res.status(404).json({ error: "Trip not found" });
      }

      const success = await dbStorage.deleteTrip(id);
      if (success) {
        res.json({ message: "Trip deleted successfully" });
      } else {
        res.status(500).json({ error: "Failed to delete trip" });
      }
    } catch (error) {
      console.error('Error deleting trip:', error);
      res.status(500).json({ error: "Failed to delete trip" });
    }
  });

  // Calendar Event routes
  app.post("/api/calendar-events", isAuthenticated, async (req: Request, res: Response) => {
    const { success, data, error } = validateRequest(insertCalendarEventSchema, req.body);
    if (!success || !data) {
      return res.status(400).json({ error: error || "Invalid calendar event data" });
    }

    try {
      // Verify the user owns the trip
      const trip = await dbStorage.getTrip(data.tripId);
      if (!trip || trip.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const event = await dbStorage.createCalendarEvent({ ...data, userId: req.user!.id });
      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating calendar event:', error);
      res.status(500).json({ error: "Failed to create calendar event" });
    }
  });

  app.get("/api/calendar-events", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const events = await dbStorage.getCalendarEventsByUser(req.user!.id);
      res.json(events);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  app.get("/api/trips/:tripId/calendar-events", isAuthenticated, async (req: Request, res: Response) => {
    const tripId = parseId(req.params.tripId);
    if (!tripId) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      // Verify the user owns the trip
      const trip = await dbStorage.getTrip(tripId);
      if (!trip || (trip.userId !== req.user!.id && !trip.isPublic)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const events = await dbStorage.getCalendarEventsByTrip(tripId);
      res.json(events);
    } catch (error) {
      console.error('Error fetching trip calendar events:', error);
      res.status(500).json({ error: "Failed to fetch trip calendar events" });
    }
  });

  app.get("/api/calendar-events/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);

    try {
      const event = await dbStorage.getCalendarEvent(id);
      if (!event) {
        return res.status(404).json({ error: "Calendar event not found" });
      }

      // Check if user owns the event
      if (event.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(event);
    } catch (error) {
      console.error('Error fetching calendar event:', error);
      res.status(500).json({ error: "Failed to fetch calendar event" });
    }
  });

  app.put("/api/calendar-events/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const existingEvent = await dbStorage.getCalendarEvent(id);
      if (!existingEvent || existingEvent.userId !== req.user!.id) {
        return res.status(404).json({ error: "Calendar event not found" });
      }

      const event = await dbStorage.updateCalendarEvent(id, req.body);
      res.json(event);
    } catch (error) {
      console.error('Error updating calendar event:', error);
      res.status(500).json({ error: "Failed to update calendar event" });
    }
  });

  app.delete("/api/calendar-events/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    try {
      const existingEvent = await dbStorage.getCalendarEvent(id);
      if (!existingEvent || existingEvent.userId !== req.user!.id) {
        return res.status(404).json({ error: "Calendar event not found" });
      }

      const success = await dbStorage.deleteCalendarEvent(id);
      if (success) {
        res.json({ message: "Calendar event deleted successfully" });
      } else {
        res.status(500).json({ error: "Failed to delete calendar event" });
      }
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      res.status(500).json({ error: "Failed to delete calendar event" });
    }
  });
}
