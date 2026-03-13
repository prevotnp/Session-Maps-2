import { 
  User, InsertUser, 
  DroneImage, InsertDroneImage,
  DroneModel, InsertDroneModel,
  Location, InsertLocation,
  OfflineMapArea, InsertOfflineMapArea,
  Waypoint, InsertWaypoint,
  WaypointShare, InsertWaypointShare,
  MapDrawing, InsertMapDrawing,
  LocationShare, InsertLocationShare,
  UserLocation, InsertUserLocation,
  Route, InsertRoute,
  RouteShare, InsertRouteShare,
  RoutePointOfInterest, InsertRoutePointOfInterest,
  RouteNote, InsertRouteNote,
  Trip, InsertTrip,
  CalendarEvent, InsertCalendarEvent,
  FriendRequest, InsertFriendRequest,
  Friendship, InsertFriendship,
  LiveMapSession, InsertLiveMapSession,
  LiveMapMember, InsertLiveMapMember,
  LiveMapPoi, InsertLiveMapPoi,
  LiveMapRoute, InsertLiveMapRoute,
  LiveMapMessage, InsertLiveMapMessage,
  LiveMapInvite, InsertLiveMapInvite,
  DeviceToken, InsertDeviceToken,
  PasswordResetToken,
  BackgroundLocationToken,
  Activity, InsertActivity,
  Cesium3dTileset, InsertCesium3dTileset,
  DirectMessage, InsertDirectMessage
} from "@shared/schema";

// Modify the interface with any CRUD methods
// you might need
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: InsertUser): Promise<User>;
  updateUserSubscription(userId: number, isSubscribed: boolean, expiryDate?: Date): Promise<User | undefined>;
  setUserAdmin(userId: number, isAdmin: boolean): Promise<User | undefined>;
  getAdminUsers(): Promise<User[]>;
  
  // Drone image operations
  createDroneImage(droneImage: InsertDroneImage): Promise<DroneImage>;
  getDroneImage(id: number): Promise<DroneImage | undefined>;
  getDroneImagesByUser(userId: number): Promise<DroneImage[]>;
  getPublicDroneImages(): Promise<DroneImage[]>;
  setDroneImageActive(id: number, isActive: boolean): Promise<DroneImage | undefined>;
  updateDroneImage(id: number, updateData: Partial<DroneImage>): Promise<DroneImage | undefined>;
  deleteDroneImage(id: number): Promise<boolean>;
  
  // 3D Drone model operations
  createDroneModel(model: InsertDroneModel): Promise<DroneModel>;
  getDroneModel(id: number): Promise<DroneModel | undefined>;
  getDroneModelByDroneImageId(droneImageId: number): Promise<DroneModel | undefined>;
  updateDroneModel(id: number, updateData: Partial<DroneModel>): Promise<DroneModel | undefined>;
  deleteDroneModel(id: number): Promise<boolean>;
  
  // Cesium 3D Tileset operations
  createCesium3dTileset(tileset: InsertCesium3dTileset): Promise<Cesium3dTileset>;
  getCesium3dTileset(id: number): Promise<Cesium3dTileset | undefined>;
  getCesium3dTilesetsByUser(userId: number): Promise<Cesium3dTileset[]>;
  getCesium3dTilesetByDroneImageId(droneImageId: number): Promise<Cesium3dTileset | undefined>;
  deleteCesium3dTileset(id: number): Promise<boolean>;
  
  // Location operations
  createLocation(location: InsertLocation): Promise<Location>;
  getLocation(id: number): Promise<Location | undefined>;
  getLocationsByUser(userId: number): Promise<Location[]>;
  
  // Offline map areas operations
  createOfflineMapArea(offlineMapArea: InsertOfflineMapArea): Promise<OfflineMapArea>;
  getOfflineMapArea(id: number): Promise<OfflineMapArea | undefined>;
  getOfflineMapAreasByUser(userId: number): Promise<OfflineMapArea[]>;
  deleteOfflineMapArea(id: number): Promise<boolean>;
  
  // Waypoint operations
  createWaypoint(waypoint: InsertWaypoint): Promise<Waypoint>;
  getWaypoint(id: number): Promise<Waypoint | undefined>;
  getWaypointsByUser(userId: number): Promise<Waypoint[]>;
  getSharedWaypoints(userId: number): Promise<Waypoint[]>;
  updateWaypoint(id: number, updateData: Partial<Waypoint>): Promise<Waypoint | undefined>;
  deleteWaypoint(id: number): Promise<boolean>;
  shareWaypoint(share: InsertWaypointShare): Promise<WaypointShare>;
  unshareWaypoint(waypointId: number, sharedWithUserId: number): Promise<boolean>;
  getWaypointShares(waypointId: number): Promise<WaypointShare[]>;
  
  // User map drawings operations
  createMapDrawing(drawing: InsertMapDrawing): Promise<MapDrawing>;
  getMapDrawing(id: number): Promise<MapDrawing | undefined>;
  getMapDrawingsByUser(userId: number): Promise<MapDrawing[]>;
  updateMapDrawing(id: number, updateData: Partial<MapDrawing>): Promise<MapDrawing | undefined>;
  deleteMapDrawing(id: number): Promise<boolean>;
  
  // Location sharing operations
  createLocationShare(share: InsertLocationShare): Promise<LocationShare>;
  getLocationShare(id: number): Promise<LocationShare | undefined>;
  getLocationSharesByUser(userId: number): Promise<LocationShare[]>;
  getPendingLocationShares(userId: number): Promise<LocationShare[]>;
  updateLocationShareStatus(id: number, status: string, respondedAt?: Date): Promise<LocationShare | undefined>;
  deleteLocationShare(id: number): Promise<boolean>;
  findLocationShareByUsers(fromUserId: number, toUserId: number): Promise<LocationShare | undefined>;
  
  // User location operations
  upsertUserLocation(location: InsertUserLocation): Promise<UserLocation>;
  getUserLocation(userId: number): Promise<UserLocation | undefined>;
  
  // Route operations
  createRoute(route: InsertRoute): Promise<Route>;
  getRoute(id: number): Promise<Route | undefined>;
  getRoutesByUser(userId: number): Promise<Route[]>;
  getPublicRoutes(): Promise<Route[]>;
  getPublicRoutesWithOwners(): Promise<(Route & { owner: { id: number; username: string; fullName: string | null } })[]>;
  getUserPublicRoutes(userId: number): Promise<Route[]>;
  getRoutesSharedWithUser(userId: number): Promise<Route[]>;
  updateRoute(id: number, updateData: Partial<Route>): Promise<Route | undefined>;
  deleteRoute(id: number): Promise<boolean>;
  
  // Route sharing operations
  shareRoute(share: InsertRouteShare): Promise<RouteShare>;
  getRouteShares(routeId: number): Promise<(RouteShare & { sharedWith: User })[]>;
  revokeRouteShare(shareId: number): Promise<boolean>;
  isRouteSharedWithUser(routeId: number, userId: number): Promise<boolean>;
  
  // Route Notes operations
  createRouteNote(note: InsertRouteNote): Promise<RouteNote>;
  getRouteNotes(routeId: number): Promise<RouteNote[]>;
  getRouteNote(id: number): Promise<RouteNote | undefined>;
  updateRouteNote(id: number, updateData: Partial<RouteNote>): Promise<RouteNote | undefined>;
  deleteRouteNote(id: number): Promise<boolean>;
  
  // Route Points of Interest operations
  createRoutePointOfInterest(poi: InsertRoutePointOfInterest): Promise<RoutePointOfInterest>;
  getRoutePointsOfInterest(routeId: number): Promise<RoutePointOfInterest[]>;
  getRoutePointOfInterest(id: number): Promise<RoutePointOfInterest | undefined>;
  updateRoutePointOfInterest(id: number, updateData: Partial<RoutePointOfInterest>): Promise<RoutePointOfInterest | undefined>;
  deleteRoutePointOfInterest(id: number): Promise<boolean>;
  
  getSharedLocations(userId: number): Promise<(UserLocation & { user: User })[]>;
  deleteUserLocation(userId: number): Promise<boolean>;
  
  // Trip operations
  createTrip(trip: InsertTrip): Promise<Trip>;
  getTrip(id: number): Promise<Trip | undefined>;
  getTripsByUser(userId: number): Promise<Trip[]>;
  updateTrip(id: number, updateData: Partial<Trip>): Promise<Trip | undefined>;
  deleteTrip(id: number): Promise<boolean>;
  
  // Calendar event operations
  createCalendarEvent(event: InsertCalendarEvent): Promise<CalendarEvent>;
  getCalendarEvent(id: number): Promise<CalendarEvent | undefined>;
  getCalendarEventsByTrip(tripId: number): Promise<CalendarEvent[]>;
  getCalendarEventsByUser(userId: number): Promise<CalendarEvent[]>;
  updateCalendarEvent(id: number, updateData: Partial<CalendarEvent>): Promise<CalendarEvent | undefined>;
  deleteCalendarEvent(id: number): Promise<boolean>;
  
  // Friend request operations
  createFriendRequest(request: InsertFriendRequest): Promise<FriendRequest>;
  getFriendRequest(id: number): Promise<FriendRequest | undefined>;
  getPendingFriendRequests(userId: number): Promise<(FriendRequest & { requester: User })[]>;
  getSentFriendRequests(userId: number): Promise<(FriendRequest & { receiver: User })[]>;
  updateFriendRequestStatus(id: number, status: string, respondedAt: Date): Promise<FriendRequest | undefined>;
  findFriendRequest(requesterId: number, receiverId: number): Promise<FriendRequest | undefined>;
  deleteFriendRequest(id: number): Promise<boolean>;
  
  // Friendship operations
  createFriendship(friendship: InsertFriendship): Promise<Friendship>;
  getFriendships(userId: number): Promise<(Friendship & { friend: User & { locationHidden?: boolean } })[]>;
  areFriends(userAId: number, userBId: number): Promise<boolean>;
  deleteFriendship(userId: number, friendId: number): Promise<boolean>;
  getFriendIdsForLocationBroadcast(userId: number): Promise<number[]>;
  toggleFriendLocationHidden(userId: number, friendId: number, hidden: boolean): Promise<boolean>;
  updateUserLocationSharing(userId: number, enabled: boolean): Promise<void>;
  
  // User search operations
  searchUsers(query: string, currentUserId: number): Promise<User[]>;
  
  // Profile operations
  getUserProfile(username: string, viewerId: number): Promise<{ user: User; routes: Route[]; activities: Activity[]; isFriend: boolean; isOwner: boolean; publicRouteCount: number; publicActivityCount: number } | undefined>;
  
  // Live Map Session operations
  createLiveMapSession(session: InsertLiveMapSession): Promise<LiveMapSession>;
  getLiveMapSession(id: number): Promise<LiveMapSession | undefined>;
  getLiveMapSessionByShareCode(shareCode: string): Promise<LiveMapSession | undefined>;
  getLiveMapSessionsByUser(userId: number): Promise<LiveMapSession[]>;
  updateLiveMapSession(id: number, updateData: Partial<LiveMapSession>): Promise<LiveMapSession | undefined>;
  deleteLiveMapSession(id: number): Promise<boolean>;
  
  // Live Map Member operations
  addLiveMapMember(member: InsertLiveMapMember): Promise<LiveMapMember>;
  getLiveMapMembers(sessionId: number): Promise<(LiveMapMember & { user: User })[]>;
  updateLiveMapMemberLocation(sessionId: number, userId: number, latitude: string, longitude: string, accuracy?: string, heading?: string): Promise<LiveMapMember | undefined>;
  removeLiveMapMember(sessionId: number, userId: number): Promise<boolean>;
  isLiveMapMember(sessionId: number, userId: number): Promise<boolean>;
  
  // Live Map POI operations
  createLiveMapPoi(poi: InsertLiveMapPoi): Promise<LiveMapPoi>;
  getLiveMapPois(sessionId: number): Promise<(LiveMapPoi & { createdByUser: User })[]>;
  deleteLiveMapPoi(id: number): Promise<boolean>;
  
  // Live Map Route operations
  createLiveMapRoute(route: InsertLiveMapRoute): Promise<LiveMapRoute>;
  getLiveMapRoutes(sessionId: number): Promise<(LiveMapRoute & { createdByUser: User })[]>;
  getLiveMapRoute(routeId: number): Promise<LiveMapRoute | undefined>;
  updateLiveMapRoute(routeId: number, data: { name?: string; pathCoordinates: string; totalDistance?: string }): Promise<LiveMapRoute | undefined>;
  deleteLiveMapRoute(id: number): Promise<boolean>;
  
  // Live Map Message operations
  createLiveMapMessage(message: InsertLiveMapMessage): Promise<LiveMapMessage>;
  getLiveMapMessages(sessionId: number, limit?: number): Promise<(LiveMapMessage & { user: User })[]>;
  
  // Live Map Invite operations
  createLiveMapInvite(invite: InsertLiveMapInvite): Promise<LiveMapInvite>;
  getLiveMapInvitesForUser(userId: number): Promise<(LiveMapInvite & { session: LiveMapSession; fromUser: User })[]>;
  updateLiveMapInviteStatus(inviteId: number, status: string): Promise<LiveMapInvite | undefined>;
  getPendingInviteForSession(sessionId: number, toUserId: number): Promise<LiveMapInvite | undefined>;
  
  // Device token operations (for push notifications)
  registerDeviceToken(token: InsertDeviceToken): Promise<DeviceToken>;
  getDeviceTokensByUser(userId: number): Promise<DeviceToken[]>;
  getActiveDeviceTokensByUser(userId: number): Promise<DeviceToken[]>;
  deactivateDeviceToken(token: string): Promise<boolean>;
  deleteDeviceToken(token: string): Promise<boolean>;
  
  // Password reset operations
  createPasswordResetToken(userId: number, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(id: number): Promise<boolean>;
  updateUserPassword(userId: number, hashedPassword: string): Promise<User | undefined>;
  
  // Activity operations
  createActivity(activity: InsertActivity): Promise<Activity>;
  getActivity(id: number): Promise<Activity | undefined>;
  getActivitiesByUser(userId: number): Promise<Activity[]>;
  updateActivity(id: number, updates: Partial<InsertActivity>): Promise<Activity | undefined>;
  deleteActivity(id: number): Promise<boolean>;
  getPublicActivities(): Promise<Activity[]>;

  sendDirectMessage(data: InsertDirectMessage): Promise<DirectMessage>;
  getConversationMessages(userAId: number, userBId: number, limit?: number, before?: number): Promise<DirectMessage[]>;
  markMessagesAsRead(readerId: number, senderId: number): Promise<void>;
  getConversationList(userId: number): Promise<Array<{
    otherUser: { id: number; username: string; fullName: string | null };
    lastMessage: { id: number; body: string; senderId: number; createdAt: Date | null };
    unreadCount: number;
  }>>;
  deleteDirectMessage(messageId: number, userId: number): Promise<boolean>;
  getUnreadMessageCount(userId: number): Promise<number>;

  // Background location tokens
  createBackgroundLocationToken(userId: number, sessionId: number, token: string, expiresAt: Date): Promise<BackgroundLocationToken>;
  getBackgroundLocationToken(token: string): Promise<BackgroundLocationToken | undefined>;
  deleteBackgroundLocationTokensForSession(userId: number, sessionId: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private droneImages: Map<number, DroneImage>;
  private locations: Map<number, Location>;
  private offlineMapAreas: Map<number, OfflineMapArea>;
  private mapDrawings: Map<number, MapDrawing>;
  private userId: number;
  private droneImageId: number;
  private locationId: number;
  private offlineMapAreaId: number;
  private mapDrawingId: number;

  constructor() {
    this.users = new Map();
    this.droneImages = new Map();
    this.locations = new Map();
    this.offlineMapAreas = new Map();
    this.mapDrawings = new Map();
    this.userId = 1;
    this.droneImageId = 1;
    this.locationId = 1;
    this.offlineMapAreaId = 1;
    this.mapDrawingId = 1;
    
    // Add some initial demo data
    this.createUser({
      username: 'demo',
      password: 'password',
      email: 'demo@example.com',
      fullName: 'Demo User'
    }).then(user => {
      // Set first user as admin for demo purposes
      this.setUserAdmin(user.id, true);
    });
    
    // Sample drone images
    this.createDroneImage({
      name: 'River Rapids Section',
      description: 'High-resolution drone capture of river rapids through forest',
      filePath: '/drone-images/river-rapids.p4m',
      capturedAt: new Date('2023-05-12'),
      userId: 1,
      isPublic: true,
      northEastLat: 46.9,
      northEastLng: -121.7,
      southWestLat: 46.8,
      southWestLng: -121.8,
      sizeInMB: 178,
      isActive: true
    });
    
    this.createDroneImage({
      name: 'East Ridge Summit',
      description: 'Aerial view of mountain peak and surrounding terrain',
      filePath: '/drone-images/east-ridge.p4m',
      capturedAt: new Date('2023-04-28'),
      userId: 1,
      isPublic: true,
      northEastLat: 47.0,
      northEastLng: -121.6,
      southWestLat: 46.9,
      southWestLng: -121.7,
      sizeInMB: 243,
      isActive: false
    });
    
    this.createDroneImage({
      name: 'Valley Meadows',
      description: 'Aerial view of scenic valley with meadows',
      filePath: '/drone-images/valley-meadows.p4m',
      capturedAt: new Date('2023-03-15'),
      userId: 1,
      isPublic: true,
      northEastLat: 46.7,
      northEastLng: -121.5,
      southWestLat: 46.6,
      southWestLng: -121.6,
      sizeInMB: 195,
      isActive: false
    });
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userId++;
    const now = new Date();
    const user: User = { 
      ...insertUser, 
      id, 
      isSubscribed: false,
      subscriptionExpiry: undefined,
      createdAt: now
    };
    this.users.set(id, user);
    return user;
  }
  
  async updateUserSubscription(userId: number, isSubscribed: boolean, expiryDate?: Date): Promise<User | undefined> {
    const user = await this.getUser(userId);
    if (!user) return undefined;
    
    const updatedUser: User = {
      ...user,
      isSubscribed,
      subscriptionExpiry: expiryDate
    };
    
    this.users.set(userId, updatedUser);
    return updatedUser;
  }
  
  // Drone image operations
  async createDroneImage(droneImage: InsertDroneImage): Promise<DroneImage> {
    const id = this.droneImageId++;
    const now = new Date();
    const newDroneImage: DroneImage = {
      ...droneImage,
      id,
      uploadedAt: now
    };
    this.droneImages.set(id, newDroneImage);
    return newDroneImage;
  }
  
  async getDroneImage(id: number): Promise<DroneImage | undefined> {
    return this.droneImages.get(id);
  }
  
  async getDroneImagesByUser(userId: number): Promise<DroneImage[]> {
    return Array.from(this.droneImages.values()).filter(
      (image) => image.userId === userId
    );
  }
  
  async getPublicDroneImages(): Promise<DroneImage[]> {
    return Array.from(this.droneImages.values()).filter(
      (image) => image.isPublic
    );
  }
  
  async setDroneImageActive(id: number, isActive: boolean): Promise<DroneImage | undefined> {
    const droneImage = await this.getDroneImage(id);
    if (!droneImage) return undefined;
    
    // Deactivate all other drone images first if setting this one to active
    if (isActive) {
      for (const [imageId, image] of this.droneImages.entries()) {
        if (image.isActive) {
          this.droneImages.set(imageId, { ...image, isActive: false });
        }
      }
    }
    
    const updatedDroneImage: DroneImage = {
      ...droneImage,
      isActive
    };
    
    this.droneImages.set(id, updatedDroneImage);
    return updatedDroneImage;
  }
  
  // Location operations
  async createLocation(location: InsertLocation): Promise<Location> {
    const id = this.locationId++;
    const now = new Date();
    const newLocation: Location = {
      ...location,
      id,
      createdAt: now
    };
    this.locations.set(id, newLocation);
    return newLocation;
  }
  
  async getLocation(id: number): Promise<Location | undefined> {
    return this.locations.get(id);
  }
  
  async getLocationsByUser(userId: number): Promise<Location[]> {
    return Array.from(this.locations.values()).filter(
      (location) => location.userId === userId
    );
  }
  
  // Offline map areas operations
  async createOfflineMapArea(offlineMapArea: InsertOfflineMapArea): Promise<OfflineMapArea> {
    const id = this.offlineMapAreaId++;
    const now = new Date();
    const newOfflineMapArea: OfflineMapArea = {
      ...offlineMapArea,
      id,
      downloadedAt: now
    };
    this.offlineMapAreas.set(id, newOfflineMapArea);
    return newOfflineMapArea;
  }
  
  async getOfflineMapArea(id: number): Promise<OfflineMapArea | undefined> {
    return this.offlineMapAreas.get(id);
  }
  
  async getOfflineMapAreasByUser(userId: number): Promise<OfflineMapArea[]> {
    return Array.from(this.offlineMapAreas.values()).filter(
      (area) => area.userId === userId
    );
  }
  
  async deleteOfflineMapArea(id: number): Promise<boolean> {
    return this.offlineMapAreas.delete(id);
  }
  
  // Map Drawing operations
  async createMapDrawing(drawing: InsertMapDrawing): Promise<MapDrawing> {
    const id = this.mapDrawingId++;
    const now = new Date();
    const newMapDrawing: MapDrawing = {
      ...drawing,
      id,
      createdAt: now,
      updatedAt: now
    };
    this.mapDrawings.set(id, newMapDrawing);
    return newMapDrawing;
  }
  
  async getMapDrawing(id: number): Promise<MapDrawing | undefined> {
    return this.mapDrawings.get(id);
  }
  
  async getMapDrawingsByUser(userId: number): Promise<MapDrawing[]> {
    return Array.from(this.mapDrawings.values()).filter(
      (drawing) => drawing.userId === userId
    );
  }
  
  async updateMapDrawing(id: number, updateData: Partial<MapDrawing>): Promise<MapDrawing | undefined> {
    const drawing = await this.getMapDrawing(id);
    if (!drawing) return undefined;
    
    const updatedDrawing: MapDrawing = {
      ...drawing,
      ...updateData,
      updatedAt: new Date()
    };
    this.mapDrawings.set(id, updatedDrawing);
    return updatedDrawing;
  }
  
  async deleteMapDrawing(id: number): Promise<boolean> {
    return this.mapDrawings.delete(id);
  }
  
  // Admin methods
  async setUserAdmin(userId: number, isAdmin: boolean): Promise<User | undefined> {
    const user = await this.getUser(userId);
    if (!user) return undefined;
    
    const updatedUser: User = { ...user, isAdmin };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }
  
  async getAdminUsers(): Promise<User[]> {
    return Array.from(this.users.values()).filter(user => user.isAdmin === true);
  }
  
  // Additional drone image methods
  async updateDroneImage(id: number, updateData: Partial<DroneImage>): Promise<DroneImage | undefined> {
    const droneImage = await this.getDroneImage(id);
    if (!droneImage) return undefined;
    
    const updatedDroneImage: DroneImage = {
      ...droneImage,
      ...updateData,
    };
    this.droneImages.set(id, updatedDroneImage);
    return updatedDroneImage;
  }
  
  async deleteDroneImage(id: number): Promise<boolean> {
    return this.droneImages.delete(id);
  }

  // Cesium 3D Tileset operations (in-memory stubs)
  private cesium3dTilesets: Map<number, Cesium3dTileset> = new Map();
  private cesium3dTilesetId: number = 1;

  async createCesium3dTileset(tileset: InsertCesium3dTileset): Promise<Cesium3dTileset> {
    const id = this.cesium3dTilesetId++;
    const newTileset: Cesium3dTileset = {
      ...tileset,
      id,
      droneImageId: tileset.droneImageId ?? null,
      centerAlt: tileset.centerAlt ?? null,
      boundingVolume: tileset.boundingVolume ?? null,
      uploadedAt: new Date(),
    };
    this.cesium3dTilesets.set(id, newTileset);
    return newTileset;
  }

  async getCesium3dTileset(id: number): Promise<Cesium3dTileset | undefined> {
    return this.cesium3dTilesets.get(id);
  }

  async getCesium3dTilesetsByUser(userId: number): Promise<Cesium3dTileset[]> {
    return Array.from(this.cesium3dTilesets.values()).filter(
      (tileset) => tileset.userId === userId
    );
  }

  async getCesium3dTilesetByDroneImageId(droneImageId: number): Promise<Cesium3dTileset | undefined> {
    return Array.from(this.cesium3dTilesets.values()).find(
      (tileset) => tileset.droneImageId === droneImageId
    );
  }

  async deleteCesium3dTileset(id: number): Promise<boolean> {
    return this.cesium3dTilesets.delete(id);
  }

  async createBackgroundLocationToken(userId: number, sessionId: number, token: string, expiresAt: Date): Promise<BackgroundLocationToken> {
    throw new Error("Not implemented in MemStorage");
  }

  async getBackgroundLocationToken(token: string): Promise<BackgroundLocationToken | undefined> {
    return undefined;
  }

  async deleteBackgroundLocationTokensForSession(userId: number, sessionId: number): Promise<void> {
    // no-op
  }
}

import { DatabaseStorage } from "./databaseStorage";

export const storage = new DatabaseStorage();
