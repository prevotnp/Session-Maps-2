import type { Express, Request, Response } from "express";
import { storage as dbStorage } from "../storage";
import { isAuthenticated } from "./middleware";
import { parseId, type WebSocketState } from "./utils";

export function registerMessagingRoutes(app: Express, wsState: WebSocketState) {
  const { clients } = wsState;

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
      if (receiverWs && receiverWs.readyState === 1) {
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
}
