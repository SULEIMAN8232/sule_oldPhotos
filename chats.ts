import { Router, Response } from 'express';
import { prisma, sendSocketMessage, userSockets } from '../server';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { upload, processImage } from '../utils/upload';

const router = Router();

// 1. Get List of Conversations
router.get('/', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const participations = await prisma.conversationParticipant.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            participants: {
              where: {
                userId: { not: userId },
              },
              include: {
                user: {
                  include: { profile: true },
                },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: {
                sender: { select: { username: true } },
              },
            },
          },
        },
      },
    });

    const chats = participations.map((part) => {
      const conv = part.conversation;
      const lastMessage = conv.messages[0] || null;
      
      // Determine if recipients are online
      const formattedParticipants = conv.participants.map((p) => {
        const isOnline = userSockets.has(p.user.id);
        return {
          id: p.user.id,
          username: p.user.username,
          displayName: p.user.profile?.displayName,
          avatarUrl: p.user.profile?.avatarUrl,
          isOnline,
        };
      });

      return {
        id: conv.id,
        name: conv.name,
        isGroup: conv.isGroup,
        participants: formattedParticipants,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              text: lastMessage.text,
              mediaUrl: lastMessage.mediaUrl,
              senderUsername: lastMessage.sender.username,
              createdAt: lastMessage.createdAt,
            }
          : null,
      };
    });

    res.json(chats);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching chats' });
  }
});

// 2. Create or Open 1-on-1 / Group Conversation
router.post('/conversation', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const { recipientIds, name, isGroup } = req.body;

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ error: 'At least one recipient ID is required' });
    }

    const allParticipantIds = Array.from(new Set([...recipientIds, currentUserId]));

    // If it's a 1-on-1 chat, check if one already exists
    if (!isGroup && allParticipantIds.length === 2) {
      const otherUserId = recipientIds[0];
      const existingConv = await prisma.conversation.findFirst({
        where: {
          isGroup: false,
          AND: [
            { participants: { some: { userId: currentUserId } } },
            { participants: { some: { userId: otherUserId } } },
          ],
        },
        include: {
          participants: {
            where: { userId: { not: currentUserId } },
            include: { user: { include: { profile: true } } },
          },
        },
      });

      if (existingConv) {
        const otherUser = existingConv.participants[0].user;
        return res.json({
          id: existingConv.id,
          isGroup: false,
          participants: [
            {
              id: otherUser.id,
              username: otherUser.username,
              displayName: otherUser.profile?.displayName,
              avatarUrl: otherUser.profile?.avatarUrl,
              isOnline: userSockets.has(otherUser.id),
            },
          ],
        });
      }
    }

    // Otherwise create a new conversation
    const newConv = await prisma.conversation.create({
      data: {
        name: isGroup ? name || 'Group Conversation' : null,
        isGroup: !!isGroup,
        participants: {
          create: allParticipantIds.map((uid) => ({
            userId: uid,
          })),
        },
      },
      include: {
        participants: {
          include: {
            user: { include: { profile: true } },
          },
        },
      },
    });

    const formattedParticipants = newConv.participants
      .filter((p) => p.userId !== currentUserId)
      .map((p) => ({
        id: p.user.id,
        username: p.user.username,
        displayName: p.user.profile?.displayName,
        avatarUrl: p.user.profile?.avatarUrl,
        isOnline: userSockets.has(p.user.id),
      }));

    res.status(201).json({
      id: newConv.id,
      name: newConv.name,
      isGroup: newConv.isGroup,
      participants: formattedParticipants,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error creating conversation' });
  }
});

// 3. Get Messages for a Conversation (Paginated)
router.get('/:conversationId/messages', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user!.id;

    // Check if user is participant
    const isParticipant = await prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
    });

    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
        sharedPost: {
          include: {
            photos: true,
            user: { include: { profile: true } },
          },
        },
        receipts: true,
      },
    });

    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      text: msg.text,
      mediaUrl: msg.mediaUrl,
      sender: {
        id: msg.sender.id,
        username: msg.sender.username,
        displayName: msg.sender.profile?.displayName,
        avatarUrl: msg.sender.profile?.avatarUrl,
      },
      sharedPost: msg.sharedPost
        ? {
            id: msg.sharedPost.id,
            thumbnailUrl: msg.sharedPost.photos[0]?.thumbnailUrl,
            username: msg.sharedPost.user.username,
            caption: msg.sharedPost.caption,
          }
        : null,
      createdAt: msg.createdAt,
      readBy: msg.receipts.map((r) => r.userId),
    }));

    res.json(formattedMessages);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

// 4. Send Message (with optional attachment file or sharedPostId link)
router.post('/:conversationId/message', authenticateJWT, upload.single('media'), async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const senderId = req.user!.id;
    const { text, sharedPostId } = req.body;

    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    const isMember = participants.some((p) => p.userId === senderId);
    if (!isMember) return res.status(403).json({ error: 'Not a member of this chat' });

    let mediaUrl = null;
    if (req.file) {
      const processed = await processImage(req.file.filename);
      mediaUrl = processed.url;
    }

    // Save message
    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        text: text || null,
        mediaUrl,
        sharedPostId: sharedPostId || null,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
        sharedPost: {
          include: {
            photos: true,
            user: { include: { profile: true } },
          },
        },
      },
    });

    // Create a read receipt for sender
    await prisma.messageReceipt.create({
      data: {
        messageId: message.id,
        userId: senderId,
      },
    });

    const formattedMessage = {
      id: message.id,
      text: message.text,
      mediaUrl: message.mediaUrl,
      sender: {
        id: message.sender.id,
        username: message.sender.username,
        displayName: message.sender.profile?.displayName,
        avatarUrl: message.sender.profile?.avatarUrl,
      },
      sharedPost: message.sharedPost
        ? {
            id: message.sharedPost.id,
            thumbnailUrl: message.sharedPost.photos[0]?.thumbnailUrl,
            username: message.sharedPost.user.username,
            caption: message.sharedPost.caption,
          }
        : null,
      createdAt: message.createdAt,
      readBy: [senderId],
    };

    // Emit live message to all participants via socket.io
    participants.forEach((participant) => {
      sendSocketMessage(participant.userId, `message:${conversationId}`, formattedMessage);
      sendSocketMessage(participant.userId, 'chat_list_update', { conversationId });
    });

    res.status(201).json(formattedMessage);
  } catch (error: any) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Error sending message' });
  }
});

// 5. Mark Message as Read
router.post('/read/:messageId', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { messageId } = req.params;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Mark as read
    await prisma.messageReceipt.upsert({
      where: {
        messageId_userId: { messageId, userId },
      },
      create: { messageId, userId },
      update: { readAt: new Date() },
    });

    // Notify other participants of read status
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId: message.conversationId },
      select: { userId: true },
    });

    participants.forEach((p) => {
      sendSocketMessage(p.userId, `message_read:${message.conversationId}`, { messageId, userId });
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Error marking message as read' });
  }
});

export default router;
