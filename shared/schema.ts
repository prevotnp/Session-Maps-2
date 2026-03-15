import { pgTable, text, serial, integer, boolean, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  isAdmin: boolean("is_admin").default(false),
  isSubscribed: boolean("is_subscribed").default(false),
  subscriptionExpiry: timestamp("subscription_expiry"),
  locationSharingEnabled: boolean("location_sharing_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Drone images table
export const droneImages = pgTable("drone_images", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  filePath: text("file_path").notNull(),
  capturedAt: timestamp("captured_at").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  userId: integer("user_id").notNull().references(() => users.id),
  isPublic: boolean("is_public").default(false),
  password: text("password"),
  northEastLat: decimal("ne_lat").notNull(),
  northEastLng: decimal("ne_lng").notNull(),
  southWestLat: decimal("sw_lat").notNull(),
  southWestLng: decimal("sw_lng").notNull(),
  cornerCoordinates: text("corner_coordinates"),
  sizeInMB: integer("size_in_mb").notNull(),
  isActive: boolean("is_active").default(false),
  hasTiles: boolean("has_tiles").default(false),
  tileMinZoom: integer("tile_min_zoom"),
  tileMaxZoom: integer("tile_max_zoom"),
  tileStoragePath: text("tile_storage_path"),
  processingStatus: text("processing_status").default("pending"),
});

// 3D Drone models table (linked to drone images)
export const droneModels = pgTable("drone_models", {
  id: serial("id").primaryKey(),
  droneImageId: integer("drone_image_id").notNull().references(() => droneImages.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  fileType: text("file_type").notNull(), // 'glb', 'gltf', 'obj', 'ply'
  mtlFilePath: text("mtl_file_path"), // Material file for OBJ models
  textureFiles: text("texture_files"), // JSON array of texture file paths
  sizeInMB: integer("size_in_mb").notNull(),
  // GPS anchor point for the model
  centerLat: decimal("center_lat", { precision: 10, scale: 6 }).notNull(),
  centerLng: decimal("center_lng", { precision: 10, scale: 6 }).notNull(),
  altitude: decimal("altitude", { precision: 10, scale: 2 }),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  userId: integer("user_id").notNull().references(() => users.id),
});

// Cesium 3D Tilesets (linked to drone images)
export const cesium3dTilesets = pgTable("cesium_3d_tilesets", {
  id: serial("id").primaryKey(),
  droneImageId: integer("drone_image_id").references(() => droneImages.id, { onDelete: 'set null' }),
  name: text("name").notNull(),
  storagePath: text("storage_path").notNull(), // Path in Object Storage where tileset.json and tiles are stored
  tilesetJsonUrl: text("tileset_json_url").notNull(), // URL to serve tileset.json
  sizeInMB: integer("size_in_mb").notNull(),
  centerLat: decimal("center_lat", { precision: 10, scale: 6 }).notNull(),
  centerLng: decimal("center_lng", { precision: 10, scale: 6 }).notNull(),
  centerAlt: decimal("center_alt", { precision: 10, scale: 2 }),
  boundingVolume: text("bounding_volume"), // JSON string of bounding volume
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  userId: integer("user_id").notNull().references(() => users.id),
});

// Saved locations
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  elevation: decimal("elevation", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Offline map areas
export const offlineMapAreas = pgTable("offline_map_areas", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  // Map bounds
  northEastLat: decimal("ne_lat").notNull(),
  northEastLng: decimal("ne_lng").notNull(),
  southWestLat: decimal("sw_lat").notNull(),
  southWestLng: decimal("sw_lng").notNull(),
  includesDroneData: boolean("includes_drone_data").default(true),
  sizeInMB: integer("size_in_mb").notNull(),
  downloadedAt: timestamp("downloaded_at").defaultNow(),
});

// Waypoint pins
export const waypoints = pgTable("waypoints", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  elevation: decimal("elevation", { precision: 10, scale: 2 }),
  isShared: boolean("is_shared").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Waypoint sharing permissions
export const waypointShares = pgTable("waypoint_shares", {
  id: serial("id").primaryKey(),
  waypointId: integer("waypoint_id").notNull().references(() => waypoints.id),
  sharedWithUserId: integer("shared_with_user_id").notNull().references(() => users.id),
  permission: text("permission").notNull().default("view"), // 'view' or 'edit'
  sharedAt: timestamp("shared_at").defaultNow(),
});

// User Map Drawings
export const mapDrawings = pgTable("map_drawings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'waypoint', 'line', 'polygon', 'measurement'
  coordinates: text("coordinates").notNull(), // JSON string of coordinates
  properties: text("properties"), // JSON string of additional properties (color, etc)
  measurementValue: decimal("measurement_value"), // For distance or area measurements
  measurementUnit: text("measurement_unit"), // 'meters', 'kilometers', 'miles', etc
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Saved routes with multiple waypoints
export const routes = pgTable("routes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  notes: text("notes"), // Additional notes/comments for the route
  photos: text("photos"), // JSON array of photo file paths
  waypointIds: text("waypoint_ids").notNull(), // JSON array of waypoint IDs in order
  pathCoordinates: text("path_coordinates").notNull(), // JSON array of optimized path coordinates
  waypointCoordinates: text("waypoint_coordinates"), // JSON array of original user-placed waypoints with names/elevations
  totalDistance: decimal("total_distance", { precision: 10, scale: 2 }), // in meters
  elevationGain: decimal("elevation_gain", { precision: 10, scale: 2 }), // in meters
  elevationLoss: decimal("elevation_loss", { precision: 10, scale: 2 }), // in meters
  estimatedTime: integer("estimated_time"), // in minutes
  routingMode: text("routing_mode").notNull().default("direct"), // 'direct', 'road', or 'trail' (legacy: 'rivers' treated as 'trail')
  activityType: text("activity_type").default("hiking"), // 'hiking', 'skiing', 'river', 'cycling', 'running'
  cesiumTilesetId: integer("cesium_tileset_id").references(() => cesium3dTilesets.id, { onDelete: 'set null' }),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Route notes with categories
export const routeNotes = pgTable("route_notes", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routes.id, { onDelete: 'cascade' }),
  category: text("category").notNull(),
  content: text("content").default(''),
  position: integer("position").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Route sharing permissions
export const routeShares = pgTable("route_shares", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routes.id),
  sharedWithUserId: integer("shared_with_user_id").notNull().references(() => users.id),
  sharedByUserId: integer("shared_by_user_id").notNull().references(() => users.id),
  sharedAt: timestamp("shared_at").defaultNow(),
});

// Route Points of Interest (standalone pins on routes)
export const routePointsOfInterest = pgTable("route_points_of_interest", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routes.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  elevation: decimal("elevation", { precision: 10, scale: 2 }),
  note: text("note"),
  photos: text("photos"), // JSON array of photo file paths
  createdAt: timestamp("created_at").defaultNow(),
});

// Location sharing requests and connections
export const locationShares = pgTable("location_shares", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id").notNull().references(() => users.id),
  toUserId: integer("to_user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // pending, accepted, rejected
  requestedAt: timestamp("requested_at").defaultNow(),
  respondedAt: timestamp("responded_at"),
  expiresAt: timestamp("expires_at"), // Optional expiration for shares
  createdAt: timestamp("created_at").defaultNow(),
});

// Real-time location updates
export const userLocations = pgTable("user_locations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  latitude: decimal("latitude", { precision: 10, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  accuracy: decimal("accuracy", { precision: 10, scale: 2 }),
  heading: decimal("heading", { precision: 5, scale: 2 }),
  speed: decimal("speed", { precision: 8, scale: 3 }),
  lastUpdated: timestamp("last_updated").defaultNow(),
  isActive: boolean("is_active").default(true),
});

// Trips table for organizing calendar events
export const trips = pgTable("trips", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  destination: text("destination"),
  latitude: decimal("latitude", { precision: 10, scale: 6 }),
  longitude: decimal("longitude", { precision: 10, scale: 6 }),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Calendar events for trips
export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  tripId: integer("trip_id").notNull().references(() => trips.id),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  location: text("location"),
  latitude: decimal("latitude", { precision: 10, scale: 6 }),
  longitude: decimal("longitude", { precision: 10, scale: 6 }),
  eventType: text("event_type").notNull().default("activity"), // activity, accommodation, transport, meal, meeting
  priority: integer("priority").default(1), // 1=low, 2=medium, 3=high
  reminderMinutes: integer("reminder_minutes").default(15),
  isCompleted: boolean("is_completed").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Friend requests
export const friendRequests = pgTable("friend_requests", {
  id: serial("id").primaryKey(),
  requesterId: integer("requester_id").notNull().references(() => users.id),
  receiverId: integer("receiver_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // pending, accepted, declined
  createdAt: timestamp("created_at").defaultNow(),
  respondedAt: timestamp("responded_at"),
});

// Friendships (accepted friend relationships)
export const friendships = pgTable("friendships", {
  id: serial("id").primaryKey(),
  userAId: integer("user_a_id").notNull().references(() => users.id),
  userBId: integer("user_b_id").notNull().references(() => users.id),
  locationHiddenByA: boolean("location_hidden_by_a").default(false),
  locationHiddenByB: boolean("location_hidden_by_b").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Live Shared Map Sessions
export const liveMapSessions = pgTable("live_map_sessions", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  shareCode: text("share_code").notNull().unique(), // Unique code for joining
  isActive: boolean("is_active").default(true),
  activeDroneLayers: text("active_drone_layers"), // JSON array of active drone image IDs
  createdAt: timestamp("created_at").defaultNow(),
  endedAt: timestamp("ended_at"), // When session was ended
  savedRouteId: integer("saved_route_id"), // Reference to the saved route when session ends
  expiresAt: timestamp("expires_at"), // Optional expiration
});

// Live Map Session Members
export const liveMapMembers = pgTable("live_map_members", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id),
  role: text("role").notNull().default("participant"), // 'owner' or 'participant'
  latitude: decimal("latitude", { precision: 10, scale: 6 }),
  longitude: decimal("longitude", { precision: 10, scale: 6 }),
  accuracy: decimal("accuracy", { precision: 10, scale: 2 }),
  heading: decimal("heading", { precision: 5, scale: 2 }),
  lastActive: timestamp("last_active").defaultNow(),
  joinedAt: timestamp("joined_at").defaultNow(),
  leftAt: timestamp("left_at"),
});

// Live Map Points of Interest
export const liveMapPois = pgTable("live_map_pois", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  createdBy: integer("created_by").notNull().references(() => users.id),
  name: text("name").notNull(),
  note: text("note"),
  latitude: decimal("latitude", { precision: 10, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Live Map Routes
export const liveMapRoutes = pgTable("live_map_routes", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  createdBy: integer("created_by").notNull().references(() => users.id),
  name: text("name").notNull(),
  pathCoordinates: text("path_coordinates").notNull(), // JSON array of coordinates
  totalDistance: decimal("total_distance", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Live Map Chat Messages
export const liveMapMessages = pgTable("live_map_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  messageType: text("message_type").notNull().default("text"), // 'text' or 'system'
  createdAt: timestamp("created_at").defaultNow(),
});

// Voice Messages - push-to-talk radio messages for live map sessions
export const voiceMessages = pgTable("voice_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id),
  audioData: text("audio_data").notNull(),
  mimeType: text("mime_type").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Live Map Invites - in-app notifications for live map invitations
export const liveMapInvites = pgTable("live_map_invites", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  fromUserId: integer("from_user_id").notNull().references(() => users.id),
  toUserId: integer("to_user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // pending, accepted, declined
  createdAt: timestamp("created_at").defaultNow(),
});

// Live Map GPS Tracks - records each member's GPS path during session
export const liveMapGpsTracks = pgTable("live_map_gps_tracks", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id),
  coordinates: text("coordinates").notNull(), // JSON array of [lng, lat, timestamp] points
  totalDistance: decimal("total_distance", { precision: 10, scale: 2 }),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
});

// Background location tokens - for native apps to POST location updates from background
export const backgroundLocationTokens = pgTable("background_location_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: integer("session_id").notNull().references(() => liveMapSessions.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Recorded activities (GPS-tracked runs, hikes, bikes, skis)
export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  activityType: text("activity_type").notNull(), // 'run', 'ski', 'hike', 'bike'
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  elapsedTimeSeconds: integer("elapsed_time_seconds").notNull(),
  movingTimeSeconds: integer("moving_time_seconds"),
  distanceMeters: decimal("distance_meters", { precision: 12, scale: 2 }).notNull(),
  avgSpeedMps: decimal("avg_speed_mps", { precision: 8, scale: 4 }), // meters per second
  maxSpeedMps: decimal("max_speed_mps", { precision: 8, scale: 4 }),
  paceSecondsPerMile: integer("pace_seconds_per_mile"),
  elevationGainMeters: decimal("elevation_gain_meters", { precision: 10, scale: 2 }),
  elevationLossMeters: decimal("elevation_loss_meters", { precision: 10, scale: 2 }),
  minElevationMeters: decimal("min_elevation_meters", { precision: 10, scale: 2 }),
  maxElevationMeters: decimal("max_elevation_meters", { precision: 10, scale: 2 }),
  pathCoordinates: text("path_coordinates").notNull(), // GeoJSON LineString coordinates [[lng, lat], ...]
  trackPoints: text("track_points"), // JSON array of detailed track points with timestamp, accuracy, etc.
  isPublic: boolean("is_public").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const directMessages = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  receiverId: integer("receiver_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text("body").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  id: true,
  username: true,
  password: true,
  email: true,
  fullName: true,
  isSubscribed: true,
  subscriptionExpiry: true,
  isAdmin: true
}).partial({ id: true });

export const insertDroneImageSchema = createInsertSchema(droneImages).pick({
  name: true,
  description: true,
  filePath: true,
  capturedAt: true,
  userId: true,
  isPublic: true,
  password: true,
  northEastLat: true,
  northEastLng: true,
  southWestLat: true,
  southWestLng: true,
  sizeInMB: true,
  isActive: true,
});

export const insertDroneModelSchema = createInsertSchema(droneModels).pick({
  droneImageId: true,
  name: true,
  filePath: true,
  fileType: true,
  mtlFilePath: true,
  textureFiles: true,
  sizeInMB: true,
  centerLat: true,
  centerLng: true,
  altitude: true,
  userId: true,
});

export const insertCesium3dTilesetSchema = createInsertSchema(cesium3dTilesets).pick({
  droneImageId: true,
  name: true,
  storagePath: true,
  tilesetJsonUrl: true,
  sizeInMB: true,
  centerLat: true,
  centerLng: true,
  centerAlt: true,
  boundingVolume: true,
  userId: true,
});

export const insertLocationSchema = createInsertSchema(locations).pick({
  userId: true,
  name: true,
  latitude: true,
  longitude: true,
  elevation: true,
});

export const insertOfflineMapAreaSchema = createInsertSchema(offlineMapAreas).pick({
  userId: true,
  name: true,
  northEastLat: true,
  northEastLng: true,
  southWestLat: true,
  southWestLng: true,
  includesDroneData: true,
  sizeInMB: true,
});

export const insertWaypointSchema = createInsertSchema(waypoints).pick({
  userId: true,
  name: true,
  latitude: true,
  longitude: true,
  elevation: true,
  isShared: true,
});

export const insertWaypointShareSchema = createInsertSchema(waypointShares).pick({
  waypointId: true,
  sharedWithUserId: true,
  permission: true,
});

export const insertMapDrawingSchema = createInsertSchema(mapDrawings).pick({
  userId: true,
  name: true,
  type: true,
  coordinates: true,
  properties: true,
  measurementValue: true,
  measurementUnit: true,
});

export const insertRouteSchema = createInsertSchema(routes).pick({
  userId: true,
  name: true,
  description: true,
  notes: true,
  waypointIds: true,
  pathCoordinates: true,
  waypointCoordinates: true,
  totalDistance: true,
  elevationGain: true,
  elevationLoss: true,
  estimatedTime: true,
  routingMode: true,
  cesiumTilesetId: true,
  isPublic: true,
}).extend({
  totalDistance: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
  elevationGain: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
  elevationLoss: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
});

export const insertRouteNoteSchema = createInsertSchema(routeNotes).pick({
  routeId: true,
  category: true,
  content: true,
  position: true,
});

export const insertRouteShareSchema = createInsertSchema(routeShares).pick({
  routeId: true,
  sharedWithUserId: true,
  sharedByUserId: true,
});

export const insertRoutePointOfInterestSchema = createInsertSchema(routePointsOfInterest).pick({
  routeId: true,
  name: true,
  latitude: true,
  longitude: true,
  elevation: true,
  note: true,
  photos: true,
});

export const insertLocationShareSchema = createInsertSchema(locationShares).pick({
  fromUserId: true,
  toUserId: true,
  status: true,
  expiresAt: true,
});

export const insertUserLocationSchema = createInsertSchema(userLocations).pick({
  userId: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  heading: true,
  speed: true,
  isActive: true,
});

export const insertTripSchema = createInsertSchema(trips).pick({
  userId: true,
  name: true,
  description: true,
  startDate: true,
  endDate: true,
  destination: true,
  latitude: true,
  longitude: true,
  isPublic: true,
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).pick({
  tripId: true,
  userId: true,
  title: true,
  description: true,
  startTime: true,
  endTime: true,
  location: true,
  latitude: true,
  longitude: true,
  eventType: true,
  priority: true,
  reminderMinutes: true,
  isCompleted: true,
  notes: true,
});

export const insertFriendRequestSchema = createInsertSchema(friendRequests).pick({
  requesterId: true,
  receiverId: true,
  status: true,
});

export const insertFriendshipSchema = createInsertSchema(friendships).pick({
  userAId: true,
  userBId: true,
});

export const insertLiveMapSessionSchema = createInsertSchema(liveMapSessions).pick({
  ownerId: true,
  name: true,
  shareCode: true,
  isActive: true,
  activeDroneLayers: true,
  expiresAt: true,
});

export const insertLiveMapMemberSchema = createInsertSchema(liveMapMembers).pick({
  sessionId: true,
  userId: true,
  role: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  heading: true,
});

export const insertLiveMapPoiSchema = createInsertSchema(liveMapPois).pick({
  sessionId: true,
  createdBy: true,
  name: true,
  note: true,
  latitude: true,
  longitude: true,
});

export const insertLiveMapRouteSchema = createInsertSchema(liveMapRoutes).pick({
  sessionId: true,
  createdBy: true,
  name: true,
  pathCoordinates: true,
  totalDistance: true,
}).extend({
  totalDistance: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
});

export const insertLiveMapMessageSchema = createInsertSchema(liveMapMessages).pick({
  sessionId: true,
  userId: true,
  body: true,
  messageType: true,
});

export const insertVoiceMessageSchema = createInsertSchema(voiceMessages).pick({
  sessionId: true,
  userId: true,
  audioData: true,
  mimeType: true,
  durationSeconds: true,
  expiresAt: true,
});

export const insertLiveMapInviteSchema = createInsertSchema(liveMapInvites).pick({
  sessionId: true,
  fromUserId: true,
  toUserId: true,
  status: true,
});

export const insertActivitySchema = createInsertSchema(activities).pick({
  userId: true,
  name: true,
  activityType: true,
  startTime: true,
  endTime: true,
  elapsedTimeSeconds: true,
  movingTimeSeconds: true,
  distanceMeters: true,
  avgSpeedMps: true,
  maxSpeedMps: true,
  paceSecondsPerMile: true,
  elevationGainMeters: true,
  elevationLossMeters: true,
  minElevationMeters: true,
  maxElevationMeters: true,
  pathCoordinates: true,
  trackPoints: true,
  isPublic: true,
  notes: true,
}).extend({
  startTime: z.union([z.string(), z.date()]).transform(val => typeof val === 'string' ? new Date(val) : val),
  endTime: z.union([z.string(), z.date()]).transform(val => typeof val === 'string' ? new Date(val) : val),
  distanceMeters: z.union([z.string(), z.number()]).transform(val => String(val)),
  avgSpeedMps: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
  maxSpeedMps: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
  elevationGainMeters: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
  elevationLossMeters: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
  minElevationMeters: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
  maxElevationMeters: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
});

export const insertLiveMapGpsTrackSchema = createInsertSchema(liveMapGpsTracks).pick({
  sessionId: true,
  userId: true,
  coordinates: true,
  totalDistance: true,
}).extend({
  totalDistance: z.union([z.string(), z.number()]).transform(val => String(val)).optional().nullable(),
});

// ============================================
// Enterprise System
// ============================================

// Enterprise organizations (businesses that get private maps)
export const enterprises = pgTable("enterprises", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoUrl: text("logo_url"),
  isActive: boolean("is_active").default(true),
  maxMembers: integer("max_members").default(50),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Enterprise members — links users to enterprises with roles
export const enterpriseMembers = pgTable("enterprise_members", {
  id: serial("id").primaryKey(),
  enterpriseId: integer("enterprise_id").notNull().references(() => enterprises.id, { onDelete: 'cascade' }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text("role").notNull().default("member"),
  invitedBy: integer("invited_by").references(() => users.id),
  status: text("status").notNull().default("pending"),
  joinedAt: timestamp("joined_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Enterprise drone images — junction table linking drone images to enterprises
export const enterpriseDroneImages = pgTable("enterprise_drone_images", {
  id: serial("id").primaryKey(),
  enterpriseId: integer("enterprise_id").notNull().references(() => enterprises.id, { onDelete: 'cascade' }),
  droneImageId: integer("drone_image_id").notNull().references(() => droneImages.id, { onDelete: 'cascade' }),
  addedBy: integer("added_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Enterprise Cesium 3D tilesets — junction table linking tilesets to enterprises
export const enterpriseCesiumTilesets = pgTable("enterprise_cesium_tilesets", {
  id: serial("id").primaryKey(),
  enterpriseId: integer("enterprise_id").notNull().references(() => enterprises.id, { onDelete: 'cascade' }),
  cesiumTilesetId: integer("cesium_tileset_id").notNull().references(() => cesium3dTilesets.id, { onDelete: 'cascade' }),
  addedBy: integer("added_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Enterprise invites — invite codes for joining
export const enterpriseInvites = pgTable("enterprise_invites", {
  id: serial("id").primaryKey(),
  enterpriseId: integer("enterprise_id").notNull().references(() => enterprises.id, { onDelete: 'cascade' }),
  inviteCode: text("invite_code").notNull().unique(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  maxUses: integer("max_uses").default(50),
  usedCount: integer("used_count").default(0),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Device tokens for push notifications
export const deviceTokens = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  platform: text("platform").notNull(), // 'ios', 'android', 'web'
  deviceName: text("device_name"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDirectMessageSchema = createInsertSchema(directMessages).pick({
  senderId: true,
  receiverId: true,
  body: true,
});

export const insertDeviceTokenSchema = createInsertSchema(deviceTokens).pick({
  userId: true,
  token: true,
  platform: true,
  deviceName: true,
});

// Auth schema
export const loginSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = insertUserSchema.extend({
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// Location sharing
export const locationShareSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number().optional(),
});

// Subscription schema
export const subscriptionSchema = z.object({
  userId: z.number(),
  planType: z.enum(["monthly", "yearly"]),
});

// Define types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertDroneImage = z.infer<typeof insertDroneImageSchema>;
export type DroneImage = typeof droneImages.$inferSelect;
export type InsertDroneModel = z.infer<typeof insertDroneModelSchema>;
export type DroneModel = typeof droneModels.$inferSelect;
export type InsertCesium3dTileset = z.infer<typeof insertCesium3dTilesetSchema>;
export type Cesium3dTileset = typeof cesium3dTilesets.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;
export type InsertOfflineMapArea = z.infer<typeof insertOfflineMapAreaSchema>;
export type OfflineMapArea = typeof offlineMapAreas.$inferSelect;
export type InsertWaypoint = z.infer<typeof insertWaypointSchema>;
export type Waypoint = typeof waypoints.$inferSelect;
export type InsertWaypointShare = z.infer<typeof insertWaypointShareSchema>;
export type WaypointShare = typeof waypointShares.$inferSelect;
export type InsertMapDrawing = z.infer<typeof insertMapDrawingSchema>;
export type MapDrawing = typeof mapDrawings.$inferSelect;
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routes.$inferSelect;
export type InsertRouteNote = z.infer<typeof insertRouteNoteSchema>;
export type RouteNote = typeof routeNotes.$inferSelect;
export type InsertRouteShare = z.infer<typeof insertRouteShareSchema>;
export type RouteShare = typeof routeShares.$inferSelect;
export type InsertRoutePointOfInterest = z.infer<typeof insertRoutePointOfInterestSchema>;
export type RoutePointOfInterest = typeof routePointsOfInterest.$inferSelect;
export type InsertLocationShare = z.infer<typeof insertLocationShareSchema>;
export type LocationShare = typeof locationShares.$inferSelect;
export type InsertUserLocation = z.infer<typeof insertUserLocationSchema>;
export type UserLocation = typeof userLocations.$inferSelect;
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof trips.$inferSelect;
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertFriendRequest = z.infer<typeof insertFriendRequestSchema>;
export type FriendRequest = typeof friendRequests.$inferSelect;
export type InsertFriendship = z.infer<typeof insertFriendshipSchema>;
export type Friendship = typeof friendships.$inferSelect;
export type InsertLiveMapSession = z.infer<typeof insertLiveMapSessionSchema>;
export type LiveMapSession = typeof liveMapSessions.$inferSelect;
export type InsertLiveMapMember = z.infer<typeof insertLiveMapMemberSchema>;
export type LiveMapMember = typeof liveMapMembers.$inferSelect;
export type InsertLiveMapPoi = z.infer<typeof insertLiveMapPoiSchema>;
export type LiveMapPoi = typeof liveMapPois.$inferSelect;
export type InsertLiveMapRoute = z.infer<typeof insertLiveMapRouteSchema>;
export type LiveMapRoute = typeof liveMapRoutes.$inferSelect;
export type InsertLiveMapMessage = z.infer<typeof insertLiveMapMessageSchema>;
export type LiveMapMessage = typeof liveMapMessages.$inferSelect;
export type InsertVoiceMessage = z.infer<typeof insertVoiceMessageSchema>;
export type VoiceMessage = typeof voiceMessages.$inferSelect;
export type InsertLiveMapInvite = z.infer<typeof insertLiveMapInviteSchema>;
export type LiveMapInvite = typeof liveMapInvites.$inferSelect;
export type InsertLiveMapGpsTrack = z.infer<typeof insertLiveMapGpsTrackSchema>;
export type LiveMapGpsTrack = typeof liveMapGpsTracks.$inferSelect;
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type BackgroundLocationToken = typeof backgroundLocationTokens.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;
export type InsertDirectMessage = z.infer<typeof insertDirectMessageSchema>;
export type DirectMessage = typeof directMessages.$inferSelect;
export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
export type LocationShareData = z.infer<typeof locationShareSchema>;
export type SubscriptionData = z.infer<typeof subscriptionSchema>;

// Password reset schemas
export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});
export type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
export type ResetPasswordData = z.infer<typeof resetPasswordSchema>;

// Enterprise insert schemas
export const insertEnterpriseSchema = createInsertSchema(enterprises).pick({
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  isActive: true,
  maxMembers: true,
  createdBy: true,
});

export const insertEnterpriseMemberSchema = createInsertSchema(enterpriseMembers).pick({
  enterpriseId: true,
  userId: true,
  role: true,
  invitedBy: true,
  status: true,
});

export const insertEnterpriseDroneImageSchema = createInsertSchema(enterpriseDroneImages).pick({
  enterpriseId: true,
  droneImageId: true,
  addedBy: true,
});

export const insertEnterpriseCesiumTilesetSchema = createInsertSchema(enterpriseCesiumTilesets).pick({
  enterpriseId: true,
  cesiumTilesetId: true,
  addedBy: true,
});

export const insertEnterpriseInviteSchema = createInsertSchema(enterpriseInvites).pick({
  enterpriseId: true,
  inviteCode: true,
  createdBy: true,
  maxUses: true,
  expiresAt: true,
});

// Enterprise types
export type Enterprise = typeof enterprises.$inferSelect;
export type InsertEnterprise = z.infer<typeof insertEnterpriseSchema>;
export type EnterpriseMember = typeof enterpriseMembers.$inferSelect;
export type InsertEnterpriseMember = z.infer<typeof insertEnterpriseMemberSchema>;
export type EnterpriseDroneImage = typeof enterpriseDroneImages.$inferSelect;
export type InsertEnterpriseDroneImage = z.infer<typeof insertEnterpriseDroneImageSchema>;
export type EnterpriseCesiumTileset = typeof enterpriseCesiumTilesets.$inferSelect;
export type InsertEnterpriseCesiumTileset = z.infer<typeof insertEnterpriseCesiumTilesetSchema>;
export type EnterpriseInvite = typeof enterpriseInvites.$inferSelect;
export type InsertEnterpriseInvite = z.infer<typeof insertEnterpriseInviteSchema>;
