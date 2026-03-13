import { ZodError, type ZodSchema, type z } from "zod";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import path from "path";
import type { WebSocket } from "ws";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export const validateRequest = <T extends ZodSchema>(schema: T, data: unknown): { success: boolean; data?: z.infer<T>; error?: string } => {
  try {
    const validData = schema.parse(data);
    return { success: true, data: validData };
  } catch (error) {
    if (error instanceof ZodError) {
      const firstError = error.errors[0];
      const fieldPath = firstError.path.join('.');
      return { success: false, error: `${fieldPath ? fieldPath + ': ' : ''}${firstError.message}` };
    }
    return { success: false, error: 'Invalid data provided' };
  }
};

export function parseId(param: string): number | null {
  const id = parseInt(param, 10);
  return isNaN(id) || id < 1 ? null : id;
}

export function safePath(baseDir: string, filename: string): string | null {
  const sanitized = path.basename(filename);
  const filePath = path.join(baseDir, sanitized);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return null;
  }
  return resolved;
}

// Define common projected CRS definitions for reprojection to WGS84
export const EPSG_DEFINITIONS: Record<number, string> = {
  6451: '+proj=tmerc +lat_0=41.66666666666666 +lon_0=-112.1666666666667 +k=0.9999473679999999 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs',
  2241: '+proj=tmerc +lat_0=41.66666666666666 +lon_0=-112.1666666666667 +k=0.9999473679999999 +x_0=200000.0001016002 +y_0=0 +datum=NAD83 +units=us-ft +no_defs',
  32612: '+proj=utm +zone=12 +datum=WGS84 +units=m +no_defs',
  32613: '+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs',
  32155: '+proj=tmerc +lat_0=40.5 +lon_0=-105.1666666666667 +k=0.9999375 +x_0=200000 +y_0=0 +datum=NAD83 +units=m +no_defs',
  6616: '+proj=tmerc +lat_0=40.5 +lon_0=-110.083333333333 +k=0.9999375 +x_0=800000.00001016 +y_0=100000.00001016 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
  6615: '+proj=tmerc +lat_0=40.5 +lon_0=-110.083333333333 +k=0.9999375 +x_0=800000 +y_0=100000 +ellps=GRS80 +units=m +no_defs',
};

// WebSocket state types for sharing between route files
export interface WebSocketState {
  clients: Map<number, WebSocket>;
  sessionRooms: Map<number, Set<number>>;
  disconnectTimers: Map<string, NodeJS.Timeout>;
  broadcastToSession: (sessionId: number, message: any) => void;
}
