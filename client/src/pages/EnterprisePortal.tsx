import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Users,
  Map,
  Box,
  UserPlus,
  Copy,
  Trash2,
  ArrowLeft,
} from "lucide-react";

interface EnterpriseMember {
  id: number;
  userId: number;
  username: string;
  fullName: string | null;
  role: "owner" | "admin" | "member";
}

interface DroneImage {
  id: number;
  name: string;
  description: string | null;
  centerLat: string;
  centerLng: string;
}

interface CesiumTileset {
  id: number;
  name: string;
  tilesetJsonUrl: string;
}

interface EnterpriseDetails {
  name: string;
  description: string | null;
  slug: string;
  members: EnterpriseMember[];
  droneImages: DroneImage[];
  cesiumTilesets: CesiumTileset[];
}

interface MyEnterprise {
  enterpriseId: number;
  role: "owner" | "admin" | "member";
  enterprise: {
    id: number;
    name: string;
  };
}

interface InviteCode {
  id: number;
  inviteCode: string;
  maxUses: number | null;
  usedCount: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function EnterprisePortal() {
  const [match, params] = useRoute("/enterprise/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const enterpriseId = params?.id;

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");

  // Fetch enterprise details
  const {
    data: enterprise,
    isLoading: isEnterpriseLoading,
    error: enterpriseError,
  } = useQuery<EnterpriseDetails>({
    queryKey: [`/api/enterprises/${enterpriseId}/details`],
    queryFn: async () => {
      const res = await fetch(`/api/enterprises/${enterpriseId}/details`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch enterprise details");
      return res.json();
    },
    enabled: !!enterpriseId,
  });

  // Fetch user's memberships to determine role
  const { data: myEnterprises = [] } = useQuery<MyEnterprise[]>({
    queryKey: ["/api/my-enterprises"],
    queryFn: async () => {
      const res = await fetch("/api/my-enterprises", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch memberships");
      return res.json();
    },
    enabled: !!user,
  });

  const myMembership = myEnterprises.find(
    (e) => String(e.enterpriseId) === String(enterpriseId)
  );
  const userRole = myMembership?.role;
  const isAdminOrOwner = userRole === "owner" || userRole === "admin";

  // Fetch invite codes (for owner/admin)
  const { data: inviteCodes = [] } = useQuery<InviteCode[]>({
    queryKey: [`/api/enterprises/${enterpriseId}/invites`],
    queryFn: async () => {
      const res = await fetch(`/api/enterprises/${enterpriseId}/invites`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch invite codes");
      return res.json();
    },
    enabled: !!enterpriseId && isAdminOrOwner,
  });

  // Invite member mutation
  const inviteMemberMutation = useMutation({
    mutationFn: async (data: { identifier: string; role: string }) => {
      await apiRequest("POST", `/api/enterprises/${enterpriseId}/members`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/enterprises/${enterpriseId}/details`],
      });
      setInviteDialogOpen(false);
      setInviteIdentifier("");
      toast({ title: "Member invited successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to invite member", description: error.message, variant: "destructive" });
    },
  });

  // Create invite code mutation
  const createInviteCodeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/enterprises/${enterpriseId}/invites`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/enterprises/${enterpriseId}/invites`],
      });
      toast({ title: "Invite code created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create invite code", description: error.message, variant: "destructive" });
    },
  });

  // Change member role mutation
  const changeRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: number; role: string }) => {
      await apiRequest("PUT", `/api/enterprises/${enterpriseId}/members/${memberId}`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/enterprises/${enterpriseId}/details`],
      });
      toast({ title: "Role updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update role", description: error.message, variant: "destructive" });
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: number) => {
      await apiRequest("DELETE", `/api/enterprises/${enterpriseId}/members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/enterprises/${enterpriseId}/details`],
      });
      toast({ title: "Member removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove member", description: error.message, variant: "destructive" });
    },
  });

  if (!match) {
    return null;
  }

  if (isEnterpriseLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading enterprise...</p>
      </div>
    );
  }

  if (enterpriseError || !enterprise) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Enterprise Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Could not load enterprise details. You may not have access.
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="min-h-screen bg-background px-4 pb-4" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Building2 className="h-7 w-7 text-primary" />
              <h1 className="text-3xl font-bold">{enterprise.name}</h1>
              <Badge variant="secondary" className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {enterprise.members.length} {enterprise.members.length === 1 ? "member" : "members"}
              </Badge>
            </div>
            {enterprise.description && (
              <p className="text-muted-foreground mt-1 ml-10">
                {enterprise.description}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="maps">
          <TabsList>
            <TabsTrigger value="maps" className="flex items-center gap-2">
              <Map className="h-4 w-4" />
              Maps
            </TabsTrigger>
            <TabsTrigger value="models" className="flex items-center gap-2">
              <Box className="h-4 w-4" />
              3D Models
            </TabsTrigger>
            {isAdminOrOwner && (
              <TabsTrigger value="team" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Team
              </TabsTrigger>
            )}
          </TabsList>

          {/* Maps Tab */}
          <TabsContent value="maps" className="mt-6">
            {enterprise.droneImages.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Map className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No drone maps available yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {enterprise.droneImages.map((image) => (
                  <Card key={image.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">{image.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {image.description && (
                        <p className="text-sm text-muted-foreground mb-4">
                          {image.description}
                        </p>
                      )}
                      {!image.description && (
                        <p className="text-sm text-muted-foreground mb-4">
                          Drone imagery overlay
                        </p>
                      )}
                      <Button
                        className="w-full"
                        onClick={() => navigate(`/?viewDroneImage=${image.id}`)}
                      >
                        <Map className="h-4 w-4 mr-2" />
                        View on Map
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* 3D Models Tab */}
          <TabsContent value="models" className="mt-6">
            {enterprise.cesiumTilesets.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Box className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No 3D models available yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {enterprise.cesiumTilesets.map((tileset) => (
                  <Card key={tileset.id}>
                    <CardHeader>
                      <CardTitle className="text-lg">{tileset.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Button
                        className="w-full"
                        onClick={() => navigate(`/cesium/${tileset.id}`)}
                      >
                        <Box className="h-4 w-4 mr-2" />
                        Open 3D Viewer
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Team Tab (owner/admin only) */}
          {isAdminOrOwner && (
            <TabsContent value="team" className="mt-6 space-y-6">
              {/* Member List */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Members</CardTitle>
                  <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Invite User
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Invite User</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 mt-4">
                        <Input
                          placeholder="Username or email"
                          value={inviteIdentifier}
                          onChange={(e) => setInviteIdentifier(e.target.value)}
                        />
                        <Select
                          value={inviteRole}
                          onValueChange={(val) => setInviteRole(val as "admin" | "member")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">Member</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          className="w-full"
                          disabled={!inviteIdentifier.trim() || inviteMemberMutation.isPending}
                          onClick={() =>
                            inviteMemberMutation.mutate({
                              identifier: inviteIdentifier.trim(),
                              role: inviteRole,
                            })
                          }
                        >
                          {inviteMemberMutation.isPending ? "Inviting..." : "Send Invite"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {enterprise.members.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div className="flex-1">
                          <p className="font-medium">{member.username}</p>
                          {member.fullName && (
                            <p className="text-sm text-muted-foreground">{member.fullName}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {member.role === "owner" ? (
                            <Badge>Owner</Badge>
                          ) : (
                            <>
                              <Select
                                value={member.role}
                                onValueChange={(val) =>
                                  changeRoleMutation.mutate({
                                    memberId: member.id,
                                    role: val,
                                  })
                                }
                              >
                                <SelectTrigger className="w-28">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="member">Member</SelectItem>
                                  <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeMemberMutation.mutate(member.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Invite Codes */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Invite Codes</CardTitle>
                  <Button
                    size="sm"
                    disabled={createInviteCodeMutation.isPending}
                    onClick={() => createInviteCodeMutation.mutate()}
                  >
                    Create Code
                  </Button>
                </CardHeader>
                <CardContent>
                  {inviteCodes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No invite codes yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {inviteCodes.map((code) => (
                        <div
                          key={code.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex-1">
                            <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                              {code.inviteCode}
                            </code>
                            <div className="flex gap-2 mt-1">
                              {code.maxUses !== null && (
                                <Badge variant="outline" className="text-xs">
                                  {(code.usedCount || 0)}/{code.maxUses} used
                                </Badge>
                              )}
                              {code.expiresAt && (
                                <Badge variant="outline" className="text-xs">
                                  Expires {new Date(code.expiresAt).toLocaleDateString()}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(code.inviteCode)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
