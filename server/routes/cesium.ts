import { Express } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated, isAdmin, extendTimeout, tilesetUpload, tilesetUploadDir } from "./middleware";
import { parseId } from "./utils";
import path from "path";
import fs from "fs";

export function registerCesiumRoutes(app: Express) {
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

  app.get("/api/admin/cesium-tilesets", isAdmin, async (req, res) => {
    try {
      const tilesets = await dbStorage.getAllCesium3dTilesets();
      return res.json(tilesets);
    } catch (error) {
      console.error("Error fetching all tilesets:", error);
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

      const { execSync } = await import('child_process');
      try {
        execSync(`unzip -o "${file.path}" -d "${extractDir}"`, { timeout: 1800000, maxBuffer: 500 * 1024 * 1024 });
      } catch (unzipErr) {
        console.error("Cesium tileset ZIP extraction error:", unzipErr);
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.unlinkSync(file.path);
        return res.status(400).json({ message: "Failed to extract ZIP file. Make sure it's a valid ZIP archive." });
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

      let boundingVolume = null;
      try {
        const tilesetJson = JSON.parse(fs.readFileSync(tilesetJsonPath, 'utf-8'));
        if (tilesetJson.root?.boundingVolume) {
          boundingVolume = JSON.stringify(tilesetJson.root.boundingVolume);
        }
      } catch (e) {
        console.error("Error parsing tileset.json:", e);
      }

      const tilesetRecord = await dbStorage.createCesium3dTileset({
        droneImageId: droneImageId ? parseInt(droneImageId) : null,
        name,
        storagePath: `local:${tilesetRootDir}`,
        tilesetJsonUrl: '',
        sizeInMB: fileSizeMB,
        centerLat,
        centerLng,
        centerAlt: centerAlt || null,
        boundingVolume,
        userId: user.id,
      });

      const tilesetJsonFilename = path.basename(tilesetJsonPath);
      const tilesetJsonUrl = `/api/cesium-tilesets/${tilesetRecord.id}/tiles/${tilesetJsonFilename}`;

      const { db } = await import('../db');
      const { cesium3dTilesets } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.update(cesium3dTilesets)
        .set({ tilesetJsonUrl })
        .where(eq(cesium3dTilesets.id, tilesetRecord.id));

      fs.unlinkSync(file.path);

      const updatedTileset = await dbStorage.getCesium3dTileset(tilesetRecord.id);
      console.log(`Cesium tileset ${tilesetRecord.id} stored locally at ${tilesetRootDir} with ${allFiles.length} files`);

      import('../cesiumStorageSync').then(({ syncTilesetToObjectStorage }) => {
        syncTilesetToObjectStorage(tilesetRecord.id, tilesetRootDir).catch(err => {
          console.error(`[CesiumSync] Background sync failed for tileset ${tilesetRecord.id}:`, err);
        });
      });

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
        '.subtree': 'application/octet-stream',
        '.bin': 'application/octet-stream',
      };

      const tileset = await dbStorage.getCesium3dTileset(tilesetId);
      if (!tileset) {
        return res.status(404).json({ message: "Tileset not found" });
      }

      if (tileset.storagePath && tileset.storagePath.startsWith('local:')) {
        const localDir = tileset.storagePath.replace('local:', '');
        const localFile = path.resolve(path.join(localDir, tilePath));
        if (localFile.startsWith(path.resolve(localDir)) && fs.existsSync(localFile)) {
          res.set('Content-Type', contentTypes[ext] || 'application/octet-stream');
          res.set('Access-Control-Allow-Origin', '*');
          return res.sendFile(localFile);
        }
      }

      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        return res.status(500).json({ message: "Object storage not configured" });
      }

      const { objectStorageClient } = await import('../replit_integrations/object_storage');
      const bucket = objectStorageClient.bucket(bucketId);
      const objectPath = tileset.storagePath && !tileset.storagePath.startsWith('local:')
        ? `${tileset.storagePath}/${tilePath}`
        : `public/cesium-tilesets/${tilesetId}/${tilePath}`;
      const file = bucket.file(objectPath);

      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({ message: "Tile not found" });
      }

      const [buffer] = await file.download();

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
          const { objectStorageClient } = await import('../replit_integrations/object_storage');
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

  app.post("/api/cesium-tilesets/:id/sync", isAdmin, async (req, res) => {
    try {
      const tilesetId = parseId(req.params.id);
      const tileset = await dbStorage.getCesium3dTileset(tilesetId);
      if (!tileset) return res.status(404).json({ message: "Tileset not found" });
      if (!tileset.storagePath || !tileset.storagePath.startsWith('local:')) {
        return res.json({ message: "Tileset already synced to Object Storage", storagePath: tileset.storagePath });
      }
      const localDir = tileset.storagePath.replace('local:', '');
      if (!fs.existsSync(localDir)) {
        return res.status(400).json({ message: "Local directory not found" });
      }
      const { syncTilesetToObjectStorage } = await import('../cesiumStorageSync');
      syncTilesetToObjectStorage(tilesetId, localDir).catch(err => {
        console.error(`[CesiumSync] Sync failed for tileset ${tilesetId}:`, err);
      });
      return res.json({ message: "Sync started in background", tilesetId });
    } catch (error) {
      return res.status(500).json({ message: "Error starting sync" });
    }
  });
}
