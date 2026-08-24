import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateJWT, authorizeAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// Protect all admin endpoints
router.use(authenticateJWT, authorizeAdmin);

// 1. Get Platform Analytics Stats
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const totalUsers = await prisma.user.count();
    const activeUsers = await prisma.user.count({ where: { isSuspended: false } });
    const suspendedUsers = await prisma.user.count({ where: { isSuspended: true } });
    const totalPosts = await prisma.post.count();
    const totalComments = await prisma.comment.count();
    const totalLikes = await prisma.like.count();
    const totalReports = await prisma.report.count({ where: { status: 'PENDING' } });

    // Signup growth (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const userGrowth = await prisma.user.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: { gte: sevenDaysAgo },
      },
      _count: { id: true },
    });

    res.json({
      metrics: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        totalPosts,
        totalComments,
        totalLikes,
        pendingReports: totalReports,
      },
      userGrowth,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error loading admin statistics' });
  }
});

// 2. Get Moderation Reports
router.get('/reports', async (req: AuthRequest, res: Response) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { username: true } },
        reportedUser: { select: { id: true, username: true } },
        reportedPost: {
          include: {
            photos: true,
          },
        },
        reportedComment: true,
      },
    });

    res.json(reports);
  } catch (error: any) {
    res.status(500).json({ error: 'Error loading moderation reports' });
  }
});

// 3. Resolve a Report
router.put('/reports/:id/resolve', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const updatedReport = await prisma.report.update({
      where: { id },
      data: { status: 'RESOLVED' },
    });

    res.json({ message: 'Report marked as resolved', report: updatedReport });
  } catch (error: any) {
    res.status(500).json({ error: 'Error resolving report' });
  }
});

// 4. List Users for Management
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        profile: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: 'Error loading user directory' });
  }
});

// 5. Suspend or Unsuspend User
router.put('/users/:id/suspend', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { suspend } = req.body; // boolean

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isSuspended: !!suspend },
    });

    res.json({
      message: `User ${updatedUser.username} has been ${updatedUser.isSuspended ? 'suspended' : 'unsuspended'}`,
      user: { id: updatedUser.id, username: updatedUser.username, isSuspended: updatedUser.isSuspended },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error updating user status' });
  }
});

// 6. Administrative Delete Post
router.delete('/posts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get post owner to decrement postCount
    const post = await prisma.post.findUnique({
      where: { id },
    });

    if (!post) return res.status(404).json({ error: 'Post not found' });

    await prisma.$transaction([
      prisma.post.delete({ where: { id } }),
      prisma.profile.update({
        where: { userId: post.userId },
        data: { postsCount: { decrement: 1 } },
      }),
    ]);

    res.json({ success: true, message: 'Post administratively removed' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error removing post' });
  }
});

// 7. Administrative Delete Comment
router.delete('/comments/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.comment.delete({ where: { id } });
    res.json({ success: true, message: 'Comment administratively removed' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error removing comment' });
  }
});

export default router;
