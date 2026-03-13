import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { parseId } from "./utils";

export function registerSocialRoutes(app: Express) {
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
}
