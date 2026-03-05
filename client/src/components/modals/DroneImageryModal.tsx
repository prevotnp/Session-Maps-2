import React, { useState, useEffect } from 'react';
import { X, Upload, Pencil, Trash2, Box, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DroneImage, DroneModel, Cesium3dTileset } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/utils';
import { UploadProgress } from '@/components/UploadProgress';
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

interface DroneImageryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivateImage?: (image: DroneImage) => void;
}

const DroneImageryModal: React.FC<DroneImageryModalProps> = ({ isOpen, onClose, onActivateImage }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = (user as any)?.isAdmin;
  
  const [uploadState, setUploadState] = useState<{
    isUploading: boolean;
    fileName: string;
    fileSize: number;
    bytesUploaded: number;
  }>({
    isUploading: false,
    fileName: '',
    fileSize: 0,
    bytesUploaded: 0
  });

  const [editingImage, setEditingImage] = useState<DroneImage | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [modelUploadingForId, setModelUploadingForId] = useState<number | null>(null);
  const [droneModels, setDroneModels] = useState<Record<number, DroneModel | null>>({});
  const [tilesetUploadingForId, setTilesetUploadingForId] = useState<number | null>(null);
  const [tilesetUploadProgress, setTilesetUploadProgress] = useState<string>('');
  
  // Fetch drone images
  const { data: droneImages, isLoading } = useQuery<DroneImage[]>({
    queryKey: ['/api/drone-images'],
  });
  
  // Fetch 3D models for all drone images
  useEffect(() => {
    if (droneImages && droneImages.length > 0) {
      droneImages.forEach(async (image) => {
        try {
          const response = await fetch(`/api/drone-images/${image.id}/model`);
          if (response.ok) {
            const model = await response.json();
            setDroneModels(prev => ({ ...prev, [image.id]: model }));
          } else {
            setDroneModels(prev => ({ ...prev, [image.id]: null }));
          }
        } catch {
          setDroneModels(prev => ({ ...prev, [image.id]: null }));
        }
      });
    }
  }, [droneImages]);
  
  // Activate/deactivate drone imagery mutation
  const toggleDroneImageMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number, isActive: boolean }) => {
      return await apiRequest('POST', `/api/drone-images/${id}/toggle-active`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drone-images'] });
      toast({
        title: "Success",
        description: "Drone imagery layer updated",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update",
        description: error.message || "Could not update drone imagery layer",
        variant: "destructive",
      });
    }
  });

  // Rename drone image mutation
  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number, name: string }) => {
      return await apiRequest('PUT', `/api/admin/drone-images/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drone-images'] });
      toast({
        title: "Renamed",
        description: "Drone imagery renamed successfully",
      });
      setEditingImage(null);
      setEditName('');
    },
    onError: (error) => {
      toast({
        title: "Failed to rename",
        description: error.message || "Could not rename drone imagery",
        variant: "destructive",
      });
    }
  });

  // Delete drone image mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest('DELETE', `/api/admin/drone-images/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/drone-images'] });
      toast({
        title: "Deleted",
        description: "Drone imagery deleted successfully",
      });
      setDeleteConfirmId(null);
    },
    onError: (error) => {
      toast({
        title: "Failed to delete",
        description: error.message || "Could not delete drone imagery",
        variant: "destructive",
      });
    }
  });
  
  const handleActivateImage = (image: DroneImage) => {
    console.log('handleActivateImage called with:', image.id, image.name);
    console.log('Image coordinates:', {
      swLat: image.southWestLat,
      swLng: image.southWestLng,
      neLat: image.northEastLat,
      neLng: image.northEastLng
    });
    
    // Store image data in a global for the map to access
    (window as any).__activatedDroneImage = image;
    
    // Dispatch a custom event that the map can listen to
    window.dispatchEvent(new CustomEvent('droneImageActivated', { detail: image }));
    
    // Close the modal
    onClose();
    
    // Also pass via React prop if available
    if (onActivateImage) {
      console.log('Calling onActivateImage callback IMMEDIATELY with:', image.id, image.name);
      onActivateImage(image);
    }
    
    // Then update the server state
    toggleDroneImageMutation.mutate({ id: image.id, isActive: true });
  };
  
  const handleDeactivateImage = (id: number) => {
    // Dispatch event to remove this drone imagery from the map
    window.dispatchEvent(new CustomEvent('droneImageDeactivated', { detail: { id } }));
    
    // Update the server state
    toggleDroneImageMutation.mutate({ id, isActive: false });
  };

  const handleStartEdit = (image: DroneImage) => {
    setEditingImage(image);
    setEditName(image.name);
  };

  const handleSaveEdit = () => {
    if (editingImage && editName.trim()) {
      renameMutation.mutate({ id: editingImage.id, name: editName.trim() });
    }
  };

  const handleCancelEdit = () => {
    setEditingImage(null);
    setEditName('');
  };

  const handleDeleteClick = (id: number) => {
    setDeleteConfirmId(id);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmId) {
      deleteMutation.mutate(deleteConfirmId);
    }
  };

  const { data: cesiumTilesets = [] } = useQuery<Cesium3dTileset[]>({
    queryKey: ['/api/cesium-tilesets'],
    enabled: isOpen,
  });

  const cesiumTilesetsByDroneImage: Record<number, Cesium3dTileset> = {};
  cesiumTilesets.forEach(t => {
    if (t.droneImageId) cesiumTilesetsByDroneImage[t.droneImageId] = t;
  });

  const handleView3D = (droneImageId: number) => {
    onClose();
    navigate(`/drone/${droneImageId}/3d`);
  };

  const handleViewCesium3D = (tilesetId: number) => {
    onClose();
    navigate(`/cesium/${tilesetId}`);
  };

  const handleUploadCesiumTileset = (droneImage: DroneImage) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip,application/x-zip-compressed,application/octet-stream';
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      const selectedFile = files[0];
      const fileSizeMB = (selectedFile.size / (1024 * 1024)).toFixed(1);
      setTilesetUploadingForId(droneImage.id);
      setTilesetUploadProgress(`Uploading (0%) - ${fileSizeMB} MB`);

      const formData = new FormData();
      formData.append('tileset', selectedFile);
      formData.append('name', `${droneImage.name} - 3D Tileset`);
      formData.append('droneImageId', String(droneImage.id));

      const centerLat = ((parseFloat(droneImage.northEastLat) + parseFloat(droneImage.southWestLat)) / 2).toString();
      const centerLng = ((parseFloat(droneImage.northEastLng) + parseFloat(droneImage.southWestLng)) / 2).toString();
      formData.append('centerLat', centerLat);
      formData.append('centerLng', centerLng);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/cesium-tilesets/upload', true);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          if (pct < 100) {
            setTilesetUploadProgress(`Uploading (${pct}%)`);
          } else {
            setTilesetUploadProgress('Processing...');
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          queryClient.invalidateQueries({ queryKey: ['/api/cesium-tilesets'] });
          toast({ title: "3D Tileset uploaded", description: "You can now view it in the 3D viewer" });
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            toast({ title: "Upload failed", description: data.message || 'Upload failed', variant: "destructive" });
          } catch {
            toast({ title: "Upload failed", description: `Server error (${xhr.status})`, variant: "destructive" });
          }
        }
        setTilesetUploadingForId(null);
        setTilesetUploadProgress('');
      };

      xhr.onerror = () => {
        toast({ title: "Upload failed", description: "Network error - check your connection", variant: "destructive" });
        setTilesetUploadingForId(null);
        setTilesetUploadProgress('');
      };

      xhr.ontimeout = () => {
        toast({ title: "Upload failed", description: "Upload timed out - file may be too large", variant: "destructive" });
        setTilesetUploadingForId(null);
        setTilesetUploadProgress('');
      };

      xhr.timeout = 600000; // 10 minute timeout
      xhr.send(formData);
    };
    input.click();
  };

  const handleUpload3DModel = (droneImageId: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,.obj,.ply';
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        await upload3DModel(droneImageId, files[0]);
      }
    };
    input.click();
  };

  const upload3DModel = async (droneImageId: number, file: File) => {
    setModelUploadingForId(droneImageId);
    
    const formData = new FormData();
    formData.append('model', file);
    formData.append('droneImageId', droneImageId.toString());
    
    try {
      const response = await fetch('/api/admin/drone-models/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      if (response.ok) {
        const model = await response.json();
        setDroneModels(prev => ({ ...prev, [droneImageId]: model }));
        toast({
          title: "3D Model Uploaded",
          description: "Your 3D model has been uploaded successfully.",
        });
      } else {
        const error = await response.json();
        toast({
          title: "Upload Failed",
          description: error.message || "Failed to upload 3D model",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Upload Error",
        description: "An error occurred while uploading your 3D model",
        variant: "destructive",
      });
    } finally {
      setModelUploadingForId(null);
    }
  };

  const handleDelete3DModel = async (modelId: number, droneImageId: number) => {
    try {
      const response = await apiRequest('DELETE', `/api/admin/drone-models/${modelId}`);
      setDroneModels(prev => ({ ...prev, [droneImageId]: null }));
      toast({
        title: "3D Model Deleted",
        description: "The 3D model has been deleted successfully.",
      });
    } catch (error) {
      toast({
        title: "Delete Failed",
        description: "Failed to delete 3D model",
        variant: "destructive",
      });
    }
  };
  
  const handleImportDroneMap = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.tif,.tiff,.geotiff,.jpg,.jpeg,.png,.p4m';
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        uploadFiles(files);
      }
    };
    input.click();
  };

  const uploadFiles = async (files: FileList) => {
    const totalSize = Array.from(files).reduce((sum, file) => sum + file.size, 0);
    setUploadState({
      isUploading: true,
      fileName: files.length === 1 ? files[0].name : `${files.length} files`,
      fileSize: totalSize,
      bytesUploaded: 0
    });

    const formData = new FormData();
    
    // Add files to form data
    Array.from(files).forEach(file => {
      formData.append('imagery', file);
      console.log('Added file:', file.name, file.type, file.size);
    });
    
    // Add default metadata
    formData.append('name', `Drone Imagery ${new Date().toLocaleDateString()}`);
    formData.append('description', 'Uploaded from map interface');
    formData.append('isPublic', 'true');
    formData.append('capturedAt', new Date().toISOString());
    
    try {
      console.log('Starting upload...');
      
      // Use XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadState(prev => ({
            ...prev,
            bytesUploaded: event.loaded
          }));
        }
      };
      
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          const result = JSON.parse(xhr.responseText);
          console.log('Upload successful:', result);
          setUploadState({ isUploading: false, fileName: '', fileSize: 0, bytesUploaded: 0 });
          queryClient.invalidateQueries({ queryKey: ['/api/drone-images'] });
          toast({
            title: "Upload Successful",
            description: `Your drone imagery has been uploaded successfully. File size: ${result.totalSizeMB}MB`,
            variant: "default",
          });
        } else {
          const errorData = JSON.parse(xhr.responseText);
          console.error('Upload failed:', errorData);
          setUploadState({ isUploading: false, fileName: '', fileSize: 0, bytesUploaded: 0 });
          toast({
            title: "Upload Failed", 
            description: errorData.message || "Failed to upload drone imagery",
            variant: "destructive",
          });
        }
      };
      
      xhr.onerror = () => {
        console.error('Upload error');
        setUploadState({ isUploading: false, fileName: '', fileSize: 0, bytesUploaded: 0 });
        toast({
          title: "Upload Error",
          description: "An error occurred while uploading your files",
          variant: "destructive",
        });
      };
      
      xhr.open('POST', '/api/drone-images');
      xhr.send(formData);
      
    } catch (error) {
      console.error('Upload error:', error);
      setUploadState({ isUploading: false, fileName: '', fileSize: 0, bytesUploaded: 0 });
      toast({
        title: "Upload Error",
        description: "An error occurred while uploading your files",
        variant: "destructive",
      });
    }
  };

  const handleCancelUpload = () => {
    setUploadState({ isUploading: false, fileName: '', fileSize: 0, bytesUploaded: 0 });
    toast({
      title: "Upload Cancelled",
      description: "File upload has been cancelled",
      variant: "default",
    });
  };
  
  if (!isOpen) return null;

  return (
    <>
      <UploadProgress
        isVisible={uploadState.isUploading}
        fileName={uploadState.fileName}
        fileSize={uploadState.fileSize}
        bytesUploaded={uploadState.bytesUploaded}
        onCancel={handleCancelUpload}
      />

      {/* Rename Dialog */}
      <Dialog open={editingImage !== null} onOpenChange={(open) => !open && handleCancelEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Drone Imagery</DialogTitle>
            <DialogDescription>
              Enter a new name for this drone imagery layer.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="drone-name">Name</Label>
              <Input
                id="drone-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter new name..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveEdit();
                  }
                }}
                data-testid="input-rename-drone"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelEdit}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={!editName.trim() || renameMutation.isPending}
            >
              {renameMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Drone Imagery</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this drone imagery? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="absolute inset-0 bg-black/70 z-20 flex items-end">
        <div className="w-full bg-dark rounded-t-2xl max-h-[85vh] overflow-y-auto">
          <div className="flex justify-center pt-4 pb-2">
            <div className="w-12 h-1 bg-white/20 rounded-full"></div>
          </div>
          <div className="p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Drone Imagery Layer</h2>
            <button className="text-white/60" onClick={onClose} data-testid="button-close-drone-modal">
              <X className="h-6 w-6" />
            </button>
          </div>
          
          {/* Upload Progress Display */}
          {uploadState.isUploading && (
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="h-4 w-4 text-blue-400 animate-pulse" />
                <span className="text-sm font-medium text-blue-300">Upload in Progress</span>
              </div>
              
              <div className="mb-2">
                <div className="text-xs text-white/80 truncate">{uploadState.fileName}</div>
                <div className="text-xs text-blue-300">
                  {Math.round(uploadState.bytesUploaded / (1024 * 1024))}MB / {Math.round(uploadState.fileSize / (1024 * 1024))}MB uploaded
                </div>
              </div>
              
              <div className="w-full bg-gray-800/50 rounded-lg h-4 mb-2 border border-blue-500/30">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-blue-400 h-full rounded-lg transition-all duration-300" 
                  style={{ width: `${uploadState.fileSize > 0 ? (uploadState.bytesUploaded / uploadState.fileSize) * 100 : 0}%` }}
                ></div>
              </div>
              
              <div className="flex justify-between text-xs text-blue-300">
                <span>{Math.round(uploadState.fileSize > 0 ? (uploadState.bytesUploaded / uploadState.fileSize) * 100 : 0)}% complete</span>
                <button 
                  onClick={handleCancelUpload}
                  className="text-red-400 hover:text-red-300"
                >
                  Cancel Upload
                </button>
              </div>
            </div>
          )}

          {/* Admin Upload Section - At Top */}
          {isAdmin && (
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Upload className="h-5 w-5 text-primary" />
                <h3 className="text-md font-semibold text-primary">Upload Drone Imagery</h3>
              </div>
              <p className="text-xs text-white/70 mb-3">
                Upload GeoTIFF, JPEG, PNG, or Pix4D project files (.p4m). Files will be georeferenced and added to your map.
              </p>
              <Button 
                className="w-full bg-primary hover:bg-primary/90 text-white"
                onClick={handleImportDroneMap}
                data-testid="button-upload-drone-imagery"
              >
                <Upload className="h-4 w-4 mr-2" />
                Select Files to Upload
              </Button>
            </div>
          )}
          
          {/* Drone Layers List - Grid Layout */}
          <h3 className="text-md font-medium mb-3">Drone Layers</h3>
          
          {isLoading ? (
            <div className="flex justify-center py-8">
              <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : droneImages && droneImages.length === 0 ? (
            <div className="text-center py-8 text-white/60">
              No drone imagery available
            </div>
          ) : (
            <div className="border border-white/20 rounded-lg overflow-hidden mb-6">
              {droneImages && droneImages.map((image, index) => (
                <div 
                  key={image.id} 
                  className={`p-3 flex items-center gap-3 ${index !== droneImages.length - 1 ? 'border-b border-white/20' : ''}`}
                  data-testid={`drone-image-${image.id}`}
                >
                  {/* View button (green) - always activates and flies to this image */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('=== VIEW BUTTON CLICKED ===');
                      console.log('Image ID:', image.id);
                      console.log('Image Name:', image.name);
                      
                      // Always call handleActivateImage to fly to this image
                      handleActivateImage(image);
                    }}
                    className="px-4 py-1.5 rounded text-sm font-medium transition-colors bg-green-600 text-white hover:bg-green-700"
                    data-testid={`view-${image.id}`}
                  >
                    View
                  </button>
                  
                  {/* Hide button (red) - only shown when image is active */}
                  {image.isActive && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('=== HIDE BUTTON CLICKED ===');
                        console.log('Image ID:', image.id);
                        handleDeactivateImage(image.id);
                      }}
                      className="px-4 py-1.5 rounded text-sm font-medium transition-colors bg-red-600 text-white hover:bg-red-700"
                      data-testid={`hide-${image.id}`}
                    >
                      Hide
                    </button>
                  )}
                  
                  {/* View 3D model button */}
                  {droneModels[image.id] ? (
                    <button
                      onClick={() => handleView3D(image.id)}
                      className="px-3 py-1.5 rounded text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                      data-testid={`view-3d-${image.id}`}
                    >
                      3D Model
                    </button>
                  ) : null}

                  {/* View Cesium 3D Map button or Upload */}
                  {cesiumTilesetsByDroneImage[image.id] ? (
                    <button
                      onClick={() => handleViewCesium3D(cesiumTilesetsByDroneImage[image.id].id)}
                      className="px-3 py-1.5 rounded text-sm font-medium bg-cyan-600 text-white hover:bg-cyan-700 transition-colors"
                    >
                      3D Map
                    </button>
                  ) : isAdmin ? (
                    <button
                      onClick={() => handleUploadCesiumTileset(image)}
                      disabled={tilesetUploadingForId === image.id}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-cyan-900/50 text-cyan-300 hover:bg-cyan-800/50 border border-cyan-700/50 transition-colors disabled:opacity-50"
                    >
                      {tilesetUploadingForId === image.id ? (tilesetUploadProgress || '...') : '+ 3D Map'}
                    </button>
                  ) : null}
                  
                  {/* Layer name */}
                  <span className="font-medium text-white flex-1">{image.name}</span>
                  
                  {/* Admin edit/delete buttons */}
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleStartEdit(image)}
                        className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"
                        title="Rename"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(image.id)}
                        className="p-1.5 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          
          {/* Admin 3D Model Management Section */}
          {isAdmin && droneImages && droneImages.length > 0 && (
            <div className="border-t border-white/10 pt-4 mb-4">
              <h4 className="text-sm font-medium mb-3 text-white/80">3D Model Management</h4>
              <div className="space-y-2">
                {droneImages.map((image) => (
                  <div key={`model-${image.id}`} className="flex items-center justify-between text-sm">
                    <span className="text-white/60 truncate">{image.name}</span>
                    <div className="flex items-center gap-2">
                      {modelUploadingForId === image.id ? (
                        <span className="text-xs text-purple-400 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Uploading...
                        </span>
                      ) : droneModels[image.id] ? (
                        <button 
                          className="text-xs text-red-400 hover:text-red-300"
                          onClick={() => handleDelete3DModel(droneModels[image.id]!.id, image.id)}
                        >
                          Delete 3D Model
                        </button>
                      ) : (
                        <button 
                          className="text-xs text-purple-400 hover:text-purple-300"
                          onClick={() => handleUpload3DModel(image.id)}
                        >
                          Upload 3D Model
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <Button 
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 rounded-xl"
            onClick={onClose}
            data-testid="button-return-to-map"
          >
            Return to Map
          </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default DroneImageryModal;
