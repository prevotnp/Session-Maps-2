import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { parseId } from "./utils";

// ========================================
// Outdoor POI caching logic
// ========================================

const outdoorPoiCache = new Map<string, { data: any; timestamp: number }>();
const POI_CACHE_TTL = 24 * 60 * 60 * 1000;
const POI_CACHE_MAX = 200;

function evictOldestCacheEntries() {
  if (outdoorPoiCache.size <= POI_CACHE_MAX) return;
  const entries = Array.from(outdoorPoiCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
  const toRemove = entries.slice(0, entries.length - POI_CACHE_MAX);
  for (const [key] of toRemove) {
    outdoorPoiCache.delete(key);
  }
}

function buildOverpassQuery(south: number, west: number, north: number, east: number): string {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:30];
(
  node["tourism"="camp_site"](${bbox});
  way["tourism"="camp_site"](${bbox});
  node["tourism"="camp_pitch"]["name"](${bbox});
  node["tourism"="alpine_hut"](${bbox});
  way["tourism"="alpine_hut"](${bbox});
  node["tourism"="wilderness_hut"](${bbox});
  way["tourism"="wilderness_hut"](${bbox});
  node["amenity"="shelter"](${bbox});
  way["amenity"="shelter"](${bbox});
  node["amenity"="drinking_water"](${bbox});
  node["natural"="spring"]["name"](${bbox});
  node["highway"="trailhead"](${bbox});
  node["information"="guidepost"]["name"](${bbox});
  node["backcountry"="yes"](${bbox});
);
out center;`;
}

function classifyPoi(tags: Record<string, string>): { category: string; type: string } {
  if (tags.tourism === 'camp_site' || tags.tourism === 'camp_pitch') {
    if (tags.backcountry === 'yes' || tags.tents === 'yes') {
      return { category: 'campsite', type: 'backcountry' };
    }
    return { category: 'campsite', type: tags.tourism === 'camp_pitch' ? 'camp_pitch' : 'camp_site' };
  }
  if (tags.tourism === 'alpine_hut') return { category: 'shelter', type: 'alpine_hut' };
  if (tags.tourism === 'wilderness_hut') return { category: 'shelter', type: 'wilderness_hut' };
  if (tags.amenity === 'shelter') return { category: 'shelter', type: 'shelter' };
  if (tags.amenity === 'drinking_water') return { category: 'water', type: 'drinking_water' };
  if (tags.natural === 'spring') return { category: 'water', type: 'spring' };
  if (tags.highway === 'trailhead') return { category: 'trailhead', type: 'trailhead' };
  if (tags.information === 'guidepost') return { category: 'guidepost', type: 'guidepost' };
  if (tags.backcountry === 'yes') return { category: 'campsite', type: 'backcountry' };
  return { category: 'other', type: 'unknown' };
}

function transformOsmElement(el: any): any {
  const tags = el.tags || {};
  const { category, type } = classifyPoi(tags);
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  return {
    id: el.id,
    lat,
    lon,
    category,
    type,
    name: tags.name || null,
    elevation: tags.ele ? parseFloat(tags.ele) : null,
    capacity: tags.capacity ? parseInt(tags.capacity, 10) : null,
    operator: tags.operator || null,
    fee: tags.fee === 'yes' ? true : tags.fee === 'no' ? false : null,
    amenities: [
      tags.drinking_water === 'yes' && 'drinking_water',
      tags.toilets === 'yes' && 'toilets',
      tags.shower === 'yes' && 'shower',
      tags.fireplace === 'yes' && 'fireplace',
      tags.bbq === 'yes' && 'bbq',
      tags.picnic_table === 'yes' && 'picnic_table',
      tags.internet_access === 'yes' && 'internet',
    ].filter(Boolean),
    website: tags.website || tags['contact:website'] || null,
    phone: tags.phone || tags['contact:phone'] || null,
    description: tags.description || null,
    openingHours: tags.opening_hours || null,
    access: tags.access || null,
  };
}

async function fetchOverpass(query: string): Promise<any> {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  const fetchFromEndpoint = async (url: string): Promise<any> => {
    const resp = await fetch(url, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  };

  try {
    return await Promise.any(endpoints.map(fetchFromEndpoint));
  } catch {
    throw new Error('All Overpass API endpoints failed');
  }
}

// ========================================
// Register misc routes
// ========================================

export function registerMiscRoutes(app: Express) {
  // ========================================
  // Push Notifications
  // ========================================

  // Register device token for push notifications
  app.post("/api/push/register", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { token, platform, deviceName } = req.body;

      if (!token || !platform) {
        return res.status(400).json({ error: "Token and platform are required" });
      }

      if (!['ios', 'android', 'web'].includes(platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }

      const deviceToken = await dbStorage.registerDeviceToken({
        userId: req.user!.id,
        token,
        platform,
        deviceName
      });

      res.status(201).json({ success: true, id: deviceToken.id });
    } catch (error) {
      console.error('Error registering device token:', error);
      res.status(500).json({ error: "Failed to register device token" });
    }
  });

  // Get user's registered devices
  app.get("/api/push/devices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const tokens = await dbStorage.getDeviceTokensByUser(req.user!.id);
      res.json(tokens.map(t => ({
        id: t.id,
        platform: t.platform,
        deviceName: t.deviceName,
        isActive: t.isActive,
        createdAt: t.createdAt
      })));
    } catch (error) {
      console.error('Error getting devices:', error);
      res.status(500).json({ error: "Failed to get devices" });
    }
  });

  // Unregister device token (scoped to current user for security)
  app.delete("/api/push/unregister", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      // Security: Only delete tokens belonging to the requesting user
      const userTokens = await dbStorage.getDeviceTokensByUser(req.user!.id);
      const belongsToUser = userTokens.some(t => t.token === token);

      if (!belongsToUser) {
        return res.status(403).json({ error: "Token does not belong to you" });
      }

      await dbStorage.deleteDeviceToken(token);
      res.json({ success: true });
    } catch (error) {
      console.error('Error unregistering device:', error);
      res.status(500).json({ error: "Failed to unregister device" });
    }
  });

  // ========================================
  // AI Route Assistance
  // ========================================

  app.post("/api/ai/route-assist", async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }

    try {
      const { message, activityType, mapCenter, mapZoom, conversationHistory, existingRoute } = req.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ message: "Message is required" });
      }

      if (!mapCenter || typeof mapCenter.lat !== 'number' || typeof mapCenter.lng !== 'number') {
        return res.status(400).json({ message: "Map center coordinates required" });
      }

      const { processRouteAssistRequest } = await import('../aiRouteAssist');

      const result = await processRouteAssistRequest({
        message: message.trim(),
        activityType: activityType || 'general',
        mapCenter,
        mapZoom: mapZoom || 12,
        conversationHistory: conversationHistory || [],
        existingRoute: existingRoute || undefined,
      }, dbStorage);

      return res.json(result);
    } catch (error) {
      console.error('AI route assist error:', error);
      return res.status(500).json({
        message: `AI assistant error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  });

  // ========================================
  // Proxy Routes
  // ========================================

  app.post("/api/proxy/overpass", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: "Missing query" });
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Overpass proxy error:', error);
      res.status(500).json({ error: "Failed to fetch from Overpass API" });
    }
  });

  app.get("/api/proxy/elevation", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { latitude, longitude } = req.query;
      if (!latitude || !longitude) return res.status(400).json({ error: "Missing latitude/longitude" });
      const response = await fetch(
        `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`
      );
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Elevation proxy error:', error);
      res.status(500).json({ error: "Failed to fetch elevation data" });
    }
  });

  // Batch elevation lookup using Open-Meteo DEM data (much more accurate than Mapbox contour tilequery)
  app.post("/api/proxy/elevation/batch", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { coordinates } = req.body;
      if (!Array.isArray(coordinates) || coordinates.length === 0) {
        return res.status(400).json({ error: "Missing or empty coordinates array" });
      }

      // Open-Meteo supports up to 100 points per request
      const maxPerRequest = 100;
      const allElevations: number[] = [];

      for (let i = 0; i < coordinates.length; i += maxPerRequest) {
        const batch = coordinates.slice(i, i + maxPerRequest);
        const latitudes = batch.map((c: [number, number]) => c[1].toFixed(6)).join(',');
        const longitudes = batch.map((c: [number, number]) => c[0].toFixed(6)).join(',');

        const response = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${latitudes}&longitude=${longitudes}`
        );

        if (!response.ok) {
          return res.status(502).json({ error: `Open-Meteo API error: ${response.status}` });
        }

        const data = await response.json();
        allElevations.push(...(data.elevation || []));
      }

      res.json({ elevation: allElevations });
    } catch (error) {
      console.error('Batch elevation proxy error:', error);
      res.status(500).json({ error: "Failed to fetch batch elevation data" });
    }
  });

  // ========================================
  // Outdoor POIs
  // ========================================

  app.get("/api/outdoor-pois", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const south = parseFloat(req.query.south as string);
      const west = parseFloat(req.query.west as string);
      const north = parseFloat(req.query.north as string);
      const east = parseFloat(req.query.east as string);

      if ([south, west, north, east].some(isNaN)) {
        return res.status(400).json({ error: "Missing or invalid bounding box parameters (south, west, north, east)" });
      }

      if (south < -90 || south > 90 || north < -90 || north > 90 ||
          west < -180 || west > 180 || east < -180 || east > 180) {
        return res.status(400).json({ error: "Coordinates out of valid range" });
      }

      if (north - south > 0.5 || east - west > 0.5) {
        return res.status(400).json({ error: "Query area too large. Max ~0.5 degrees (~50km) per side." });
      }

      const cacheKey = `${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)}`;
      const cached = outdoorPoiCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < POI_CACHE_TTL) {
        return res.json(cached.data);
      }

      const query = buildOverpassQuery(south, west, north, east);
      const osmData = await fetchOverpass(query);

      const pois = (osmData.elements || [])
        .map(transformOsmElement)
        .filter((p: any) => p !== null);

      const result = { pois, count: pois.length };

      outdoorPoiCache.set(cacheKey, { data: result, timestamp: Date.now() });
      evictOldestCacheEntries();

      return res.json(result);
    } catch (error) {
      console.error('Outdoor POI fetch error:', error);
      return res.status(500).json({ error: "Failed to fetch outdoor POIs" });
    }
  });
}
