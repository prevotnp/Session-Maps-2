import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { objectStorageClient } from './replit_integrations/object_storage';

const TILE_SIZE = 512;

export interface ImageBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface TileGenerationResult {
  minZoom: number;
  maxZoom: number;
  totalTiles: number;
  storagePath: string;
}

function getBucketId(): string {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    throw new Error('DEFAULT_OBJECT_STORAGE_BUCKET_ID not set');
  }
  return bucketId;
}

export async function generateTilesFromImage(
  imagePath: string,
  bounds: ImageBounds,
  imageId: number,
  onProgress?: (percent: number, message: string) => void
): Promise<TileGenerationResult> {
  const bucketId = getBucketId();
  const bucket = objectStorageClient.bucket(bucketId);
  const basePath = `public/drone-tiles/${imageId}`;
  const tileDir = `/tmp/drone-tiles-${imageId}`;

  fs.rmSync(tileDir, { recursive: true, force: true });
  fs.mkdirSync(tileDir, { recursive: true });

  onProgress?.(5, 'Reprojecting to WGS84...');

  const wgs84File = `/tmp/drone_${imageId}_wgs84.tif`;
  try {
    execSync(`gdalwarp -t_srs EPSG:4326 -of GTiff -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 "${imagePath}" "${wgs84File}"`, { timeout: 600000 });
  } catch (err: any) {
    console.error('Reprojection failed:', err.message?.substring(0, 200));
    throw new Error('Failed to reproject GeoTIFF to WGS84');
  }

  const sourceFile = fs.existsSync(wgs84File) ? wgs84File : imagePath;

  let imgInfo: string;
  try {
    imgInfo = execSync(`gdalinfo "${sourceFile}" -json`, { timeout: 30000 }).toString();
  } catch {
    imgInfo = '{}';
  }
  const info = JSON.parse(imgInfo);
  const imgWidth = info?.size?.[0] || 10000;

  const lngSpan = bounds.east - bounds.west;
  const pixelsPerDegLng = imgWidth / lngSpan;
  const maxZoom = Math.min(20, Math.floor(Math.log2(pixelsPerDegLng * 360 / TILE_SIZE)));
  const minZoom = Math.max(14, maxZoom - 6);

  onProgress?.(10, `Generating tiles at zoom ${minZoom}-${maxZoom}...`);

  const smallFile = `/tmp/drone_${imageId}_small.tif`;
  try {
    execSync(`gdal_translate -of GTiff -outsize 4096 0 -co TILED=YES "${sourceFile}" "${smallFile}"`, { timeout: 60000 });
    execSync(`gdal2tiles.py --profile=mercator --zoom=${minZoom}-${Math.min(17, maxZoom)} --tilesize=512 --processes=1 --xyz --resampling=bilinear --no-kml "${smallFile}" "${tileDir}"`, { timeout: 120000 });
  } catch (err: any) {
    console.error('Low zoom tile generation error:', err.message?.substring(0, 200));
  } finally {
    fs.rmSync(smallFile, { force: true });
  }

  onProgress?.(40, 'Generating medium zoom tiles...');

  if (maxZoom >= 18) {
    const medFile = `/tmp/drone_${imageId}_medium.tif`;
    try {
      execSync(`gdal_translate -of GTiff -outsize 12000 0 -co TILED=YES "${sourceFile}" "${medFile}"`, { timeout: 60000 });
      execSync(`gdal2tiles.py --profile=mercator --zoom=18-${Math.min(19, maxZoom)} --tilesize=512 --processes=1 --xyz --resampling=bilinear --no-kml "${medFile}" "${tileDir}"`, { timeout: 120000 });
    } catch (err: any) {
      console.error('Medium zoom tile generation error:', err.message?.substring(0, 200));
    } finally {
      fs.rmSync(medFile, { force: true });
    }
  }

  onProgress?.(60, 'Generating high zoom tiles...');

  if (maxZoom >= 20) {
    try {
      execSync(`gdal2tiles.py --profile=mercator --zoom=20 --tilesize=512 --processes=1 --xyz --resampling=bilinear --no-kml "${sourceFile}" "${tileDir}"`, { timeout: 300000 });
    } catch (err: any) {
      console.error('High zoom tile generation error:', err.message?.substring(0, 200));
    }
  }

  fs.rmSync(wgs84File, { force: true });

  onProgress?.(70, 'Uploading tiles to storage...');

  let tilesUploaded = 0;
  const allTiles: string[] = [];

  function findTiles(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findTiles(fullPath);
      } else if (entry.name.endsWith('.png') && !entry.name.endsWith('.aux.xml')) {
        allTiles.push(fullPath);
      }
    }
  }
  findTiles(tileDir);

  const BATCH_SIZE = 20;
  for (let i = 0; i < allTiles.length; i += BATCH_SIZE) {
    const batch = allTiles.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (tilePath) => {
      const relative = path.relative(tileDir, tilePath);
      const storageTilePath = `${basePath}/${relative}`;
      const file = bucket.file(storageTilePath);
      const data = fs.readFileSync(tilePath);
      await file.save(data, {
        contentType: 'image/png',
        metadata: { cacheControl: 'public, max-age=31536000' }
      });
    }));
    tilesUploaded += batch.length;
    if (onProgress && tilesUploaded % 50 === 0) {
      const percent = 70 + Math.round((tilesUploaded / allTiles.length) * 25);
      onProgress(percent, `Uploaded ${tilesUploaded}/${allTiles.length} tiles`);
    }
  }

  const metaFile = bucket.file(`${basePath}/metadata.json`);
  await metaFile.save(JSON.stringify({
    imageId,
    bounds,
    minZoom,
    maxZoom,
    tileSize: TILE_SIZE,
    totalTiles: tilesUploaded,
    generatedAt: new Date().toISOString()
  }), { contentType: 'application/json' });

  fs.rmSync(tileDir, { recursive: true, force: true });

  onProgress?.(100, `Complete: ${tilesUploaded} tiles uploaded`);
  console.log(`Tile generation complete: ${tilesUploaded} tiles stored in Object Storage`);

  return {
    minZoom,
    maxZoom,
    totalTiles: tilesUploaded,
    storagePath: basePath,
  };
}

export async function serveTile(
  imageId: number,
  z: number,
  x: number,
  y: number
): Promise<Buffer | null> {
  const bucketId = getBucketId();
  const bucket = objectStorageClient.bucket(bucketId);
  const tilePath = `public/drone-tiles/${imageId}/${z}/${x}/${y}.png`;
  const file = bucket.file(tilePath);

  try {
    const [exists] = await file.exists();
    if (!exists) return null;

    const [buffer] = await file.download();
    return buffer;
  } catch {
    return null;
  }
}

export async function getTileMetadata(imageId: number): Promise<any | null> {
  const bucketId = getBucketId();
  const bucket = objectStorageClient.bucket(bucketId);
  const metaPath = `public/drone-tiles/${imageId}/metadata.json`;
  const file = bucket.file(metaPath);

  try {
    const [exists] = await file.exists();
    if (!exists) return null;

    const [buffer] = await file.download();
    return JSON.parse(buffer.toString());
  } catch {
    return null;
  }
}

export async function deleteTiles(imageId: number): Promise<void> {
  const bucketId = getBucketId();
  const bucket = objectStorageClient.bucket(bucketId);
  const prefix = `public/drone-tiles/${imageId}/`;

  try {
    const [files] = await bucket.getFiles({ prefix });
    await Promise.all(files.map(f => f.delete()));
    console.log(`Deleted ${files.length} tiles for image ${imageId}`);
  } catch (err) {
    console.error(`Error deleting tiles for image ${imageId}:`, err);
  }
}
