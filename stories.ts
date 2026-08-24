import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { upload, processImage } from '../utils/upload';

const router = Router();

// 1. Post a Story (expires in 24h)
router.post('/upload', authenticateJWT, upload.single('photo'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    if (!req.file) {
      return res.status(400).json({ error: 'Photo is required for story' });
    }

    const processed = await processImage(req.file.filename);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    const story = await prisma.story.create({
      data: {
        userId,
        mediaUrl: processed.url,
        expiresAt,
      },
      include: {
        user: {
          include: { profile: true },
        },
      },
    });

    res.status(201).json(story);
  } catch (error: any) {
    res.status(500).json({ error: 'Error uploading story' });
  }
});

// 2. Get active stories feed (grouped by user, for people current user follows)
router.get('/feed', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const now = new Date();

    // Get following list
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = following.map((f) => f.followingId);
    
    // Include user's own stories in their stories list
    followingIds.push(userId);

    // Get all active stories
    const stories = await prisma.story.findMany({
      where: {
        userId: { in: followingIds },
        expiresAt: { gt: now },
        user: { isSuspended: false },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          include: { profile: true },
        },
        views: {
          where: { userId },
        },
      },
    });

    // Group stories by user
    const groupedStoriesMap = new Map<string, any>();

    stories.forEach((story) => {
      const uId = story.userId;
      if (!groupedStoriesMap.has(uId)) {
        groupedStoriesMap.set(uId, {
          userId: uId,
          username: story.user.username,
          avatarUrl: story.user.profile?.avatarUrl,
          displayName: story.user.profile?.displayName,
          stories: [],
        });
      }
      
      groupedStoriesMap.get(uId).stories.push({
        id: story.id,
        mediaUrl: story.mediaUrl,
        createdAt: story.createdAt,
        isViewed: story.views.length > 0,
      });
    });

    const result = Array.from(groupedStoriesMap.values());
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching story feed' });
  }
});

// 3. View a Story
router.post('/view/:storyId', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) return res.status(404).json({ error: 'Story not found or expired' });

    // Mark as viewed
    await prisma.storyView.upsert({
      where: {
        storyId_userId: { storyId, userId },
      },
      create: { storyId, userId },
      update: {},
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Error recording story view' });
  }
});

// 4. Get story view list (who viewed my story, for creator only)
router.get('/views/:storyId', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { storyId } = req.params;

    const story = await prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (story.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized to view story views list' });
    }

    const views = await prisma.storyView.findMany({
      where: { storyId },
      include: {
        user: {
          include: { profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const viewList = views.map((v) => ({
      userId: v.user.id,
      username: v.user.username,
      displayName: v.user.profile?.displayName,
      avatarUrl: v.user.profile?.avatarUrl,
      viewedAt: v.createdAt,
    }));

    res.json(viewList);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching story views' });
  }
});

export default router;
