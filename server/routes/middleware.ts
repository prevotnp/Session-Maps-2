import type { Request, Response, NextFunction, RequestHandler } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

// Auth middleware
export const isAuthenticated: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
};

// Admin middleware
export const isAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated() && (req.user as any).isAdmin) {
    return next();
  }
  res.status(403).json({ message: "Admin access required" });
};

// Extended timeout for large uploads (2 hours)
export const extendTimeout: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  req.setTimeout(7200000);
  res.setTimeout(7200000);
  next();
};

// --- Upload directories ---

export const uploadDir = process.env.NODE_ENV === 'production'
  ? path.join(process.cwd(), 'uploads', 'drone-imagery')
  : path.join('/home/runner/session-maps-data', 'drone-imagery');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export const modelUploadDir = path.join(process.cwd(), 'uploads', 'drone-models');
if (!fs.existsSync(modelUploadDir)) {
  fs.mkdirSync(modelUploadDir, { recursive: true });
}

const waypointPhotoDir = path.join(process.cwd(), 'uploads', 'waypoint-photos');
if (!fs.existsSync(waypointPhotoDir)) {
  fs.mkdirSync(waypointPhotoDir, { recursive: true });
}

const routePhotoDir = path.join(process.cwd(), 'uploads', 'route-photos');
if (!fs.existsSync(routePhotoDir)) {
  fs.mkdirSync(routePhotoDir, { recursive: true });
}

const tilesetUploadDir = path.join(process.cwd(), 'uploads', 'cesium-tilesets');
if (!fs.existsSync(tilesetUploadDir)) {
  fs.mkdirSync(tilesetUploadDir, { recursive: true });
}

// --- Multer configurations ---

const multerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

export const upload = multer({
  storage: multerStorage,
  limits: { fileSize: Infinity },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['.tif', '.tiff', '.jpg', '.jpeg', '.png'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only GeoTIFF, JPEG, and PNG files are allowed.'));
    }
  }
});

const modelMulterStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, modelUploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

export const modelUpload = multer({
  storage: modelMulterStorage,
  limits: { fileSize: Infinity },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['.glb', '.gltf', '.obj', '.ply', '.mtl', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.zip', '.json', '.bin', '.b3dm', '.i3dm', '.pnts', '.cmpt'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: GLB, GLTF, OBJ, PLY, MTL, texture images, and ZIP archives.'));
    }
  }
});

export const modelMultiUpload = multer({
  storage: modelMulterStorage,
  limits: { fileSize: Infinity },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['.glb', '.gltf', '.obj', '.ply', '.mtl', '.jpg', '.jpeg', '.png', '.tif', '.tiff'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type.'));
    }
  }
});

const waypointPhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, waypointPhotoDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

export const waypointPhotoUpload = multer({
  storage: waypointPhotoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: JPG, PNG, WebP, HEIC, GIF, MP4, MOV, AVI, MKV, WebM.'));
    }
  }
});

const routePhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, routePhotoDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

export const routePhotoUpload = multer({
  storage: routePhotoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: JPG, PNG, WebP, HEIC, GIF, MP4, MOV, AVI, MKV, WebM.'));
    }
  }
});

const tilesetMulterStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tilesetUploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

export const tilesetUpload = multer({
  storage: tilesetMulterStorage,
  limits: { fileSize: Infinity },
});

// Re-export directory paths for route files that need them
export { waypointPhotoDir, routePhotoDir, tilesetUploadDir };
