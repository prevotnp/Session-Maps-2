# Overview

Session Maps is a full-stack web application for high-resolution drone imagery mapping with real-time GPS tracking and collaboration features. It enables users to upload custom drone imagery, share locations, create waypoints and drawings, and download maps for offline use. The application targets outdoor professionals, surveyors, and teams requiring precise, collaborative mapping.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The client is a React 18 single-page application built with TypeScript. It uses Wouter for routing, TanStack React Query for state management, Radix UI with shadcn/ui for UI components, and Tailwind CSS for styling. Mapbox GL JS is integrated for interactive mapping. Vite is used for building. The architecture is component-based with clear separation of concerns (pages, UI components, hooks, utilities).

## Backend Architecture
The server is an Express.js application with TypeScript, providing a REST API and real-time capabilities. It uses Passport.js for authentication (local and Replit OAuth), express-session for session management, and a WebSocket server for live communication. Multer handles drone imagery uploads.

## Data Storage Solutions
The application utilizes a PostgreSQL database hosted on Neon, managed with Drizzle ORM. The schema is code-first and evolved using migrations. Key data models include Users, Drone Images, Locations, Waypoints, Map Drawings, Live Map Sessions, Members, POIs, Routes, Route Notes, Messages, and Offline Map Areas.

## Authentication and Authorization
Security involves Replit OAuth as the primary authentication, with a local username/password fallback. Session management uses HttpOnly cookies. Role-based access control grants admin privileges for imagery management, and middleware protects routes.

## UI/UX Decisions
The application features a unified bottom toolbar for map controls, including 3D/2D toggles, topographic overlays, drone imagery, and tools. A dedicated "Build Route" button is provided. Editable route waypoints are draggable, and a pulsing blue dot indicates real-time location tracking. Map base style uses Satellite for better imagery rendering.

## Feature Specifications
- **Drone Imagery**: Full-resolution tile-based viewing system. GeoTIFF uploads are reprojected via GDAL and sliced into 512px map tiles at zoom levels 14-20, stored in Replit Object Storage (`public/drone-tiles/{imageId}/{z}/{x}/{y}.png`). Frontend uses Mapbox raster tile sources for unlimited zoom detail. Original TIFFs can be preserved in Object Storage (`.private/drone-originals/`). Key files: `server/tileGenerator.ts` (GDAL-based generation + upload), `server/generateAllTiles.sh` (batch script). Also supports 3D model viewer for GLB/GLTF, OBJ, and PLY formats.
- **Cesium 3D Map Viewer**: True 3D viewing of drone photogrammetry using CesiumJS (loaded from CDN). Supports Cesium 3D Tiles exported from DroneDeploy/Pix4D. Upload zipped tileset via admin panel, stored in Object Storage (`public/cesium-tilesets/{tilesetId}/`). Viewer at `/cesium/:id` with full orbit/pan/zoom, Mapbox satellite base layer, measurement tools (click-to-measure distance), and real-time GPS dot overlay. Schema: `cesium_3d_tilesets` table. API: GET/POST/DELETE `/api/cesium-tilesets`, GET `/api/cesium-tilesets/:id/tiles/*` for serving tile files. Key file: `client/src/pages/CesiumViewer.tsx`.
- **Route Notes**: Categorized notes system per route. Users create custom categories (e.g., "Trip Journal", "Gear List", "Itinerary") with per-category text editing and auto-save. Includes "Scan Text" OCR feature using Tesseract.js for capturing handwritten/printed text via phone camera. API: GET/POST/PUT/DELETE `/api/routes/:routeId/notes`. Schema: `route_notes` table (id, routeId, category, content, position).
- **Routing**: Offers Direct, Road, Trails, and Draw modes. Trail mode supports multiple activity profiles via OpenRouteService: foot-hiking, foot-walking, cycling-road, cycling-mountain, cycling-regular, cycling-electric. New endpoint `POST /api/ors/route` accepts a `profile` parameter; legacy `POST /api/ors/hiking-route` kept for backward compat. Custom fallback router (Dijkstra on OSM data) adapts Overpass queries per activity type (hiking vs cycling ways) and now returns elevation gain/loss via Open-Meteo API. Route Builder UI shows activity sub-selector when Trails mode is selected. Routing mode renamed from `rivers` to `trail` (backward compat: DB values `rivers` mapped to `trail` on load). AI route generation queries real trail data from Waymarked Trails API + Overpass before calling Claude.
- **Trail Overlays**: Multi-activity trail visualization via Waymarked Trails raster tiles. Six overlay types independently toggleable from the toolbar: Hiking (on by default), Cycling, MTB, Ski Slopes, Horse Riding, Skating. Functions `addTrailOverlay(map, type)` / `removeTrailOverlay(map, type)` in `mapUtils.ts`. State tracked in `useMapbox.ts` via `activeTrailOverlays` Set. Plus Mapbox vector path lines and labels from `mapbox-streets-v8`.
- **Outdoor POIs**: Backcountry campsites, shelters, huts, water sources, trailheads, and guideposts sourced from OpenStreetMap via Overpass API. Rendered as colored GeoJSON circles with name labels at zoom 12+. Click for detailed popup (elevation, capacity, operator, amenities). Toggle via "Camps" button in toolbar. Server endpoint `GET /api/outdoor-pois` with 24h cache, bounding box validation, area limit. Hook: `useOutdoorPOIs.ts`.
- **Direct Messaging**: Any-to-any user messaging system (no friendship required). Schema: `direct_messages` table (id, senderId, receiverId, body, readAt, createdAt). API: GET `/api/messages/conversations`, GET `/api/messages/unread-count`, GET `/api/messages/:userId`, POST `/api/messages`, PATCH `/api/messages/:userId/read`. Real-time delivery via WebSocket `dm:new` event. Unread badge in bottom navigation. MessagesModal with conversation list, conversation view, and new message search. Key file: `client/src/components/modals/MessagesModal.tsx`.
- **User Profiles**: Profile page shows name, avatar, email, location sharing toggle, expandable routes/activities dropdowns with public/private indicators. Privacy model: self sees all, friends see public routes + shared routes + public activities, non-friends see only name/username. FriendProfileModal supports Add Friend/Unfriend buttons. API: GET `/api/profiles/:username` returns user info, routes, activities, isFriend, isOwner, counts. Key files: `client/src/pages/Profile.tsx`, `client/src/components/modals/FriendProfileModal.tsx`.
- **Collaboration**: Live shared maps with real-time member location tracking, collaborative POI creation, in-session chat, and session ownership.
- **Location Tracking**: Real-time GPS tracking with a blue dot marker and accuracy circle, integrated with location sharing.
- **Elevation**: Improved elevation calculations using smart sampling.
- **Sharing**: Routes can be shared with friends via email or username, appearing as read-only for recipients.
- **PWA Support**: Service worker for static asset caching, manifest.json for "Add to Home Screen", iOS-optimized meta tags.
- **iOS App (Capacitor)**: Native wrapper for App Store distribution with location permissions and push notification support. See `docs/IOS_BUILD_GUIDE.md`.
- **AI Route Assistant**: AI-powered route planning using Anthropic Claude, accessible from the UnifiedToolbar (2D map) and CesiumViewer toolbar (3D map) via a yellow Sparkles "AI Assist" button. Also integrated inside Route Builder modal. Fetches real trail data from OpenStreetMap Overpass API AND community routes from the Session Maps database, presents multiple labeled route options (blue=trail-data, purple=community) with "Use This Route" buttons and follow-up conversation support. API: POST `/api/ai/route-assist`. Supports activity types: hiking, trail running, downhill skiing, XC skiing, mountain biking. Key files: `server/aiRouteAssist.ts` (backend), `client/src/components/AIRouteAssistPanel.tsx` (standalone panel), `client/src/components/modals/RouteBuilderModal.tsx` (inline AI section).
- **Background Resilience**: Wake Lock API keeps screen on during recording. Activity recording state persisted to localStorage (survives iOS app suspension). `useBackgroundResilience` hook handles visibility changes, GPS restart, and WebSocket reconnection on foreground resume. Recovery banner offers to resume interrupted recordings. WebSocket has exponential backoff reconnection and visibility-aware reconnect. Key hooks: `useWakeLock.ts`, `useBackgroundResilience.ts`.

# External Dependencies

## Third-party Services
- **Mapbox**: Base layers, geocoding, elevation.
- **Neon Database**: Serverless PostgreSQL hosting.
- **Replit OAuth**: Authentication provider.
- **OpenStreetMap Overpass API**: Trail routing data.
- **OpenRouteService**: Professional multi-activity routing — foot-hiking, foot-walking, cycling-road, cycling-mountain, cycling-regular, cycling-electric (optional, requires ORS_API_KEY).
- **Waymarked Trails**: Multi-activity trail overlay tiles (hiking, cycling, MTB, slopes, riding, skating) and named route API.
- **Open-Meteo**: Free elevation API used by custom fallback trail router for elevation gain/loss calculations.
- **Esri World Imagery**: High-resolution overlay imagery.
- **Anthropic Claude**: AI route planning assistant (claude-sonnet-4-20250514) for natural language route suggestions. Requires ANTHROPIC_API_KEY.

## Key Libraries
- **Frontend**: React Query, Mapbox GL JS, Radix UI, Tailwind CSS, Wouter.
- **Backend**: Express.js, Passport.js, Drizzle ORM, Multer, WebSocket.
- **Utilities**: Proj4 (for coordinate reprojection), Sharp (for image conversion).
- **Mobile**: Capacitor for iOS/Android native wrapper with push notifications and geolocation plugins.

## External APIs
- **Mapbox API**: Map tiles, geocoding, directions.
- **Teton County GIS**: Regional high-resolution imagery and parcel data.
- **WebSocket Protocol**: Real-time communication.
- **Resend**: Transactional email delivery for password reset emails. Connected via Replit integration (connector). Client helper in `server/resend.ts`, used in forgot-password endpoint in `server/routes.ts`.