import * as fs from 'fs';
import * as path from 'path';

interface TrailNode {
  id: string;
  lat: number;
  lon: number;
  neighbors: Map<string, number>; // nodeId -> distance in meters
}

interface TrailGraph {
  nodes: Map<string, TrailNode>;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  lastUpdated: Date;
}

interface RouteResult {
  coordinates: [number, number][]; // [lng, lat] pairs
  distance: number; // meters
  success: boolean;
  message?: string;
  elevationGain?: number; // meters
  elevationLoss?: number; // meters
}

// In-memory cache for trail graphs by region
const trailGraphCache = new Map<string, TrailGraph>();

// Calculate distance between two coordinates using Haversine formula
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// List of Overpass API endpoints to try (with fallbacks)
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

export type ActivityProfile = 'foot-hiking' | 'foot-walking' | 'cycling-regular' | 'cycling-mountain' | 'cycling-road' | 'cycling-electric';

export const ALLOWED_PROFILES: ActivityProfile[] = [
  'foot-hiking',
  'foot-walking',
  'cycling-regular',
  'cycling-mountain',
  'cycling-road',
  'cycling-electric'
];

function buildOverpassQuery(minLat: number, minLon: number, maxLat: number, maxLon: number, profile: ActivityProfile = 'foot-hiking'): string {
  const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;

  if (profile.startsWith('cycling')) {
    return `
      [out:json][timeout:90];
      (
        way["highway"="cycleway"](${bbox});
        way["highway"="path"]["bicycle"!="no"](${bbox});
        way["highway"="track"]["bicycle"!="no"](${bbox});
        way["highway"="residential"](${bbox});
        way["highway"="unclassified"](${bbox});
        way["highway"="tertiary"](${bbox});
        way["highway"="secondary"](${bbox});
        way["highway"="service"](${bbox});
        way["route"="bicycle"](${bbox});
        way["cycleway"](${bbox});
      );
      out body;
      >;
      out skel qt;
    `;
  }

  return `
    [out:json][timeout:90];
    (
      way["highway"="path"](${bbox});
      way["highway"="footway"](${bbox});
      way["highway"="track"](${bbox});
      way["highway"="bridleway"](${bbox});
      way["route"="hiking"](${bbox});
      way["sac_scale"](${bbox});
    );
    out body;
    >;
    out skel qt;
  `;
}

// Fetch trail data from OpenStreetMap Overpass API with retry logic
async function fetchOSMTrails(minLat: number, minLon: number, maxLat: number, maxLon: number, profile: ActivityProfile = 'foot-hiking'): Promise<any> {
  const query = buildOverpassQuery(minLat, minLon, maxLat, maxLon, profile);

  console.log(`Fetching OSM trails for bounds: ${minLat},${minLon} to ${maxLat},${maxLon}`);
  
  let lastError: Error | null = null;
  
  // Try each endpoint with retries
  for (const overpassUrl of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`Trying Overpass endpoint: ${overpassUrl} (attempt ${attempt + 1})`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(overpassUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`Successfully fetched trail data from ${overpassUrl}`);
        return data;
      } catch (error: any) {
        lastError = error;
        console.log(`Overpass request failed: ${error.message}`);
        // Wait a bit before retry
        if (attempt < 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }
  
  throw lastError || new Error('All Overpass API endpoints failed');
}

// Build a graph from OSM data
function buildGraphFromOSM(osmData: any, bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }): TrailGraph {
  const nodes = new Map<string, TrailNode>();
  const nodeCoords = new Map<number, { lat: number; lon: number }>();

  // First pass: extract all node coordinates
  for (const element of osmData.elements) {
    if (element.type === 'node') {
      nodeCoords.set(element.id, { lat: element.lat, lon: element.lon });
    }
  }

  // Second pass: build edges from ways
  for (const element of osmData.elements) {
    if (element.type === 'way' && element.nodes && element.nodes.length >= 2) {
      const wayNodes = element.nodes;
      
      for (let i = 0; i < wayNodes.length - 1; i++) {
        const nodeIdA = wayNodes[i];
        const nodeIdB = wayNodes[i + 1];
        const coordsA = nodeCoords.get(nodeIdA);
        const coordsB = nodeCoords.get(nodeIdB);

        if (!coordsA || !coordsB) continue;

        const nodeKeyA = `${nodeIdA}`;
        const nodeKeyB = `${nodeIdB}`;

        // Create or get node A
        if (!nodes.has(nodeKeyA)) {
          nodes.set(nodeKeyA, {
            id: nodeKeyA,
            lat: coordsA.lat,
            lon: coordsA.lon,
            neighbors: new Map()
          });
        }

        // Create or get node B
        if (!nodes.has(nodeKeyB)) {
          nodes.set(nodeKeyB, {
            id: nodeKeyB,
            lat: coordsB.lat,
            lon: coordsB.lon,
            neighbors: new Map()
          });
        }

        // Calculate distance
        const distance = haversineDistance(coordsA.lat, coordsA.lon, coordsB.lat, coordsB.lon);

        // Add bidirectional edges
        nodes.get(nodeKeyA)!.neighbors.set(nodeKeyB, distance);
        nodes.get(nodeKeyB)!.neighbors.set(nodeKeyA, distance);
      }
    }
  }

  console.log(`Built trail graph with ${nodes.size} nodes`);

  return {
    nodes,
    bounds,
    lastUpdated: new Date()
  };
}

// Find the nearest point on a line segment to a given point
// Returns { point: [lat, lon], t: parameter (0-1), distance: meters }
function nearestPointOnSegment(
  pointLat: number, pointLon: number,
  segStartLat: number, segStartLon: number,
  segEndLat: number, segEndLon: number
): { lat: number; lon: number; t: number; distance: number } {
  // Convert to a local coordinate system for projection
  const dx = segEndLon - segStartLon;
  const dy = segEndLat - segStartLat;
  
  if (dx === 0 && dy === 0) {
    // Segment is a point
    return {
      lat: segStartLat,
      lon: segStartLon,
      t: 0,
      distance: haversineDistance(pointLat, pointLon, segStartLat, segStartLon)
    };
  }
  
  // Calculate projection parameter t
  const t = Math.max(0, Math.min(1, 
    ((pointLon - segStartLon) * dx + (pointLat - segStartLat) * dy) / (dx * dx + dy * dy)
  ));
  
  // Calculate the nearest point on the segment
  const nearestLat = segStartLat + t * dy;
  const nearestLon = segStartLon + t * dx;
  
  const distance = haversineDistance(pointLat, pointLon, nearestLat, nearestLon);
  
  return { lat: nearestLat, lon: nearestLon, t, distance };
}

// Find the nearest point on any edge in the graph and optionally create a split node
interface EdgeSnapResult {
  node: TrailNode;
  distance: number;
  isNewNode: boolean;
}

function findNearestEdgeAndSnap(
  graph: TrailGraph, 
  lat: number, 
  lon: number, 
  maxDistance: number = 500,
  snapId: string
): EdgeSnapResult | null {
  let bestResult: { 
    nodeA: TrailNode; 
    nodeB: TrailNode; 
    projLat: number; 
    projLon: number;
    t: number;
    distance: number;
  } | null = null;
  
  // Iterate over all edges to find the closest one
  const visited = new Set<string>();
  
  for (const nodeA of Array.from(graph.nodes.values())) {
    for (const [neighborId, _] of Array.from(nodeA.neighbors.entries())) {
      // Create a unique edge key to avoid checking the same edge twice
      const edgeKey = nodeA.id < neighborId ? `${nodeA.id}-${neighborId}` : `${neighborId}-${nodeA.id}`;
      if (visited.has(edgeKey)) continue;
      visited.add(edgeKey);
      
      const nodeB = graph.nodes.get(neighborId);
      if (!nodeB) continue;
      
      const result = nearestPointOnSegment(
        lat, lon,
        nodeA.lat, nodeA.lon,
        nodeB.lat, nodeB.lon
      );
      
      if (result.distance <= maxDistance && (!bestResult || result.distance < bestResult.distance)) {
        bestResult = {
          nodeA,
          nodeB,
          projLat: result.lat,
          projLon: result.lon,
          t: result.t,
          distance: result.distance
        };
      }
    }
  }
  
  if (!bestResult) {
    return null;
  }
  
  // If t is very close to 0 or 1, just use the existing endpoint
  if (bestResult.t < 0.01) {
    return { node: bestResult.nodeA, distance: bestResult.distance, isNewNode: false };
  }
  if (bestResult.t > 0.99) {
    return { node: bestResult.nodeB, distance: bestResult.distance, isNewNode: false };
  }
  
  // Create a new node at the projection point and splice it into the graph
  const newNode: TrailNode = {
    id: snapId,
    lat: bestResult.projLat,
    lon: bestResult.projLon,
    neighbors: new Map()
  };
  
  // Calculate distances from new node to both endpoints
  const distToA = haversineDistance(newNode.lat, newNode.lon, bestResult.nodeA.lat, bestResult.nodeA.lon);
  const distToB = haversineDistance(newNode.lat, newNode.lon, bestResult.nodeB.lat, bestResult.nodeB.lon);
  
  // Connect new node to both endpoints
  newNode.neighbors.set(bestResult.nodeA.id, distToA);
  newNode.neighbors.set(bestResult.nodeB.id, distToB);
  
  // Update the existing nodes to connect to the new node
  bestResult.nodeA.neighbors.set(newNode.id, distToA);
  bestResult.nodeB.neighbors.set(newNode.id, distToB);
  
  // Remove the direct edge between A and B (traffic now goes through new node)
  bestResult.nodeA.neighbors.delete(bestResult.nodeB.id);
  bestResult.nodeB.neighbors.delete(bestResult.nodeA.id);
  
  // Add the new node to the graph
  graph.nodes.set(newNode.id, newNode);
  
  return { node: newNode, distance: bestResult.distance, isNewNode: true };
}

// Find the nearest node in the graph to a given coordinate (legacy, used as fallback)
function findNearestNode(graph: TrailGraph, lat: number, lon: number, maxDistance: number = 500): TrailNode | null {
  let nearest: TrailNode | null = null;
  let nearestDist = Infinity;

  const nodes = Array.from(graph.nodes.values());
  for (const node of nodes) {
    const dist = haversineDistance(lat, lon, node.lat, node.lon);
    if (dist < nearestDist && dist <= maxDistance) {
      nearestDist = dist;
      nearest = node;
    }
  }

  return nearest;
}

// Simple priority queue implementation for Dijkstra
class PriorityQueue {
  private heap: { id: string; priority: number }[] = [];

  push(id: string, priority: number) {
    this.heap.push({ id, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): { id: string; priority: number } | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return result;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].priority <= this.heap[index].priority) break;
      [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number) {
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < this.heap.length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < this.heap.length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.heap[smallest], this.heap[index]] = [this.heap[index], this.heap[smallest]];
      index = smallest;
    }
  }
}

// Dijkstra's algorithm for shortest path with priority queue for O(E log V) performance
function dijkstra(graph: TrailGraph, startId: string, endId: string): { path: string[]; distance: number } | null {
  // Check if start and end nodes exist
  if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) {
    return null;
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const visited = new Set<string>();
  const pq = new PriorityQueue();

  // Initialize
  distances.set(startId, 0);
  pq.push(startId, 0);

  while (!pq.isEmpty()) {
    const current = pq.pop();
    if (!current) break;

    const { id: currentId, priority: currentDist } = current;

    // Skip if already visited
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Early exit if we reached destination
    if (currentId === endId) {
      // Reconstruct path
      const path: string[] = [];
      let node: string | undefined = endId;
      while (node) {
        path.unshift(node);
        node = previous.get(node);
      }
      return { path, distance: distances.get(endId)! };
    }

    // Skip if we've found a shorter path since this was queued
    if (currentDist > (distances.get(currentId) ?? Infinity)) continue;

    // Update neighbors
    const currentNode = graph.nodes.get(currentId);
    if (!currentNode) continue;

    const neighbors = Array.from(currentNode.neighbors.entries());
    for (const [neighborId, edgeDistance] of neighbors) {
      if (visited.has(neighborId)) continue;

      const newDist = currentDist + edgeDistance;
      const oldDist = distances.get(neighborId) ?? Infinity;
      
      if (newDist < oldDist) {
        distances.set(neighborId, newDist);
        previous.set(neighborId, currentId);
        pq.push(neighborId, newDist);
      }
    }
  }

  return null;
}

async function fetchElevationForCoordinates(coordinates: [number, number][]): Promise<{ elevationGain: number; elevationLoss: number }> {
  if (coordinates.length < 2) {
    return { elevationGain: 0, elevationLoss: 0 };
  }

  const maxPointsPerRequest = 100;
  const sampled: [number, number][] = [];

  if (coordinates.length <= maxPointsPerRequest) {
    sampled.push(...coordinates);
  } else {
    const step = (coordinates.length - 1) / (maxPointsPerRequest - 1);
    for (let i = 0; i < maxPointsPerRequest; i++) {
      sampled.push(coordinates[Math.round(i * step)]);
    }
  }

  const latitudes = sampled.map(c => c[1].toFixed(6)).join(',');
  const longitudes = sampled.map(c => c[0].toFixed(6)).join(',');

  const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitudes}&longitude=${longitudes}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(`Open-Meteo elevation API error: ${response.status}`);
      return { elevationGain: 0, elevationLoss: 0 };
    }

    const data = await response.json();
    const elevations: number[] = data.elevation;

    if (!elevations || elevations.length < 2) {
      return { elevationGain: 0, elevationLoss: 0 };
    }

    let elevationGain = 0;
    let elevationLoss = 0;

    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) {
        elevationGain += diff;
      } else {
        elevationLoss += Math.abs(diff);
      }
    }

    return {
      elevationGain: Math.round(elevationGain * 10) / 10,
      elevationLoss: Math.round(elevationLoss * 10) / 10
    };
  } catch (error) {
    console.log(`Elevation fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { elevationGain: 0, elevationLoss: 0 };
  }
}

// Get or create trail graph for a region
export async function getTrailGraph(minLat: number, minLon: number, maxLat: number, maxLon: number, profile: ActivityProfile = 'foot-hiking'): Promise<TrailGraph> {
  const profileKey = profile.startsWith('cycling') ? 'cycling' : 'hiking';
  const cacheKey = `${profileKey}_${Math.floor(minLat * 10)}_${Math.floor(minLon * 10)}_${Math.ceil(maxLat * 10)}_${Math.ceil(maxLon * 10)}`;
  
  const cached = trailGraphCache.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.lastUpdated.getTime();
    if (age < 24 * 60 * 60 * 1000) {
      console.log(`Using cached trail graph (${profileKey}): ${cached.nodes.size} nodes`);
      return cached;
    }
  }

  console.log(`Fetching fresh trail data from OpenStreetMap for profile: ${profile}...`);
  const osmData = await fetchOSMTrails(minLat, minLon, maxLat, maxLon, profile);
  const graph = buildGraphFromOSM(osmData, { minLat, maxLat, minLon, maxLon });
  
  trailGraphCache.set(cacheKey, graph);
  
  return graph;
}

// Calculate shortest path between waypoints on trails
export async function calculateTrailRoute(waypoints: [number, number][], profile: ActivityProfile = 'foot-hiking'): Promise<RouteResult> {
  if (waypoints.length < 2) {
    return { coordinates: [], distance: 0, success: false, message: 'Need at least 2 waypoints' };
  }

  // Calculate bounding box with padding
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lng, lat] of waypoints) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lng);
    maxLon = Math.max(maxLon, lng);
  }
  
  // Add padding (about 2km)
  const padding = 0.02;
  minLat -= padding;
  maxLat += padding;
  minLon -= padding;
  maxLon += padding;

  try {
    // Get trail graph for the region
    const graph = await getTrailGraph(minLat, minLon, maxLat, maxLon, profile);
    
    if (graph.nodes.size === 0) {
      return { 
        coordinates: [], 
        distance: 0, 
        success: false, 
        message: 'No trails found in this area. Try a different location or use Road mode.' 
      };
    }

    // Create a working copy of the graph that we can modify with snap nodes
    // We'll clone the graph to avoid modifying the cached version
    const workingGraph: TrailGraph = {
      nodes: new Map(),
      bounds: graph.bounds,
      lastUpdated: graph.lastUpdated
    };
    
    // Deep copy nodes
    for (const [id, node] of Array.from(graph.nodes.entries())) {
      workingGraph.nodes.set(id, {
        id: node.id,
        lat: node.lat,
        lon: node.lon,
        neighbors: new Map(node.neighbors)
      });
    }

    const fullPath: [number, number][] = [];
    let totalDistance = 0;

    // Snap all waypoints to the nearest edge in the graph
    const snappedNodes: TrailNode[] = [];
    const createdSnapNodes: string[] = [];
    
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const snapId = `snap_wp_${i}_${Date.now()}`;
      
      // Use edge-based snapping for accurate positioning
      const snapResult = findNearestEdgeAndSnap(workingGraph, wp[1], wp[0], 1000, snapId);
      
      if (!snapResult) {
        return { 
          coordinates: [], 
          distance: 0, 
          success: false, 
          message: `Waypoint ${i + 1} is too far from any trail (>1km). Move it closer to a trail.` 
        };
      }
      
      snappedNodes.push(snapResult.node);
      if (snapResult.isNewNode) {
        createdSnapNodes.push(snapResult.node.id);
      }
      
      console.log(`Waypoint ${i + 1} snapped to node ${snapResult.node.id} (${snapResult.distance.toFixed(0)}m away, new=${snapResult.isNewNode})`);
    }

    // Route between each consecutive pair of waypoints
    for (let i = 0; i < waypoints.length - 1; i++) {
      const startWaypoint = waypoints[i];
      const endWaypoint = waypoints[i + 1];
      const startNode = snappedNodes[i];
      const endNode = snappedNodes[i + 1];

      // Add the original waypoint coordinate at the start
      if (i === 0) {
        fullPath.push(startWaypoint);
      }

      // Calculate shortest path on trail network
      const result = dijkstra(workingGraph, startNode.id, endNode.id);
      
      if (!result) {
        return { 
          coordinates: [], 
          distance: 0, 
          success: false, 
          message: `No trail path found between waypoints ${i + 1} and ${i + 2}. The trails may not be connected.` 
        };
      }

      // Add path nodes to result
      for (const nodeId of result.path) {
        const node = workingGraph.nodes.get(nodeId)!;
        const coord: [number, number] = [node.lon, node.lat];
        
        // Skip if this coordinate is essentially the same as the last one
        if (fullPath.length > 0) {
          const lastCoord = fullPath[fullPath.length - 1];
          if (Math.abs(lastCoord[0] - coord[0]) < 0.000001 && Math.abs(lastCoord[1] - coord[1]) < 0.000001) {
            continue;
          }
        }
        fullPath.push(coord);
      }
      totalDistance += result.distance;

      // Add the final waypoint coordinate at the end
      if (i === waypoints.length - 2) {
        const lastCoord = fullPath[fullPath.length - 1];
        if (Math.abs(lastCoord[0] - endWaypoint[0]) > 0.000001 || Math.abs(lastCoord[1] - endWaypoint[1]) > 0.000001) {
          fullPath.push(endWaypoint);
        }
      }
    }

    const elevation = await fetchElevationForCoordinates(fullPath);

    return {
      coordinates: fullPath,
      distance: totalDistance,
      success: true,
      elevationGain: elevation.elevationGain,
      elevationLoss: elevation.elevationLoss
    };

  } catch (error) {
    console.error('Trail routing error:', error);
    return { 
      coordinates: [], 
      distance: 0, 
      success: false, 
      message: `Trail routing failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

// Get trail statistics for an area
export async function getTrailStats(minLat: number, minLon: number, maxLat: number, maxLon: number): Promise<{ nodeCount: number; edgeCount: number }> {
  const graph = await getTrailGraph(minLat, minLon, maxLat, maxLon);
  
  let edgeCount = 0;
  const nodes = Array.from(graph.nodes.values());
  for (const node of nodes) {
    edgeCount += node.neighbors.size;
  }
  // Edges are bidirectional so divide by 2
  edgeCount = Math.floor(edgeCount / 2);
  
  return { nodeCount: graph.nodes.size, edgeCount };
}
