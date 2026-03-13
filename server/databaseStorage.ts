import { eq, and, or, like, sql, desc, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  droneImages,
  droneModels,
  cesium3dTilesets,
  locations,
  offlineMapAreas,
  waypoints,
  waypointShares,
  mapDrawings,
  locationShares,
  userLocations,
  routes,
  routeShares,
  routePointsOfInterest,
  routeNotes,
  trips,
  calendarEvents,
  friendRequests,
  friendships,
  liveMapSessions,
  liveMapMembers,
  liveMapPois,
  liveMapRoutes,
  liveMapMessages,
  liveMapInvites,
  liveMapGpsTracks,
  deviceTokens,
  passwordResetTokens,
  backgroundLocationTokens,
  activities,
  directMessages,
  type User,
  type InsertUser,
  type DroneImage,
  type InsertDroneImage,
  type DroneModel,
  type InsertDroneModel,
  type Location,
  type InsertLocation,
  type OfflineMapArea,
  type InsertOfflineMapArea,
  type Waypoint,
  type InsertWaypoint,
  type WaypointShare,
  type InsertWaypointShare,
  type MapDrawing,
  type InsertMapDrawing,
  type LocationShare,
  type InsertLocationShare,
  type UserLocation,
  type InsertUserLocation,
  type Route,
  type InsertRoute,
  type RouteShare,
  type InsertRouteShare,
  type RoutePointOfInterest,
  type InsertRoutePointOfInterest,
  type RouteNote,
  type InsertRouteNote,
  type Trip,
  type InsertTrip,
  type CalendarEvent,
  type InsertCalendarEvent,
  type FriendRequest,
  type InsertFriendRequest,
  type Friendship,
  type InsertFriendship,
  type LiveMapSession,
  type InsertLiveMapSession,
  type LiveMapMember,
  type InsertLiveMapMember,
  type LiveMapPoi,
  type InsertLiveMapPoi,
  type LiveMapRoute,
  type InsertLiveMapRoute,
  type LiveMapMessage,
  type InsertLiveMapMessage,
  type LiveMapInvite,
  type InsertLiveMapInvite,
  type LiveMapGpsTrack,
  type InsertLiveMapGpsTrack,
  type DeviceToken,
  type InsertDeviceToken,
  type PasswordResetToken,
  type BackgroundLocationToken,
  type Activity,
  type InsertActivity,
  type DirectMessage,
  type InsertDirectMessage,
  type Cesium3dTileset,
  type InsertCesium3dTileset,
} from "@shared/schema";
import { IStorage } from "./storage";

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async upsertUser(userData: InsertUser): Promise<User> {
    if (userData.id) {
      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            username: userData.username,
            email: userData.email,
            fullName: userData.fullName,
            isSubscribed: userData.isSubscribed,
            subscriptionExpiry: userData.subscriptionExpiry,
            isAdmin: userData.isAdmin,
          },
        })
        .returning();
      return user;
    } else {
      return this.createUser(userData);
    }
  }

  async updateUserSubscription(userId: number, isSubscribed: boolean, expiryDate?: Date): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ 
        isSubscribed,
        subscriptionExpiry: expiryDate || null
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async setUserAdmin(userId: number, isAdmin: boolean): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ isAdmin })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getAdminUsers(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.isAdmin, true));
  }

  // Drone image operations
  async createDroneImage(droneImage: InsertDroneImage): Promise<DroneImage> {
    const [newDroneImage] = await db
      .insert(droneImages)
      .values(droneImage)
      .returning();
    return newDroneImage;
  }

  async getDroneImage(id: number): Promise<DroneImage | undefined> {
    const [droneImage] = await db.select().from(droneImages).where(eq(droneImages.id, id));
    return droneImage;
  }

  async getDroneImagesByUser(userId: number): Promise<DroneImage[]> {
    return await db.select().from(droneImages).where(eq(droneImages.userId, userId));
  }

  async getPublicDroneImages(): Promise<DroneImage[]> {
    return await db.select().from(droneImages).where(eq(droneImages.isPublic, true));
  }

  async setDroneImageActive(id: number, isActive: boolean): Promise<DroneImage | undefined> {
    const [droneImage] = await db
      .update(droneImages)
      .set({ isActive })
      .where(eq(droneImages.id, id))
      .returning();
    return droneImage;
  }

  async updateDroneImage(id: number, updateData: Partial<DroneImage>): Promise<DroneImage | undefined> {
    const [droneImage] = await db
      .update(droneImages)
      .set(updateData)
      .where(eq(droneImages.id, id))
      .returning();
    return droneImage;
  }

  async deleteDroneImage(id: number): Promise<boolean> {
    const result = await db.delete(droneImages).where(eq(droneImages.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // 3D Drone model operations
  async createDroneModel(model: InsertDroneModel): Promise<DroneModel> {
    const [newModel] = await db
      .insert(droneModels)
      .values(model)
      .returning();
    return newModel;
  }

  async getDroneModel(id: number): Promise<DroneModel | undefined> {
    const [model] = await db.select().from(droneModels).where(eq(droneModels.id, id));
    return model;
  }

  async getDroneModelByDroneImageId(droneImageId: number): Promise<DroneModel | undefined> {
    const [model] = await db.select().from(droneModels).where(eq(droneModels.droneImageId, droneImageId));
    return model;
  }

  async updateDroneModel(id: number, updateData: Partial<DroneModel>): Promise<DroneModel | undefined> {
    const [model] = await db
      .update(droneModels)
      .set(updateData)
      .where(eq(droneModels.id, id))
      .returning();
    return model;
  }

  async deleteDroneModel(id: number): Promise<boolean> {
    const result = await db.delete(droneModels).where(eq(droneModels.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Cesium 3D Tileset operations
  async createCesium3dTileset(tileset: InsertCesium3dTileset): Promise<Cesium3dTileset> {
    const [newTileset] = await db
      .insert(cesium3dTilesets)
      .values(tileset)
      .returning();
    return newTileset;
  }

  async getCesium3dTileset(id: number): Promise<Cesium3dTileset | undefined> {
    const [tileset] = await db.select().from(cesium3dTilesets).where(eq(cesium3dTilesets.id, id));
    return tileset;
  }

  async getCesium3dTilesetsByUser(userId: number): Promise<Cesium3dTileset[]> {
    return await db.select().from(cesium3dTilesets).where(eq(cesium3dTilesets.userId, userId));
  }

  async getCesium3dTilesetByDroneImageId(droneImageId: number): Promise<Cesium3dTileset | undefined> {
    const [tileset] = await db.select().from(cesium3dTilesets).where(eq(cesium3dTilesets.droneImageId, droneImageId));
    return tileset;
  }

  async deleteCesium3dTileset(id: number): Promise<boolean> {
    const result = await db.delete(cesium3dTilesets).where(eq(cesium3dTilesets.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Location operations
  async createLocation(location: InsertLocation): Promise<Location> {
    const [newLocation] = await db
      .insert(locations)
      .values(location)
      .returning();
    return newLocation;
  }

  async getLocation(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async getLocationsByUser(userId: number): Promise<Location[]> {
    return await db.select().from(locations).where(eq(locations.userId, userId));
  }

  // Offline map areas operations
  async createOfflineMapArea(offlineMapArea: InsertOfflineMapArea): Promise<OfflineMapArea> {
    const [newOfflineMapArea] = await db
      .insert(offlineMapAreas)
      .values(offlineMapArea)
      .returning();
    return newOfflineMapArea;
  }

  async getOfflineMapArea(id: number): Promise<OfflineMapArea | undefined> {
    const [offlineMapArea] = await db.select().from(offlineMapAreas).where(eq(offlineMapAreas.id, id));
    return offlineMapArea;
  }

  async getOfflineMapAreasByUser(userId: number): Promise<OfflineMapArea[]> {
    return await db.select().from(offlineMapAreas).where(eq(offlineMapAreas.userId, userId));
  }

  async deleteOfflineMapArea(id: number): Promise<boolean> {
    const result = await db.delete(offlineMapAreas).where(eq(offlineMapAreas.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Waypoint operations
  async createWaypoint(waypoint: InsertWaypoint): Promise<Waypoint> {
    const [newWaypoint] = await db
      .insert(waypoints)
      .values(waypoint)
      .returning();
    return newWaypoint;
  }

  async getWaypoint(id: number): Promise<Waypoint | undefined> {
    const [waypoint] = await db.select().from(waypoints).where(eq(waypoints.id, id));
    return waypoint;
  }

  async getWaypointsByUser(userId: number): Promise<Waypoint[]> {
    return await db.select().from(waypoints).where(eq(waypoints.userId, userId));
  }

  async getSharedWaypoints(userId: number): Promise<Waypoint[]> {
    return await db
      .select()
      .from(waypoints)
      .innerJoin(waypointShares, eq(waypoints.id, waypointShares.waypointId))
      .where(eq(waypointShares.sharedWithUserId, userId))
      .then(results => results.map(result => result.waypoints));
  }

  async updateWaypoint(id: number, updateData: Partial<Waypoint>): Promise<Waypoint | undefined> {
    const [waypoint] = await db
      .update(waypoints)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(waypoints.id, id))
      .returning();
    return waypoint;
  }

  async deleteWaypoint(id: number): Promise<boolean> {
    // First delete any shares for this waypoint
    await db.delete(waypointShares).where(eq(waypointShares.waypointId, id));
    
    // Then delete the waypoint itself
    const result = await db.delete(waypoints).where(eq(waypoints.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async shareWaypoint(share: InsertWaypointShare): Promise<WaypointShare> {
    const [newShare] = await db
      .insert(waypointShares)
      .values(share)
      .returning();
    return newShare;
  }

  async unshareWaypoint(waypointId: number, sharedWithUserId: number): Promise<boolean> {
    const result = await db
      .delete(waypointShares)
      .where(
        and(
          eq(waypointShares.waypointId, waypointId),
          eq(waypointShares.sharedWithUserId, sharedWithUserId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  async getWaypointShares(waypointId: number): Promise<WaypointShare[]> {
    return await db
      .select()
      .from(waypointShares)
      .where(eq(waypointShares.waypointId, waypointId));
  }

  // Map drawings operations
  async createMapDrawing(drawing: InsertMapDrawing): Promise<MapDrawing> {
    const [newMapDrawing] = await db
      .insert(mapDrawings)
      .values(drawing)
      .returning();
    return newMapDrawing;
  }

  async getMapDrawing(id: number): Promise<MapDrawing | undefined> {
    const [mapDrawing] = await db.select().from(mapDrawings).where(eq(mapDrawings.id, id));
    return mapDrawing;
  }

  async getMapDrawingsByUser(userId: number): Promise<MapDrawing[]> {
    return await db.select().from(mapDrawings).where(eq(mapDrawings.userId, userId));
  }

  async updateMapDrawing(id: number, updateData: Partial<MapDrawing>): Promise<MapDrawing | undefined> {
    const [mapDrawing] = await db
      .update(mapDrawings)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(mapDrawings.id, id))
      .returning();
    return mapDrawing;
  }

  async deleteMapDrawing(id: number): Promise<boolean> {
    const result = await db.delete(mapDrawings).where(eq(mapDrawings.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Location sharing operations
  async createLocationShare(share: InsertLocationShare): Promise<LocationShare> {
    const [locationShare] = await db
      .insert(locationShares)
      .values(share)
      .returning();
    return locationShare;
  }

  async getLocationShare(id: number): Promise<LocationShare | undefined> {
    const [locationShare] = await db.select().from(locationShares).where(eq(locationShares.id, id));
    return locationShare;
  }

  async getLocationSharesByUser(userId: number): Promise<LocationShare[]> {
    return await db.select().from(locationShares)
      .where(or(eq(locationShares.fromUserId, userId), eq(locationShares.toUserId, userId)));
  }

  async getPendingLocationShares(userId: number): Promise<LocationShare[]> {
    return await db.select().from(locationShares)
      .where(and(eq(locationShares.toUserId, userId), eq(locationShares.status, "pending")));
  }

  async updateLocationShareStatus(id: number, status: string, respondedAt?: Date): Promise<LocationShare | undefined> {
    const [locationShare] = await db
      .update(locationShares)
      .set({ status, respondedAt: respondedAt || new Date() })
      .where(eq(locationShares.id, id))
      .returning();
    return locationShare;
  }

  async deleteLocationShare(id: number): Promise<boolean> {
    const result = await db.delete(locationShares).where(eq(locationShares.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async findLocationShareByUsers(fromUserId: number, toUserId: number): Promise<LocationShare | undefined> {
    const [locationShare] = await db.select().from(locationShares)
      .where(and(eq(locationShares.fromUserId, fromUserId), eq(locationShares.toUserId, toUserId)));
    return locationShare;
  }

  // User location operations
  async upsertUserLocation(location: InsertUserLocation): Promise<UserLocation> {
    const [userLocation] = await db
      .insert(userLocations)
      .values({ ...location, lastUpdated: new Date() })
      .onConflictDoUpdate({
        target: userLocations.userId,
        set: {
          ...location,
          lastUpdated: new Date(),
        },
      })
      .returning();
    return userLocation;
  }

  async getUserLocation(userId: number): Promise<UserLocation | undefined> {
    const [userLocation] = await db.select().from(userLocations).where(eq(userLocations.userId, userId));
    return userLocation;
  }

  async getSharedLocations(userId: number): Promise<(UserLocation & { user: User })[]> {
    // Get locations from users who have accepted shares FROM this user
    const shareFromUser = await db
      .select({
        userLocation: userLocations,
        user: users,
      })
      .from(locationShares)
      .innerJoin(userLocations, eq(locationShares.toUserId, userLocations.userId))
      .innerJoin(users, eq(userLocations.userId, users.id))
      .where(and(
        eq(locationShares.fromUserId, userId),
        eq(locationShares.status, "accepted"),
        eq(userLocations.isActive, true)
      ));

    // Get locations from users who have sent accepted shares TO this user
    const shareToUser = await db
      .select({
        userLocation: userLocations,
        user: users,
      })
      .from(locationShares)
      .innerJoin(userLocations, eq(locationShares.fromUserId, userLocations.userId))
      .innerJoin(users, eq(userLocations.userId, users.id))
      .where(and(
        eq(locationShares.toUserId, userId),
        eq(locationShares.status, "accepted"),
        eq(userLocations.isActive, true)
      ));

    // Combine both arrays and remove duplicates
    const allShares = [...shareFromUser, ...shareToUser];
    const uniqueShares = allShares.filter((share, index, arr) => 
      arr.findIndex(s => s.user.id === share.user.id) === index
    );

    return uniqueShares.map(share => ({
      ...share.userLocation,
      user: share.user,
    }));
  }

  async deleteUserLocation(userId: number): Promise<boolean> {
    const result = await db.delete(userLocations).where(eq(userLocations.userId, userId));
    return (result.rowCount ?? 0) > 0;
  }

  // Route operations
  async createRoute(route: InsertRoute): Promise<Route> {
    const [newRoute] = await db
      .insert(routes)
      .values(route)
      .returning();
    return newRoute;
  }

  async getRoute(id: number): Promise<Route | undefined> {
    const [route] = await db.select().from(routes).where(eq(routes.id, id));
    return route;
  }

  async getRoutesByUser(userId: number): Promise<Route[]> {
    return await db.select().from(routes).where(eq(routes.userId, userId));
  }

  async getRouteShareCounts(routeIds: number[]): Promise<Map<number, number>> {
    if (routeIds.length === 0) return new Map();
    
    const counts = await db
      .select({
        routeId: routeShares.routeId,
        count: sql<number>`count(*)::int`
      })
      .from(routeShares)
      .where(inArray(routeShares.routeId, routeIds))
      .groupBy(routeShares.routeId);
    
    const countMap = new Map<number, number>();
    counts.forEach(c => countMap.set(c.routeId, c.count));
    return countMap;
  }

  async getPublicRoutes(): Promise<Route[]> {
    return await db.select().from(routes).where(eq(routes.isPublic, true));
  }

  async getPublicRoutesWithOwners(): Promise<(Route & { owner: { id: number; username: string; fullName: string | null } })[]> {
    const result = await db
      .select({
        route: routes,
        owner: {
          id: users.id,
          username: users.username,
          fullName: users.fullName
        }
      })
      .from(routes)
      .where(eq(routes.isPublic, true))
      .innerJoin(users, eq(routes.userId, users.id));
    
    return result.map(row => ({
      ...row.route,
      owner: row.owner
    }));
  }

  async getUserPublicRoutes(userId: number): Promise<Route[]> {
    return await db
      .select()
      .from(routes)
      .where(and(eq(routes.userId, userId), eq(routes.isPublic, true)));
  }

  async updateRoute(id: number, updateData: Partial<Route>): Promise<Route | undefined> {
    const [route] = await db
      .update(routes)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(routes.id, id))
      .returning();
    return route;
  }

  async deleteRoute(id: number): Promise<boolean> {
    const result = await db.delete(routes).where(eq(routes.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getRoutesSharedWithUser(userId: number): Promise<Route[]> {
    const sharedRoutes = await db
      .select({ route: routes })
      .from(routeShares)
      .where(eq(routeShares.sharedWithUserId, userId))
      .innerJoin(routes, eq(routeShares.routeId, routes.id));
    return sharedRoutes.map((row) => row.route);
  }

  // Route sharing operations
  async shareRoute(share: InsertRouteShare): Promise<RouteShare> {
    const [newShare] = await db
      .insert(routeShares)
      .values(share)
      .onConflictDoNothing()
      .returning();
    return newShare;
  }

  async getRouteShares(routeId: number): Promise<(RouteShare & { sharedWith: User })[]> {
    const shares = await db
      .select({
        id: routeShares.id,
        routeId: routeShares.routeId,
        sharedWithUserId: routeShares.sharedWithUserId,
        sharedByUserId: routeShares.sharedByUserId,
        sharedAt: routeShares.sharedAt,
        sharedWith: users
      })
      .from(routeShares)
      .where(eq(routeShares.routeId, routeId))
      .innerJoin(users, eq(routeShares.sharedWithUserId, users.id));
    
    return shares.map(share => ({
      id: share.id,
      routeId: share.routeId,
      sharedWithUserId: share.sharedWithUserId,
      sharedByUserId: share.sharedByUserId,
      sharedAt: share.sharedAt,
      sharedWith: share.sharedWith
    }));
  }

  async revokeRouteShare(shareId: number): Promise<boolean> {
    const result = await db.delete(routeShares).where(eq(routeShares.id, shareId));
    return (result.rowCount ?? 0) > 0;
  }

  async isRouteSharedWithUser(routeId: number, userId: number): Promise<boolean> {
    const [share] = await db
      .select()
      .from(routeShares)
      .where(
        and(
          eq(routeShares.routeId, routeId),
          eq(routeShares.sharedWithUserId, userId)
        )
      );
    return !!share;
  }

  // Route Notes operations
  async createRouteNote(note: InsertRouteNote): Promise<RouteNote> {
    const [newNote] = await db
      .insert(routeNotes)
      .values(note)
      .returning();
    return newNote;
  }

  async getRouteNotes(routeId: number): Promise<RouteNote[]> {
    return await db
      .select()
      .from(routeNotes)
      .where(eq(routeNotes.routeId, routeId))
      .orderBy(routeNotes.position);
  }

  async getRouteNote(id: number): Promise<RouteNote | undefined> {
    const [note] = await db
      .select()
      .from(routeNotes)
      .where(eq(routeNotes.id, id));
    return note;
  }

  async updateRouteNote(id: number, updateData: Partial<RouteNote>): Promise<RouteNote | undefined> {
    const [note] = await db
      .update(routeNotes)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(routeNotes.id, id))
      .returning();
    return note;
  }

  async deleteRouteNote(id: number): Promise<boolean> {
    const result = await db.delete(routeNotes).where(eq(routeNotes.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Route Points of Interest operations
  async createRoutePointOfInterest(poi: InsertRoutePointOfInterest): Promise<RoutePointOfInterest> {
    const [newPoi] = await db
      .insert(routePointsOfInterest)
      .values(poi)
      .returning();
    return newPoi;
  }

  async getRoutePointsOfInterest(routeId: number): Promise<RoutePointOfInterest[]> {
    return await db
      .select()
      .from(routePointsOfInterest)
      .where(eq(routePointsOfInterest.routeId, routeId));
  }

  async getRoutePointOfInterest(id: number): Promise<RoutePointOfInterest | undefined> {
    const [poi] = await db
      .select()
      .from(routePointsOfInterest)
      .where(eq(routePointsOfInterest.id, id));
    return poi;
  }

  async updateRoutePointOfInterest(id: number, updateData: Partial<RoutePointOfInterest>): Promise<RoutePointOfInterest | undefined> {
    const [poi] = await db
      .update(routePointsOfInterest)
      .set(updateData)
      .where(eq(routePointsOfInterest.id, id))
      .returning();
    return poi;
  }

  async deleteRoutePointOfInterest(id: number): Promise<boolean> {
    const result = await db.delete(routePointsOfInterest).where(eq(routePointsOfInterest.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Trip operations
  async createTrip(trip: InsertTrip): Promise<Trip> {
    const [newTrip] = await db
      .insert(trips)
      .values(trip)
      .returning();
    return newTrip;
  }

  async getTrip(id: number): Promise<Trip | undefined> {
    const [trip] = await db.select().from(trips).where(eq(trips.id, id));
    return trip;
  }

  async getTripsByUser(userId: number): Promise<Trip[]> {
    return await db.select().from(trips)
      .where(eq(trips.userId, userId))
      .orderBy(trips.startDate);
  }

  async updateTrip(id: number, updateData: Partial<Trip>): Promise<Trip | undefined> {
    const [trip] = await db
      .update(trips)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(trips.id, id))
      .returning();
    return trip;
  }

  async deleteTrip(id: number): Promise<boolean> {
    // First delete all calendar events for this trip
    await db.delete(calendarEvents).where(eq(calendarEvents.tripId, id));
    // Then delete the trip
    const result = await db.delete(trips).where(eq(trips.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Calendar event operations
  async createCalendarEvent(event: InsertCalendarEvent): Promise<CalendarEvent> {
    const [newEvent] = await db
      .insert(calendarEvents)
      .values(event)
      .returning();
    return newEvent;
  }

  async getCalendarEvent(id: number): Promise<CalendarEvent | undefined> {
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    return event;
  }

  async getCalendarEventsByTrip(tripId: number): Promise<CalendarEvent[]> {
    return await db.select().from(calendarEvents)
      .where(eq(calendarEvents.tripId, tripId))
      .orderBy(calendarEvents.startTime);
  }

  async getCalendarEventsByUser(userId: number): Promise<CalendarEvent[]> {
    return await db.select().from(calendarEvents)
      .where(eq(calendarEvents.userId, userId))
      .orderBy(calendarEvents.startTime);
  }

  async updateCalendarEvent(id: number, updateData: Partial<CalendarEvent>): Promise<CalendarEvent | undefined> {
    const [event] = await db
      .update(calendarEvents)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(calendarEvents.id, id))
      .returning();
    return event;
  }

  async deleteCalendarEvent(id: number): Promise<boolean> {
    const result = await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Friend request operations
  async createFriendRequest(request: InsertFriendRequest): Promise<FriendRequest> {
    const [friendRequest] = await db
      .insert(friendRequests)
      .values(request)
      .returning();
    return friendRequest;
  }

  async getFriendRequest(id: number): Promise<FriendRequest | undefined> {
    const [request] = await db.select().from(friendRequests).where(eq(friendRequests.id, id));
    return request;
  }

  async getPendingFriendRequests(userId: number): Promise<(FriendRequest & { requester: User })[]> {
    const requests = await db
      .select()
      .from(friendRequests)
      .innerJoin(users, eq(friendRequests.requesterId, users.id))
      .where(
        and(
          eq(friendRequests.receiverId, userId),
          eq(friendRequests.status, "pending")
        )
      );
    
    return requests.map(r => ({
      ...r.friend_requests,
      requester: r.users
    }));
  }

  async getSentFriendRequests(userId: number): Promise<(FriendRequest & { receiver: User })[]> {
    const requests = await db
      .select()
      .from(friendRequests)
      .innerJoin(users, eq(friendRequests.receiverId, users.id))
      .where(
        and(
          eq(friendRequests.requesterId, userId),
          eq(friendRequests.status, "pending")
        )
      );
    
    return requests.map(r => ({
      ...r.friend_requests,
      receiver: r.users
    }));
  }

  async updateFriendRequestStatus(id: number, status: string, respondedAt: Date): Promise<FriendRequest | undefined> {
    const [request] = await db
      .update(friendRequests)
      .set({ status, respondedAt })
      .where(eq(friendRequests.id, id))
      .returning();
    return request;
  }

  async findFriendRequest(requesterId: number, receiverId: number): Promise<FriendRequest | undefined> {
    const [request] = await db
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.requesterId, requesterId),
          eq(friendRequests.receiverId, receiverId),
          eq(friendRequests.status, "pending")
        )
      );
    return request;
  }

  async deleteFriendRequest(id: number): Promise<boolean> {
    const result = await db.delete(friendRequests).where(eq(friendRequests.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Friendship operations
  async createFriendship(friendship: InsertFriendship): Promise<Friendship> {
    const [newFriendship] = await db
      .insert(friendships)
      .values(friendship)
      .returning();
    return newFriendship;
  }

  async getFriendships(userId: number): Promise<(Friendship & { friend: User })[]> {
    // Get friendships where user is userAId
    const friendshipsA = await db
      .select()
      .from(friendships)
      .innerJoin(users, eq(friendships.userBId, users.id))
      .where(eq(friendships.userAId, userId));
    
    // Get friendships where user is userBId
    const friendshipsB = await db
      .select()
      .from(friendships)
      .innerJoin(users, eq(friendships.userAId, users.id))
      .where(eq(friendships.userBId, userId));
    
    const resultA = friendshipsA.map(f => ({
      ...f.friendships,
      friend: f.users,
      locationHidden: f.friendships.locationHiddenByA
    }));
    
    const resultB = friendshipsB.map(f => ({
      ...f.friendships,
      friend: f.users,
      locationHidden: f.friendships.locationHiddenByB
    }));
    
    return [...resultA, ...resultB];
  }

  async getFriendIdsForLocationBroadcast(userId: number): Promise<number[]> {
    const friendshipsA = await db
      .select({ friendId: friendships.userBId })
      .from(friendships)
      .where(and(
        eq(friendships.userAId, userId),
        eq(friendships.locationHiddenByA, false)
      ));
    
    const friendshipsB = await db
      .select({ friendId: friendships.userAId })
      .from(friendships)
      .where(and(
        eq(friendships.userBId, userId),
        eq(friendships.locationHiddenByB, false)
      ));
    
    return [
      ...friendshipsA.map(f => f.friendId),
      ...friendshipsB.map(f => f.friendId)
    ];
  }

  async toggleFriendLocationHidden(userId: number, friendId: number, hidden: boolean): Promise<boolean> {
    const [friendshipA] = await db
      .select()
      .from(friendships)
      .where(and(
        eq(friendships.userAId, userId),
        eq(friendships.userBId, friendId)
      ));
    
    if (friendshipA) {
      await db.update(friendships)
        .set({ locationHiddenByA: hidden })
        .where(eq(friendships.id, friendshipA.id));
      return true;
    }
    
    const [friendshipB] = await db
      .select()
      .from(friendships)
      .where(and(
        eq(friendships.userAId, friendId),
        eq(friendships.userBId, userId)
      ));
    
    if (friendshipB) {
      await db.update(friendships)
        .set({ locationHiddenByB: hidden })
        .where(eq(friendships.id, friendshipB.id));
      return true;
    }
    
    return false;
  }

  async updateUserLocationSharing(userId: number, enabled: boolean): Promise<void> {
    await db.update(users)
      .set({ locationSharingEnabled: enabled })
      .where(eq(users.id, userId));
  }

  async areFriends(userAId: number, userBId: number): Promise<boolean> {
    const [friendship] = await db
      .select()
      .from(friendships)
      .where(
        or(
          and(
            eq(friendships.userAId, userAId),
            eq(friendships.userBId, userBId)
          ),
          and(
            eq(friendships.userAId, userBId),
            eq(friendships.userBId, userAId)
          )
        )
      );
    return !!friendship;
  }

  async deleteFriendship(userId: number, friendId: number): Promise<boolean> {
    const result = await db
      .delete(friendships)
      .where(
        or(
          and(
            eq(friendships.userAId, userId),
            eq(friendships.userBId, friendId)
          ),
          and(
            eq(friendships.userAId, friendId),
            eq(friendships.userBId, userId)
          )
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  // User search operations
  async searchUsers(query: string, currentUserId: number): Promise<User[]> {
    const searchPattern = `%${query}%`;
    const foundUsers = await db
      .select()
      .from(users)
      .where(
        and(
          or(
            like(users.username, searchPattern),
            like(users.email, searchPattern),
            like(users.fullName, searchPattern)
          ),
          sql`${users.id} != ${currentUserId}`
        )
      )
      .limit(10);
    return foundUsers;
  }

  // Profile operations
  async getUserProfile(username: string, viewerId: number): Promise<{ user: User; routes: Route[]; activities: Activity[]; isFriend: boolean; isOwner: boolean; publicRouteCount: number; publicActivityCount: number } | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    if (!user) return undefined;

    const isFriend = await this.areFriends(viewerId, user.id);
    const isOwner = viewerId === user.id;

    if (!isOwner && !isFriend) {
      return {
        user,
        routes: [],
        activities: [],
        isFriend: false,
        isOwner: false,
        publicRouteCount: 0,
        publicActivityCount: 0
      };
    }

    let userRoutes: Route[];
    let userActivities: Activity[];

    if (isOwner) {
      userRoutes = await db
        .select()
        .from(routes)
        .where(eq(routes.userId, user.id))
        .orderBy(routes.createdAt);

      userActivities = await db
        .select()
        .from(activities)
        .where(eq(activities.userId, user.id))
        .orderBy(activities.startTime);
    } else {
      const publicRoutes = await db
        .select()
        .from(routes)
        .where(
          and(
            eq(routes.userId, user.id),
            eq(routes.isPublic, true)
          )
        );

      const sharedRoutes = await db
        .select({ route: routes })
        .from(routes)
        .innerJoin(routeShares, eq(routes.id, routeShares.routeId))
        .where(
          and(
            eq(routes.userId, user.id),
            eq(routeShares.sharedWithUserId, viewerId)
          )
        );

      const sharedRoutesList = sharedRoutes.map(sr => sr.route);
      const allRoutes = [...publicRoutes, ...sharedRoutesList];
      const uniqueRoutes = Array.from(new Map(allRoutes.map(r => [r.id, r])).values());
      userRoutes = uniqueRoutes.sort((a, b) => 
        new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      );

      userActivities = await db
        .select()
        .from(activities)
        .where(
          and(
            eq(activities.userId, user.id),
            eq(activities.isPublic, true)
          )
        );
    }

    const publicRouteCount = userRoutes.filter(r => r.isPublic).length;
    const publicActivityCount = userActivities.filter(a => a.isPublic).length;

    return {
      user,
      routes: userRoutes,
      activities: userActivities,
      isFriend,
      isOwner,
      publicRouteCount,
      publicActivityCount
    };
  }

  // Live Map Session operations
  async createLiveMapSession(session: InsertLiveMapSession): Promise<LiveMapSession> {
    const [newSession] = await db.insert(liveMapSessions).values(session).returning();
    return newSession;
  }

  async getLiveMapSession(id: number): Promise<LiveMapSession | undefined> {
    const [session] = await db.select().from(liveMapSessions).where(eq(liveMapSessions.id, id));
    return session;
  }

  async getLiveMapSessionByShareCode(shareCode: string): Promise<LiveMapSession | undefined> {
    const [session] = await db.select().from(liveMapSessions).where(eq(liveMapSessions.shareCode, shareCode));
    return session;
  }

  async getLiveMapSessionsByUser(userId: number): Promise<LiveMapSession[]> {
    // Get sessions where user is owner or member
    const ownedSessions = await db.select().from(liveMapSessions).where(eq(liveMapSessions.ownerId, userId));
    
    const memberSessions = await db
      .select({ session: liveMapSessions })
      .from(liveMapMembers)
      .innerJoin(liveMapSessions, eq(liveMapMembers.sessionId, liveMapSessions.id))
      .where(eq(liveMapMembers.userId, userId));
    
    const allSessions = [...ownedSessions, ...memberSessions.map(ms => ms.session)];
    return Array.from(new Map(allSessions.map(s => [s.id, s])).values());
  }

  async updateLiveMapSession(id: number, updateData: Partial<LiveMapSession>): Promise<LiveMapSession | undefined> {
    const [session] = await db
      .update(liveMapSessions)
      .set(updateData)
      .where(eq(liveMapSessions.id, id))
      .returning();
    return session;
  }

  async deleteLiveMapSession(id: number): Promise<boolean> {
    const result = await db.delete(liveMapSessions).where(eq(liveMapSessions.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Live Map Member operations
  async addLiveMapMember(member: InsertLiveMapMember): Promise<LiveMapMember> {
    const [newMember] = await db.insert(liveMapMembers).values(member).returning();
    return newMember;
  }

  async getLiveMapMembers(sessionId: number): Promise<(LiveMapMember & { user: User })[]> {
    const members = await db
      .select({
        member: liveMapMembers,
        user: users
      })
      .from(liveMapMembers)
      .innerJoin(users, eq(liveMapMembers.userId, users.id))
      .where(and(
        eq(liveMapMembers.sessionId, sessionId),
        isNull(liveMapMembers.leftAt)
      ));
    
    return members.map(m => ({ ...m.member, user: m.user }));
  }

  async updateLiveMapMemberLocation(
    sessionId: number,
    userId: number,
    latitude: string,
    longitude: string,
    accuracy?: string,
    heading?: string
  ): Promise<LiveMapMember | undefined> {
    const [member] = await db
      .update(liveMapMembers)
      .set({
        latitude,
        longitude,
        accuracy: accuracy || null,
        heading: heading || null,
        lastActive: new Date()
      })
      .where(and(eq(liveMapMembers.sessionId, sessionId), eq(liveMapMembers.userId, userId)))
      .returning();
    return member;
  }

  async removeLiveMapMember(sessionId: number, userId: number): Promise<boolean> {
    const result = await db
      .update(liveMapMembers)
      .set({ leftAt: new Date() })
      .where(and(
        eq(liveMapMembers.sessionId, sessionId),
        eq(liveMapMembers.userId, userId),
        isNull(liveMapMembers.leftAt)
      ))
      .returning();
    return result.length > 0;
  }

  async isLiveMapMember(sessionId: number, userId: number): Promise<boolean> {
    const [member] = await db
      .select()
      .from(liveMapMembers)
      .where(and(
        eq(liveMapMembers.sessionId, sessionId),
        eq(liveMapMembers.userId, userId),
        isNull(liveMapMembers.leftAt)
      ));
    return !!member;
  }

  async rejoinLiveMapMember(sessionId: number, userId: number): Promise<LiveMapMember | undefined> {
    const [member] = await db
      .update(liveMapMembers)
      .set({ leftAt: null, lastActive: new Date() })
      .where(and(
        eq(liveMapMembers.sessionId, sessionId),
        eq(liveMapMembers.userId, userId)
      ))
      .returning();
    return member;
  }

  async hasLiveMapMembership(sessionId: number, userId: number): Promise<boolean> {
    const [member] = await db
      .select()
      .from(liveMapMembers)
      .where(and(
        eq(liveMapMembers.sessionId, sessionId),
        eq(liveMapMembers.userId, userId)
      ));
    return !!member;
  }

  // Live Map POI operations
  async createLiveMapPoi(poi: InsertLiveMapPoi): Promise<LiveMapPoi> {
    const [newPoi] = await db.insert(liveMapPois).values(poi).returning();
    return newPoi;
  }

  async getLiveMapPois(sessionId: number): Promise<(LiveMapPoi & { createdByUser: User })[]> {
    const pois = await db
      .select({
        poi: liveMapPois,
        user: users
      })
      .from(liveMapPois)
      .innerJoin(users, eq(liveMapPois.createdBy, users.id))
      .where(eq(liveMapPois.sessionId, sessionId));
    
    return pois.map(p => ({ ...p.poi, createdByUser: p.user }));
  }

  async deleteLiveMapPoi(id: number): Promise<boolean> {
    const result = await db.delete(liveMapPois).where(eq(liveMapPois.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Live Map Route operations
  async createLiveMapRoute(route: InsertLiveMapRoute): Promise<LiveMapRoute> {
    const [newRoute] = await db.insert(liveMapRoutes).values(route).returning();
    return newRoute;
  }

  async getLiveMapRoutes(sessionId: number): Promise<(LiveMapRoute & { createdByUser: User })[]> {
    const liveRoutes = await db
      .select({
        route: liveMapRoutes,
        user: users
      })
      .from(liveMapRoutes)
      .innerJoin(users, eq(liveMapRoutes.createdBy, users.id))
      .where(eq(liveMapRoutes.sessionId, sessionId));
    
    return liveRoutes.map(r => ({ ...r.route, createdByUser: r.user }));
  }

  async getLiveMapRoute(routeId: number): Promise<LiveMapRoute | undefined> {
    const [route] = await db.select().from(liveMapRoutes).where(eq(liveMapRoutes.id, routeId));
    return route;
  }

  async updateLiveMapRoute(routeId: number, data: { name?: string; pathCoordinates: string; totalDistance?: string }): Promise<LiveMapRoute | undefined> {
    const updateData: Record<string, any> = { pathCoordinates: data.pathCoordinates };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.totalDistance !== undefined) updateData.totalDistance = data.totalDistance;
    const [updated] = await db.update(liveMapRoutes).set(updateData).where(eq(liveMapRoutes.id, routeId)).returning();
    return updated;
  }

  async deleteLiveMapRoute(id: number): Promise<boolean> {
    const result = await db.delete(liveMapRoutes).where(eq(liveMapRoutes.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Live Map Message operations
  async createLiveMapMessage(message: InsertLiveMapMessage): Promise<LiveMapMessage> {
    const [newMessage] = await db.insert(liveMapMessages).values(message).returning();
    return newMessage;
  }

  async getLiveMapMessages(sessionId: number, limit: number = 50): Promise<(LiveMapMessage & { user: User })[]> {
    const messages = await db
      .select({
        message: liveMapMessages,
        user: users
      })
      .from(liveMapMessages)
      .innerJoin(users, eq(liveMapMessages.userId, users.id))
      .where(eq(liveMapMessages.sessionId, sessionId))
      .orderBy(liveMapMessages.createdAt)
      .limit(limit);
    
    return messages.map(m => ({ ...m.message, user: m.user }));
  }

  // Live Map Invite operations
  async createLiveMapInvite(invite: InsertLiveMapInvite): Promise<LiveMapInvite> {
    const [newInvite] = await db.insert(liveMapInvites).values(invite).returning();
    return newInvite;
  }

  async getLiveMapInvitesForUser(userId: number): Promise<(LiveMapInvite & { session: LiveMapSession; fromUser: User })[]> {
    const invites = await db
      .select({
        invite: liveMapInvites,
        session: liveMapSessions,
        fromUser: users
      })
      .from(liveMapInvites)
      .innerJoin(liveMapSessions, eq(liveMapInvites.sessionId, liveMapSessions.id))
      .innerJoin(users, eq(liveMapInvites.fromUserId, users.id))
      .where(and(
        eq(liveMapInvites.toUserId, userId),
        eq(liveMapInvites.status, 'pending')
      ))
      .orderBy(desc(liveMapInvites.createdAt));
    
    return invites.map(i => ({ ...i.invite, session: i.session, fromUser: i.fromUser }));
  }

  async updateLiveMapInviteStatus(inviteId: number, status: string): Promise<LiveMapInvite | undefined> {
    const [updated] = await db
      .update(liveMapInvites)
      .set({ status })
      .where(eq(liveMapInvites.id, inviteId))
      .returning();
    return updated;
  }

  async getPendingInviteForSession(sessionId: number, toUserId: number): Promise<LiveMapInvite | undefined> {
    const [invite] = await db
      .select()
      .from(liveMapInvites)
      .where(and(
        eq(liveMapInvites.sessionId, sessionId),
        eq(liveMapInvites.toUserId, toUserId),
        eq(liveMapInvites.status, 'pending')
      ));
    return invite;
  }

  // GPS Track operations for live map sessions
  async createLiveMapGpsTrack(track: InsertLiveMapGpsTrack): Promise<LiveMapGpsTrack> {
    const [newTrack] = await db.insert(liveMapGpsTracks).values(track).returning();
    return newTrack;
  }

  async getLiveMapGpsTracks(sessionId: number): Promise<LiveMapGpsTrack[]> {
    return await db
      .select()
      .from(liveMapGpsTracks)
      .where(eq(liveMapGpsTracks.sessionId, sessionId));
  }

  async getLiveMapGpsTrackByUser(sessionId: number, userId: number): Promise<LiveMapGpsTrack | undefined> {
    const [track] = await db
      .select()
      .from(liveMapGpsTracks)
      .where(and(
        eq(liveMapGpsTracks.sessionId, sessionId),
        eq(liveMapGpsTracks.userId, userId)
      ));
    return track;
  }

  async updateLiveMapGpsTrack(id: number, updates: Partial<LiveMapGpsTrack>): Promise<LiveMapGpsTrack | undefined> {
    const [updated] = await db
      .update(liveMapGpsTracks)
      .set(updates)
      .where(eq(liveMapGpsTracks.id, id))
      .returning();
    return updated;
  }

  async endLiveMapSession(sessionId: number, savedRouteId: number): Promise<LiveMapSession | undefined> {
    const [updated] = await db
      .update(liveMapSessions)
      .set({ 
        isActive: false,
        endedAt: new Date(),
        savedRouteId 
      })
      .where(eq(liveMapSessions.id, sessionId))
      .returning();
    return updated;
  }

  async getEndedLiveMapSessionsForUser(userId: number): Promise<LiveMapSession[]> {
    const memberSessions = await db
      .select({ session: liveMapSessions })
      .from(liveMapMembers)
      .innerJoin(liveMapSessions, eq(liveMapMembers.sessionId, liveMapSessions.id))
      .where(and(
        eq(liveMapMembers.userId, userId),
        eq(liveMapSessions.isActive, false)
      ));
    
    const ownedSessions = await db
      .select()
      .from(liveMapSessions)
      .where(and(
        eq(liveMapSessions.ownerId, userId),
        eq(liveMapSessions.isActive, false)
      ));
    
    // Combine and dedupe
    const sessionMap = new Map<number, LiveMapSession>();
    memberSessions.forEach(m => sessionMap.set(m.session.id, m.session));
    ownedSessions.forEach(s => sessionMap.set(s.id, s));
    
    return Array.from(sessionMap.values());
  }

  // Device token operations (for push notifications)
  async registerDeviceToken(token: InsertDeviceToken): Promise<DeviceToken> {
    // Upsert - update if token exists, insert if not
    const existing = await db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.token, token.token));
    
    if (existing.length > 0) {
      const [updated] = await db
        .update(deviceTokens)
        .set({ 
          userId: token.userId,
          platform: token.platform,
          deviceName: token.deviceName,
          isActive: true,
          updatedAt: new Date()
        })
        .where(eq(deviceTokens.token, token.token))
        .returning();
      return updated;
    }
    
    const [created] = await db.insert(deviceTokens).values(token).returning();
    return created;
  }

  async getDeviceTokensByUser(userId: number): Promise<DeviceToken[]> {
    return await db
      .select()
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId));
  }

  async getActiveDeviceTokensByUser(userId: number): Promise<DeviceToken[]> {
    return await db
      .select()
      .from(deviceTokens)
      .where(and(
        eq(deviceTokens.userId, userId),
        eq(deviceTokens.isActive, true)
      ));
  }

  async deactivateDeviceToken(token: string): Promise<boolean> {
    const result = await db
      .update(deviceTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(deviceTokens.token, token));
    return true;
  }

  async deleteDeviceToken(token: string): Promise<boolean> {
    await db.delete(deviceTokens).where(eq(deviceTokens.token, token));
    return true;
  }

  // Password reset operations
  async createPasswordResetToken(userId: number, token: string, expiresAt: Date): Promise<PasswordResetToken> {
    const [resetToken] = await db
      .insert(passwordResetTokens)
      .values({ userId, token, expiresAt })
      .returning();
    return resetToken;
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
    return resetToken;
  }

  async markPasswordResetTokenUsed(id: number): Promise<boolean> {
    await db
      .update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.id, id));
    return true;
  }

  async updateUserPassword(userId: number, hashedPassword: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  // Activity operations
  async createActivity(activity: InsertActivity): Promise<Activity> {
    const [newActivity] = await db
      .insert(activities)
      .values(activity)
      .returning();
    return newActivity;
  }

  async getActivity(id: number): Promise<Activity | undefined> {
    const [activity] = await db.select().from(activities).where(eq(activities.id, id));
    return activity;
  }

  async getActivitiesByUser(userId: number): Promise<Activity[]> {
    return await db
      .select()
      .from(activities)
      .where(eq(activities.userId, userId))
      .orderBy(desc(activities.startTime));
  }

  async updateActivity(id: number, updates: Partial<InsertActivity>): Promise<Activity | undefined> {
    const [updatedActivity] = await db
      .update(activities)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(activities.id, id))
      .returning();
    return updatedActivity;
  }

  async deleteActivity(id: number): Promise<boolean> {
    await db.delete(activities).where(eq(activities.id, id));
    return true;
  }

  async getPublicActivities(): Promise<Activity[]> {
    return await db
      .select()
      .from(activities)
      .where(eq(activities.isPublic, true))
      .orderBy(desc(activities.startTime));
  }

  async sendDirectMessage(data: InsertDirectMessage): Promise<DirectMessage> {
    const [message] = await db.insert(directMessages).values(data).returning();
    return message;
  }

  async getConversationMessages(userAId: number, userBId: number, limit = 50, before?: number): Promise<DirectMessage[]> {
    const baseWhere = or(
      and(eq(directMessages.senderId, userAId), eq(directMessages.receiverId, userBId)),
      and(eq(directMessages.senderId, userBId), eq(directMessages.receiverId, userAId))
    );

    if (before) {
      return db
        .select()
        .from(directMessages)
        .where(and(baseWhere, sql`${directMessages.id} < ${before}`))
        .orderBy(sql`${directMessages.createdAt} DESC`)
        .limit(limit);
    }

    return db
      .select()
      .from(directMessages)
      .where(baseWhere)
      .orderBy(sql`${directMessages.createdAt} DESC`)
      .limit(limit);
  }

  async markMessagesAsRead(readerId: number, senderId: number): Promise<void> {
    await db
      .update(directMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(directMessages.senderId, senderId),
          eq(directMessages.receiverId, readerId),
          sql`${directMessages.readAt} IS NULL`
        )
      );
  }

  async getConversationList(userId: number): Promise<Array<{
    otherUser: { id: number; username: string; fullName: string | null };
    lastMessage: { id: number; body: string; senderId: number; createdAt: Date | null };
    unreadCount: number;
  }>> {
    const allMessages = await db
      .select()
      .from(directMessages)
      .where(
        or(
          eq(directMessages.senderId, userId),
          eq(directMessages.receiverId, userId)
        )
      )
      .orderBy(sql`${directMessages.createdAt} DESC`);

    const conversationMap = new Map<number, { lastMessage: DirectMessage; unreadCount: number }>();

    for (const msg of allMessages) {
      const otherId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (!conversationMap.has(otherId)) {
        const unreadCount = allMessages.filter(
          m => m.senderId === otherId && m.receiverId === userId && !m.readAt
        ).length;
        conversationMap.set(otherId, { lastMessage: msg, unreadCount });
      }
    }

    const results: Array<{
      otherUser: { id: number; username: string; fullName: string | null };
      lastMessage: { id: number; body: string; senderId: number; createdAt: Date | null };
      unreadCount: number;
    }> = [];

    for (const [otherId, data] of conversationMap) {
      const otherUser = await this.getUser(otherId);
      if (otherUser) {
        results.push({
          otherUser: { id: otherUser.id, username: otherUser.username, fullName: otherUser.fullName },
          lastMessage: {
            id: data.lastMessage.id,
            body: data.lastMessage.body,
            senderId: data.lastMessage.senderId,
            createdAt: data.lastMessage.createdAt,
          },
          unreadCount: data.unreadCount,
        });
      }
    }

    results.sort((a, b) => {
      const aTime = a.lastMessage.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const bTime = b.lastMessage.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return results;
  }

  async deleteDirectMessage(messageId: number, userId: number): Promise<boolean> {
    const [msg] = await db.select().from(directMessages).where(eq(directMessages.id, messageId));
    if (!msg || msg.senderId !== userId) return false;
    await db.delete(directMessages).where(eq(directMessages.id, messageId));
    return true;
  }

  async getUnreadMessageCount(userId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(directMessages)
      .where(
        and(
          eq(directMessages.receiverId, userId),
          sql`${directMessages.readAt} IS NULL`
        )
      );
    return result[0]?.count || 0;
  }

  // Background location token operations
  async createBackgroundLocationToken(
    userId: number,
    sessionId: number,
    token: string,
    expiresAt: Date
  ): Promise<BackgroundLocationToken> {
    // Delete any existing tokens for this user/session combo
    await db
      .delete(backgroundLocationTokens)
      .where(
        and(
          eq(backgroundLocationTokens.userId, userId),
          eq(backgroundLocationTokens.sessionId, sessionId)
        )
      );

    const [created] = await db
      .insert(backgroundLocationTokens)
      .values({ userId, sessionId, token, expiresAt })
      .returning();
    return created;
  }

  async getBackgroundLocationToken(token: string): Promise<BackgroundLocationToken | undefined> {
    const [result] = await db
      .select()
      .from(backgroundLocationTokens)
      .where(eq(backgroundLocationTokens.token, token));
    return result;
  }

  async deleteBackgroundLocationTokensForSession(
    userId: number,
    sessionId: number
  ): Promise<void> {
    await db
      .delete(backgroundLocationTokens)
      .where(
        and(
          eq(backgroundLocationTokens.userId, userId),
          eq(backgroundLocationTokens.sessionId, sessionId)
        )
      );
  }
}