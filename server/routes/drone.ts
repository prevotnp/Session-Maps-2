import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated, isAdmin, extendTimeout, upload, modelUpload, modelMultiUpload, uploadDir, modelUploadDir } from "./middleware";
import { parseId, safePath, EPSG_DEFINITIONS, validateRequest } from "./utils";
import { insertDroneImageSchema } from "@shared/schema";
import sharp from "sharp";
import * as GeoTIFF from "geotiff";
import proj4 from "proj4";
import path from "path";
import fs from "fs";
import { generateTilesFromImage, serveTile, getTileMetadata, deleteTiles, type ImageBounds } from "../tileGenerator";

export function registerDroneRoutes(app: Express) {
  // Public drone images
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
  app.post("/api/admin/drone-models/upload", isAdmin, extendTimeout, modelUpload.single('model'), async (req, res) => {
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

      const droneImage = await dbStorage.getDroneImage(parseInt(droneImageId));
      if (!droneImage) {
        fs.unlink(file.path, () => {});
        return res.status(404).json({ message: "Drone image not found" });
      }

      const existingModel = await dbStorage.getDroneModelByDroneImageId(parseInt(droneImageId));
      if (existingModel) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ message: "A 3D model already exists for this drone image. Delete it first." });
      }

      const fileExt = path.extname(file.originalname).toLowerCase();
      let primaryModelPath = file.path;
      let modelFileType = fileExt.replace('.', '');
      let totalSizeBytes = file.size;

      if (fileExt === '.zip') {
        const { execSync } = await import('child_process');
        const extractDir = path.join(modelUploadDir, `extracted-${Date.now()}`);
        fs.mkdirSync(extractDir, { recursive: true });

        try {
          execSync(`unzip -o "${file.path}" -d "${extractDir}"`, { timeout: 1800000, maxBuffer: 500 * 1024 * 1024 });
        } catch (unzipErr) {
          console.error("ZIP extraction error:", unzipErr);
          fs.rmSync(extractDir, { recursive: true, force: true });
          fs.unlink(file.path, () => {});
          return res.status(400).json({ message: "Failed to extract ZIP file. Make sure it's a valid ZIP archive." });
        }

        fs.unlink(file.path, () => {});

        const getAllFiles = (dir: string): string[] => {
          const results: string[] = [];
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              results.push(...getAllFiles(fullPath));
            } else {
              results.push(fullPath);
            }
          }
          return results;
        };

        const allFiles = getAllFiles(extractDir);
        const modelExtensions = ['.glb', '.gltf', '.obj', '.ply'];
        const mainModelPath = allFiles.find(f =>
          modelExtensions.includes(path.extname(f).toLowerCase())
        );

        if (!mainModelPath) {
          fs.rmSync(extractDir, { recursive: true, force: true });
          return res.status(400).json({
            message: "No 3D model file (.glb, .gltf, .obj, .ply) found in the ZIP. Make sure your ZIP contains at least one model file."
          });
        }

        primaryModelPath = mainModelPath;
        modelFileType = path.extname(mainModelPath).toLowerCase().replace('.', '');
        totalSizeBytes = allFiles.reduce((sum, f) => {
          try { return sum + fs.statSync(f).size; } catch { return sum; }
        }, 0);

        console.log(`ZIP extracted: ${allFiles.length} files, main model: ${path.basename(mainModelPath)} (${modelFileType})`);
      }

      const totalSizeMB = Math.round(totalSizeBytes / (1024 * 1024));

      let calculatedCenterLat = centerLat;
      let calculatedCenterLng = centerLng;

      if (!calculatedCenterLat || !calculatedCenterLng) {
        if (droneImage.cornerCoordinates && Array.isArray(droneImage.cornerCoordinates)) {
          const corners = droneImage.cornerCoordinates as [number, number][];
          if (corners.length >= 4) {
            const avgLng = corners.reduce((sum, c) => sum + c[0], 0) / corners.length;
            const avgLat = corners.reduce((sum, c) => sum + c[1], 0) / corners.length;
            calculatedCenterLat = calculatedCenterLat || avgLat.toString();
            calculatedCenterLng = calculatedCenterLng || avgLng.toString();
          }
        }

        if (!calculatedCenterLat || !calculatedCenterLng) {
          const neLat = parseFloat(droneImage.northEastLat);
          const swLat = parseFloat(droneImage.southWestLat);
          const neLng = parseFloat(droneImage.northEastLng);
          const swLng = parseFloat(droneImage.southWestLng);

          if (Math.abs(neLat) <= 90 && Math.abs(swLat) <= 90 && Math.abs(neLng) <= 180 && Math.abs(swLng) <= 180) {
            calculatedCenterLat = calculatedCenterLat || ((neLat + swLat) / 2).toString();
            calculatedCenterLng = calculatedCenterLng || ((neLng + swLng) / 2).toString();
          } else {
            calculatedCenterLat = calculatedCenterLat || "0";
            calculatedCenterLng = calculatedCenterLng || "0";
          }
        }
      }

      const modelData = {
        droneImageId: parseInt(droneImageId),
        name: name || `3D Model - ${droneImage.name}`,
        filePath: primaryModelPath,
        fileType: modelFileType,
        sizeInMB: totalSizeMB,
        centerLat: calculatedCenterLat,
        centerLng: calculatedCenterLng,
        altitude: altitude || null,
        userId: user.id
      };

      const newModel = await dbStorage.createDroneModel(modelData);

      return res.status(201).json(newModel);
    } catch (error) {
      if (file) fs.unlink(file.path, () => {});
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

  // Serve 3D model files (supports nested paths for extracted ZIPs)
  app.get("/api/drone-models/*", async (req, res) => {
    const requestedPath = req.params[0];
    if (!requestedPath) {
      return res.status(400).json({ message: "Invalid filename" });
    }
    const filePath = path.resolve(path.join(modelUploadDir, requestedPath));
    if (!filePath.startsWith(path.resolve(modelUploadDir))) {
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

  // ==========================================
  // Drone Image File Serving & Tile Routes
  // ==========================================

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
}
