import { useState, useRef } from 'react';
import { ArrowLeft, Upload, Trash2, Pencil, Eye, MapPin, Cloud, HardDrive, CheckCircle, Clock, AlertCircle, Loader2, X, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DroneImage, Cesium3dTileset } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useLocation } from 'wouter';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

function formatFileSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UploadManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = (user as any)?.isAdmin;

  // Upload state for 2D
  const [upload2D, setUpload2D] = useState<{ uploading: boolean; fileName: string; progress: number }>({
    uploading: false, fileName: '', progress: 0
  });
  const xhr2DRef = useRef<XMLHttpRequest | null>(null);

  // Upload state for 3D
  const [upload3D, setUpload3D] = useState<{ uploading: boolean; fileName: string; progress: string }>({
    uploading: false, fileName: '', progress: ''
  });
  const xhr3DRef = useRef<XMLHttpRequest | null>(null);

  // Edit/Delete state
  const [editingImage, setEditingImage] = useState<DroneImage | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmType, setDeleteConfirmType] = useState<'2d' | '3d'>('2d');
  const [deleteTilesetId, setDeleteTilesetId] = useState<number | null>(null);

  // 3D upload name dialog
  const [pending3DFile, setPending3DFile] = useState<File | null>(null);
  const [tileset3DName, setTileset3DName] = useState('');

  // Data queries
  const { data: droneImages = [], isLoading: loadingImages } = useQuery<DroneImage[]>({
    queryKey: ['/api/drone-images'],
  });

  const { data: cesiumTilesets = [], isLoading: loadingTilesets } = useQuery<Cesium3dTileset[]>({
    queryKey: ['/api/admin/cesium-tilesets'],
  });

  // Mutations
  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return apiRequest('PUT', `/api/admin/drone-images/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drone-images'] });
      toast({ title: "Renamed successfully" });
      setEditingImage(null);
    },
    onError: () => {
      toast({ title: "Rename failed", variant: "destructive" });
    }
  });

  const deleteImageMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/admin/drone-images/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drone-images'] });
      toast({ title: "2D map deleted" });
      setDeleteConfirmId(null);
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
      setDeleteConfirmId(null);
    }
  });

  const deleteTilesetMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/cesium-tilesets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/cesium-tilesets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cesium-tilesets'] });
      toast({ title: "3D map deleted" });
      setDeleteTilesetId(null);
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
      setDeleteTilesetId(null);
    }
  });

  // ---- 2D Upload ----
  const handle2DUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tif,.tiff,.geotiff';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      const formData = new FormData();
      let totalSize = 0;
      for (let i = 0; i < files.length; i++) {
        formData.append('imagery', files[i]);
        totalSize += files[i].size;
      }

      // Auto-extract GPS from first GeoTIFF
      let bounds = { neLat: '43.5', neLng: '-110.7', swLat: '43.4', swLng: '-110.9' };
      try {
        const { fromBlob } = await import('geotiff');
        const tiff = await fromBlob(files[0]);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        if (bbox && bbox.length >= 4) {
          bounds = {
            swLng: String(bbox[0]),
            swLat: String(bbox[1]),
            neLng: String(bbox[2]),
            neLat: String(bbox[3])
          };
        }
      } catch (err) {
        console.warn('Could not extract GPS from GeoTIFF, using defaults');
      }

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      formData.append('name', `Drone Imagery ${dateStr}`);
      formData.append('description', 'Uploaded from upload manager');
      formData.append('capturedAt', now.toISOString());
      formData.append('isPublic', 'true');
      formData.append('northEastLat', bounds.neLat);
      formData.append('northEastLng', bounds.neLng);
      formData.append('southWestLat', bounds.swLat);
      formData.append('southWestLng', bounds.swLng);

      setUpload2D({ uploading: true, fileName: files[0].name, progress: 0 });

      const xhr = new XMLHttpRequest();
      xhr2DRef.current = xhr;
      xhr.open('POST', '/api/drone-images');
      xhr.withCredentials = true;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUpload2D(prev => ({ ...prev, progress: Math.round((event.loaded / event.total) * 100) }));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          queryClient.invalidateQueries({ queryKey: ['/api/drone-images'] });
          toast({ title: "2D map uploaded successfully" });
        } else {
          toast({ title: "Upload failed", description: `Server error (${xhr.status})`, variant: "destructive" });
        }
        setUpload2D({ uploading: false, fileName: '', progress: 0 });
        xhr2DRef.current = null;
      };

      xhr.onerror = () => {
        toast({ title: "Upload failed", description: "Network error", variant: "destructive" });
        setUpload2D({ uploading: false, fileName: '', progress: 0 });
        xhr2DRef.current = null;
      };

      xhr.ontimeout = () => {
        toast({ title: "Upload timed out", variant: "destructive" });
        setUpload2D({ uploading: false, fileName: '', progress: 0 });
        xhr2DRef.current = null;
      };

      xhr.timeout = 7200000; // 2 hours
      xhr.send(formData);
    };
    input.click();
  };

  // ---- 3D Upload ----
  const handle3DUploadSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setTileset3DName(file.name.replace('.zip', ''));
      setPending3DFile(file);
    };
    input.click();
  };

  const handle3DUploadStart = () => {
    if (!pending3DFile) return;
    const file = pending3DFile;
    const name = tileset3DName || file.name.replace('.zip', '');

    const formData = new FormData();
    formData.append('tileset', file);
    formData.append('name', name);
    // Default center coordinates (Jackson Hole area)
    formData.append('centerLat', '43.4799');
    formData.append('centerLng', '-110.7624');

    setPending3DFile(null);
    setUpload3D({ uploading: true, fileName: file.name, progress: 'Uploading (0%)' });

    const xhr = new XMLHttpRequest();
    xhr3DRef.current = xhr;
    xhr.open('POST', '/api/cesium-tilesets/upload');
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setUpload3D(prev => ({
          ...prev,
          progress: pct < 100 ? `Uploading (${pct}%)` : 'Processing...'
        }));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        queryClient.invalidateQueries({ queryKey: ['/api/admin/cesium-tilesets'] });
        queryClient.invalidateQueries({ queryKey: ['/api/cesium-tilesets'] });
        toast({ title: "3D map uploaded", description: "Opening 3D viewer..." });
        try {
          const tileset = JSON.parse(xhr.responseText);
          if (tileset?.id) {
            navigate(`/cesium/${tileset.id}`);
          }
        } catch { /* stay on page */ }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          toast({ title: "Upload failed", description: data.message || 'Upload failed', variant: "destructive" });
        } catch {
          toast({ title: "Upload failed", description: `Server error (${xhr.status})`, variant: "destructive" });
        }
      }
      setUpload3D({ uploading: false, fileName: '', progress: '' });
      xhr3DRef.current = null;
    };

    xhr.onerror = () => {
      toast({ title: "Upload failed", description: "Network error", variant: "destructive" });
      setUpload3D({ uploading: false, fileName: '', progress: '' });
      xhr3DRef.current = null;
    };

    xhr.ontimeout = () => {
      toast({ title: "Upload timed out", variant: "destructive" });
      setUpload3D({ uploading: false, fileName: '', progress: '' });
      xhr3DRef.current = null;
    };

    xhr.timeout = 7200000; // 2 hours
    xhr.send(formData);
  };

  // ---- View on Map ----
  const handleViewOnMap = (image: DroneImage) => {
    // Mark image as active via API (must send isActive: true in body)
    fetch(`/api/drone-images/${image.id}/toggle-active`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    }).then(() => {
      // Store in global so MapView can pick it up after navigation
      (window as any).__activatedDroneImage = image;
      navigate('/');
    });
  };

  // ---- Status badge ----
  const StatusBadge = ({ status }: { status: string | null | undefined }) => {
    const s = status || 'pending';
    const config: Record<string, { icon: any; label: string; cls: string }> = {
      'complete': { icon: CheckCircle, label: 'Complete', cls: 'text-green-400 bg-green-400/10' },
      'generating_tiles': { icon: Loader2, label: 'Processing', cls: 'text-yellow-400 bg-yellow-400/10' },
      'pending': { icon: Clock, label: 'Pending', cls: 'text-gray-400 bg-gray-400/10' },
      'failed': { icon: AlertCircle, label: 'Failed', cls: 'text-red-400 bg-red-400/10' },
    };
    const c = config[s] || config['pending'];
    const Icon = c.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.cls}`}>
        <Icon className={`w-3 h-3 ${s === 'generating_tiles' ? 'animate-spin' : ''}`} />
        {c.label}
      </span>
    );
  };

  // ---- Sync badge ----
  const SyncBadge = ({ storagePath }: { storagePath: string }) => {
    const isLocal = storagePath?.startsWith('local:');
    return isLocal ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-amber-400 bg-amber-400/10">
        <HardDrive className="w-3 h-3" />
        Local
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-green-400 bg-green-400/10">
        <Cloud className="w-3 h-3" />
        Cloud
      </span>
    );
  };

  // Redirect non-admins
  if (!isAdmin) {
    navigate('/');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-white/10" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            className="bg-gray-900 border-white/20 text-white hover:bg-gray-800"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Map
          </Button>
          <h1 className="text-lg font-semibold flex-1">Upload Management</h1>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="bg-gray-900 border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => navigate('/admin')}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Enterprise Management
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">

        {/* =================== 2D MAPS SECTION =================== */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-400" />
                2D Maps
              </h2>
              <p className="text-white/50 text-sm mt-1">Drone imagery overlays (.tiff)</p>
            </div>
            <Button
              onClick={handle2DUpload}
              disabled={upload2D.uploading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload .tiff
            </Button>
          </div>

          {/* 2D Upload Progress */}
          {upload2D.uploading && (
            <div className="mb-4 bg-blue-900/20 border border-blue-400/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-blue-300 font-medium">{upload2D.fileName}</span>
                <button
                  onClick={() => { xhr2DRef.current?.abort(); setUpload2D({ uploading: false, fileName: '', progress: 0 }); }}
                  className="text-red-400 text-xs hover:text-red-300"
                >
                  Cancel
                </button>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${upload2D.progress}%` }}
                />
              </div>
              <span className="text-xs text-white/50 mt-1">{upload2D.progress}%</span>
            </div>
          )}

          {/* 2D Maps List */}
          {loadingImages ? (
            <div className="text-center py-8 text-white/50">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : droneImages.length === 0 ? (
            <div className="text-center py-12 bg-gray-900/50 rounded-lg border border-white/5">
              <MapPin className="w-10 h-10 mx-auto mb-3 text-white/20" />
              <p className="text-white/40">No 2D maps uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {droneImages.map(image => (
                <div key={image.id} className="bg-gray-900/80 border border-white/10 rounded-lg p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium truncate">{image.name}</h3>
                      <StatusBadge status={image.processingStatus} />
                      {image.isActive && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium text-blue-400 bg-blue-400/10">Active</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-white/40">
                      <span>{formatFileSize(image.sizeInMB || 0)}</span>
                      <span>{formatDate(image.uploadedAt as any)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-green-600/20 border-green-500/30 text-green-400 hover:bg-green-600/30 text-xs"
                      onClick={() => handleViewOnMap(image)}
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      View
                    </Button>
                    <button
                      onClick={() => { setEditingImage(image); setEditName(image.name); }}
                      className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                      title="Rename"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setDeleteConfirmId(image.id); setDeleteConfirmType('2d'); }}
                      className="p-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* =================== 3D MAPS SECTION =================== */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Cloud className="w-5 h-5 text-cyan-400" />
                3D Maps
              </h2>
              <p className="text-white/50 text-sm mt-1">3D map files (.zip with .glb/.json)</p>
            </div>
            <Button
              onClick={handle3DUploadSelect}
              disabled={upload3D.uploading}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload .zip
            </Button>
          </div>

          {/* 3D Upload Progress */}
          {upload3D.uploading && (
            <div className="mb-4 bg-cyan-900/20 border border-cyan-400/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-cyan-300 font-medium">{upload3D.fileName}</span>
                <button
                  onClick={() => { xhr3DRef.current?.abort(); setUpload3D({ uploading: false, fileName: '', progress: '' }); }}
                  className="text-red-400 text-xs hover:text-red-300"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-white/50">{upload3D.progress}</p>
            </div>
          )}

          {/* 3D Maps List */}
          {loadingTilesets ? (
            <div className="text-center py-8 text-white/50">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : cesiumTilesets.length === 0 ? (
            <div className="text-center py-12 bg-gray-900/50 rounded-lg border border-white/5">
              <Cloud className="w-10 h-10 mx-auto mb-3 text-white/20" />
              <p className="text-white/40">No 3D maps uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cesiumTilesets.map(tileset => {
                const linkedImage = droneImages.find(img => img.id === tileset.droneImageId);
                return (
                  <div key={tileset.id} className="bg-gray-900/80 border border-white/10 rounded-lg p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium truncate">{tileset.name}</h3>
                        <SyncBadge storagePath={tileset.storagePath} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/40">
                        <span>{formatFileSize(tileset.sizeInMB || 0)}</span>
                        <span>{formatDate(tileset.uploadedAt as any)}</span>
                        {linkedImage && (
                          <span className="text-cyan-400/60">Linked: {linkedImage.name}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-cyan-600/20 border-cyan-500/30 text-cyan-400 hover:bg-cyan-600/30 text-xs"
                        onClick={() => navigate(`/cesium/${tileset.id}`)}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        View 3D
                      </Button>
                      <button
                        onClick={() => { setDeleteTilesetId(tileset.id); setDeleteConfirmType('3d'); }}
                        className="p-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* =================== DIALOGS =================== */}

      {/* Rename Dialog */}
      <Dialog open={!!editingImage} onOpenChange={(open) => { if (!open) setEditingImage(null); }}>
        <DialogContent className="bg-gray-900 border-white/20 text-white">
          <DialogHeader>
            <DialogTitle>Rename 2D Map</DialogTitle>
            <DialogDescription className="text-white/50">Enter a new name for this drone imagery.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-input" className="text-white/70">Name</Label>
            <Input
              id="rename-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editingImage && editName.trim()) {
                  renameMutation.mutate({ id: editingImage.id, name: editName.trim() });
                }
              }}
              className="bg-gray-800 border-white/20 text-white mt-2"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingImage(null)} className="border-white/20 text-white">Cancel</Button>
            <Button
              onClick={() => { if (editingImage && editName.trim()) renameMutation.mutate({ id: editingImage.id, name: editName.trim() }); }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3D Upload Name Dialog */}
      <Dialog open={!!pending3DFile} onOpenChange={(open) => { if (!open) setPending3DFile(null); }}>
        <DialogContent className="bg-gray-900 border-white/20 text-white">
          <DialogHeader>
            <DialogTitle>Upload 3D Map</DialogTitle>
            <DialogDescription className="text-white/50">
              Name your 3D map. File: {pending3DFile?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="tileset-name" className="text-white/70">Name</Label>
            <Input
              id="tileset-name"
              value={tileset3DName}
              onChange={(e) => setTileset3DName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handle3DUploadStart(); }}
              className="bg-gray-800 border-white/20 text-white mt-2"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending3DFile(null)} className="border-white/20 text-white">Cancel</Button>
            <Button onClick={handle3DUploadStart} className="bg-cyan-600 hover:bg-cyan-700">
              <Upload className="w-4 h-4 mr-2" />
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete 2D Confirmation */}
      <AlertDialog open={deleteConfirmId !== null && deleteConfirmType === '2d'} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent className="bg-gray-900 border-white/20 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete 2D Map</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              This will permanently delete this drone imagery and all associated files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/20 text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (deleteConfirmId) deleteImageMutation.mutate(deleteConfirmId); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete 3D Confirmation */}
      <AlertDialog open={deleteTilesetId !== null && deleteConfirmType === '3d'} onOpenChange={(open) => { if (!open) setDeleteTilesetId(null); }}>
        <AlertDialogContent className="bg-gray-900 border-white/20 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete 3D Map</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              This will permanently delete this 3D map and all associated files from cloud storage. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/20 text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (deleteTilesetId) deleteTilesetMutation.mutate(deleteTilesetId); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
