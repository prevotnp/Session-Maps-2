import { getUncachableResendClient } from "./resend";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage as dbStorage } from "./storage";
import { setupAuth, sessionMiddleware } from "./auth";
import { WebSocketServer, WebSocket } from "ws";
import Anthropic from '@anthropic-ai/sdk';
import { 
  insertDroneImageSchema,
  insertLocationSchema,
  insertOfflineMapAreaSchema,
  insertWaypointSchema,
  locationShareSchema,
  insertMapDrawingSchema,
  insertRouteSchema,
  insertTripSchema,
  insertCalendarEventSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  insertActivitySchema
} from "@shared/schema";
import crypto, { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { ZodError } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import * as GeoTIFF from "geotiff";
import proj4 from "proj4";
import { generateTilesFromImage, serveTile, getTileMetadata, deleteTiles, type ImageBounds } from "./tileGenerator";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";

// Scrypt password hashing (same as auth.ts)
const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

// Define common projected CRS definitions for reprojection to WGS84
const EPSG_DEFINITIONS: Record<number, string> = {
  // NAD83(2011) / Idaho East (ftUS)
  6451: '+proj=tmerc +lat_0=41.66666666666666 +lon_0=-112.1666666666667 +k=0.9999473679999999 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs',
  // NAD83 / Idaho East (ftUS)
  2241: '+proj=tmerc +lat_0=41.66666666666666 +lon_0=-112.1666666666667 +k=0.9999473679999999 +x_0=200000.0001016002 +y_0=0 +datum=NAD83 +units=us-ft +no_defs',
  // UTM zones commonly used in Wyoming/Idaho
  32612: '+proj=utm +zone=12 +datum=WGS84 +units=m +no_defs', // UTM Zone 12N
  32613: '+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs', // UTM Zone 13N
  // NAD83 / Wyoming East
  32155: '+proj=tmerc +lat_0=40.5 +lon_0=-105.1666666666667 +k=0.9999375 +x_0=200000 +y_0=0 +datum=NAD83 +units=m +no_defs',
  // NAD83(2011) / Wyoming West (ftUS) - covers Teton, Sublette, Lincoln, Uinta counties
  6616: '+proj=tmerc +lat_0=40.5 +lon_0=-110.083333333333 +k=0.9999375 +x_0=800000.00001016 +y_0=100000.00001016 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs',
  // NAD83(2011) / Wyoming West (meters)
  6615: '+proj=tmerc +lat_0=40.5 +lon_0=-110.083333333333 +k=0.9999375 +x_0=800000 +y_0=100000 +ellps=GRS80 +units=m +no_defs',
};

// Configure multer for drone imagery uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'drone-imagery');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for 3D model uploads
const modelUploadDir = path.join(process.cwd(), 'uploads', 'drone-models');
if (!fs.existsSync(modelUploadDir)) {
  fs.mkdirSync(modelUploadDir, { recursive: true });
}

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage: multerStorage,
  limits: {
    fileSize: 5000 * 1024 * 1024, // 5GB limit per file
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.tif', '.tiff', '.jpg', '.jpeg', '.png'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only GeoTIFF, JPEG, and PNG files are allowed.'));
    }
  }
});

// Configure multer for 3D model file uploads
const modelMulterStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, modelUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const modelUpload = multer({ 
  storage: modelMulterStorage,
  limits: {
    fileSize: 5000 * 1024 * 1024, // 5GB limit per file
  },
  fileFilter: (req, file, cb) => {
    // Allow 3D model files, material files, and texture files
    const allowedTypes = ['.glb', '.gltf', '.obj', '.ply', '.mtl', '.jpg', '.jpeg', '.png', '.tif', '.tiff'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: GLB, GLTF, OBJ, PLY, MTL, and texture images.'));
    }
  }
});

// Multi-file upload for OBJ + MTL + textures
const modelMultiUpload = multer({ 
  storage: modelMulterStorage,
  limits: {
    fileSize: 5000 * 1024 * 1024, // 5GB limit per file
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.glb', '.gltf', '.obj', '.ply', '.mtl', '.jpg', '.jpeg', '.png', '.tif', '.tiff'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type.'));
    }
  }
});

// Configure multer for waypoint photo uploads
const waypointPhotoDir = path.join(process.cwd(), 'uploads', 'waypoint-photos');
if (!fs.existsSync(waypointPhotoDir)) {
  fs.mkdirSync(waypointPhotoDir, { recursive: true });
}

const waypointPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, waypointPhotoDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const waypointPhotoUpload = multer({ 
  storage: waypointPhotoStorage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit per file for large photos/videos
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: JPG, PNG, WebP, HEIC, GIF, MP4, MOV, AVI, MKV, WebM.'));
    }
  }
});

// Configure multer for route photo uploads
const routePhotoDir = path.join(process.cwd(), 'uploads', 'route-photos');
if (!fs.existsSync(routePhotoDir)) {
  fs.mkdirSync(routePhotoDir, { recursive: true });
}

const routePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, routePhotoDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const routePhotoUpload = multer({ 
  storage: routePhotoStorage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit per file for large photos/videos
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: JPG, PNG, WebP, HEIC, GIF, MP4, MOV, AVI, MKV, WebM.'));
    }
  }
});

// Configure multer for Cesium 3D tileset uploads
const tilesetUploadDir = path.join(process.cwd(), 'uploads', 'cesium-tilesets');
if (!fs.existsSync(tilesetUploadDir)) {
  fs.mkdirSync(tilesetUploadDir, { recursive: true });
}

const tilesetMulterStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, tilesetUploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const tilesetUpload = multer({
  storage: tilesetMulterStorage,
  limits: { fileSize: 2000 * 1024 * 1024 }, // 2GB max
});

// Helper to validate and parse JSON requests
const validateRequest = <T extends import("zod").ZodSchema>(schema: T, data: unknown): { success: boolean; data?: import("zod").z.infer<T>; error?: string } => {
  try {
    const validData = schema.parse(data);
    return { success: true, data: validData };
  } catch (error) {
    if (error instanceof ZodError) {
      const firstError = error.errors[0];
      const path = firstError.path.join('.');
      return { success: false, error: `${path ? path + ': ' : ''}${firstError.message}` };
    }
    return { success: false, error: 'Invalid data provided' };
  }
};

function parseId(param: string): number | null {
  const id = parseInt(param, 10);
  return isNaN(id) || id < 1 ? null : id;
}

function safePath(baseDir: string, filename: string): string | null {
  const sanitized = path.basename(filename);
  const filePath = path.join(baseDir, sanitized);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return null;
  }
  return resolved;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  registerObjectStorageRoutes(app);
  
  // Auth middleware
  setupAuth(app);
  
  // Setup admin user based on your username
  const setupAdminUser = async () => {
    try {
      // Check if your username already exists and make it admin
      const existingUser = await dbStorage.getUserByUsername("prevotnp");
      if (existingUser) {
        await dbStorage.setUserAdmin(existingUser.id, true);
      }
    } catch (error) {
      console.error("Admin user setup error:", error);
    }
  };
  
  await setupAdminUser();
  
  // Auth middleware
  const isAuthenticated = (req: Request, res: Response, next: any) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: "Not authenticated" });
  };
  
  // Admin middleware
  const isAdmin = (req: Request, res: Response, next: any) => {
    if (req.isAuthenticated() && (req.user as any).isAdmin) {
      return next();
    }
    res.status(403).json({ message: "Admin access required" });
  };
  
  // Password reset - request reset link
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      
      // Find user by email
      const user = await dbStorage.getUserByEmail(email);
      
      // Always return success to prevent email enumeration
      if (!user) {
        return res.status(200).json({ 
          message: "If an account with that email exists, you will receive a password reset link." 
        });
      }
      
      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
      
      // Save token to database
      await dbStorage.createPasswordResetToken(user.id, token, expiresAt);
      
      // Build reset URL
      const baseUrl = process.env.APP_URL || (process.env.NODE_ENV === 'production' 
        ? 'https://www.sessionmaps.com' 
        : 'http://localhost:5000');
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      
      try {
        const { client: resend, fromEmail } = await getUncachableResendClient();
        await resend.emails.send({
          from: fromEmail || 'Session Maps <noreply@sessionmaps.com>',
          to: [email],
          subject: 'Reset Your Session Maps Password',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="font-size: 24px; font-weight: 700; color: #1e293b; margin: 0;">Session Maps</h1>
              </div>
              <h2 style="font-size: 20px; font-weight: 600; color: #1e293b; margin-bottom: 16px;">Reset Your Password</h2>
              <p style="font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 24px;">
                We received a request to reset the password for your Session Maps account. Click the button below to create a new password.
              </p>
              <div style="text-align: center; margin-bottom: 24px;">
                <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px;">
                  Reset Password
                </a>
              </div>
              <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 16px;">
                This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.
              </p>
              <p style="font-size: 12px; color: #cbd5e1; line-height: 1.5;">
                If the button doesn't work, copy and paste this link into your browser:<br/>
                <a href="${resetUrl}" style="color: #60a5fa; word-break: break-all;">${resetUrl}</a>
              </p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
              <p style="font-size: 11px; color: #cbd5e1; text-align: center;">
                &copy; ${new Date().getFullYear()} Session Maps &middot; sessionmaps.com
              </p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
      }

      return res.status(200).json({ 
        message: "If an account with that email exists, you will receive a password reset link."
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Forgot password error:", error);
      return res.status(500).json({ message: "Error processing password reset request" });
    }
  });

  // Password reset - verify token and reset password
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);
      
      // Find the token
      const resetToken = await dbStorage.getPasswordResetToken(token);
      
      if (!resetToken) {
        return res.status(400).json({ message: "Invalid or expired reset link" });
      }
      
      // Check if token is expired
      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ message: "Reset link has expired. Please request a new one." });
      }
      
      // Check if token was already used
      if (resetToken.used) {
        return res.status(400).json({ message: "This reset link has already been used" });
      }
      
      // Hash new password using same scrypt method as registration
      const hashedPassword = await hashPassword(password);
      
      // Update user's password
      const updatedUser = await dbStorage.updateUserPassword(resetToken.userId, hashedPassword);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Mark token as used
      await dbStorage.markPasswordResetTokenUsed(resetToken.id);
      
      return res.status(200).json({ message: "Password reset successfully. You can now log in with your new password." });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Reset password error:", error);
      return res.status(500).json({ message: "Error resetting password" });
    }
  });

  // Verify reset token (for frontend to check if token is valid before showing form)
  app.get("/api/auth/verify-reset-token/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      const resetToken = await dbStorage.getPasswordResetToken(token);
      
      if (!resetToken) {
        return res.status(400).json({ valid: false, message: "Invalid reset link" });
      }
      
      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ valid: false, message: "Reset link has expired" });
      }
      
      if (resetToken.used) {
        return res.status(400).json({ valid: false, message: "Reset link has already been used" });
      }
      
      return res.status(200).json({ valid: true });
    } catch (error) {
      console.error("Verify reset token error:", error);
      return res.status(500).json({ valid: false, message: "Error verifying reset token" });
    }
  });
  
  // Subscription routes
  app.post("/api/subscription/purchase", isAuthenticated, async (req, res) => {
    return res.status(501).json({ 
      message: "Subscriptions are coming soon. Payment integration is not yet available." 
    });
  });
  
  app.get("/api/subscription/status", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    
    try {
      const userDetails = await dbStorage.getUser(user.id);
      if (!userDetails) {
        return res.status(404).json({ message: "User not found" });
      }
      
      return res.status(200).json({
        isSubscribed: userDetails.isSubscribed,
        expiryDate: userDetails.subscriptionExpiry
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching subscription status" });
    }
  });
  
  // Drone image routes - public access
  app.get("/api/drone-images", async (req, res) => {
    try {
      const publicDroneImages = await dbStorage.getPublicDroneImages();
      return res.status(200).json(publicDroneImages);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching drone images" });
    }
  });
  
  // Admin-only drone image routes
  app.get("/api/admin/drone-images", isAdmin, async (req, res) => {
    try {
      // Admins can see all drone images
      const adminDroneImages = await dbStorage.getDroneImagesByUser((req.user as any).id);
      return res.status(200).json(adminDroneImages);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching admin drone images" });
    }
  });
  
  // Middleware to extend timeout for large file uploads
  const extendTimeout = (req: Request, res: Response, next: Function) => {
    // Set 30 minute timeout for large file uploads
    req.setTimeout(30 * 60 * 1000);
    res.setTimeout(30 * 60 * 1000);
    next();
  };

  // Drone imagery upload endpoint (admin only)
  app.post("/api/drone-images", isAdmin, extendTimeout, upload.array('imagery', 10), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    
    try {
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const {
        name,
        description,
        northEastLat,
        northEastLng,
        southWestLat,
        southWestLng,
        capturedAt
      } = req.body;

      // Calculate total file size
      const totalSizeBytes = files.reduce((total, file) => total + file.size, 0);
      const totalSizeMB = Math.round(totalSizeBytes / (1024 * 1024));

      const filePath = files[0].path;
      const fileExt = filePath.toLowerCase();
      
      // Extract GPS coordinates from GeoTIFF using geotiff.js library
      let extractedCoords = {
        northEastLat: northEastLat || "43.7904",
        northEastLng: northEastLng || "-110.6818",
        southWestLat: southWestLat || "43.7504",
        southWestLng: southWestLng || "-110.7818"
      };
      let cornerCoordinates: string | null = null;
      
      if (fileExt.endsWith('.tif') || fileExt.endsWith('.tiff')) {
        try {
          
          const tiff = await GeoTIFF.fromFile(filePath);
          const image = await tiff.getImage();
          const bbox = image.getBoundingBox();
          const geoKeys = image.getGeoKeys();
          
          if (bbox && bbox.length === 4) {
            // bbox is [minX, minY, maxX, maxY] which is [west, south, east, north]
            let [west, south, east, north] = bbox;
            
            // Check if coordinates need reprojection (not in WGS84 range)
            const needsReprojection = Math.abs(north) > 90 || Math.abs(south) > 90 || 
                                       Math.abs(east) > 180 || Math.abs(west) > 180;
            
            if (needsReprojection && geoKeys?.ProjectedCSTypeGeoKey) {
              const epsgCode = geoKeys.ProjectedCSTypeGeoKey;
              if (EPSG_DEFINITIONS[epsgCode]) {
                proj4.defs(`EPSG:${epsgCode}`, EPSG_DEFINITIONS[epsgCode]);
                
                // Convert corners to WGS84
                const swWgs84 = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [west, south]);
                const neWgs84 = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [east, north]);
                const nwWgs84 = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [west, north]);
                const seWgs84 = proj4(`EPSG:${epsgCode}`, 'EPSG:4326', [east, south]);
                
                // Update bounding box with reprojected values
                west = swWgs84[0];
                south = swWgs84[1];
                east = neWgs84[0];
                north = neWgs84[1];
                
                // Create corner coordinates in WGS84 [lng, lat] format
                // Order: top-left (NW), top-right (NE), bottom-right (SE), bottom-left (SW)
                const corners = [nwWgs84, neWgs84, seWgs84, swWgs84];
                cornerCoordinates = JSON.stringify(corners);
                
              } else {
                console.warn(`Unknown EPSG code ${epsgCode}, coordinates may be incorrect`);
              }
            } else {
              // Create corner coordinates in the format [lng, lat]
              // Order: top-left (UL), top-right (UR), bottom-right (LR), bottom-left (LL)
              const corners = [
                [west, north],   // UL
                [east, north],   // UR
                [east, south],   // LR
                [west, south]    // LL
              ];
              cornerCoordinates = JSON.stringify(corners);
            }
            
            extractedCoords = {
              southWestLat: south.toString(),
              southWestLng: west.toString(),
              northEastLat: north.toString(),
              northEastLng: east.toString()
            };
            
          }
        } catch (geotiffError) {
          console.error('GeoTIFF coordinate extraction failed, using provided/default coordinates:', geotiffError);
        }
      }

      // Create drone image record with GDAL-extracted coordinates
      const droneImageData = {
        name: name || `Drone Imagery ${new Date().toLocaleDateString()}`,
        description: description || null,
        password: null,
        isPublic: true,
        northEastLat: extractedCoords.northEastLat,
        northEastLng: extractedCoords.northEastLng, 
        southWestLat: extractedCoords.southWestLat,
        southWestLng: extractedCoords.southWestLng,
        cornerCoordinates: cornerCoordinates,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
        userId: 1,
        filePath: filePath,
        sizeInMB: totalSizeMB,
        isActive: true
      };

      const newDroneImage = await dbStorage.createDroneImage(droneImageData);
      
      res.status(201).json({
        ...newDroneImage,
        uploadedFiles: files.length,
        totalSizeMB,
        message: "Drone imagery uploaded successfully. Tile generation starting in background."
      });

      const bounds: ImageBounds = {
        north: parseFloat(extractedCoords.northEastLat),
        south: parseFloat(extractedCoords.southWestLat),
        east: parseFloat(extractedCoords.northEastLng),
        west: parseFloat(extractedCoords.southWestLng)
      };

      try {
        await dbStorage.updateDroneImage(newDroneImage.id, { processingStatus: 'generating_tiles' });
        
        const tileResult = await generateTilesFromImage(
          filePath,
          bounds,
          newDroneImage.id,
          () => {}
        );

        await dbStorage.updateDroneImage(newDroneImage.id, {
          hasTiles: true,
          tileMinZoom: tileResult.minZoom,
          tileMaxZoom: tileResult.maxZoom,
          tileStoragePath: tileResult.storagePath,
          processingStatus: 'complete'
        });
      } catch (tileError) {
        console.error(`Tile generation failed for image ${newDroneImage.id}:`, tileError);
        await dbStorage.updateDroneImage(newDroneImage.id, { processingStatus: 'failed' });
      }

      return;
    } catch (error) {
      console.error("Drone imagery upload error:", error);
      if (files) {
        files.forEach(file => {
          fs.unlink(file.path, () => {});
        });
      }
      return res.status(500).json({ message: "Error uploading drone imagery" });
    }
  });
  
  // Update drone image (admin only)
  app.put("/api/admin/drone-images/:id", isAdmin, async (req, res) => {
    const droneImageId = parseId(req.params.id);
    
    try {
      const droneImage = await dbStorage.getDroneImage(droneImageId);
      if (!droneImage) {
        return res.status(404).json({ message: "Drone image not found" });
      }
      
      const updatedDroneImage = await dbStorage.updateDroneImage(droneImageId, req.body);
      return res.status(200).json(updatedDroneImage);
    } catch (error) {
      return res.status(500).json({ message: "Error updating drone image" });
    }
  });
  
  // Delete drone image (admin only)
  app.delete("/api/admin/drone-images/:id", isAdmin, async (req, res) => {
    const droneImageId = parseId(req.params.id);
    
    try {
      const droneImage = await dbStorage.getDroneImage(droneImageId);
      if (!droneImage) {
        return res.status(404).json({ message: "Drone image not found" });
      }
      
      const deleted = await dbStorage.deleteDroneImage(droneImageId);
      if (deleted) {
        return res.status(200).json({ message: "Drone image deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting drone image" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error deleting drone image" });
    }
  });
  
  // Toggle active state for drone image (admin only)
  // Only one drone image can be active at a time
  app.post("/api/admin/drone-images/:id/toggle-active", isAdmin, async (req, res) => {
    const droneImageId = parseId(req.params.id);
    
    try {
      const droneImage = await dbStorage.getDroneImage(droneImageId);
      if (!droneImage) {
        return res.status(404).json({ message: "Drone image not found" });
      }
      
      const isActive = req.body.isActive === true;
      
      // If activating this image, first deactivate all other drone images
      if (isActive) {
        const allDroneImages = await dbStorage.getPublicDroneImages();
        for (const img of allDroneImages) {
          if (img.id !== droneImageId && img.isActive) {
            await dbStorage.setDroneImageActive(img.id, false);
          }
        }
      }
      
      const updatedDroneImage = await dbStorage.setDroneImageActive(droneImageId, isActive);
      
      return res.status(200).json(updatedDroneImage);
    } catch (error) {
      return res.status(500).json({ message: "Error toggling drone image active state" });
    }
  });
  
  // File upload endpoint for drone imagery (admin only)
  app.post("/api/admin/drone-images/upload", isAdmin, extendTimeout, upload.array('imagery', 10), async (req, res) => {
    const user = req.user as any;
    const files = req.files as Express.Multer.File[];
    
    try {
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const {
        name,
        description,
        password,
        isPublic,
        northEastLat,
        northEastLng,
        southWestLat,
        southWestLng,
        capturedAt
      } = req.body;

      // Calculate total file size
      const totalSizeBytes = files.reduce((total, file) => total + file.size, 0);
      const totalSizeMB = Math.round(totalSizeBytes / (1024 * 1024));

      // Create drone image record
      const droneImageData = {
        name,
        description: description || null,
        password: password || null,
        isPublic: isPublic === 'true',
        northEastLat,
        northEastLng,
        southWestLat,
        southWestLng,
        capturedAt: new Date(capturedAt),
        userId: user.id,
        filePath: files[0].path, // Primary file path
        sizeInMB: totalSizeMB,
        isActive: true
      };

      const validation = validateRequest(insertDroneImageSchema, droneImageData);
      
      if (!validation.success) {
        // Clean up uploaded files on validation error
        files.forEach(file => {
          fs.unlink(file.path, () => {});
        });
        return res.status(400).json({ message: validation.error });
      }

      const newDroneImage = await dbStorage.createDroneImage(validation.data!);

      return res.status(201).json({
        ...newDroneImage,
        uploadedFiles: files.length,
        totalSizeMB
      });
    } catch (error) {
      // Clean up uploaded files on error
      if (files) {
        files.forEach(file => {
          fs.unlink(file.path, () => {});
        });
      }
      console.error("Drone imagery upload error:", error);
      return res.status(500).json({ message: "Error uploading drone imagery" });
    }
  });

  // Toggle active state for drone image (authenticated users)
  // This allows any authenticated user to view drone imagery
  app.post("/api/drone-images/:id/toggle-active", isAuthenticated, async (req, res) => {
    const droneImageId = parseId(req.params.id);
    
    try {
      const droneImage = await dbStorage.getDroneImage(droneImageId);
      if (!droneImage) {
        return res.status(404).json({ message: "Drone image not found" });
      }
      
      const isActive = req.body.isActive === true;
      
      // If activating this image, first deactivate all other drone images
      if (isActive) {
        const allDroneImages = await dbStorage.getPublicDroneImages();
        for (const img of allDroneImages) {
          if (img.id !== droneImageId && img.isActive) {
            await dbStorage.setDroneImageActive(img.id, false);
          }
        }
      }
      
      const updatedDroneImage = await dbStorage.setDroneImageActive(droneImageId, isActive);
      
      return res.status(200).json(updatedDroneImage);
    } catch (error) {
      console.error("Error toggling drone image active state:", error);
      return res.status(500).json({ message: "Error toggling drone image active state" });
    }
  });

  // Save drone image position adjustments permanently
  app.patch('/api/drone-images/:id/position', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { scale, offsetLat, offsetLng } = req.body;
      
      // Get current drone image
      const currentImage = await dbStorage.getDroneImage(parseInt(id));
      if (!currentImage) {
        return res.status(404).json({ message: 'Drone image not found' });
      }
      
      // Calculate new bounds based on adjustments
      const originalNeLat = parseFloat(currentImage.northEastLat);
      const originalNeLng = parseFloat(currentImage.northEastLng);
      const originalSwLat = parseFloat(currentImage.southWestLat);
      const originalSwLng = parseFloat(currentImage.southWestLng);
      
      // Apply scale and offset adjustments
      const centerLat = (originalNeLat + originalSwLat) / 2;
      const centerLng = (originalNeLng + originalSwLng) / 2;
      
      const latRange = (originalNeLat - originalSwLat) * scale / 2;
      const lngRange = (originalNeLng - originalSwLng) * scale / 2;
      
      const newNeLat = centerLat + latRange + offsetLat;
      const newNeLng = centerLng + lngRange + offsetLng;
      const newSwLat = centerLat - latRange + offsetLat;
      const newSwLng = centerLng - lngRange + offsetLng;
      
      // Update the drone image with new coordinates
      const updatedImage = await dbStorage.updateDroneImage(parseInt(id), {
        northEastLat: newNeLat.toString(),
        northEastLng: newNeLng.toString(),
        southWestLat: newSwLat.toString(),
        southWestLng: newSwLng.toString()
      });
      
      res.json(updatedImage);
    } catch (error) {
      console.error('Error saving drone image position:', error);
      res.status(500).json({ message: 'Failed to save drone image position' });
    }
  });

  // Serve uploaded drone imagery files
  app.get("/api/drone-imagery/:filename", async (req, res) => {
    const filePath = safePath(uploadDir, req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid filename" });
    }
    
    try {
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).json({ message: "File not found" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error serving file" });
    }
  });
  
  // ==========================================
  // 3D Drone Model Routes
  // ==========================================
  
  // Upload 3D model for a drone image (admin only)
  app.post("/api/admin/drone-models/upload", isAdmin, modelUpload.single('model'), async (req, res) => {
    const user = req.user as any;
    const file = req.file;
    
    try {
      if (!file) {
        return res.status(400).json({ message: "No model file uploaded" });
      }

      const { droneImageId, name, centerLat, centerLng, altitude } = req.body;
      
      if (!droneImageId) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ message: "Drone image ID is required" });
      }

      // Check if drone image exists
      const droneImage = await dbStorage.getDroneImage(parseInt(droneImageId));
      if (!droneImage) {
        fs.unlink(file.path, () => {});
        return res.status(404).json({ message: "Drone image not found" });
      }

      // Check if a model already exists for this drone image
      const existingModel = await dbStorage.getDroneModelByDroneImageId(parseInt(droneImageId));
      if (existingModel) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ message: "A 3D model already exists for this drone image. Delete it first." });
      }

      const fileExt = path.extname(file.originalname).toLowerCase().replace('.', '');
      const fileSizeMB = Math.round(file.size / (1024 * 1024));

      // Calculate center coordinates from drone image cornerCoordinates (WGS84) if not provided
      let calculatedCenterLat = centerLat;
      let calculatedCenterLng = centerLng;
      
      if (!calculatedCenterLat || !calculatedCenterLng) {
        // Use cornerCoordinates if available (these are proper WGS84 lat/lng)
        if (droneImage.cornerCoordinates && Array.isArray(droneImage.cornerCoordinates)) {
          const corners = droneImage.cornerCoordinates as [number, number][];
          if (corners.length >= 4) {
            // Calculate center from all 4 corners
            const avgLng = corners.reduce((sum, c) => sum + c[0], 0) / corners.length;
            const avgLat = corners.reduce((sum, c) => sum + c[1], 0) / corners.length;
            calculatedCenterLat = calculatedCenterLat || avgLat.toString();
            calculatedCenterLng = calculatedCenterLng || avgLng.toString();
          }
        }
        
        // Fallback to bounding box fields only if they look like valid WGS84 coordinates
        if (!calculatedCenterLat || !calculatedCenterLng) {
          const neLat = parseFloat(droneImage.northEastLat);
          const swLat = parseFloat(droneImage.southWestLat);
          const neLng = parseFloat(droneImage.northEastLng);
          const swLng = parseFloat(droneImage.southWestLng);
          
          // Check if values look like valid WGS84 (lat: -90 to 90, lng: -180 to 180)
          if (Math.abs(neLat) <= 90 && Math.abs(swLat) <= 90 && Math.abs(neLng) <= 180 && Math.abs(swLng) <= 180) {
            calculatedCenterLat = calculatedCenterLat || ((neLat + swLat) / 2).toString();
            calculatedCenterLng = calculatedCenterLng || ((neLng + swLng) / 2).toString();
          } else {
            // Default to a safe fallback if coordinates are invalid
            calculatedCenterLat = calculatedCenterLat || "0";
            calculatedCenterLng = calculatedCenterLng || "0";
          }
        }
      }

      const modelData = {
        droneImageId: parseInt(droneImageId),
        name: name || `3D Model - ${droneImage.name}`,
        filePath: file.path,
        fileType: fileExt,
        sizeInMB: fileSizeMB,
        centerLat: calculatedCenterLat,
        centerLng: calculatedCenterLng,
        altitude: altitude || null,
        userId: user.id
      };

      const newModel = await dbStorage.createDroneModel(modelData);

      return res.status(201).json(newModel);
    } catch (error) {
      if (file) {
        fs.unlink(file.path, () => {});
      }
      console.error("3D model upload error:", error);
      return res.status(500).json({ message: "Error uploading 3D model" });
    }
  });

  // Upload MTL and texture files for an existing 3D model (admin only)
  app.post("/api/admin/drone-models/:modelId/textures", isAdmin, modelMultiUpload.array('files', 20), async (req, res) => {
    const modelId = parseId(req.params.modelId);
    if (!modelId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const files = req.files as Express.Multer.File[];
    
    try {
      const model = await dbStorage.getDroneModel(modelId);
      if (!model) {
        files?.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(404).json({ message: "3D model not found" });
      }

      let mtlFilePath: string | undefined;
      const textureFilePaths: string[] = [];

      for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.mtl') {
          mtlFilePath = file.path;
        } else if (['.jpg', '.jpeg', '.png', '.tif', '.tiff'].includes(ext)) {
          textureFilePaths.push(file.path);
        }
      }

      const updateData: any = {};
      if (mtlFilePath) updateData.mtlFilePath = mtlFilePath;
      if (textureFilePaths.length > 0) updateData.textureFiles = JSON.stringify(textureFilePaths);

      const updatedModel = await dbStorage.updateDroneModel(modelId, updateData);
      
      return res.status(200).json(updatedModel);
    } catch (error) {
      files?.forEach(f => fs.unlink(f.path, () => {}));
      console.error("Texture upload error:", error);
      return res.status(500).json({ message: "Error uploading texture files" });
    }
  });

  // Get 3D model for a drone image
  app.get("/api/drone-images/:id/model", async (req, res) => {
    const droneImageId = parseId(req.params.id);
    
    try {
      const model = await dbStorage.getDroneModelByDroneImageId(droneImageId);
      if (!model) {
        return res.status(404).json({ message: "No 3D model found for this drone image" });
      }
      return res.status(200).json(model);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching 3D model" });
    }
  });

  // Update 3D model metadata (admin only)
  app.put("/api/admin/drone-models/:id", isAdmin, async (req, res) => {
    const modelId = parseId(req.params.id);
    if (!modelId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const { name, centerLat, centerLng, altitude } = req.body;
    
    try {
      const updateData: any = {};
      if (name) updateData.name = name;
      if (centerLat) updateData.centerLat = centerLat;
      if (centerLng) updateData.centerLng = centerLng;
      if (altitude !== undefined) updateData.altitude = altitude;
      
      const updatedModel = await dbStorage.updateDroneModel(modelId, updateData);
      if (!updatedModel) {
        return res.status(404).json({ message: "3D model not found" });
      }
      
      return res.status(200).json(updatedModel);
    } catch (error) {
      return res.status(500).json({ message: "Error updating 3D model" });
    }
  });

  // Delete 3D model (admin only)
  app.delete("/api/admin/drone-models/:id", isAdmin, async (req, res) => {
    const modelId = parseId(req.params.id);
    
    try {
      const model = await dbStorage.getDroneModel(modelId);
      if (!model) {
        return res.status(404).json({ message: "3D model not found" });
      }
      
      // Delete the file
      if (model.filePath && fs.existsSync(model.filePath)) {
        fs.unlinkSync(model.filePath);
      }
      
      // Delete from database
      const deleted = await dbStorage.deleteDroneModel(modelId);
      if (!deleted) {
        return res.status(500).json({ message: "Error deleting 3D model from database" });
      }
      
      return res.status(200).json({ message: "3D model deleted successfully" });
    } catch (error) {
      return res.status(500).json({ message: "Error deleting 3D model" });
    }
  });

  // Serve 3D model files
  app.get("/api/drone-models/:filename", async (req, res) => {
    const filePath = safePath(modelUploadDir, req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid filename" });
    }
    
    try {
      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).json({ message: "Model file not found" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error serving model file" });
    }
  });

  // ============ Cesium 3D Tileset Routes ============

  app.get("/api/cesium-tilesets", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    try {
      const tilesets = await dbStorage.getCesium3dTilesetsByUser(user.id);
      return res.json(tilesets);
    } catch (error) {
      console.error("Error fetching tilesets:", error);
      return res.status(500).json({ message: "Error fetching tilesets" });
    }
  });

  app.get("/api/cesium-tilesets/:id", isAuthenticated, async (req, res) => {
    try {
      const tilesetId = parseId(req.params.id);
      if (!tilesetId) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const tileset = await dbStorage.getCesium3dTileset(tilesetId);
      if (!tileset) return res.status(404).json({ message: "Tileset not found" });
      return res.json(tileset);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching tileset" });
    }
  });

  app.post("/api/cesium-tilesets/upload", isAdmin, extendTimeout, tilesetUpload.single('tileset'), async (req, res) => {
    const user = req.user as any;
    const file = req.file;
    
    try {
      if (!file) {
        return res.status(400).json({ message: "No tileset file uploaded" });
      }

      const { name, droneImageId, centerLat, centerLng, centerAlt } = req.body;

      if (!name) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ message: "Name is required" });
      }

      if (!centerLat || !centerLng) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ message: "Center coordinates (centerLat, centerLng) are required" });
      }

      const fileSizeMB = Math.round(file.size / (1024 * 1024));
      
      const extractDir = path.join(tilesetUploadDir, `extract-${Date.now()}`);
      fs.mkdirSync(extractDir, { recursive: true });

      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(file.path);
      
      // Safely extract zip entries (prevent Zip Slip)
      const entries = zip.getEntries();
      for (const entry of entries) {
        const entryPath = path.join(extractDir, entry.entryName);
        const resolvedPath = path.resolve(entryPath);
        
        // Ensure the resolved path is within extractDir (prevent path traversal)
        if (!resolvedPath.startsWith(path.resolve(extractDir) + path.sep) && resolvedPath !== path.resolve(extractDir)) {
          // Skip malicious entries
          console.warn(`Skipping suspicious zip entry: ${entry.entryName}`);
          continue;
        }
        
        if (entry.isDirectory) {
          fs.mkdirSync(resolvedPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
          fs.writeFileSync(resolvedPath, entry.getData());
        }
      }

      let tilesetJsonPath = '';
      const tilesetJsonNames = ['tileset.json', 'Tileset.json', 'root.json', 'layer.json'];
      const allFiles: string[] = [];
      const listAllFiles = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            listAllFiles(fullPath);
          } else {
            allFiles.push(fullPath);
          }
        }
      };
      listAllFiles(extractDir);
      const findTilesetJson = (dir: string): string | null => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && tilesetJsonNames.includes(entry.name)) {
            return fullPath;
          }
          if (entry.isDirectory()) {
            const found = findTilesetJson(fullPath);
            if (found) return found;
          }
        }
        return null;
      };
      
      tilesetJsonPath = findTilesetJson(extractDir) || '';

      if (!tilesetJsonPath) {
        const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
        if (jsonFiles.length > 0) {
          for (const jsonFile of jsonFiles) {
            try {
              const content = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
              if (content.asset || content.root || content.geometricError !== undefined) {
                tilesetJsonPath = jsonFile;
                break;
              }
            } catch {}
          }
        }
      }

      if (!tilesetJsonPath) {
        const fileList = allFiles.slice(0, 30).map(f => path.relative(extractDir, f)).join(', ');
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.unlinkSync(file.path);
        return res.status(400).json({ message: `No tileset.json found in the uploaded zip file. Found files: ${fileList}` });
      }

      const tilesetRootDir = path.dirname(tilesetJsonPath);

      const tilesetRecord = await dbStorage.createCesium3dTileset({
        droneImageId: droneImageId ? parseInt(droneImageId) : null,
        name,
        storagePath: '',
        tilesetJsonUrl: '',
        sizeInMB: fileSizeMB,
        centerLat,
        centerLng,
        centerAlt: centerAlt || null,
        boundingVolume: null,
        userId: user.id,
      });

      const storagePath = `public/cesium-tilesets/${tilesetRecord.id}`;

      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        return res.status(500).json({ message: "Object storage not configured" });
      }
      
      const { objectStorageClient } = await import('./replit_integrations/object_storage');
      const bucket = objectStorageClient.bucket(bucketId);

      const uploadDir = async (dirPath: string, prefix: string) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await uploadDir(fullPath, `${prefix}/${entry.name}`);
          } else {
            const objectPath = `${prefix}/${entry.name}`;
            const fileBuffer = fs.readFileSync(fullPath);
            await bucket.file(objectPath).save(fileBuffer);
          }
        }
      };

      await uploadDir(tilesetRootDir, storagePath);

      let boundingVolume = null;
      try {
        const tilesetJson = JSON.parse(fs.readFileSync(tilesetJsonPath, 'utf-8'));
        if (tilesetJson.root?.boundingVolume) {
          boundingVolume = JSON.stringify(tilesetJson.root.boundingVolume);
        }
      } catch (e) {
        console.error("Error parsing tileset.json:", e);
      }

      const tilesetJsonFilename = path.basename(tilesetJsonPath);
      const tilesetJsonUrl = `/api/cesium-tilesets/${tilesetRecord.id}/tiles/${tilesetJsonFilename}`;

      const { db } = await import('./db');
      const { cesium3dTilesets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.update(cesium3dTilesets)
        .set({ 
          storagePath, 
          tilesetJsonUrl,
          boundingVolume 
        })
        .where(eq(cesium3dTilesets.id, tilesetRecord.id));

      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.unlinkSync(file.path);

      const updatedTileset = await dbStorage.getCesium3dTileset(tilesetRecord.id);
      return res.status(201).json(updatedTileset);
    } catch (error) {
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      console.error("Tileset upload error:", error);
      return res.status(500).json({ message: "Error uploading tileset" });
    }
  });

  app.get("/api/cesium-tilesets/:id/tiles/*", async (req, res) => {
    try {
      const tilesetId = parseId(req.params.id);
      const tilePath = (req.params as Record<string, string>)[0];
      
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        return res.status(500).json({ message: "Object storage not configured" });
      }

      const { objectStorageClient } = await import('./replit_integrations/object_storage');
      const bucket = objectStorageClient.bucket(bucketId);
      const objectPath = `public/cesium-tilesets/${tilesetId}/${tilePath}`;
      const file = bucket.file(objectPath);

      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({ message: "Tile not found" });
      }

      const [buffer] = await file.download();
      
      const ext = path.extname(tilePath).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.json': 'application/json',
        '.b3dm': 'application/octet-stream',
        '.i3dm': 'application/octet-stream',
        '.pnts': 'application/octet-stream',
        '.cmpt': 'application/octet-stream',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
      };
      
      res.set('Content-Type', contentTypes[ext] || 'application/octet-stream');
      res.set('Access-Control-Allow-Origin', '*');
      return res.send(buffer);
    } catch (error) {
      console.error("Error serving tileset file:", error);
      return res.status(500).json({ message: "Error serving tileset file" });
    }
  });

  app.delete("/api/cesium-tilesets/:id", isAdmin, async (req, res) => {
    try {
      const tilesetId = parseId(req.params.id);
      const tileset = await dbStorage.getCesium3dTileset(tilesetId);
      if (!tileset) return res.status(404).json({ message: "Tileset not found" });

      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (bucketId && tileset.storagePath) {
        try {
          const { objectStorageClient } = await import('./replit_integrations/object_storage');
          const bucket = objectStorageClient.bucket(bucketId);
          const [files] = await bucket.getFiles({ prefix: tileset.storagePath + '/' });
          await Promise.all(files.map(f => f.delete()));
        } catch (e) {
          console.error("Error deleting tileset files from storage:", e);
        }
      }

      await dbStorage.deleteCesium3dTileset(tilesetId);
      return res.json({ message: "Tileset deleted" });
    } catch (error) {
      return res.status(500).json({ message: "Error deleting tileset" });
    }
  });

  // Location routes
  app.post("/api/locations", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertLocationSchema, { ...req.body, userId: user.id });
    
    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }
    
    try {
      const newLocation = await dbStorage.createLocation(validation.data!);
      return res.status(201).json(newLocation);
    } catch (error) {
      return res.status(500).json({ message: "Error saving location" });
    }
  });
  
  app.get("/api/locations", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    
    try {
      const locations = await dbStorage.getLocationsByUser(user.id);
      return res.status(200).json(locations);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching locations" });
    }
  });
  
  // Offline map areas routes
  app.post("/api/offline-maps", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertOfflineMapAreaSchema, { ...req.body, userId: user.id });
    
    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }
    
    try {
      const newOfflineMapArea = await dbStorage.createOfflineMapArea(validation.data!);
      return res.status(201).json(newOfflineMapArea);
    } catch (error) {
      return res.status(500).json({ message: "Error creating offline map area" });
    }
  });
  
  app.get("/api/offline-maps", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    
    try {
      const offlineMapAreas = await dbStorage.getOfflineMapAreasByUser(user.id);
      return res.status(200).json(offlineMapAreas);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching offline map areas" });
    }
  });
  
  app.delete("/api/offline-maps/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const offlineMapAreaId = parseId(req.params.id);
    if (!offlineMapAreaId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      // Verify the offline map area belongs to the user
      const offlineMapArea = await dbStorage.getOfflineMapArea(offlineMapAreaId);
      if (!offlineMapArea) {
        return res.status(404).json({ message: "Offline map area not found" });
      }
      
      if (offlineMapArea.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this offline map area" });
      }
      
      const deleted = await dbStorage.deleteOfflineMapArea(offlineMapAreaId);
      
      if (deleted) {
        return res.status(200).json({ message: "Offline map area deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting offline map area" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error deleting offline map area" });
    }
  });
  
  // Waypoint routes
  app.post("/api/waypoints", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertWaypointSchema, { ...req.body, userId: user.id });
    
    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }
    
    try {
      const newWaypoint = await dbStorage.createWaypoint(validation.data!);
      return res.status(201).json(newWaypoint);
    } catch (error) {
      return res.status(500).json({ message: "Error creating waypoint" });
    }
  });
  
  app.get("/api/waypoints", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    
    try {
      const userWaypoints = await dbStorage.getWaypointsByUser(user.id);
      const sharedWaypoints = await dbStorage.getSharedWaypoints(user.id);
      
      return res.status(200).json({
        userWaypoints,
        sharedWaypoints
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching waypoints" });
    }
  });
  
  app.put("/api/waypoints/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const waypointId = parseId(req.params.id);
    if (!waypointId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      // Verify the waypoint belongs to the user
      const waypoint = await dbStorage.getWaypoint(waypointId);
      if (!waypoint) {
        return res.status(404).json({ message: "Waypoint not found" });
      }
      
      if (waypoint.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to update this waypoint" });
      }
      
      const updatedWaypoint = await dbStorage.updateWaypoint(waypointId, req.body);
      
      if (updatedWaypoint) {
        return res.status(200).json(updatedWaypoint);
      } else {
        return res.status(500).json({ message: "Error updating waypoint" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error updating waypoint" });
    }
  });
  
  app.delete("/api/waypoints/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const waypointId = parseId(req.params.id);
    if (!waypointId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      // Verify the waypoint belongs to the user
      const waypoint = await dbStorage.getWaypoint(waypointId);
      if (!waypoint) {
        return res.status(404).json({ message: "Waypoint not found" });
      }
      
      if (waypoint.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this waypoint" });
      }
      
      const deleted = await dbStorage.deleteWaypoint(waypointId);
      
      if (deleted) {
        return res.status(200).json({ message: "Waypoint deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting waypoint" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error deleting waypoint" });
    }
  });
  
  // User Map Drawing routes
  app.post("/api/map-drawings", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const validation = validateRequest(insertMapDrawingSchema, { ...req.body, userId: user.id });
    
    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }
    
    try {
      const newMapDrawing = await dbStorage.createMapDrawing(validation.data!);
      return res.status(201).json(newMapDrawing);
    } catch (error) {
      return res.status(500).json({ message: "Error creating map drawing" });
    }
  });
  
  app.get("/api/map-drawings", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    
    try {
      const mapDrawings = await dbStorage.getMapDrawingsByUser(user.id);
      return res.status(200).json(mapDrawings);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching map drawings" });
    }
  });
  
  app.get("/api/map-drawings/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const drawingId = parseId(req.params.id);
    
    try {
      const drawing = await dbStorage.getMapDrawing(drawingId);
      if (!drawing) {
        return res.status(404).json({ message: "Map drawing not found" });
      }
      
      // Only allow access to the user's own drawings
      if (drawing.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to access this drawing" });
      }
      
      return res.status(200).json(drawing);
    } catch (error) {
      return res.status(500).json({ message: "Error fetching map drawing" });
    }
  });
  
  app.put("/api/map-drawings/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const drawingId = parseId(req.params.id);
    
    try {
      const drawing = await dbStorage.getMapDrawing(drawingId);
      if (!drawing) {
        return res.status(404).json({ message: "Map drawing not found" });
      }
      
      // Only allow updating the user's own drawings
      if (drawing.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to modify this drawing" });
      }
      
      const updatedDrawing = await dbStorage.updateMapDrawing(drawingId, req.body);
      return res.status(200).json(updatedDrawing);
    } catch (error) {
      return res.status(500).json({ message: "Error updating map drawing" });
    }
  });
  
  app.delete("/api/map-drawings/:id", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const drawingId = parseId(req.params.id);
    
    try {
      const drawing = await dbStorage.getMapDrawing(drawingId);
      if (!drawing) {
        return res.status(404).json({ message: "Map drawing not found" });
      }
      
      // Only allow deleting the user's own drawings
      if (drawing.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this drawing" });
      }
      
      const deleted = await dbStorage.deleteMapDrawing(drawingId);
      if (deleted) {
        return res.status(200).json({ message: "Map drawing deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting map drawing" });
      }
    } catch (error) {
      return res.status(500).json({ message: "Error deleting map drawing" });
    }
  });

  // Location sharing API routes
  
  // Send location share request by username
  app.post('/api/location-shares', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { username } = req.body;

    try {
      // Find the target user by username
      const targetUser = await dbStorage.getUserByUsername(username);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      if (targetUser.id === user.id) {
        return res.status(400).json({ message: "Cannot share location with yourself" });
      }

      // Check if share request already exists
      const existingShare = await dbStorage.findLocationShareByUsers(user.id, targetUser.id);
      if (existingShare) {
        return res.status(400).json({ message: "Location share request already exists" });
      }

      // Create location share request
      const locationShare = await dbStorage.createLocationShare({
        fromUserId: user.id,
        toUserId: targetUser.id,
        status: "pending"
      });

      return res.status(201).json({ 
        message: `Location share request sent to ${username}`,
        share: locationShare 
      });
    } catch (error) {
      console.error('Error creating location share:', error);
      return res.status(500).json({ message: "Error sending location share request" });
    }
  });

  // Get pending location share requests for current user
  app.get('/api/location-shares/pending', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;

    try {
      const pendingShares = await dbStorage.getPendingLocationShares(user.id);
      
      // Get usernames for the from users
      const sharesWithUsernames = await Promise.all(
        pendingShares.map(async (share) => {
          const fromUser = await dbStorage.getUser(share.fromUserId);
          return {
            ...share,
            fromUsername: fromUser?.username || 'Unknown User'
          };
        })
      );

      return res.status(200).json(sharesWithUsernames);
    } catch (error) {
      console.error('Error fetching pending shares:', error);
      return res.status(500).json({ message: "Error fetching pending location shares" });
    }
  });

  // Accept or reject location share request
  app.patch('/api/location-shares/:id', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const shareId = parseId(req.params.id);
    if (!shareId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const { status } = req.body; // 'accepted' or 'rejected'

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ message: "Status must be 'accepted' or 'rejected'" });
    }

    try {
      const locationShare = await dbStorage.getLocationShare(shareId);
      if (!locationShare) {
        return res.status(404).json({ message: "Location share request not found" });
      }

      // Only the recipient can accept/reject
      if (locationShare.toUserId !== user.id) {
        return res.status(403).json({ message: "Not authorized to modify this share request" });
      }

      if (locationShare.status !== 'pending') {
        return res.status(400).json({ message: "Share request has already been responded to" });
      }

      const updatedShare = await dbStorage.updateLocationShareStatus(shareId, status, new Date());
      
      return res.status(200).json({
        message: `Location share request ${status}`,
        share: updatedShare
      });
    } catch (error) {
      console.error('Error updating location share:', error);
      return res.status(500).json({ message: "Error updating location share request" });
    }
  });

  // Get current user's location shares (both sent and received)
  app.get('/api/location-shares', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;

    try {
      const allShares = await dbStorage.getLocationSharesByUser(user.id);
      
      // Get usernames for both from and to users
      const sharesWithUsernames = await Promise.all(
        allShares.map(async (share) => {
          const fromUser = await dbStorage.getUser(share.fromUserId);
          const toUser = await dbStorage.getUser(share.toUserId);
          return {
            ...share,
            fromUsername: fromUser?.username || 'Unknown User',
            toUsername: toUser?.username || 'Unknown User'
          };
        })
      );

      return res.status(200).json(sharesWithUsernames);
    } catch (error) {
      console.error('Error fetching location shares:', error);
      return res.status(500).json({ message: "Error fetching location shares" });
    }
  });

  // Update current user's location
  app.post('/api/user-location', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { latitude, longitude, accuracy, heading, speed } = req.body;

    try {
      const userLocation = await dbStorage.upsertUserLocation({
        userId: user.id,
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        accuracy: accuracy?.toString(),
        heading: heading?.toString(),
        speed: speed?.toString(),
        isActive: true
      });

      // Broadcast location update via WebSocket
      const locationData = {
        type: 'location-update',
        userId: user.id,
        username: user.username,
        latitude: parseFloat(userLocation.latitude),
        longitude: parseFloat(userLocation.longitude),
        accuracy: userLocation.accuracy ? parseFloat(userLocation.accuracy) : null,
        heading: userLocation.heading ? parseFloat(userLocation.heading) : null,
        speed: userLocation.speed ? parseFloat(userLocation.speed) : null,
        lastUpdated: userLocation.lastUpdated
      };

      // Send to all connected clients who have accepted location shares
      const acceptedShares = await dbStorage.getLocationSharesByUser(user.id);
      const connectedFriends = acceptedShares
        .filter((share: any) => share.status === 'accepted')
        .map((share: any) => share.fromUserId === user.id ? share.toUserId : share.fromUserId)
        .filter((friendId: any) => clients.has(friendId));

      connectedFriends.forEach(friendId => {
        const friendWs = clients.get(friendId);
        if (friendWs && friendWs.readyState === WebSocket.OPEN) {
          friendWs.send(JSON.stringify(locationData));
        }
      });

      return res.status(200).json(userLocation);
    } catch (error) {
      console.error('Error updating user location:', error);
      return res.status(500).json({ message: "Error updating location" });
    }
  });

  // Get shared locations from friends
  app.get('/api/shared-locations', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;

    try {
      const sharedLocations = await dbStorage.getSharedLocations(user.id);
      
      // Convert string coordinates back to numbers for the frontend
      const formattedLocations = sharedLocations.map((location: any) => ({
        ...location,
        latitude: parseFloat(location.latitude),
        longitude: parseFloat(location.longitude),
        accuracy: location.accuracy ? parseFloat(location.accuracy) : null,
        heading: location.heading ? parseFloat(location.heading) : null,
        speed: location.speed ? parseFloat(location.speed) : null
      }));

      return res.status(200).json(formattedLocations);
    } catch (error) {
      console.error('Error fetching shared locations:', error);
      return res.status(500).json({ message: "Error fetching shared locations" });
    }
  });

  // Delete location share
  app.delete('/api/location-shares/:id', isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const shareId = parseId(req.params.id);

    try {
      const locationShare = await dbStorage.getLocationShare(shareId);
      if (!locationShare) {
        return res.status(404).json({ message: "Location share not found" });
      }

      // Only the creator or recipient can delete
      if (locationShare.fromUserId !== user.id && locationShare.toUserId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this location share" });
      }

      const deleted = await dbStorage.deleteLocationShare(shareId);
      if (deleted) {
        return res.status(200).json({ message: "Location share deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting location share" });
      }
    } catch (error) {
      console.error('Error deleting location share:', error);
      return res.status(500).json({ message: "Error deleting location share" });
    }
  });

  // Route API endpoints
  app.post("/api/routes", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    const requestData = { ...req.body, userId: user.id };
    
    const validation = validateRequest(insertRouteSchema, requestData);
    
    if (!validation.success) {
      return res.status(400).json({ message: validation.error });
    }
    
    try {
      const newRoute = await dbStorage.createRoute(validation.data!);
      return res.status(201).json(newRoute);
    } catch (error) {
      console.error('Error creating route:', error);
      return res.status(500).json({ message: "Error creating route" });
    }
  });

  // Update an existing route
  app.put("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    const user = req.user as any;
    
    if (!routeId) {
      return res.status(400).json({ message: "Invalid route ID" });
    }
    
    try {
      // Verify route exists and user owns it
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }
      
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Only route owner can update" });
      }
      
      // Validate request body fields
      const { 
        pathCoordinates, 
        waypointCoordinates, 
        totalDistance,
        name,
        description,
        notes,
        elevationGain,
        elevationLoss,
        estimatedTime,
        routingMode,
        isPublic
      } = req.body;
      
      if (!pathCoordinates || typeof pathCoordinates !== 'string') {
        return res.status(400).json({ message: "pathCoordinates is required and must be a JSON string" });
      }
      
      if (!waypointCoordinates || typeof waypointCoordinates !== 'string') {
        return res.status(400).json({ message: "waypointCoordinates is required and must be a JSON string" });
      }
      
      // Validate JSON format
      try {
        JSON.parse(pathCoordinates);
        JSON.parse(waypointCoordinates);
      } catch {
        return res.status(400).json({ message: "Invalid JSON format in coordinates" });
      }
      
      // Validate totalDistance is a number
      if (totalDistance !== undefined && typeof totalDistance !== 'number') {
        return res.status(400).json({ message: "totalDistance must be a number" });
      }
      
      // Parse waypoint coordinates for routing calculations
      let waypointCoordsArray: [number, number][] = [];
      try {
        const parsed = JSON.parse(waypointCoordinates);
        
        // Handle different waypoint formats
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (typeof parsed[0] === 'object' && !Array.isArray(parsed[0]) && parsed[0].lngLat !== undefined) {
            // Format: [{name, lngLat: [lng, lat], elevation}, ...]
            waypointCoordsArray = parsed.map((wp: any) => wp.lngLat as [number, number]);
          } else if (typeof parsed[0] === 'object' && !Array.isArray(parsed[0]) && parsed[0].lng !== undefined) {
            // Format: [{lng, lat}, ...]
            waypointCoordsArray = parsed.map((wp: any) => [wp.lng, wp.lat] as [number, number]);
          } else if (Array.isArray(parsed[0])) {
            // Format: [[lng, lat], ...]
            waypointCoordsArray = parsed;
          } else {
            waypointCoordsArray = parsed;
          }
        }
      } catch {
        return res.status(400).json({ message: "Invalid waypoint coordinates format" });
      }
      
      // Calculate actual path based on routing mode
      let finalPathCoordinates = pathCoordinates;
      let finalTotalDistance = totalDistance;
      
      const effectiveRoutingMode = routingMode || route.routingMode;
      
      if (effectiveRoutingMode === 'trail' && waypointCoordsArray.length >= 2) {
        try {
          const { calculateTrailRoute } = await import('./trailRouting');
          const trailResult = await calculateTrailRoute(waypointCoordsArray);
          
          if (trailResult.success && trailResult.coordinates.length > 0) {
            finalPathCoordinates = JSON.stringify(trailResult.coordinates);
            finalTotalDistance = trailResult.distance;
          } else {
            // Fall back to direct path if trail routing fails
          }
        } catch (error) {
          console.error('Trail routing error during save:', error);
          // Continue with direct path if trail routing fails
        }
      }
      
      // Update the route with all editable fields
      const updateData: any = {
        pathCoordinates: finalPathCoordinates,
        waypointCoordinates,
        totalDistance: finalTotalDistance
      };
      
      // Add optional fields if provided
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (notes !== undefined) updateData.notes = notes;
      if (elevationGain !== undefined) updateData.elevationGain = elevationGain;
      if (elevationLoss !== undefined) updateData.elevationLoss = elevationLoss;
      if (estimatedTime !== undefined) updateData.estimatedTime = estimatedTime;
      if (routingMode !== undefined) updateData.routingMode = routingMode;
      if (isPublic !== undefined) updateData.isPublic = isPublic;
      
      const updatedRoute = await dbStorage.updateRoute(routeId, updateData);
      return res.status(200).json(updatedRoute);
    } catch (error) {
      console.error('Error updating route:', error);
      return res.status(500).json({ message: "Error updating route" });
    }
  });

  // Partial update for route (toggle public, etc.)
  app.patch("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    const user = req.user as any;
    
    if (!routeId) {
      return res.status(400).json({ message: "Invalid route ID" });
    }
    
    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }
      
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Only route owner can update" });
      }
      
      const { isPublic, name, description, notes } = req.body;
      
      const updateData: any = {};
      if (isPublic !== undefined) updateData.isPublic = isPublic;
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (notes !== undefined) updateData.notes = notes;
      
      const updatedRoute = await dbStorage.updateRoute(routeId, updateData);
      return res.status(200).json(updatedRoute);
    } catch (error) {
      console.error('Error updating route:', error);
      return res.status(500).json({ message: "Error updating route" });
    }
  });

  app.get("/api/routes", isAuthenticated, async (req, res) => {
    const user = req.user as any;
    
    try {
      // Get user's own routes
      const ownRoutes = await dbStorage.getRoutesByUser(user.id);
      
      // Get routes shared with user
      const sharedRoutes = await dbStorage.getRoutesSharedWithUser(user.id);
      
      // Get share counts for own routes
      const ownRouteIds = ownRoutes.map(r => r.id);
      const shareCounts = await dbStorage.getRouteShareCounts(ownRouteIds);
      
      // Combine and mark shared routes
      const allRoutes = [
        ...ownRoutes.map(route => ({ 
          ...route, 
          isOwner: true, 
          isShared: false,
          shareCount: shareCounts.get(route.id) || 0
        })),
        ...sharedRoutes.map(route => ({ ...route, isOwner: false, isShared: true, shareCount: 0 }))
      ];
      
      return res.status(200).json(allRoutes);
    } catch (error) {
      console.error('Error fetching routes:', error);
      return res.status(500).json({ message: "Error fetching routes" });
    }
  });

  app.get("/api/routes/public", async (req, res) => {
    try {
      const publicRoutes = await dbStorage.getPublicRoutesWithOwners();
      return res.status(200).json(publicRoutes);
    } catch (error) {
      console.error('Error fetching public routes:', error);
      return res.status(500).json({ message: "Error fetching public routes" });
    }
  });

  // Get user public profile with their public routes
  app.get("/api/users/:userId/public-profile", async (req, res) => {
    const userId = parseId(req.params.userId);
    
    if (!userId) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    
    try {
      const user = await dbStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const publicRoutes = await dbStorage.getUserPublicRoutes(userId);
      
      return res.status(200).json({
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        routes: publicRoutes
      });
    } catch (error) {
      console.error('Error fetching user public profile:', error);
      return res.status(500).json({ message: "Error fetching user profile" });
    }
  });

  app.get("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    
    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }
      
      // Check if user owns the route or if it's public
      if (route.userId !== user.id && !route.isPublic) {
        return res.status(403).json({ message: "Not authorized to view this route" });
      }
      
      return res.status(200).json(route);
    } catch (error) {
      console.error('Error fetching route:', error);
      return res.status(500).json({ message: "Error fetching route" });
    }
  });

  app.delete("/api/routes/:id", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    
    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }
      
      // Only allow deleting user's own routes
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this route" });
      }
      
      const deleted = await dbStorage.deleteRoute(routeId);
      if (deleted) {
        return res.status(200).json({ message: "Route deleted successfully" });
      } else {
        return res.status(500).json({ message: "Error deleting route" });
      }
    } catch (error) {
      console.error('Error deleting route:', error);
      return res.status(500).json({ message: "Error deleting route" });
    }
  });

  // Route sharing endpoints
  app.post("/api/routes/:id/share", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const { emailOrUsername } = req.body;

    try {
      // Verify route exists and user owns it
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Only route owner can share" });
      }

      // Find user by email or username
      let targetUser = await dbStorage.getUserByEmail(emailOrUsername);
      if (!targetUser) {
        targetUser = await dbStorage.getUserByUsername(emailOrUsername);
      }

      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Don't allow sharing with yourself
      if (targetUser.id === user.id) {
        return res.status(400).json({ message: "Cannot share route with yourself" });
      }

      // Check if already shared
      const isAlreadyShared = await dbStorage.isRouteSharedWithUser(routeId, targetUser.id);
      if (isAlreadyShared) {
        return res.status(400).json({ message: "Route already shared with this user" });
      }

      // Create share
      const share = await dbStorage.shareRoute({
        routeId,
        sharedWithUserId: targetUser.id,
        sharedByUserId: user.id,
      });

      return res.status(201).json({
        message: "Route shared successfully",
        share
      });
    } catch (error) {
      console.error('Error sharing route:', error);
      return res.status(500).json({ message: "Error sharing route" });
    }
  });

  app.get("/api/routes/:id/shares", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can see who route is shared with
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const shares = await dbStorage.getRouteShares(routeId);
      return res.status(200).json(shares);
    } catch (error) {
      console.error('Error fetching route shares:', error);
      return res.status(500).json({ message: "Error fetching shares" });
    }
  });

  app.delete("/api/routes/:id/shares/:shareId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.id);
    const shareId = parseId(req.params.shareId);
    if (!routeId || !shareId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can revoke shares
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const revoked = await dbStorage.revokeRouteShare(shareId);
      if (revoked) {
        return res.status(200).json({ message: "Share revoked successfully" });
      } else {
        return res.status(404).json({ message: "Share not found" });
      }
    } catch (error) {
      console.error('Error revoking share:', error);
      return res.status(500).json({ message: "Error revoking share" });
    }
  });

  // Route Notes endpoints
  app.get("/api/routes/:routeId/notes", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      const isOwner = route.userId === user.id;
      const isShared = await dbStorage.isRouteSharedWithUser(routeId, user.id);
      
      if (!isOwner && !isShared && !route.isPublic) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const notes = await dbStorage.getRouteNotes(routeId);
      return res.status(200).json(notes);
    } catch (error) {
      console.error('Error fetching route notes:', error);
      return res.status(500).json({ message: "Error fetching route notes" });
    }
  });

  app.post("/api/routes/:routeId/notes", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { category, content, position } = req.body;
      
      if (!category) {
        return res.status(400).json({ message: "Category is required" });
      }

      const note = await dbStorage.createRouteNote({
        routeId,
        category,
        content: content || '',
        position: position || 0,
      });

      return res.status(201).json(note);
    } catch (error) {
      console.error('Error creating route note:', error);
      return res.status(500).json({ message: "Error creating route note" });
    }
  });

  app.put("/api/routes/:routeId/notes/:noteId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const noteId = parseId(req.params.noteId);
    if (!routeId || !noteId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { category, content, position } = req.body;
      const updateData: any = {};
      if (category !== undefined) updateData.category = category;
      if (content !== undefined) updateData.content = content;
      if (position !== undefined) updateData.position = position;

      const updated = await dbStorage.updateRouteNote(noteId, updateData);
      if (!updated) {
        return res.status(404).json({ message: "Note not found" });
      }

      return res.status(200).json(updated);
    } catch (error) {
      console.error('Error updating route note:', error);
      return res.status(500).json({ message: "Error updating route note" });
    }
  });

  app.delete("/api/routes/:routeId/notes/:noteId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const noteId = parseId(req.params.noteId);
    if (!routeId || !noteId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const deleted = await dbStorage.deleteRouteNote(noteId);
      if (!deleted) {
        return res.status(404).json({ message: "Note not found" });
      }

      return res.status(200).json({ message: "Note deleted" });
    } catch (error) {
      console.error('Error deleting route note:', error);
      return res.status(500).json({ message: "Error deleting route note" });
    }
  });

  // Route Points of Interest endpoints
  app.get("/api/routes/:routeId/pois", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Check access (owner or shared with user)
      const isOwner = route.userId === user.id;
      const isShared = await dbStorage.isRouteSharedWithUser(routeId, user.id);
      
      if (!isOwner && !isShared && !route.isPublic) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const pois = await dbStorage.getRoutePointsOfInterest(routeId);
      return res.status(200).json(pois);
    } catch (error) {
      console.error('Error fetching route POIs:', error);
      return res.status(500).json({ message: "Error fetching points of interest" });
    }
  });

  app.post("/api/routes/:routeId/pois", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can add POIs
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { name, latitude, longitude, elevation, note } = req.body;
      
      if (!name || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ message: "Name, latitude, and longitude are required" });
      }

      const poi = await dbStorage.createRoutePointOfInterest({
        routeId,
        name,
        latitude: String(latitude),
        longitude: String(longitude),
        elevation: elevation ? String(elevation) : undefined,
        note
      });

      return res.status(201).json(poi);
    } catch (error) {
      console.error('Error creating route POI:', error);
      return res.status(500).json({ message: "Error creating point of interest" });
    }
  });

  app.put("/api/routes/:routeId/pois/:poiId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can edit POIs
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      const { name, latitude, longitude, elevation, note, photos } = req.body;
      const updateData: any = {};
      
      if (name !== undefined) updateData.name = name;
      if (latitude !== undefined) updateData.latitude = String(latitude);
      if (longitude !== undefined) updateData.longitude = String(longitude);
      if (elevation !== undefined) updateData.elevation = String(elevation);
      if (note !== undefined) updateData.note = note;
      if (photos !== undefined) updateData.photos = photos;

      const updated = await dbStorage.updateRoutePointOfInterest(poiId, updateData);
      return res.status(200).json(updated);
    } catch (error) {
      console.error('Error updating route POI:', error);
      return res.status(500).json({ message: "Error updating point of interest" });
    }
  });

  // Upload photos for a POI
  app.post("/api/routes/:routeId/pois/:poiId/photos", isAuthenticated, waypointPhotoUpload.array('photos', 100), async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const files = req.files as Express.Multer.File[];

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No photos uploaded" });
      }

      // Get existing photos and append new ones
      const existingPhotos: string[] = poi.photos ? JSON.parse(poi.photos) : [];
      const newPhotoPaths = files.map(file => `/api/waypoint-photos/${path.basename(file.path)}`);
      const allPhotos = [...existingPhotos, ...newPhotoPaths];

      const updated = await dbStorage.updateRoutePointOfInterest(poiId, {
        photos: JSON.stringify(allPhotos)
      });

      return res.status(200).json({ 
        message: "Photos uploaded successfully",
        photos: allPhotos,
        poi: updated
      });
    } catch (error) {
      console.error('Error uploading POI photos:', error);
      if (files) {
        files.forEach(file => fs.unlink(file.path, () => {}));
      }
      return res.status(500).json({ message: "Error uploading photos" });
    }
  });

  // Delete a photo from a POI
  app.delete("/api/routes/:routeId/pois/:poiId/photos", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const { photoPath } = req.body;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      const existingPhotos: string[] = poi.photos ? JSON.parse(poi.photos) : [];
      const updatedPhotos = existingPhotos.filter(p => p !== photoPath);

      // Delete file from disk
      const filename = path.basename(photoPath);
      const filePath = path.join(waypointPhotoDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const updated = await dbStorage.updateRoutePointOfInterest(poiId, {
        photos: JSON.stringify(updatedPhotos)
      });

      return res.status(200).json({ 
        message: "Photo deleted",
        photos: updatedPhotos,
        poi: updated
      });
    } catch (error) {
      console.error('Error deleting POI photo:', error);
      return res.status(500).json({ message: "Error deleting photo" });
    }
  });

  // Serve waypoint photos
  app.get("/api/waypoint-photos/:filename", (req, res) => {
    const filePath = safePath(waypointPhotoDir, req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid filename" });
    }
    
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "Photo not found" });
    }
  });

  // Upload photos for a route
  app.post("/api/routes/:routeId/photos", isAuthenticated, (req, res, next) => {
    routePhotoUpload.array('photos', 100)(req, res, (err) => {
      if (err) {
        console.error('Multer error uploading route photos:', err);
        return res.status(400).json({ message: err.message || "Error uploading files" });
      }
      next();
    });
  }, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const files = req.files as Express.Multer.File[];

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No photos uploaded" });
      }

      // Get existing photos and append new ones
      const existingPhotos: string[] = route.photos ? JSON.parse(route.photos) : [];
      const newPhotoPaths = files.map(file => `/api/route-photos/${path.basename(file.path)}`);
      const allPhotos = [...existingPhotos, ...newPhotoPaths];

      const updated = await dbStorage.updateRoute(routeId, {
        photos: JSON.stringify(allPhotos)
      });

      return res.status(200).json({ 
        message: "Photos uploaded successfully",
        photos: allPhotos,
        route: updated
      });
    } catch (error) {
      console.error('Error uploading route photos:', error);
      if (files) {
        files.forEach(file => fs.unlink(file.path, () => {}));
      }
      return res.status(500).json({ message: "Error uploading photos" });
    }
  });

  // Delete a photo from a route
  app.delete("/api/routes/:routeId/photos", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    if (!routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;
    const { photoPath } = req.body;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const existingPhotos: string[] = route.photos ? JSON.parse(route.photos) : [];
      const updatedPhotos = existingPhotos.filter(p => p !== photoPath);

      // Delete file from disk
      const filename = path.basename(photoPath);
      const filePath = path.join(routePhotoDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const updated = await dbStorage.updateRoute(routeId, {
        photos: JSON.stringify(updatedPhotos)
      });

      return res.status(200).json({ 
        message: "Photo deleted",
        photos: updatedPhotos,
        route: updated
      });
    } catch (error) {
      console.error('Error deleting route photo:', error);
      return res.status(500).json({ message: "Error deleting photo" });
    }
  });

  // Serve route photos
  app.get("/api/route-photos/:filename", (req, res) => {
    const filePath = safePath(routePhotoDir, req.params.filename);
    if (!filePath) {
      return res.status(400).json({ message: "Invalid filename" });
    }
    
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "Photo not found" });
    }
  });

  app.delete("/api/routes/:routeId/pois/:poiId", isAuthenticated, async (req, res) => {
    const routeId = parseId(req.params.routeId);
    const poiId = parseId(req.params.poiId);
    if (!routeId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const user = req.user as any;

    try {
      const route = await dbStorage.getRoute(routeId);
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      // Only owner can delete POIs
      if (route.userId !== user.id) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const poi = await dbStorage.getRoutePointOfInterest(poiId);
      if (!poi || poi.routeId !== routeId) {
        return res.status(404).json({ message: "Point of interest not found" });
      }

      const deleted = await dbStorage.deleteRoutePointOfInterest(poiId);
      if (deleted) {
        return res.status(200).json({ message: "Point of interest deleted" });
      } else {
        return res.status(500).json({ message: "Failed to delete" });
      }
    } catch (error) {
      console.error('Error deleting route POI:', error);
      return res.status(500).json({ message: "Error deleting point of interest" });
    }
  });

  // Trail routing endpoints
  const { calculateTrailRoute, getTrailStats, ALLOWED_PROFILES } = await import('./trailRouting');
  type ActivityProfile = typeof ALLOWED_PROFILES[number];

  app.post("/api/ors/hiking-route", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { waypoints } = req.body;

      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({
          success: false,
          message: "At least 2 waypoints required (format: [[lng, lat], [lng, lat], ...])"
        });
      }

      if (waypoints.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Maximum 50 waypoints allowed"
        });
      }

      const orsApiKey = process.env.ORS_API_KEY;
      if (!orsApiKey) {
        console.log('ORS_API_KEY not set, falling back to custom trail router');
        const result = await calculateTrailRoute(waypoints);
        return res.json(result);
      }

      const orsResponse = await fetch('https://api.openrouteservice.org/v2/directions/foot-hiking/geojson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': orsApiKey
        },
        body: JSON.stringify({
          coordinates: waypoints,
          elevation: true,
          instructions: false,
          preference: 'recommended'
        })
      });

      if (!orsResponse.ok) {
        const errorText = await orsResponse.text();
        console.error(`ORS API error ${orsResponse.status}:`, errorText);

        if (orsResponse.status === 429 || orsResponse.status >= 500) {
          console.log('ORS unavailable, falling back to custom trail router');
          const result = await calculateTrailRoute(waypoints);
          return res.json(result);
        }

        return res.status(orsResponse.status).json({
          success: false,
          message: `Hiking route calculation failed: ${errorText}`
        });
      }

      const orsData = await orsResponse.json();

      if (!orsData.features || orsData.features.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No hiking route found between these waypoints. Try moving them closer to trails."
        });
      }

      const feature = orsData.features[0];
      const coordinates = feature.geometry.coordinates;
      const summary = feature.properties.summary;

      const pathCoordinates: [number, number][] = coordinates.map((c: number[]) => [c[0], c[1]]);

      let elevationGain = 0;
      let elevationLoss = 0;
      for (let i = 1; i < coordinates.length; i++) {
        if (coordinates[i].length >= 3 && coordinates[i - 1].length >= 3) {
          const diff = coordinates[i][2] - coordinates[i - 1][2];
          if (diff > 0) elevationGain += diff;
          else elevationLoss += Math.abs(diff);
        }
      }

      return res.json({
        success: true,
        coordinates: pathCoordinates,
        distance: summary.distance,
        duration: summary.duration,
        elevationGain: Math.round(elevationGain),
        elevationLoss: Math.round(elevationLoss),
        source: 'openrouteservice'
      });

    } catch (error) {
      console.error('ORS hiking route error:', error);

      try {
        const { waypoints } = req.body;
        const result = await calculateTrailRoute(waypoints);
        return res.json(result);
      } catch (fallbackError) {
        return res.status(500).json({
          success: false,
          message: `Hiking route error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }
  });

  app.post("/api/ors/route", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { waypoints, profile } = req.body;

      if (!profile || !ALLOWED_PROFILES.includes(profile)) {
        return res.status(400).json({
          success: false,
          message: `Invalid profile. Allowed: ${ALLOWED_PROFILES.join(', ')}`
        });
      }

      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({
          success: false,
          message: "At least 2 waypoints required (format: [[lng, lat], [lng, lat], ...])"
        });
      }

      if (waypoints.length > 50) {
        return res.status(400).json({
          success: false,
          message: "Maximum 50 waypoints allowed"
        });
      }

      const orsApiKey = process.env.ORS_API_KEY;
      if (!orsApiKey) {
        console.log(`ORS_API_KEY not set, falling back to custom trail router (profile: ${profile})`);
        const result = await calculateTrailRoute(waypoints, profile);
        return res.json(result);
      }

      const orsUrl = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

      const orsResponse = await fetch(orsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': orsApiKey
        },
        body: JSON.stringify({
          coordinates: waypoints,
          elevation: true,
          instructions: false,
          preference: 'recommended'
        })
      });

      if (!orsResponse.ok) {
        const errorText = await orsResponse.text();
        console.error(`ORS API error ${orsResponse.status} (profile: ${profile}):`, errorText);

        if (orsResponse.status === 429 || orsResponse.status >= 500) {
          console.log(`ORS unavailable, falling back to custom trail router (profile: ${profile})`);
          const result = await calculateTrailRoute(waypoints, profile);
          return res.json(result);
        }

        return res.status(orsResponse.status).json({
          success: false,
          message: `Route calculation failed: ${errorText}`
        });
      }

      const orsData = await orsResponse.json();

      if (!orsData.features || orsData.features.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No route found between these waypoints. Try moving them closer to paths."
        });
      }

      const feature = orsData.features[0];
      const coordinates = feature.geometry.coordinates;
      const summary = feature.properties.summary;

      const pathCoordinates: [number, number][] = coordinates.map((c: number[]) => [c[0], c[1]]);

      let elevationGain = 0;
      let elevationLoss = 0;
      for (let i = 1; i < coordinates.length; i++) {
        if (coordinates[i].length >= 3 && coordinates[i - 1].length >= 3) {
          const diff = coordinates[i][2] - coordinates[i - 1][2];
          if (diff > 0) elevationGain += diff;
          else elevationLoss += Math.abs(diff);
        }
      }

      return res.json({
        success: true,
        coordinates: pathCoordinates,
        distance: summary.distance,
        duration: summary.duration,
        elevationGain: Math.round(elevationGain),
        elevationLoss: Math.round(elevationLoss),
        profile,
        source: 'openrouteservice'
      });

    } catch (error) {
      console.error('ORS route error:', error);

      try {
        const { waypoints, profile } = req.body;
        const result = await calculateTrailRoute(waypoints, profile || 'foot-hiking');
        return res.json(result);
      } catch (fallbackError) {
        return res.status(500).json({
          success: false,
          message: `Route error: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }
  });

  // Calculate shortest path route on trails
  app.post("/api/trails/route", async (req, res) => {
    try {
      const { waypoints } = req.body;
      
      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({ 
          success: false, 
          message: "At least 2 waypoints required (format: [[lng, lat], [lng, lat], ...])" 
        });
      }

      // Validate waypoint format
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (!Array.isArray(wp) || wp.length !== 2 || typeof wp[0] !== 'number' || typeof wp[1] !== 'number') {
          return res.status(400).json({ 
            success: false, 
            message: `Invalid waypoint format at index ${i}. Expected [longitude, latitude]` 
          });
        }
      }

      const result = await calculateTrailRoute(waypoints);
      
      return res.json(result);
    } catch (error) {
      console.error('Trail routing error:', error);
      return res.status(500).json({ 
        success: false, 
        message: `Trail routing error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  });

  // Get trail statistics for an area
  app.get("/api/trails/stats", async (req, res) => {
    try {
      const { minLat, minLon, maxLat, maxLon } = req.query;
      
      if (!minLat || !minLon || !maxLat || !maxLon) {
        return res.status(400).json({ 
          success: false, 
          message: "Bounding box required: minLat, minLon, maxLat, maxLon" 
        });
      }

      const stats = await getTrailStats(
        parseFloat(minLat as string),
        parseFloat(minLon as string),
        parseFloat(maxLat as string),
        parseFloat(maxLon as string)
      );
      
      return res.json({ success: true, ...stats });
    } catch (error) {
      console.error('Trail stats error:', error);
      return res.status(500).json({ 
        success: false, 
        message: `Failed to get trail stats: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    }
  });
  
  // ============================================
  // Fetch real hiking trail data for an area
  // Used to give AI knowledge of actual trails
  // ============================================
  app.get("/api/trails/named-routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { lat, lng, radius } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({ error: "lat and lng parameters required" });
      }

      const centerLat = parseFloat(lat as string);
      const centerLng = parseFloat(lng as string);
      const searchRadius = parseFloat((radius as string) || '0.15');

      const bbox = `${centerLng - searchRadius},${centerLat - searchRadius},${centerLng + searchRadius},${centerLat + searchRadius}`;

      const wmtResponse = await fetch(
        `https://hiking.waymarkedtrails.org/api/v1/list/by_bbox?bbox=${bbox}&limit=30`,
        { signal: AbortSignal.timeout(10000) }
      );

      let namedRoutes: any[] = [];
      if (wmtResponse.ok) {
        const wmtData = await wmtResponse.json();
        if (wmtData.results) {
          namedRoutes = wmtData.results.map((r: any) => ({
            id: r.id,
            name: r.name || r.ref || 'Unnamed route',
            ref: r.ref || null,
            group: r.group || null,
            type: r.type || 'relation'
          }));
        }
      }

      const overpassQuery = `
        [out:json][timeout:15];
        (
          way["highway"~"path|footway|track"]["name"](${centerLat - searchRadius},${centerLng - searchRadius},${centerLat + searchRadius},${centerLng + searchRadius});
          relation["route"="hiking"](${centerLat - searchRadius},${centerLng - searchRadius},${centerLat + searchRadius},${centerLng + searchRadius});
        );
        out tags;
      `;

      let trailDetails: any[] = [];
      try {
        const overpassResponse = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: AbortSignal.timeout(12000)
        });

        if (overpassResponse.ok) {
          const overpassData = await overpassResponse.json();
          trailDetails = overpassData.elements
            .filter((el: any) => el.tags?.name)
            .map((el: any) => ({
              name: el.tags.name,
              type: el.type,
              highway: el.tags.highway || null,
              sac_scale: el.tags.sac_scale || null,
              surface: el.tags.surface || null,
              trail_visibility: el.tags.trail_visibility || null,
              ref: el.tags.ref || null,
              distance: el.tags.distance || null,
              description: el.tags.description || null
            }));
        }
      } catch (overpassError) {
        console.warn('Overpass query failed (non-critical):', overpassError);
      }

      const allTrails = new Map<string, any>();
      for (const route of namedRoutes) {
        allTrails.set(route.name, { ...route, source: 'waymarkedtrails' });
      }
      for (const trail of trailDetails) {
        if (!allTrails.has(trail.name)) {
          allTrails.set(trail.name, { ...trail, source: 'overpass' });
        } else {
          const existing = allTrails.get(trail.name);
          if (trail.sac_scale) existing.sac_scale = trail.sac_scale;
          if (trail.surface) existing.surface = trail.surface;
          if (trail.description) existing.description = trail.description;
        }
      }

      res.json({
        trails: Array.from(allTrails.values()),
        center: { lat: centerLat, lng: centerLng },
        bbox
      });

    } catch (error) {
      console.error('Named routes error:', error);
      res.json({ trails: [], center: null, bbox: null });
    }
  });

  // ============================================
  // AI Route Generation
  // ============================================
  
  app.post("/api/ai/generate-route", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { prompt, routingMode, centerLat, centerLng } = req.body;

      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: "A route description is required" });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "AI route generation is not configured. Missing ANTHROPIC_API_KEY." });
      }

      let trailContext = '';
      
      if (centerLat && centerLng) {
        try {
          const trailsUrl = `http://localhost:${process.env.PORT || 5000}/api/trails/named-routes?lat=${centerLat}&lng=${centerLng}&radius=0.15`;
          const trailsResponse = await fetch(trailsUrl, {
            headers: { 'Cookie': req.headers.cookie || '' },
            signal: AbortSignal.timeout(15000)
          });

          if (trailsResponse.ok) {
            const trailsData = await trailsResponse.json();
            if (trailsData.trails && trailsData.trails.length > 0) {
              const trailList = trailsData.trails
                .slice(0, 25)
                .map((t: any) => {
                  let desc = `- ${t.name}`;
                  if (t.sac_scale) desc += ` (difficulty: ${t.sac_scale})`;
                  if (t.surface) desc += ` (surface: ${t.surface})`;
                  if (t.distance) desc += ` (${t.distance})`;
                  if (t.description) desc += ` — ${t.description}`;
                  return desc;
                })
                .join('\n');

              trailContext = `

REAL TRAIL DATA FOR THIS AREA (from OpenStreetMap):
The following named hiking trails and routes exist in this area. Use these REAL trail names for your waypoints. Place waypoints at junctions, trailheads, and key points ALONG these actual trails:

${trailList}

IMPORTANT: Prefer waypoints along these real, named trails. Use the actual trail names in your waypoint names (e.g., "Teton Crest Trail Junction" not "Waypoint 3"). If the user's request matches one of these trails, route along it.`;
            }
          }
        } catch (trailFetchError) {
          console.warn('Failed to fetch trail context (non-critical):', trailFetchError);
        }
      }

      const client = new Anthropic({ apiKey });

      const routingContext = (routingMode === 'trail' || routingMode === 'rivers')
        ? 'The user will route on TRAILS between your waypoints. Place waypoints near known trail junctions, trailheads, and intersections so the trail router can connect them along real hiking paths.'
        : routingMode === 'road'
        ? 'The user will route on ROADS between your waypoints. Place waypoints at road intersections, parking lots, and key turns.'
        : 'The user will draw DIRECT LINES between your waypoints. Place waypoints to outline the shape of the route.';

      const systemPrompt = `You are a geographic route planner for outdoor activities (hiking, running, biking, skiing, etc). Given a user's natural language description of a desired route, return ONLY a valid JSON object with waypoints.

CRITICAL RULES:
- Return ONLY valid JSON. No other text, no markdown backticks, no explanation.
- Use your geographic knowledge of trails, parks, roads, mountains, lakes, and landmarks.
- Coordinates MUST be [longitude, latitude] format (longitude first, like GeoJSON).
- Include 4-15 waypoints depending on route complexity.
- ${routingContext}
- If the user asks for a loop, the last waypoint should be the same location as the first.
- Name waypoints descriptively using real place names when possible.
- If you are not confident about exact coordinates for a location, approximate using your best knowledge of the area's geography.
${trailContext}

Response JSON format:
{
  "name": "Descriptive Route Name",
  "description": "Brief description of the route and what to expect",
  "waypoints": [
    { "name": "Starting Point Name", "lng": -110.1234, "lat": 43.5678 },
    { "name": "Second Point", "lng": -110.1245, "lat": 43.5690 }
  ]
}`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          { role: "user", content: prompt.trim() }
        ]
      });

      const responseText = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      const cleanJson = responseText.replace(/```json\s*|```\s*/g, '').trim();

      let routeData;
      try {
        routeData = JSON.parse(cleanJson);
      } catch (parseError) {
        console.error('Failed to parse AI response:', responseText);
        return res.status(500).json({
          error: "AI returned an invalid response. Please try rephrasing your route description."
        });
      }

      if (!routeData.waypoints || !Array.isArray(routeData.waypoints) || routeData.waypoints.length < 2) {
        return res.status(500).json({
          error: "AI could not generate enough waypoints. Try being more specific about the location."
        });
      }

      for (const wp of routeData.waypoints) {
        if (typeof wp.lng !== 'number' || typeof wp.lat !== 'number' ||
            wp.lng < -180 || wp.lng > 180 || wp.lat < -90 || wp.lat > 90) {
          return res.status(500).json({
            error: "AI returned invalid coordinates. Please try again."
          });
        }
      }

      res.json({
        name: routeData.name || "AI Generated Route",
        description: routeData.description || "",
        waypoints: routeData.waypoints.map((wp: any, index: number) => ({
          name: wp.name || `Waypoint ${index + 1}`,
          lng: wp.lng,
          lat: wp.lat
        }))
      });

    } catch (error: any) {
      console.error('AI route generation error:', error);

      if (error?.status === 401) {
        return res.status(500).json({ error: "Invalid API key. Check ANTHROPIC_API_KEY." });
      }
      if (error?.status === 429) {
        return res.status(429).json({ error: "Rate limited. Please wait a moment and try again." });
      }

      res.status(500).json({ error: "Failed to generate route. Please try again." });
    }
  });

  // WebSocket server for real-time location sharing
  const wss = new WebSocketServer({ noServer: true });
  
  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }

    const mockRes: any = {
      end: () => {},
      setHeader: () => mockRes,
      getHeader: () => undefined,
      writeHead: () => mockRes,
      on: () => mockRes,
      emit: () => mockRes,
    };

    sessionMiddleware(request as any, mockRes, () => {
      const sess = (request as any).session;
      const authenticatedUserId = sess?.passport?.user;

      if (!authenticatedUserId) {
        console.log('WebSocket: Rejecting unauthenticated connection');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).authenticatedUserId = authenticatedUserId;
        wss.emit('connection', ws, request);
      });
    });
  });

  // Store connected clients
  const clients: Map<number, WebSocket> = new Map();
  
  // Store live map session rooms: sessionId -> Set of userIds
  const sessionRooms: Map<number, Set<number>> = new Map();
  
  function broadcastToSession(sessionId: number, message: any) {
    const room = sessionRooms.get(sessionId);
    if (!room) return;
    
    const messageStr = JSON.stringify({ ...message, sessionId });
    room.forEach(userId => {
      const client = clients.get(userId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }
  
  wss.on('connection', (ws: WebSocket) => {
    const userId: number = (ws as any).authenticatedUserId;
    let currentSessionId: number | null = null;
    
    (ws as any).isAlive = true;
    
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });
    
    clients.set(userId, ws);
    
    ws.send(JSON.stringify({ 
      type: 'auth',
      status: 'success',
      userId: userId,
      message: 'Connected to location sharing service'
    }));
    
    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message);
        
        (ws as any).isAlive = true;
        
        if (data.type === 'auth') {
          return;
        }
        
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        
        if (data.type === 'session:join' && userId) {
          const sessionId = parseId(String(data.sessionId));
          if (!sessionId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid session ID' }));
            return;
          }
          
          try {
            const session = await dbStorage.getLiveMapSession(sessionId);
            if (!session || !session.isActive) {
              ws.send(JSON.stringify({ type: 'error', message: 'Session not found or ended' }));
              return;
            }
            
            const members = await dbStorage.getLiveMapMembers(sessionId);
            const isMember = members.some((m: any) => m.userId === userId) || session.ownerId === userId;
            
            if (!isMember) {
              ws.send(JSON.stringify({ type: 'error', message: 'Not a member of this session' }));
              return;
            }
          } catch (err) {
            console.error('Error verifying session membership:', err);
          }
          
          currentSessionId = sessionId;
          
          if (!sessionRooms.has(sessionId)) {
            sessionRooms.set(sessionId, new Set());
          }
          sessionRooms.get(sessionId)!.add(userId);
          
          ws.send(JSON.stringify({
            type: 'session:joined',
            sessionId
          }));
        }
        
        if (data.type === 'session:leave' && userId && currentSessionId) {
          const room = sessionRooms.get(currentSessionId);
          if (room) {
            room.delete(userId);
            if (room.size === 0) {
              sessionRooms.delete(currentSessionId);
            }
          }
          currentSessionId = null;
        }
        
        if (data.type === 'session:location' && userId && currentSessionId) {
          const { latitude, longitude, accuracy, heading } = data;
          
          await dbStorage.updateLiveMapMemberLocation(
            currentSessionId,
            userId,
            String(latitude),
            String(longitude),
            accuracy ? String(accuracy) : undefined,
            heading ? String(heading) : undefined
          );
          
          broadcastToSession(currentSessionId, {
            type: 'member:locationUpdate',
            data: { userId, latitude, longitude, accuracy, heading }
          });
        }
        
        if (data.type === 'location' && userId) {
          const validation = validateRequest(locationShareSchema, data.location);
          if (!validation.success) {
            ws.send(JSON.stringify({ 
              type: 'error',
              message: validation.error
            }));
            return;
          }
          
          try {
            const sender = await dbStorage.getUser(userId);
            if (!sender || !sender.locationSharingEnabled) return;
            
            const friendIds = await dbStorage.getFriendIdsForLocationBroadcast(userId);
            
            friendIds.forEach((friendId: number) => {
              const friendClient = clients.get(friendId);
              if (friendClient && friendClient.readyState === WebSocket.OPEN) {
                friendClient.send(JSON.stringify({
                  type: 'location',
                  userId,
                  location: validation.data
                }));
              }
            });
          } catch (err) {
            console.error('Error broadcasting location:', err);
          }
        }
      } catch (error) {
        ws.send(JSON.stringify({ 
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });
    
    ws.on('close', () => {
      clients.delete(userId);
      
      if (currentSessionId) {
        const room = sessionRooms.get(currentSessionId);
        if (room) {
          room.delete(userId);
          if (room.size === 0) {
            sessionRooms.delete(currentSessionId);
          } else {
            broadcastToSession(currentSessionId, {
              type: 'member:disconnected',
              data: { userId }
            });
          }
        }
      }
    });
  });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) {
        const deadUserId = ws.authenticatedUserId;
        if (deadUserId) {
          clients.delete(deadUserId);
          
          sessionRooms.forEach((room, sessionId) => {
            if (room.has(deadUserId)) {
              room.delete(deadUserId);
              if (room.size === 0) {
                sessionRooms.delete(sessionId);
              } else {
                broadcastToSession(sessionId, {
                  type: 'member:disconnected',
                  data: { userId: deadUserId }
                });
              }
            }
          });
        }
        
        ws.terminate();
        return;
      }
      
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  // Serve drone image file directly - uses Sharp for image conversion
  app.get('/api/drone-images/:id/file', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const droneImage = await dbStorage.getDroneImage(parseInt(id));
      
      if (!droneImage) {
        return res.status(404).json({ message: 'Drone image not found' });
      }
      
      if (!fs.existsSync(droneImage.filePath)) {
        if (droneImage.hasTiles) {
          return res.status(410).json({ message: 'Original file removed. This image is served via tiles at /api/drone-images/' + id + '/tiles/{z}/{x}/{y}.png' });
        }
        return res.status(404).json({ message: 'Image file not found' });
      }

      const originalPath = droneImage.filePath;
      const ext = originalPath.toLowerCase();
      
      // For non-TIFF files, serve directly
      if (!ext.endsWith('.tif') && !ext.endsWith('.tiff')) {
        const stat = fs.statSync(originalPath);
        const fileStream = fs.createReadStream(originalPath);
        const contentType = ext.endsWith('.png') ? 'image/png' : 
                           ext.endsWith('.jpg') || ext.endsWith('.jpeg') ? 'image/jpeg' : 
                           'application/octet-stream';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return fileStream.pipe(res);
      }

      // For GeoTIFF files, convert to PNG using Sharp with transparent black pixels
      const pngPath = originalPath.replace(/\.(tiff?|TIF+)$/i, '_web.png');
      
      if (!fs.existsSync(pngPath)) {
        try {
          const maxDim = 4096; // Mapbox texture limit safe value
          
          // First resize the image
          const resizedBuffer = await sharp(originalPath, { limitInputPixels: false })
            .resize(maxDim, maxDim, {
              fit: 'inside',
              withoutEnlargement: true
            })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          
          const { data, info } = resizedBuffer;
          const { width, height, channels } = info;
          
          // Make near-black pixels transparent (threshold: RGB all < 15)
          const threshold = 15;
          for (let i = 0; i < data.length; i += channels) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // If pixel is near-black, make it fully transparent
            if (r < threshold && g < threshold && b < threshold) {
              data[i + 3] = 0; // Set alpha to 0 (transparent)
            }
          }
          
          // Save the modified buffer as PNG
          await sharp(data, {
            raw: {
              width,
              height,
              channels
            }
          })
            .png({ compressionLevel: 6 })
            .toFile(pngPath);
          
        } catch (convertError: any) {
          console.error('Sharp conversion failed:', convertError?.message || convertError);
          
          // Try with lower resolution and simpler processing
          try {
            const resizedBuffer = await sharp(originalPath, { limitInputPixels: false })
              .resize(2048, 2048, {
                fit: 'inside',
                withoutEnlargement: true
              })
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            
            const { data, info } = resizedBuffer;
            const { width, height, channels } = info;
            
            // Make near-black pixels transparent
            const threshold = 15;
            for (let i = 0; i < data.length; i += channels) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              if (r < threshold && g < threshold && b < threshold) {
                data[i + 3] = 0;
              }
            }
            
            await sharp(data, {
              raw: { width, height, channels }
            })
              .png({ compressionLevel: 6 })
              .toFile(pngPath);
            
          } catch (retryError: any) {
            console.error('Sharp retry failed:', retryError?.message || retryError);
            // Fall back to serving original TIFF
            const stat = fs.statSync(originalPath);
            const fileStream = fs.createReadStream(originalPath);
            
            res.setHeader('Content-Type', 'image/tiff');
            res.setHeader('Content-Length', stat.size);
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            res.setHeader('Content-Disposition', `inline; filename="${droneImage.name}.tiff"`);
            
            return fileStream.pipe(res);
          }
        }
      }

      // Serve the PNG file
      const stat = fs.statSync(pngPath);
      const fileStream = fs.createReadStream(pngPath);
      
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Disposition', `inline; filename="${droneImage.name}.png"`);
      
      fileStream.pipe(res);
      
    } catch (error) {
      console.error('Error serving drone image file:', error);
      res.status(500).json({ message: 'Error serving drone image' });
    }
  });

  app.get('/api/drone-images/:id/tiles/:z/:x/:y.png', async (req: Request, res: Response) => {
    try {
      const { id, z, x, y } = req.params;
      const imageId = parseInt(id);
      const zoom = parseInt(z);
      const tileX = parseInt(x);
      const tileY = parseInt(y);

      const tileBuffer = await serveTile(imageId, zoom, tileX, tileY);
      
      if (!tileBuffer) {
        const emptyTile = await sharp(Buffer.alloc(512 * 512 * 4, 0), {
          raw: { width: 512, height: 512, channels: 4 }
        }).png().toBuffer();
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(emptyTile);
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.send(tileBuffer);
    } catch (error) {
      console.error('Error serving tile:', error);
      res.status(500).json({ message: 'Error serving tile' });
    }
  });

  app.get('/api/drone-images/:id/tile-info', async (req: Request, res: Response) => {
    try {
      const imageId = parseId(req.params.id);
      const droneImage = await dbStorage.getDroneImage(imageId);
      
      if (!droneImage) {
        return res.status(404).json({ message: 'Drone image not found' });
      }

      const metadata = await getTileMetadata(imageId);
      
      res.json({
        hasTiles: droneImage.hasTiles,
        tileMinZoom: droneImage.tileMinZoom,
        tileMaxZoom: droneImage.tileMaxZoom,
        processingStatus: droneImage.processingStatus,
        metadata
      });
    } catch (error) {
      res.status(500).json({ message: 'Error getting tile info' });
    }
  });

  app.post('/api/admin/drone-images/:id/generate-tiles', isAdmin, extendTimeout, async (req: Request, res: Response) => {
    const imageId = parseId(req.params.id);
    
    try {
      const droneImage = await dbStorage.getDroneImage(imageId);
      if (!droneImage) {
        return res.status(404).json({ message: 'Drone image not found' });
      }

      if (!fs.existsSync(droneImage.filePath)) {
        return res.status(404).json({ message: 'Original image file not found on disk' });
      }

      const bounds: ImageBounds = {
        north: parseFloat(droneImage.northEastLat),
        south: parseFloat(droneImage.southWestLat),
        east: parseFloat(droneImage.northEastLng),
        west: parseFloat(droneImage.southWestLng)
      };

      await dbStorage.updateDroneImage(imageId, { processingStatus: 'generating_tiles' });
      
      res.json({ message: 'Tile generation started', imageId });

      try {
        const tileResult = await generateTilesFromImage(
          droneImage.filePath,
          bounds,
          imageId,
          () => {}
        );

        await dbStorage.updateDroneImage(imageId, {
          hasTiles: true,
          tileMinZoom: tileResult.minZoom,
          tileMaxZoom: tileResult.maxZoom,
          tileStoragePath: tileResult.storagePath,
          processingStatus: 'complete'
        });
      } catch (tileError) {
        console.error(`Tile generation failed for image ${imageId}:`, tileError);
        await dbStorage.updateDroneImage(imageId, { processingStatus: 'failed' });
      }
    } catch (error) {
      console.error('Error starting tile generation:', error);
      res.status(500).json({ message: 'Error starting tile generation' });
    }
  });

  // Trip routes
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

  // Friend search endpoint
  app.get("/api/friends/search", isAuthenticated, async (req: Request, res: Response) => {
    const query = req.query.query as string;
    
    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Search query must be at least 2 characters" });
    }

    try {
      const users = await dbStorage.searchUsers(query, req.user!.id);
      // Remove password from response
      const safeUsers = users.map(u => ({ id: u.id, username: u.username, fullName: u.fullName }));
      res.json(safeUsers);
    } catch (error) {
      console.error('Error searching users:', error);
      res.status(500).json({ error: "Failed to search users" });
    }
  });

  // Send friend request
  app.post("/api/friend-requests", isAuthenticated, async (req: Request, res: Response) => {
    const { receiverId } = req.body;
    
    if (!receiverId) {
      return res.status(400).json({ error: "receiverId is required" });
    }

    try {
      // Can't send request to yourself
      if (receiverId === req.user!.id) {
        return res.status(400).json({ error: "Cannot send friend request to yourself" });
      }

      // Check if receiver exists
      const receiver = await dbStorage.getUser(receiverId);
      if (!receiver) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if already friends
      const areFriends = await dbStorage.areFriends(req.user!.id, receiverId);
      if (areFriends) {
        return res.status(400).json({ error: "You are already friends with this user" });
      }

      // Check if request already exists
      const existingRequest = await dbStorage.findFriendRequest(req.user!.id, receiverId);
      if (existingRequest) {
        return res.status(400).json({ error: "Friend request already sent" });
      }

      // Check for reverse request
      const reverseRequest = await dbStorage.findFriendRequest(receiverId, req.user!.id);
      if (reverseRequest) {
        return res.status(400).json({ error: "This user has already sent you a friend request" });
      }

      const friendRequest = await dbStorage.createFriendRequest({
        requesterId: req.user!.id,
        receiverId,
        status: "pending"
      });

      res.status(201).json(friendRequest);
    } catch (error) {
      console.error('Error creating friend request:', error);
      res.status(500).json({ error: "Failed to create friend request" });
    }
  });

  // Get pending friend requests (received)
  app.get("/api/friend-requests/pending", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const requests = await dbStorage.getPendingFriendRequests(req.user!.id);
      // Remove passwords from response
      const safeRequests = requests.map(r => ({
        ...r,
        requester: { ...r.requester, password: undefined }
      }));
      res.json(safeRequests);
    } catch (error) {
      console.error('Error fetching pending friend requests:', error);
      res.status(500).json({ error: "Failed to fetch friend requests" });
    }
  });

  // Get sent friend requests
  app.get("/api/friend-requests/sent", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const requests = await dbStorage.getSentFriendRequests(req.user!.id);
      // Remove passwords from response
      const safeRequests = requests.map(r => ({
        ...r,
        receiver: { ...r.receiver, password: undefined }
      }));
      res.json(safeRequests);
    } catch (error) {
      console.error('Error fetching sent friend requests:', error);
      res.status(500).json({ error: "Failed to fetch sent requests" });
    }
  });

  // Accept friend request
  app.patch("/api/friend-requests/:id/accept", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    
    try {
      const request = await dbStorage.getFriendRequest(id);
      if (!request) {
        return res.status(404).json({ error: "Friend request not found" });
      }

      if (request.receiverId !== req.user!.id) {
        return res.status(403).json({ error: "You can only accept requests sent to you" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({ error: "Request has already been processed" });
      }

      // Update request status
      await dbStorage.updateFriendRequestStatus(id, "accepted", new Date());

      // Create friendship
      await dbStorage.createFriendship({
        userAId: request.requesterId,
        userBId: request.receiverId
      });

      res.json({ message: "Friend request accepted" });
    } catch (error) {
      console.error('Error accepting friend request:', error);
      res.status(500).json({ error: "Failed to accept friend request" });
    }
  });

  // Decline friend request
  app.patch("/api/friend-requests/:id/decline", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    
    try {
      const request = await dbStorage.getFriendRequest(id);
      if (!request) {
        return res.status(404).json({ error: "Friend request not found" });
      }

      if (request.receiverId !== req.user!.id) {
        return res.status(403).json({ error: "You can only decline requests sent to you" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({ error: "Request has already been processed" });
      }

      await dbStorage.updateFriendRequestStatus(id, "declined", new Date());
      res.json({ message: "Friend request declined" });
    } catch (error) {
      console.error('Error declining friend request:', error);
      res.status(500).json({ error: "Failed to decline friend request" });
    }
  });

  // Cancel sent friend request
  app.delete("/api/friend-requests/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    
    try {
      const request = await dbStorage.getFriendRequest(id);
      if (!request) {
        return res.status(404).json({ error: "Friend request not found" });
      }

      if (request.requesterId !== req.user!.id) {
        return res.status(403).json({ error: "You can only cancel your own requests" });
      }

      await dbStorage.deleteFriendRequest(id);
      res.json({ message: "Friend request cancelled" });
    } catch (error) {
      console.error('Error cancelling friend request:', error);
      res.status(500).json({ error: "Failed to cancel friend request" });
    }
  });

  // Get friends list
  app.get("/api/friends", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const friendships = await dbStorage.getFriendships(req.user!.id);
      // Remove passwords from response
      const safeFriendships = friendships.map(f => ({
        ...f,
        friend: { ...f.friend, password: undefined }
      }));
      res.json(safeFriendships);
    } catch (error) {
      console.error('Error fetching friends:', error);
      res.status(500).json({ error: "Failed to fetch friends" });
    }
  });

  // Remove friend
  app.delete("/api/friends/:friendId", isAuthenticated, async (req: Request, res: Response) => {
    const friendId = parseId(req.params.friendId);
    if (!friendId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const success = await dbStorage.deleteFriendship(req.user!.id, friendId);
      if (success) {
        res.json({ message: "Friend removed successfully" });
      } else {
        res.status(404).json({ error: "Friendship not found" });
      }
    } catch (error) {
      console.error('Error removing friend:', error);
      res.status(500).json({ error: "Failed to remove friend" });
    }
  });

  app.patch("/api/user/location-sharing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      
      await dbStorage.updateUserLocationSharing(req.user!.id, enabled);
      res.json({ message: "Location sharing preference updated", enabled });
    } catch (error) {
      console.error('Error updating location sharing:', error);
      res.status(500).json({ error: "Failed to update location sharing" });
    }
  });

  app.patch("/api/friends/:friendId/location-sharing", isAuthenticated, async (req: Request, res: Response) => {
    const friendId = parseId(req.params.friendId);
    if (!friendId) {
      return res.status(400).json({ message: "Invalid friend ID" });
    }
    
    try {
      const { hidden } = req.body;
      if (typeof hidden !== 'boolean') {
        return res.status(400).json({ error: "hidden must be a boolean" });
      }
      
      const success = await dbStorage.toggleFriendLocationHidden(req.user!.id, friendId, hidden);
      if (!success) {
        return res.status(404).json({ error: "Friendship not found" });
      }
      
      res.json({ message: "Friend location sharing updated", hidden });
    } catch (error) {
      console.error('Error updating friend location sharing:', error);
      res.status(500).json({ error: "Failed to update friend location sharing" });
    }
  });

  // Get user profile by username
  app.get("/api/profiles/:username", isAuthenticated, async (req: Request, res: Response) => {
    const username = req.params.username;
    
    try {
      const profile = await dbStorage.getUserProfile(username, req.user!.id);
      if (!profile) {
        return res.status(404).json({ error: "User not found" });
      }

      const { isFriend, isOwner } = profile;
      const safeUser: Record<string, any> = {
        id: profile.user.id,
        username: profile.user.username,
        fullName: profile.user.fullName,
        createdAt: profile.user.createdAt,
      };
      if (isOwner || isFriend) {
        safeUser.email = profile.user.email;
        safeUser.locationSharingEnabled = (profile.user as any).locationSharingEnabled;
      }

      res.json({
        user: safeUser,
        isFriend,
        isOwner,
        publicRouteCount: profile.publicRouteCount,
        publicActivityCount: profile.publicActivityCount,
        routes: profile.routes,
        activities: profile.activities,
      });
    } catch (error) {
      console.error('Error fetching user profile:', error);
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  // ========== Direct Messages ==========

  app.get("/api/messages/conversations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const conversations = await dbStorage.getConversationList(req.user!.id);
      res.json(conversations);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/messages/unread-count", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const count = await dbStorage.getUnreadMessageCount(req.user!.id);
      res.json({ count });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  app.get("/api/messages/:userId", isAuthenticated, async (req: Request, res: Response) => {
    const otherUserId = parseId(req.params.userId);
    if (!otherUserId) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    try {
      const before = req.query.before ? parseInt(req.query.before as string) : undefined;
      const messages = await dbStorage.getConversationMessages(req.user!.id, otherUserId, 50, before);
      await dbStorage.markMessagesAsRead(req.user!.id, otherUserId);
      res.json(messages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/messages", isAuthenticated, async (req: Request, res: Response) => {
    const { receiverId, body } = req.body;

    if (!receiverId || !body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: "receiverId and body are required" });
    }

    if (receiverId === req.user!.id) {
      return res.status(400).json({ error: "Cannot message yourself" });
    }

    const receiver = await dbStorage.getUser(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: "User not found" });
    }

    try {
      const message = await dbStorage.sendDirectMessage({
        senderId: req.user!.id,
        receiverId,
        body: body.trim(),
      });

      const receiverWs = clients.get(receiverId);
      if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
        receiverWs.send(JSON.stringify({
          type: 'dm:new',
          data: {
            ...message,
            sender: {
              id: req.user!.id,
              username: req.user!.username,
              fullName: req.user!.fullName
            }
          }
        }));
      }

      res.status(201).json(message);
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  app.patch("/api/messages/:userId/read", isAuthenticated, async (req: Request, res: Response) => {
    const otherUserId = parseId(req.params.userId);
    if (!otherUserId) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    try {
      await dbStorage.markMessagesAsRead(req.user!.id, otherUserId);
      res.json({ message: "Messages marked as read" });
    } catch (error) {
      console.error('Error marking messages read:', error);
      res.status(500).json({ error: "Failed to mark messages as read" });
    }
  });

  app.delete("/api/messages/:messageId", isAuthenticated, async (req: Request, res: Response) => {
    const messageId = parseId(req.params.messageId);
    if (!messageId) {
      return res.status(400).json({ error: "Invalid message ID" });
    }

    try {
      const deleted = await dbStorage.deleteDirectMessage(messageId, req.user!.id);
      if (!deleted) {
        return res.status(404).json({ error: "Message not found or not yours" });
      }
      res.json({ message: "Message deleted" });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({ error: "Failed to delete message" });
    }
  });

  // ========== Live Shared Map Routes ==========

  // Generate a unique share code
  function generateShareCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Create a new live map session
  app.post("/api/live-maps", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: "Name is required" });
      }

      // Generate unique share code
      let shareCode = generateShareCode();
      let existing = await dbStorage.getLiveMapSessionByShareCode(shareCode);
      while (existing) {
        shareCode = generateShareCode();
        existing = await dbStorage.getLiveMapSessionByShareCode(shareCode);
      }

      const session = await dbStorage.createLiveMapSession({
        ownerId: req.user!.id,
        name: name.trim(),
        shareCode,
        isActive: true
      });

      // Add owner as a member
      await dbStorage.addLiveMapMember({
        sessionId: session.id,
        userId: req.user!.id,
        role: 'owner'
      });

      res.status(201).json(session);
    } catch (error) {
      console.error('Error creating live map session:', error);
      res.status(500).json({ error: "Failed to create live map session" });
    }
  });

  // Get user's live map sessions
  app.get("/api/live-maps", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const sessions = await dbStorage.getLiveMapSessionsByUser(req.user!.id);
      res.json(sessions);
    } catch (error) {
      console.error('Error fetching live map sessions:', error);
      res.status(500).json({ error: "Failed to fetch live map sessions" });
    }
  });

  // Get a specific live map session with all data
  app.get("/api/live-maps/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    
    try {
      const session = await dbStorage.getLiveMapSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Check if user is a member
      const isMember = await dbStorage.isLiveMapMember(id, req.user!.id);
      if (!isMember && session.ownerId !== req.user!.id) {
        return res.status(403).json({ error: "You are not a member of this session" });
      }

      // Get all session data
      const members = await dbStorage.getLiveMapMembers(id);
      const pois = await dbStorage.getLiveMapPois(id);
      const routes = await dbStorage.getLiveMapRoutes(id);
      const messages = await dbStorage.getLiveMapMessages(id);

      // Remove passwords from member users
      const safeMembers = members.map(m => ({
        ...m,
        user: { ...m.user, password: undefined }
      }));

      res.json({
        ...session,
        members: safeMembers,
        pois,
        routes,
        messages
      });
    } catch (error) {
      console.error('Error fetching live map session:', error);
      res.status(500).json({ error: "Failed to fetch live map session" });
    }
  });

  // Join a live map session by share code
  app.post("/api/live-maps/join", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { shareCode } = req.body;
      if (!shareCode || typeof shareCode !== 'string') {
        return res.status(400).json({ error: "Share code is required" });
      }

      const session = await dbStorage.getLiveMapSessionByShareCode(shareCode.toUpperCase().trim());
      if (!session) {
        return res.status(404).json({ error: "Session not found. Check the share code and try again." });
      }

      if (!session.isActive) {
        return res.status(400).json({ error: "This session has ended" });
      }

      // Check if already an active member
      const isMember = await dbStorage.isLiveMapMember(session.id, req.user!.id);
      if (isMember) {
        return res.json(session);
      }

      // Check if previously left — rejoin instead of creating new membership
      const hasMembership = await dbStorage.hasLiveMapMembership(session.id, req.user!.id);
      if (hasMembership) {
        await dbStorage.rejoinLiveMapMember(session.id, req.user!.id);
        
        await dbStorage.createLiveMapMessage({
          sessionId: session.id,
          userId: req.user!.id,
          body: `${req.user!.username} rejoined the map`,
          messageType: 'system'
        });

        broadcastToSession(session.id, {
          type: 'member:joined',
          data: { userId: req.user!.id, username: req.user!.username }
        });

        return res.json(session);
      }

      // Brand new member — add
      await dbStorage.addLiveMapMember({
        sessionId: session.id,
        userId: req.user!.id,
        role: 'participant'
      });

      // Send system message
      await dbStorage.createLiveMapMessage({
        sessionId: session.id,
        userId: req.user!.id,
        body: `${req.user!.username} joined the map`,
        messageType: 'system'
      });

      // Notify other members via WebSocket
      broadcastToSession(session.id, {
        type: 'member:joined',
        data: {
          userId: req.user!.id,
          username: req.user!.username
        }
      });

      res.json(session);
    } catch (error) {
      console.error('Error joining live map session:', error);
      res.status(500).json({ error: "Failed to join live map session" });
    }
  });

  // Leave a live map session
  app.post("/api/live-maps/:id/leave", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    
    try {
      const session = await dbStorage.getLiveMapSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Owner cannot leave, only delete
      if (session.ownerId === req.user!.id) {
        return res.status(400).json({ error: "Owner cannot leave. Delete the session instead." });
      }

      await dbStorage.removeLiveMapMember(id, req.user!.id);

      // Send system message
      await dbStorage.createLiveMapMessage({
        sessionId: id,
        userId: req.user!.id,
        body: `${req.user!.username} left the map`,
        messageType: 'system'
      });

      // Notify other members
      broadcastToSession(id, {
        type: 'member:left',
        data: { userId: req.user!.id }
      });

      res.json({ message: "Left session successfully" });
    } catch (error) {
      console.error('Error leaving live map session:', error);
      res.status(500).json({ error: "Failed to leave session" });
    }
  });

  // End a live map session (owner only) - saves all data as immutable route
  app.delete("/api/live-maps/:id", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    
    try {
      const session = await dbStorage.getLiveMapSession(id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.ownerId !== req.user!.id) {
        return res.status(403).json({ error: "Only the owner can end this session" });
      }

      if (!session.isActive) {
        return res.status(400).json({ error: "Session has already ended" });
      }

      // Gather all session data
      const [members, pois, routes, messages, gpsTracks] = await Promise.all([
        dbStorage.getLiveMapMembers(id),
        dbStorage.getLiveMapPois(id),
        dbStorage.getLiveMapRoutes(id),
        dbStorage.getLiveMapMessages(id),
        dbStorage.getLiveMapGpsTracks(id)
      ]);

      // Build combined path coordinates from all GPS tracks
      const allPathCoordinates: [number, number][] = [];
      const memberTracks: { userId: number; username: string; coordinates: [number, number][] }[] = [];
      
      for (const track of gpsTracks) {
        const member = members.find(m => m.userId === track.userId);
        const memberUser = member ? await dbStorage.getUser(member.userId) : null;
        try {
          const coords = JSON.parse(track.coordinates) as [number, number][];
          if (coords.length > 0) {
            memberTracks.push({
              userId: track.userId,
              username: memberUser?.username || `User ${track.userId}`,
              coordinates: coords
            });
            allPathCoordinates.push(...coords);
          }
        } catch {}
      }

      // Build waypoints from POIs
      const waypointCoordinates = pois.map(poi => ({
        name: poi.name,
        lngLat: [parseFloat(poi.longitude as string), parseFloat(poi.latitude as string)] as [number, number],
        note: poi.note
      }));

      // Build session notes from messages
      const messageLog = messages.map(m => {
        const msgUser = m.user;
        const timestamp = new Date(m.createdAt!).toLocaleString();
        return `[${timestamp}] ${msgUser?.username || 'Unknown'}: ${m.body}`;
      }).join('\n');

      // Calculate total distance from all tracks
      let totalDistance = 0;
      gpsTracks.forEach(track => {
        if (track.totalDistance) {
          totalDistance += parseFloat(track.totalDistance as string);
        }
      });

      // Create session summary data
      const sessionData = {
        members: memberTracks.map(m => ({ userId: m.userId, username: m.username })),
        pois: waypointCoordinates,
        routes: routes.map(r => {
          let parsedCoords = [];
          try {
            parsedCoords = typeof r.pathCoordinates === 'string' ? JSON.parse(r.pathCoordinates) : r.pathCoordinates;
          } catch {}
          return { name: r.name, pathCoordinates: parsedCoords };
        }),
        messageCount: messages.length
      };

      // Create a saved route for the session
      const savedRoute = await dbStorage.createRoute({
        userId: session.ownerId,
        name: `${session.name} (Live Session)`,
        description: `Live session ended on ${new Date().toLocaleDateString()}. Participants: ${memberTracks.map(m => m.username).join(', ')}`,
        notes: `Session Chat Log:\n${messageLog}\n\n---\nSession Data:\n${JSON.stringify(sessionData, null, 2)}`,
        waypointIds: JSON.stringify([]),
        pathCoordinates: JSON.stringify(allPathCoordinates.length > 0 ? allPathCoordinates : [[0, 0]]),
        waypointCoordinates: JSON.stringify(waypointCoordinates),
        totalDistance: totalDistance.toString(),
        elevationGain: "0",
        elevationLoss: "0",
        estimatedTime: 0,
        routingMode: 'live_session',
        isPublic: false
      });

      // End the session (mark as inactive, link to saved route)
      await dbStorage.endLiveMapSession(id, savedRoute.id);

      // Notify members before ending
      broadcastToSession(id, {
        type: 'session:ended',
        data: { savedRouteId: savedRoute.id }
      });

      res.json({ 
        message: "Session ended successfully", 
        savedRouteId: savedRoute.id 
      });
    } catch (error) {
      console.error('Error ending live map session:', error);
      res.status(500).json({ error: "Failed to end session" });
    }
  });

  // Record GPS track point during a live session
  app.post("/api/live-maps/:id/gps-track", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const { coordinates, totalDistance } = req.body;
      
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (!session.isActive) {
        return res.status(400).json({ error: "Session has ended" });
      }

      // Check if user already has a track for this session
      let track = await dbStorage.getLiveMapGpsTrackByUser(sessionId, req.user!.id);
      
      if (track) {
        // Update existing track
        track = await dbStorage.updateLiveMapGpsTrack(track.id, {
          coordinates: JSON.stringify(coordinates),
          totalDistance: totalDistance?.toString()
        });
      } else {
        // Create new track
        track = await dbStorage.createLiveMapGpsTrack({
          sessionId,
          userId: req.user!.id,
          coordinates: JSON.stringify(coordinates),
          totalDistance: totalDistance?.toString()
        });
      }

      // Broadcast to all members
      broadcastToSession(sessionId, {
        type: 'gpsTrack:updated',
        data: { 
          userId: req.user!.id, 
          username: req.user!.username,
          coordinates,
          totalDistance 
        }
      });

      res.json(track);
    } catch (error) {
      console.error('Error recording GPS track:', error);
      res.status(500).json({ error: "Failed to record GPS track" });
    }
  });

  // Get GPS tracks for a live session
  app.get("/api/live-maps/:id/gps-tracks", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const tracks = await dbStorage.getLiveMapGpsTracks(sessionId);
      
      // Add user info to tracks
      const tracksWithUsers = await Promise.all(tracks.map(async (track) => {
        const user = await dbStorage.getUser(track.userId);
        return {
          ...track,
          user: user ? { id: user.id, username: user.username, fullName: user.fullName } : null
        };
      }));

      res.json(tracksWithUsers);
    } catch (error) {
      console.error('Error fetching GPS tracks:', error);
      res.status(500).json({ error: "Failed to fetch GPS tracks" });
    }
  });

  // Update drone layers for a session
  app.patch("/api/live-maps/:id/drone-layers", isAuthenticated, async (req: Request, res: Response) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const { activeDroneLayers } = req.body;
      
      const isMember = await dbStorage.isLiveMapMember(id, req.user!.id);
      const session = await dbStorage.getLiveMapSession(id);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const updated = await dbStorage.updateLiveMapSession(id, {
        activeDroneLayers: JSON.stringify(activeDroneLayers)
      });

      // Broadcast to all members
      broadcastToSession(id, {
        type: 'droneLayers:updated',
        data: { activeDroneLayers, updatedBy: req.user!.id }
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating drone layers:', error);
      res.status(500).json({ error: "Failed to update drone layers" });
    }
  });

  // Add a POI to a live map
  app.post("/api/live-maps/:id/pois", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const { name, note, latitude, longitude } = req.body;
      
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const poi = await dbStorage.createLiveMapPoi({
        sessionId,
        createdBy: req.user!.id,
        name,
        note,
        latitude,
        longitude
      });

      // Broadcast to all members
      broadcastToSession(sessionId, {
        type: 'poi:created',
        data: { ...poi, createdByUser: { id: req.user!.id, username: req.user!.username } }
      });

      res.status(201).json(poi);
    } catch (error) {
      console.error('Error creating POI:', error);
      res.status(500).json({ error: "Failed to create POI" });
    }
  });

  // Delete a POI from a live map
  app.delete("/api/live-maps/:sessionId/pois/:poiId", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.sessionId);
    const poiId = parseId(req.params.poiId);
    if (!sessionId || !poiId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      await dbStorage.deleteLiveMapPoi(poiId);

      // Broadcast to all members
      broadcastToSession(sessionId, {
        type: 'poi:deleted',
        data: { poiId }
      });

      res.json({ message: "POI deleted" });
    } catch (error) {
      console.error('Error deleting POI:', error);
      res.status(500).json({ error: "Failed to delete POI" });
    }
  });

  // Add a route to a live map
  app.post("/api/live-maps/:id/routes", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const { name, pathCoordinates, totalDistance } = req.body;
      
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const route = await dbStorage.createLiveMapRoute({
        sessionId,
        createdBy: req.user!.id,
        name,
        pathCoordinates,
        totalDistance
      });

      // Broadcast to all members
      broadcastToSession(sessionId, {
        type: 'route:created',
        data: { ...route, createdByUser: { id: req.user!.id, username: req.user!.username } }
      });

      res.status(201).json(route);
    } catch (error) {
      console.error('Error creating route:', error);
      res.status(500).json({ error: "Failed to create route" });
    }
  });

  // Update a route on a live map
  app.put("/api/live-maps/:sessionId/routes/:routeId", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.sessionId);
    const routeId = parseId(req.params.routeId);
    if (!sessionId || !routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const { name, pathCoordinates } = req.body;
      
      if (!pathCoordinates) {
        return res.status(400).json({ error: "pathCoordinates is required" });
      }
      
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const existingRoute = await dbStorage.getLiveMapRoute(routeId);
      if (!existingRoute || existingRoute.sessionId !== sessionId) {
        return res.status(404).json({ error: "Route not found in this session" });
      }

      if (existingRoute.createdBy !== req.user!.id && session.ownerId !== req.user!.id) {
        return res.status(403).json({ error: "Only the route creator or session owner can edit this route" });
      }

      const updated = await dbStorage.updateLiveMapRoute(routeId, {
        name,
        pathCoordinates,
      });

      if (!updated) {
        return res.status(404).json({ error: "Route not found" });
      }

      broadcastToSession(sessionId, {
        type: 'route:updated',
        data: { ...updated, createdByUser: { id: req.user!.id, username: req.user!.username } }
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating route:', error);
      res.status(500).json({ error: "Failed to update route" });
    }
  });

  // Delete a route from a live map
  app.delete("/api/live-maps/:sessionId/routes/:routeId", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.sessionId);
    const routeId = parseId(req.params.routeId);
    if (!sessionId || !routeId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      await dbStorage.deleteLiveMapRoute(routeId);

      // Broadcast to all members
      broadcastToSession(sessionId, {
        type: 'route:deleted',
        data: { routeId }
      });

      res.json({ message: "Route deleted" });
    } catch (error) {
      console.error('Error deleting route:', error);
      res.status(500).json({ error: "Failed to delete route" });
    }
  });

  // Send a message to a live map
  app.post("/api/live-maps/:id/messages", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const { body } = req.body;
      if (!body || typeof body !== 'string' || !body.trim()) {
        return res.status(400).json({ error: "Message body is required" });
      }
      
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const message = await dbStorage.createLiveMapMessage({
        sessionId,
        userId: req.user!.id,
        body: body.trim(),
        messageType: 'text'
      });

      // Broadcast to all members
      broadcastToSession(sessionId, {
        type: 'message:new',
        data: { 
          ...message, 
          user: { id: req.user!.id, username: req.user!.username, fullName: req.user!.fullName } 
        }
      });

      res.status(201).json(message);
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Get messages for a live map
  app.get("/api/live-maps/:id/messages", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    
    try {
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      const session = await dbStorage.getLiveMapSession(sessionId);
      
      if (!session || (!isMember && session.ownerId !== req.user!.id)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const messages = await dbStorage.getLiveMapMessages(sessionId);
      
      // Remove passwords
      const safeMessages = messages.map(m => ({
        ...m,
        user: { ...m.user, password: undefined }
      }));

      res.json(safeMessages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Send live map invite to a friend
  app.post("/api/live-maps/:id/invites", isAuthenticated, async (req: Request, res: Response) => {
    const sessionId = parseId(req.params.id);
    const { toUserId } = req.body;
    
    try {
      if (!toUserId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      
      const session = await dbStorage.getLiveMapSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      // Check if sender is owner or member
      const isMember = await dbStorage.isLiveMapMember(sessionId, req.user!.id);
      if (session.ownerId !== req.user!.id && !isMember) {
        return res.status(403).json({ error: "Not authorized to invite" });
      }
      
      // Check if already a member
      const isAlreadyMember = await dbStorage.isLiveMapMember(sessionId, toUserId);
      if (isAlreadyMember || session.ownerId === toUserId) {
        return res.status(400).json({ error: "User is already in session" });
      }
      
      // Check if pending invite already exists
      const existingInvite = await dbStorage.getPendingInviteForSession(sessionId, toUserId);
      if (existingInvite) {
        return res.status(400).json({ error: "Invite already sent" });
      }
      
      const invite = await dbStorage.createLiveMapInvite({
        sessionId,
        fromUserId: req.user!.id,
        toUserId,
        status: 'pending'
      });
      
      res.status(201).json(invite);
    } catch (error) {
      console.error('Error sending invite:', error);
      res.status(500).json({ error: "Failed to send invite" });
    }
  });

  // Get pending live map invites for current user
  app.get("/api/live-map-invites", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const invites = await dbStorage.getLiveMapInvitesForUser(req.user!.id);
      
      // Remove passwords from user data
      const safeInvites = invites.map(invite => ({
        ...invite,
        fromUser: { ...invite.fromUser, password: undefined }
      }));
      
      res.json(safeInvites);
    } catch (error) {
      console.error('Error fetching invites:', error);
      res.status(500).json({ error: "Failed to fetch invites" });
    }
  });

  // Accept or decline a live map invite
  app.patch("/api/live-map-invites/:id", isAuthenticated, async (req: Request, res: Response) => {
    const inviteId = parseId(req.params.id);
    if (!inviteId) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const { status } = req.body;
    
    try {
      if (!status || !['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      
      const invites = await dbStorage.getLiveMapInvitesForUser(req.user!.id);
      const invite = invites.find(i => i.id === inviteId);
      
      if (!invite) {
        return res.status(404).json({ error: "Invite not found" });
      }
      
      await dbStorage.updateLiveMapInviteStatus(inviteId, status);
      
      // If accepted, add user to session
      if (status === 'accepted') {
        const hasMembership = await dbStorage.hasLiveMapMembership(invite.sessionId, req.user!.id);
        if (hasMembership) {
          await dbStorage.rejoinLiveMapMember(invite.sessionId, req.user!.id);
        } else {
          await dbStorage.addLiveMapMember({
            sessionId: invite.sessionId,
            userId: req.user!.id,
            role: 'participant'
          });
        }
      }
      
      res.json({ success: true, sessionId: invite.sessionId });
    } catch (error) {
      console.error('Error updating invite:', error);
      res.status(500).json({ error: "Failed to update invite" });
    }
  });

  // ============================================
  // Push Notification Routes
  // ============================================

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
  // Activities API (GPS-tracked activities)
  // ========================================

  // Create a new activity
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
        name: activity.name,
        description: `Recorded ${activity.activityType} activity on ${new Date(activity.startTime).toLocaleDateString()}`,
        waypointIds: JSON.stringify([]),
        pathCoordinates: pathCoordinates,
        waypointCoordinates: waypointCoordinates,
        totalDistance: activity.distanceMeters,
        elevationGain: activity.elevationGainMeters,
        elevationLoss: activity.elevationLossMeters,
        estimatedTime: activity.elapsedTimeSeconds ? Math.round(activity.elapsedTimeSeconds / 60) : null,
        routingMode: "direct",
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

  const { processRouteAssistRequest } = await import('./aiRouteAssist');

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
    for (const url of endpoints) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(35000),
        });
        if (!resp.ok) continue;
        return await resp.json();
      } catch {
        continue;
      }
    }
    throw new Error('All Overpass API endpoints failed');
  }

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

  return httpServer;
}
