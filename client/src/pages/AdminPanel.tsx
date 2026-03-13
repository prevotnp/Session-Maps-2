import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Upload, Building2, Plus, Trash2, Copy, ChevronDown, ChevronRight, Users, Image, Box } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function AdminPanel() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Enterprise management state
  const [showCreateEnterprise, setShowCreateEnterprise] = useState(false);
  const [newEnterpriseName, setNewEnterpriseName] = useState('');
  const [newEnterpriseDescription, setNewEnterpriseDescription] = useState('');
  const [newEnterpriseMaxMembers, setNewEnterpriseMaxMembers] = useState('50');
  const [expandedEnterpriseId, setExpandedEnterpriseId] = useState<number | null>(null);
  // Enterprise upload state
  const [enterpriseUpload2D, setEnterpriseUpload2D] = useState<{ uploading: boolean; progress: number; fileName: string; enterpriseId: number | null }>({
    uploading: false, progress: 0, fileName: '', enterpriseId: null
  });
  const [enterpriseUpload3D, setEnterpriseUpload3D] = useState<{ uploading: boolean; progress: string; fileName: string }>({
    uploading: false, progress: '', fileName: ''
  });
  const [pending3DFile, setPending3DFile] = useState<File | null>(null);
  const [tileset3DName, setTileset3DName] = useState('');
  const [upload3DEnterpriseId, setUpload3DEnterpriseId] = useState<number | null>(null);
  const xhr2DRef = useRef<XMLHttpRequest | null>(null);
  const xhr3DRef = useRef<XMLHttpRequest | null>(null);

  // Enterprise queries
  const { data: enterprises = [], isLoading: isLoadingEnterprises } = useQuery<any[]>({
    queryKey: ['/api/enterprises'],
    enabled: !!user?.isAdmin,
  });

  const { data: enterpriseDetails, isLoading: isLoadingDetails } = useQuery<any>({
    queryKey: [`/api/enterprises/${expandedEnterpriseId}/details`],
    enabled: !!user?.isAdmin && expandedEnterpriseId !== null,
  });

  const { data: enterpriseInvites = [] } = useQuery<any[]>({
    queryKey: [`/api/enterprises/${expandedEnterpriseId}/invites`],
    enabled: !!user?.isAdmin && expandedEnterpriseId !== null,
  });

  // Enterprise mutations
  const createEnterprise = useMutation({
    mutationFn: async (data: { name: string; description: string; maxMembers: number }) => {
      const res = await apiRequest('POST', '/api/enterprises', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/enterprises'] });
      setShowCreateEnterprise(false);
      setNewEnterpriseName('');
      setNewEnterpriseDescription('');
      setNewEnterpriseMaxMembers('50');
      toast({ title: 'Enterprise created', description: 'The enterprise has been created successfully.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const assignDroneImage = useMutation({
    mutationFn: async ({ enterpriseId, droneImageId }: { enterpriseId: number; droneImageId: number }) => {
      const res = await apiRequest('POST', `/api/enterprises/${enterpriseId}/drone-images`, { droneImageId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/enterprises/${expandedEnterpriseId}/details`] });
      toast({ title: 'Drone image assigned', description: 'The drone image has been assigned to the enterprise.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const removeDroneImage = useMutation({
    mutationFn: async ({ enterpriseId, droneImageId }: { enterpriseId: number; droneImageId: number }) => {
      await apiRequest('DELETE', `/api/enterprises/${enterpriseId}/drone-images/${droneImageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/enterprises/${expandedEnterpriseId}/details`] });
      toast({ title: 'Drone image removed', description: 'The drone image has been removed from the enterprise.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const assignTileset = useMutation({
    mutationFn: async ({ enterpriseId, cesiumTilesetId }: { enterpriseId: number; cesiumTilesetId: number }) => {
      const res = await apiRequest('POST', `/api/enterprises/${enterpriseId}/cesium-tilesets`, { cesiumTilesetId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/enterprises/${expandedEnterpriseId}/details`] });
      toast({ title: 'Tileset assigned', description: 'The Cesium tileset has been assigned to the enterprise.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const removeTileset = useMutation({
    mutationFn: async ({ enterpriseId, tilesetId }: { enterpriseId: number; tilesetId: number }) => {
      await apiRequest('DELETE', `/api/enterprises/${enterpriseId}/cesium-tilesets/${tilesetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/enterprises/${expandedEnterpriseId}/details`] });
      toast({ title: 'Tileset removed', description: 'The Cesium tileset has been removed from the enterprise.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const createInvite = useMutation({
    mutationFn: async (enterpriseId: number) => {
      const res = await apiRequest('POST', `/api/enterprises/${enterpriseId}/invites`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/enterprises/${expandedEnterpriseId}/invites`] });
      toast({ title: 'Invite created', description: 'A new invite code has been generated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // ---- Enterprise Upload Handlers ----
  const handleEnterprise2DUpload = (enterpriseId: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tif,.tiff,.geotiff';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('imagery', files[i]);
      }

      // Auto-extract GPS from first GeoTIFF
      let bounds = { neLat: '43.5', neLng: '-110.7', swLat: '43.4', swLng: '-110.9' };
      try {
        const { fromBlob } = await import('geotiff');
        const tiff = await fromBlob(files[0]);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        if (bbox && bbox.length >= 4) {
          bounds = { swLng: String(bbox[0]), swLat: String(bbox[1]), neLng: String(bbox[2]), neLat: String(bbox[3]) };
        }
      } catch {}

      const now = new Date();
      formData.append('name', `Drone Imagery ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
      formData.append('description', '');
      formData.append('capturedAt', now.toISOString());
      formData.append('isPublic', 'false');
      formData.append('northEastLat', bounds.neLat);
      formData.append('northEastLng', bounds.neLng);
      formData.append('southWestLat', bounds.swLat);
      formData.append('southWestLng', bounds.swLng);

      setEnterpriseUpload2D({ uploading: true, fileName: files[0].name, progress: 0, enterpriseId });

      const xhr = new XMLHttpRequest();
      xhr2DRef.current = xhr;
      xhr.open('POST', '/api/drone-images');
      xhr.withCredentials = true;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setEnterpriseUpload2D(prev => ({ ...prev, progress: Math.round((event.loaded / event.total) * 100) }));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (result?.id) {
              assignDroneImage.mutate({ enterpriseId, droneImageId: result.id });
            }
          } catch {}
          queryClient.invalidateQueries({ queryKey: ['/api/admin/drone-images'] });
          toast({ title: '2D map uploaded and assigned to enterprise' });
        } else {
          toast({ title: 'Upload failed', variant: 'destructive' });
        }
        setEnterpriseUpload2D({ uploading: false, fileName: '', progress: 0, enterpriseId: null });
        xhr2DRef.current = null;
      };

      xhr.onerror = () => {
        toast({ title: 'Upload failed', description: 'Network error', variant: 'destructive' });
        setEnterpriseUpload2D({ uploading: false, fileName: '', progress: 0, enterpriseId: null });
        xhr2DRef.current = null;
      };

      xhr.timeout = 7200000;
      xhr.send(formData);
    };
    input.click();
  };

  const handleEnterprise3DSelect = (enterpriseId: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setTileset3DName(file.name.replace('.zip', ''));
      setPending3DFile(file);
      setUpload3DEnterpriseId(enterpriseId);
    };
    input.click();
  };

  const handleEnterprise3DStart = () => {
    if (!pending3DFile || !upload3DEnterpriseId) return;
    const file = pending3DFile;
    const name = tileset3DName || file.name.replace('.zip', '');
    const enterpriseId = upload3DEnterpriseId;

    const formData = new FormData();
    formData.append('tileset', file);
    formData.append('name', name);
    formData.append('centerLat', '43.4799');
    formData.append('centerLng', '-110.7624');

    setPending3DFile(null);
    setUpload3DEnterpriseId(null);
    setEnterpriseUpload3D({ uploading: true, fileName: file.name, progress: 'Uploading (0%)' });

    const xhr = new XMLHttpRequest();
    xhr3DRef.current = xhr;
    xhr.open('POST', '/api/cesium-tilesets/upload');
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setEnterpriseUpload3D(prev => ({
          ...prev,
          progress: pct < 100 ? `Uploading (${pct}%)` : 'Processing...'
        }));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result?.id) {
            assignTileset.mutate({ enterpriseId, cesiumTilesetId: result.id });
          }
        } catch {}
        queryClient.invalidateQueries({ queryKey: ['/api/admin/cesium-tilesets'] });
        queryClient.invalidateQueries({ queryKey: ['/api/cesium-tilesets'] });
        toast({ title: '3D map uploaded and assigned to enterprise' });
      } else {
        toast({ title: 'Upload failed', variant: 'destructive' });
      }
      setEnterpriseUpload3D({ uploading: false, fileName: '', progress: '' });
      xhr3DRef.current = null;
    };

    xhr.onerror = () => {
      toast({ title: 'Upload failed', description: 'Network error', variant: 'destructive' });
      setEnterpriseUpload3D({ uploading: false, fileName: '', progress: '' });
      xhr3DRef.current = null;
    };

    xhr.timeout = 7200000;
    xhr.send(formData);
  };

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You need administrator privileges to access this panel.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 pb-4" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
      <div className="max-w-6xl mx-auto">
        {/* Enterprise Management */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Enterprise Management
                </CardTitle>
                <CardDescription>
                  Create and manage enterprises, assign drone images and tilesets
                </CardDescription>
              </div>
              <Button
                onClick={() => setShowCreateEnterprise(!showCreateEnterprise)}
                size="sm"
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                New Enterprise
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Create Enterprise Form */}
            {showCreateEnterprise && (
              <div className="mb-6 p-4 border rounded-lg space-y-4">
                <h3 className="font-semibold">Create New Enterprise</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Name *</label>
                    <Input
                      value={newEnterpriseName}
                      onChange={(e) => setNewEnterpriseName(e.target.value)}
                      placeholder="Enterprise name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Max Members</label>
                    <Input
                      type="number"
                      value={newEnterpriseMaxMembers}
                      onChange={(e) => setNewEnterpriseMaxMembers(e.target.value)}
                      placeholder="50"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Description</label>
                  <Input
                    value={newEnterpriseDescription}
                    onChange={(e) => setNewEnterpriseDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (!newEnterpriseName.trim()) return;
                      createEnterprise.mutate({
                        name: newEnterpriseName.trim(),
                        description: newEnterpriseDescription.trim(),
                        maxMembers: parseInt(newEnterpriseMaxMembers) || 50,
                      });
                    }}
                    disabled={!newEnterpriseName.trim() || createEnterprise.isPending}
                  >
                    {createEnterprise.isPending ? 'Creating...' : 'Create Enterprise'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowCreateEnterprise(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Enterprise List */}
            {isLoadingEnterprises ? (
              <div className="text-center py-8">Loading enterprises...</div>
            ) : enterprises.length === 0 ? (
              <div className="text-center py-8">
                <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-medium">No enterprises yet</p>
                <p className="text-muted-foreground">Create your first enterprise to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {enterprises.map((enterprise: any) => (
                  <div key={enterprise.id} className="border rounded-lg">
                    {/* Enterprise Row */}
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedEnterpriseId(
                        expandedEnterpriseId === enterprise.id ? null : enterprise.id
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {expandedEnterpriseId === enterprise.id ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <h3 className="font-semibold">{enterprise.name}</h3>
                          {enterprise.description && (
                            <p className="text-sm text-muted-foreground">{enterprise.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={enterprise.isActive !== false ? "default" : "secondary"}>
                          {enterprise.isActive !== false ? "Active" : "Inactive"}
                        </Badge>
                        {enterprise.maxMembers && (
                          <span className="text-xs text-muted-foreground">
                            Max {enterprise.maxMembers} members
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expanded Enterprise Detail */}
                    {expandedEnterpriseId === enterprise.id && (
                      <div className="border-t p-4 space-y-6">
                        {isLoadingDetails ? (
                          <div className="text-center py-4">Loading details...</div>
                        ) : (
                          <>
                            {/* Drone Image Assignments */}
                            <div>
                              <h4 className="font-medium flex items-center gap-2 mb-3">
                                <Image className="h-4 w-4" />
                                Drone Images
                              </h4>
                              <div className="mb-3">
                                <Button
                                  size="sm"
                                  onClick={() => handleEnterprise2DUpload(enterprise.id)}
                                  disabled={enterpriseUpload2D.uploading}
                                  className="flex items-center gap-2"
                                >
                                  <Upload className="h-4 w-4" />
                                  Upload 2D Map
                                </Button>
                                {enterpriseUpload2D.uploading && enterpriseUpload2D.enterpriseId === enterprise.id && (
                                  <div className="mt-2 p-3 border rounded-lg">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-muted-foreground">{enterpriseUpload2D.fileName}</span>
                                      <button
                                        onClick={() => { xhr2DRef.current?.abort(); setEnterpriseUpload2D({ uploading: false, fileName: '', progress: 0, enterpriseId: null }); }}
                                        className="text-xs text-destructive hover:underline"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                    <div className="w-full bg-secondary rounded-full h-2">
                                      <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${enterpriseUpload2D.progress}%` }} />
                                    </div>
                                    <span className="text-xs text-muted-foreground">{enterpriseUpload2D.progress}%</span>
                                  </div>
                                )}
                              </div>
                              {(enterpriseDetails?.droneImages || []).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No drone images assigned</p>
                              ) : (
                                <div className="space-y-2">
                                  {(enterpriseDetails?.droneImages || []).map((img: any) => (
                                    <div key={img.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                                      <span className="text-sm">{img.name}</span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeDroneImage.mutate({
                                          enterpriseId: enterprise.id,
                                          droneImageId: img.id,
                                        })}
                                        disabled={removeDroneImage.isPending}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Cesium Tileset Assignments */}
                            <div>
                              <h4 className="font-medium flex items-center gap-2 mb-3">
                                <Box className="h-4 w-4" />
                                Cesium Tilesets
                              </h4>
                              <div className="mb-3">
                                <Button
                                  size="sm"
                                  onClick={() => handleEnterprise3DSelect(enterprise.id)}
                                  disabled={enterpriseUpload3D.uploading}
                                  className="flex items-center gap-2"
                                >
                                  <Upload className="h-4 w-4" />
                                  Upload 3D Map
                                </Button>
                                {enterpriseUpload3D.uploading && (
                                  <div className="mt-2 p-3 border rounded-lg">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-muted-foreground">{enterpriseUpload3D.fileName}</span>
                                      <button
                                        onClick={() => { xhr3DRef.current?.abort(); setEnterpriseUpload3D({ uploading: false, fileName: '', progress: '' }); }}
                                        className="text-xs text-destructive hover:underline"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">{enterpriseUpload3D.progress}</p>
                                  </div>
                                )}
                              </div>
                              {(enterpriseDetails?.cesiumTilesets || []).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No tilesets assigned</p>
                              ) : (
                                <div className="space-y-2">
                                  {(enterpriseDetails?.cesiumTilesets || []).map((ts: any) => (
                                    <div key={ts.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                                      <span className="text-sm">{ts.name}</span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeTileset.mutate({
                                          enterpriseId: enterprise.id,
                                          tilesetId: ts.id,
                                        })}
                                        disabled={removeTileset.isPending}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Members */}
                            <div>
                              <h4 className="font-medium flex items-center gap-2 mb-3">
                                <Users className="h-4 w-4" />
                                Members ({(enterpriseDetails?.members || []).length})
                              </h4>
                              {(enterpriseDetails?.members || []).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No members yet</p>
                              ) : (
                                <div className="space-y-2">
                                  {(enterpriseDetails?.members || []).map((member: any) => (
                                    <div key={member.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                                      <div>
                                        <span className="text-sm font-medium">{member.fullName || member.username}</span>
                                        <span className="text-xs text-muted-foreground ml-2">@{member.username}</span>
                                      </div>
                                      <Badge variant="outline">{member.role}</Badge>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Invite Codes */}
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-medium">Invite Codes</h4>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => createInvite.mutate(enterprise.id)}
                                  disabled={createInvite.isPending}
                                  className="flex items-center gap-2"
                                >
                                  <Plus className="h-3 w-3" />
                                  {createInvite.isPending ? 'Creating...' : 'Generate Code'}
                                </Button>
                              </div>
                              {enterpriseInvites.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No invite codes yet</p>
                              ) : (
                                <div className="space-y-2">
                                  {enterpriseInvites.map((invite: any) => (
                                    <div key={invite.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                                      <div>
                                        <code className="text-sm font-mono bg-background px-2 py-1 rounded border">
                                          {invite.inviteCode}
                                        </code>
                                        <span className="text-xs text-muted-foreground ml-2">
                                          Used: {invite.usedCount || 0}/{invite.maxUses || 'unlimited'}
                                        </span>
                                        {invite.expiresAt && (
                                          <span className="text-xs text-muted-foreground ml-2">
                                            Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                                          </span>
                                        )}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(invite.inviteCode);
                                          toast({ title: 'Copied', description: 'Invite code copied to clipboard.' });
                                        }}
                                      >
                                        <Copy className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3D Upload Name Dialog */}
        <Dialog open={!!pending3DFile} onOpenChange={(open) => { if (!open) { setPending3DFile(null); setUpload3DEnterpriseId(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload 3D Map</DialogTitle>
              <DialogDescription>
                Name your 3D map. File: {pending3DFile?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="enterprise-tileset-name">Name</Label>
              <Input
                id="enterprise-tileset-name"
                value={tileset3DName}
                onChange={(e) => setTileset3DName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleEnterprise3DStart(); }}
                className="mt-2"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setPending3DFile(null); setUpload3DEnterpriseId(null); }}>Cancel</Button>
              <Button onClick={handleEnterprise3DStart}>
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}