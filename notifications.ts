import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateJWT, AuthRequest } from '../middleware/auth';

const router = Router();

// 1. Get User Notifications
router.get('/', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const notifications = await prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: {
          include: { profile: true },
        },
        comment: true,
      },
      take: 50,
    });

    const formatted = notifications.map((notif) => ({
      id: notif.id,
      type: notif.type,
      postId: notif.postId,
      isRead: notif.isRead,
      createdAt: notif.createdAt,
      sender: {
        id: notif.sender.id,
        username: notif.sender.username,
        displayName: notif.sender.profile?.displayName,
        avatarUrl: notif.sender.profile?.avatarUrl,
      },
      commentText: notif.comment?.text || null,
    }));

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching notifications' });
  }
});

// 2. Mark All Notifications as Read
router.put('/read-all', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error marking notifications as read' });
  }
});

// 3. Mark Single Notification as Read
router.put('/:id/read', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const notif = await prisma.notification.findFirst({
      where: { id, recipientId: userId },
    });

    if (!notif) return res.status(404).json({ error: 'Notification not found' });

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Error marking notification as read' });
  }
});

// 4. Get Unread Notifications Badge Count
router.get('/badge-count', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const count = await prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });

    res.json({ count });
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching notification badge count' });
  }
});

export default router;
