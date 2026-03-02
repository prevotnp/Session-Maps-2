import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RouteAssistRequest {
  message: string;
  activityType: 'hiking' | 'downhill_skiing' | 'xc_skiing' | 'mountain_biking' | 'trail_running' | 'general';
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  conversationHistory: ChatMessage[];
  existingRoute?: {
    name: string;
    waypoints: Array<{ name: string; lat: number; lng: number; elevation?: number }>;
    totalDistance: number;
    elevationGain: number;
    elevationLoss: number;
    routingMode: string;
  };
}

interface SuggestedWaypoint {
  name: string;
  lat: number;
  lng: number;
  description?: string;
}

interface RouteOption {
  label: string;
  source: 'trail_data' | 'community';
  description: string;
  waypoints: SuggestedWaypoint[];
  communityRouteId?: number;
  communityAuthor?: string;
}

interface RouteAssistResponse {
  message: string;
  routeOptions?: RouteOption[];
}

async function fetchTrailDataForArea(
  center: { lat: number; lng: number },
  zoom: number,
  activityType: string
): Promise<string> {
  const radiusDeg = Math.max(0.02, 0.5 / Math.pow(2, Math.max(0, zoom - 10)));
  const south = center.lat - radiusDeg;
  const north = center.lat + radiusDeg;
  const west = center.lng - radiusDeg;
  const east = center.lng + radiusDeg;

  let wayFilters = '';
  switch (activityType) {
    case 'downhill_skiing':
      wayFilters = `
        way["piste:type"="downhill"](${south},${west},${north},${east});
        way["aerialway"](${south},${west},${north},${east});
        node["aerialway"="station"](${south},${west},${north},${east});
      `;
      break;
    case 'xc_skiing':
      wayFilters = `
        way["piste:type"="nordic"](${south},${west},${north},${east});
        way["piste:type"="skitour"](${south},${west},${north},${east});
        way["highway"="path"]["piste:type"](${south},${west},${north},${east});
        way["landuse"="winter_sports"](${south},${west},${north},${east});
      `;
      break;
    case 'mountain_biking':
      wayFilters = `
        way["highway"="path"]["mtb:scale"](${south},${west},${north},${east});
        way["highway"="track"](${south},${west},${north},${east});
        way["highway"="path"]["bicycle"!="no"](${south},${west},${north},${east});
        way["route"="mtb"](${south},${west},${north},${east});
      `;
      break;
    case 'trail_running':
    case 'hiking':
    default:
      wayFilters = `
        way["highway"="path"](${south},${west},${north},${east});
        way["highway"="footway"](${south},${west},${north},${east});
        way["highway"="track"](${south},${west},${north},${east});
        way["highway"="bridleway"](${south},${west},${north},${east});
        way["route"="hiking"](${south},${west},${north},${east});
        way["sac_scale"](${south},${west},${north},${east});
      `;
      break;
  }

  const query = `
    [out:json][timeout:60];
    (
      ${wayFilters}
      node["natural"="peak"](${south},${west},${north},${east});
      node["natural"="saddle"](${south},${west},${north},${east});
      node["tourism"~"viewpoint|alpine_hut"](${south},${west},${north},${east});
      node["amenity"="parking"]["access"!="private"](${south},${west},${north},${east});
    );
    out body;
    >;
    out skel qt;
  `;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) continue;
      const data = await response.json();
      if (!data.elements || data.elements.length === 0) {
        return 'No trail data found in this area from OpenStreetMap.';
      }
      return summarizeTrailData(data, activityType);
    } catch (e) {
      console.error(`Overpass fetch failed (${endpoint}):`, e);
      continue;
    }
  }
  return 'Unable to fetch trail data. Overpass API may be temporarily unavailable.';
}

function summarizeTrailData(osmData: any, activityType: string): string {
  const nodes = new Map<number, { lat: number; lon: number; tags?: any }>();
  const ways: Array<{ name: string; type: string; tags: any; nodeIds: number[] }> = [];
  const pois: Array<{ name: string; type: string; lat: number; lon: number; ele?: string }> = [];

  for (const el of osmData.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
      if (el.tags?.name) {
        const poiType = el.tags.natural || el.tags.tourism || el.tags.amenity || el.tags.aerialway || 'point';
        pois.push({ name: el.tags.name, type: poiType, lat: el.lat, lon: el.lon, ele: el.tags.ele });
      }
    }
  }

  for (const el of osmData.elements) {
    if (el.type === 'way' && el.tags) {
      const name = el.tags.name || el.tags.ref || 'Unnamed trail';
      const type = el.tags['piste:type'] || el.tags.highway || el.tags.aerialway || el.tags.route || 'way';
      ways.push({ name, type, tags: el.tags, nodeIds: el.nodes || [] });
    }
  }

  const lines: string[] = [];
  lines.push(`=== OPENSTREETMAP TRAIL DATA (${activityType}) ===`);
  lines.push(`Trails/ways: ${ways.length} | Points of interest: ${pois.length}`);
  lines.push('');

  const trailsByName = new Map<string, typeof ways[0][]>();
  for (const way of ways) {
    if (!trailsByName.has(way.name)) trailsByName.set(way.name, []);
    trailsByName.get(way.name)!.push(way);
  }

  lines.push('--- NAMED TRAILS ---');
  for (const [name, segments] of Array.from(trailsByName.entries())) {
    if (name === 'Unnamed trail') continue;
    const types = Array.from(new Set(segments.map(s => s.type))).join(', ');
    const tags = segments[0].tags;
    let detail = `• ${name} (${types})`;
    if (tags.sac_scale) detail += ` [difficulty: ${tags.sac_scale}]`;
    if (tags['piste:difficulty']) detail += ` [difficulty: ${tags['piste:difficulty']}]`;
    if (tags['piste:grooming']) detail += ` [grooming: ${tags['piste:grooming']}]`;
    if (tags.surface) detail += ` [surface: ${tags.surface}]`;
    if (tags.trail_visibility) detail += ` [visibility: ${tags.trail_visibility}]`;
    if (tags.mtb_scale) detail += ` [MTB scale: ${tags.mtb_scale}]`;

    let totalLength = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.nodeIds.length - 1; i++) {
        const a = nodes.get(seg.nodeIds[i]);
        const b = nodes.get(seg.nodeIds[i + 1]);
        if (a && b) {
          const R = 6371000;
          const dLat = (b.lat - a.lat) * Math.PI / 180;
          const dLon = (b.lon - a.lon) * Math.PI / 180;
          const sin2 = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
          totalLength += R * 2 * Math.atan2(Math.sqrt(sin2), Math.sqrt(1 - sin2));
        }
      }
    }
    if (totalLength > 0) detail += ` [~${(totalLength / 1609.34).toFixed(1)} mi]`;

    if (segments[0].nodeIds.length > 0) {
      const startNode = nodes.get(segments[0].nodeIds[0]);
      const lastSeg = segments[segments.length - 1];
      const endNode = nodes.get(lastSeg.nodeIds[lastSeg.nodeIds.length - 1]);
      if (startNode) detail += ` [starts: ${startNode.lat.toFixed(5)}, ${startNode.lon.toFixed(5)}]`;
      if (endNode) detail += ` [ends: ${endNode.lat.toFixed(5)}, ${endNode.lon.toFixed(5)}]`;
    }
    lines.push(detail);
  }

  const unnamed = trailsByName.get('Unnamed trail');
  if (unnamed) lines.push(`• Plus ${unnamed.length} unnamed trail segments`);

  lines.push('');
  lines.push('--- POINTS OF INTEREST ---');
  for (const poi of pois) {
    let detail = `• ${poi.name} (${poi.type})`;
    if (poi.ele) detail += ` [elevation: ${Math.round(parseFloat(poi.ele) * 3.28084).toLocaleString()} ft / ${poi.ele}m]`;
    detail += ` [location: ${poi.lat.toFixed(5)}, ${poi.lon.toFixed(5)}]`;
    lines.push(detail);
  }

  return lines.join('\n');
}

interface CommunityRoute {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  totalDistance: string | null;
  elevationGain: string | null;
  elevationLoss: string | null;
  estimatedTime: number | null;
  routingMode: string;
  waypoints: Array<{ name: string; lngLat: [number, number]; elevation?: number }>;
  ownerUsername: string;
  ownerFullName: string | null;
  routeNotes: Array<{ category: string; content: string }>;
  pointsOfInterest: Array<{ name: string; lat: number; lng: number; note?: string; elevation?: number }>;
}

export async function fetchCommunityRoutes(
  center: { lat: number; lng: number },
  radiusDeg: number,
  dbStorage: any
): Promise<CommunityRoute[]> {
  try {
    const publicRoutes = await dbStorage.getPublicRoutesWithOwners();
    if (!publicRoutes || publicRoutes.length === 0) return [];

    const south = center.lat - radiusDeg;
    const north = center.lat + radiusDeg;
    const west = center.lng - radiusDeg;
    const east = center.lng + radiusDeg;

    const nearbyRoutes: CommunityRoute[] = [];

    for (const route of publicRoutes) {
      let waypoints: Array<{ name: string; lngLat: [number, number]; elevation?: number }> = [];
      try {
        if (route.waypointCoordinates) {
          waypoints = JSON.parse(route.waypointCoordinates);
        }
      } catch { continue; }

      if (waypoints.length === 0) {
        try {
          const path = JSON.parse(route.pathCoordinates);
          if (path.length > 0) {
            const mid = path[Math.floor(path.length / 2)];
            const [lng, lat] = Array.isArray(mid) ? mid : [mid.lng || mid[0], mid.lat || mid[1]];
            if (lat < south || lat > north || lng < west || lng > east) continue;
          }
        } catch { continue; }
      } else {
        const isNearby = waypoints.some(wp => {
          const [lng, lat] = wp.lngLat;
          return lat >= south && lat <= north && lng >= west && lng <= east;
        });
        if (!isNearby) continue;
      }

      let routeNotes: Array<{ category: string; content: string }> = [];
      let pointsOfInterest: Array<{ name: string; lat: number; lng: number; note?: string; elevation?: number }> = [];

      try {
        const notes = await dbStorage.getRouteNotes(route.id);
        routeNotes = notes.map((n: any) => ({ category: n.category, content: n.content || '' }));
      } catch {}

      try {
        const pois = await dbStorage.getRoutePointsOfInterest(route.id);
        pointsOfInterest = pois.map((p: any) => ({
          name: p.name,
          lat: parseFloat(p.latitude),
          lng: parseFloat(p.longitude),
          note: p.note || undefined,
          elevation: p.elevation ? parseFloat(p.elevation) : undefined,
        }));
      } catch {}

      nearbyRoutes.push({
        id: route.id,
        name: route.name,
        description: route.description,
        notes: route.notes,
        totalDistance: route.totalDistance,
        elevationGain: route.elevationGain,
        elevationLoss: route.elevationLoss,
        estimatedTime: route.estimatedTime,
        routingMode: route.routingMode,
        waypoints,
        ownerUsername: route.owner.username,
        ownerFullName: route.owner.fullName,
        routeNotes,
        pointsOfInterest,
      });
    }

    console.log(`[AI Route Assist] Found ${nearbyRoutes.length} community routes nearby (out of ${publicRoutes.length} total public)`);
    return nearbyRoutes;
  } catch (error) {
    console.error('[AI Route Assist] Error fetching community routes:', error);
    return [];
  }
}

function summarizeCommunityRoutes(routes: CommunityRoute[]): string {
  if (routes.length === 0) {
    return '=== SESSION MAPS COMMUNITY ROUTES ===\nNo public routes from other Session Maps users found in this area.\n';
  }

  const lines: string[] = [];
  lines.push(`=== SESSION MAPS COMMUNITY ROUTES (${routes.length} found) ===`);
  lines.push('These are routes created and shared by real Session Maps users who have actually done these routes.');
  lines.push('Community routes have GPS-verified waypoints and often include personal notes about conditions, difficulty, and tips.');
  lines.push('');

  for (const route of routes) {
    const distMiles = route.totalDistance ? (parseFloat(route.totalDistance) / 1609.34).toFixed(1) : '?';
    const gainFeet = route.elevationGain ? Math.round(parseFloat(route.elevationGain) * 3.28084) : null;
    const lossFeet = route.elevationLoss ? Math.round(parseFloat(route.elevationLoss) * 3.28084) : null;

    lines.push(`--- Route: "${route.name}" (by @${route.ownerUsername}) [ID: ${route.id}] ---`);
    if (route.description) lines.push(`  Description: ${route.description}`);
    lines.push(`  Distance: ${distMiles} mi | Mode: ${route.routingMode}`);
    if (gainFeet !== null) lines.push(`  Elevation: +${gainFeet.toLocaleString()} ft / -${(lossFeet || 0).toLocaleString()} ft`);
    if (route.estimatedTime) lines.push(`  Estimated time: ${route.estimatedTime} min`);

    if (route.waypoints.length > 0) {
      lines.push(`  Waypoints (${route.waypoints.length}):`);
      for (const wp of route.waypoints) {
        const [lng, lat] = wp.lngLat;
        const eleFeet = wp.elevation ? Math.round(wp.elevation * 3.28084) : null;
        lines.push(`    • ${wp.name} (${lat.toFixed(5)}, ${lng.toFixed(5)})${eleFeet ? ` [${eleFeet.toLocaleString()} ft]` : ''}`);
      }
    }

    if (route.notes) {
      lines.push(`  Creator's notes: ${route.notes.substring(0, 300)}${route.notes.length > 300 ? '...' : ''}`);
    }

    if (route.routeNotes.length > 0) {
      lines.push(`  Detailed notes:`);
      for (const note of route.routeNotes) {
        if (note.content) {
          lines.push(`    [${note.category}]: ${note.content.substring(0, 200)}${note.content.length > 200 ? '...' : ''}`);
        }
      }
    }

    if (route.pointsOfInterest.length > 0) {
      lines.push(`  Points of Interest marked by creator:`);
      for (const poi of route.pointsOfInterest) {
        lines.push(`    📍 ${poi.name} (${poi.lat.toFixed(5)}, ${poi.lng.toFixed(5)})${poi.note ? ` — ${poi.note}` : ''}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function buildSystemPrompt(
  activityType: string,
  trailData: string,
  communityData: string,
  existingRoute?: RouteAssistRequest['existingRoute']
): string {
  let activityContext = '';
  switch (activityType) {
    case 'downhill_skiing':
      activityContext = 'The user is planning a downhill skiing session. Focus on ski runs, lifts, difficulty ratings (green/blue/black/double-black), and efficient lift-to-run sequencing. Consider ability level and suggest warm-up runs before harder terrain.';
      break;
    case 'xc_skiing':
      activityContext = 'The user is planning a cross-country skiing outing. Focus on groomed Nordic trails, classic vs skate lanes, trail difficulty, and loop options. Consider grooming conditions and flat vs hilly terrain preferences.';
      break;
    case 'mountain_biking':
      activityContext = 'The user is planning a mountain bike ride. Focus on singletrack, MTB difficulty ratings, trail surface, climbing vs descending, and flow trail options. Consider technical ability and fitness level.';
      break;
    case 'trail_running':
      activityContext = 'The user is planning a trail run. Focus on runnable trail surfaces, manageable elevation gain, distance targets, and out-and-back vs loop options.';
      break;
    case 'hiking':
    default:
      activityContext = 'The user is planning a hike. Focus on trail conditions, elevation gain/loss, scenic viewpoints, difficulty, distance, and estimated time. Consider turnaround points and bail-out options.';
      break;
  }

  let existingRouteContext = '';
  if (existingRoute) {
    const distMiles = (existingRoute.totalDistance / 1609.34).toFixed(1);
    const gainFeet = Math.round(existingRoute.elevationGain * 3.28084);
    const lossFeet = Math.round(existingRoute.elevationLoss * 3.28084);
    existingRouteContext = `
THE USER HAS AN EXISTING ROUTE LOADED:
- Name: ${existingRoute.name}
- Distance: ${distMiles} miles
- Elevation: +${gainFeet} ft / -${lossFeet} ft
- Routing mode: ${existingRoute.routingMode}
- Waypoints: ${existingRoute.waypoints.map(wp => {
      const eleFeet = wp.elevation ? Math.round(wp.elevation * 3.28084) : null;
      return `${wp.name} (${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}${eleFeet ? `, ${eleFeet}ft` : ''})`;
    }).join(' → ')}
You can suggest modifications, extensions, or alternatives to this existing route.
`;
  }

  return `You are an expert outdoor route planning assistant for Session Maps, a trail mapping app focused on the Jackson Hole / Teton County, Wyoming area (though users may explore anywhere). You help users build the most efficient and enjoyable routes for their chosen activity.

${activityContext}

YOU HAVE TWO DATA SOURCES — USE BOTH:

1. **OpenStreetMap trail data** — verified trail network data including trail names, types, difficulty ratings, surfaces, and coordinates. This is your primary source for understanding what trails physically exist and how they connect.

2. **Session Maps community routes** — routes created and shared by other Session Maps users who have ACTUALLY hiked/skied/biked these routes in real life. These are GPS-verified, often include personal notes about conditions and tips, and represent proven route choices by experienced local users. Community routes are extremely valuable because they represent real-world-tested itineraries.

YOUR DECISION-MAKING PROCESS (follow this every time the user asks for a route):

Step 1 — UNDERSTAND THE REQUEST: What activity? How far? How hard? How much time? Loop or out-and-back? Any specific goals (summit, views, lake, etc.)? If the request is vague, ASK CLARIFYING QUESTIONS before suggesting routes. Always ask about fitness level and available time if not mentioned.

Step 2 — SEARCH COMMUNITY ROUTES FIRST: Scan the Session Maps community routes data carefully. Look for routes that match the user's criteria — similar distance, similar activity type, relevant location. Community routes are gold because real people have done them and left notes. Even if a community route isn't a perfect match, it may contain useful insights (trailhead info, conditions notes, waypoint names).

Step 3 — ANALYZE TRAIL DATA: Cross-reference the OSM trail data to understand the full trail network. Identify trail connections, alternative paths, and options the community routes might not cover.

Step 4 — BUILD 1 TO 3 OPTIONS: Present options clearly labeled so the user can compare:

   **Option A: "AI-Optimized Route"** — Your best recommendation built from analyzing the full trail network. This is the route YOU would design from scratch using all available data, optimized for the user's specific criteria. Use real trail names and coordinates from the OSM data.

   **Option B: "Community Route by @username"** (include this whenever a relevant community route exists) — A route that another Session Maps user has actually completed and shared. Explain who created it, what they noted about it, and why it's relevant to the user's request. Use the community route's actual GPS-verified waypoint coordinates. Always credit the creator with their @username.

   **Option C** (optional) — A variation when useful. Could be a shorter/longer alternative, different loop direction, easier/harder option, or a hybrid that combines the best of trail data with insights from a community route.

   For each option, explain: distance, elevation gain/loss, estimated time, difficulty, what makes it good, and any trade-offs. Directly compare the options so the user can make an informed choice.

Step 5 — If no community routes match at all, that's fine — present 1-2 options from trail data alone and briefly mention that no community routes were found for this specific request.

IMPORTANT RULES:
1. Only suggest routes on REAL trails that appear in the data. Never invent trail names or coordinates.
2. When referencing a community route, ALWAYS credit the creator (e.g. "This route was shared by @trailrunner42 on Session Maps"). This is mandatory.
3. Community route waypoints are GPS-verified — they are the most reliable coordinates available. Prefer them when they match the user's needs.
4. Use imperial units (miles, feet) as primary, with metric in parentheses when helpful.
5. Be concise but specific. Don't dump raw data — synthesize it into clear, actionable recommendations.
6. If community routes exist but aren't a good match, briefly mention they exist and explain why you're recommending something different.
7. When a community route partially matches (e.g. right area but wrong distance), mention it as a reference and explain how your AI-optimized option improves on it for the user's specific needs.

WHEN SUGGESTING ROUTE OPTIONS:
Include waypoints in special JSON blocks at the END of your message. Each option gets its own block. Format EXACTLY like this:

For trail-data-sourced routes:
\`\`\`route_option
{
  "label": "Scenic Loop via Cascade Canyon",
  "source": "trail_data",
  "description": "5.2 mile loop with 1,200ft gain through Cascade Canyon with lake views",
  "waypoints": [
    {"name": "Trailhead Parking", "lat": 43.7500, "lng": -110.8000, "description": "Start here"},
    {"name": "Cascade Canyon Fork", "lat": 43.7550, "lng": -110.7950, "description": "Bear left at junction"},
    {"name": "Inspiration Point", "lat": 43.7600, "lng": -110.7900, "description": "Scenic overlook — turnaround"}
  ]
}
\`\`\`

For community-sourced routes:
\`\`\`route_option
{
  "label": "@trailrunner42's Cascade Loop",
  "source": "community",
  "description": "Popular 4.8 mile loop shared by @trailrunner42 — rated intermediate, includes Hidden Falls stop",
  "communityRouteId": 42,
  "communityAuthor": "trailrunner42",
  "waypoints": [
    {"name": "Jenny Lake Trailhead", "lat": 43.7510, "lng": -110.8010, "description": "Well-marked start"},
    {"name": "Hidden Falls", "lat": 43.7560, "lng": -110.7940, "description": "Worth the stop per @trailrunner42"}
  ]
}
\`\`\`

You may include 1 to 3 route_option blocks. Only include them when you're actually suggesting specific routes — NOT when asking clarifying questions.

${existingRouteContext}

REAL OPENSTREETMAP TRAIL DATA FOR THE CURRENT MAP VIEW:
${trailData}

SESSION MAPS COMMUNITY ROUTE DATA FOR THE CURRENT MAP VIEW:
${communityData}

Remember: OSM coordinates are from the verified trail network. Community route coordinates are GPS-verified by real Session Maps users who were physically there. Both are trustworthy — use them confidently. Always prefer named trails over unnamed segments for navigation clarity.`;
}

export async function processRouteAssistRequest(
  request: RouteAssistRequest,
  dbStorage: any
): Promise<RouteAssistResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      message: 'AI Route Assistant is not configured. Please add your ANTHROPIC_API_KEY to the environment variables.',
    };
  }

  const { mapCenter, mapZoom, activityType } = request;
  const radiusDeg = Math.max(0.02, 0.5 / Math.pow(2, Math.max(0, mapZoom - 10)));

  console.log(`[AI Route Assist] Fetching data for ${activityType} near ${mapCenter.lat.toFixed(4)}, ${mapCenter.lng.toFixed(4)} (zoom ${mapZoom})`);

  const [trailData, communityRoutes] = await Promise.all([
    fetchTrailDataForArea(mapCenter, mapZoom, activityType),
    fetchCommunityRoutes(mapCenter, radiusDeg, dbStorage),
  ]);

  const communityData = summarizeCommunityRoutes(communityRoutes);

  console.log(`[AI Route Assist] OSM trail data: ${trailData.length} chars`);
  console.log(`[AI Route Assist] Community routes: ${communityRoutes.length} found nearby`);

  const systemPrompt = buildSystemPrompt(activityType, trailData, communityData, request.existingRoute);

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const recentHistory = request.conversationHistory.slice(-10);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: request.message });

  try {
    console.log(`[AI Route Assist] Sending to Claude (${messages.length} messages, system prompt ${systemPrompt.length} chars)`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system: systemPrompt,
      messages: messages,
    });

    const assistantMessage = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    let routeOptions: RouteOption[] | undefined;
    let cleanMessage = assistantMessage;

    const optionRegex = /```route_option\n([\s\S]*?)```/g;
    let match;
    const parsedOptions: RouteOption[] = [];

    while ((match = optionRegex.exec(assistantMessage)) !== null) {
      try {
        const option = JSON.parse(match[1]);
        parsedOptions.push(option);
      } catch (e) {
        console.error('[AI Route Assist] Failed to parse route option JSON:', e);
      }
    }

    if (parsedOptions.length > 0) {
      routeOptions = parsedOptions;
      cleanMessage = assistantMessage.replace(/```route_option\n[\s\S]*?```/g, '').trim();
    }

    console.log(`[AI Route Assist] Response: ${cleanMessage.length} chars, ${routeOptions?.length || 0} route options (${routeOptions?.filter(o => o.source === 'community').length || 0} from community)`);

    return { message: cleanMessage, routeOptions };

  } catch (error: any) {
    console.error('[AI Route Assist] Claude API error:', error);
    if (error.status === 401) return { message: 'Invalid API key. Please check your ANTHROPIC_API_KEY in Replit Secrets.' };
    if (error.status === 429) return { message: 'Rate limit reached. Please wait a moment and try again.' };
    return { message: `AI assistant error: ${error.message || 'Unknown error'}. Please try again.` };
  }
}
