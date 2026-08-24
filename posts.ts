import { Router, Response } from 'express';
import { prisma, sendSocketMessage } from '../server';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { upload, processImage } from '../utils/upload';

const router = Router();

// 1. Create Post (supports single or multi-photo uploads)
router.post('/create', authenticateJWT, upload.array('photos', 10), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { caption, location, altTexts } = req.body;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'At least one photo is required' });
    }

    const altTextList = altTexts ? JSON.parse(altTexts) : [];

    // Process all images concurrently
    const processedPhotos = await Promise.all(
      files.map(async (file, index) => {
        const processed = await processImage(file.filename);
        return {
          url: processed.url,
          thumbnailUrl: processed.thumbnailUrl,
          aspectRatio: 1.0, // default square, can be customized
          altText: altTextList[index] || '',
          order: index,
        };
      })
    );

    // Parse and extract hashtags from caption
    const hashtags: string[] = [];
    if (caption) {
      const matches = caption.match(/#\w+/g);
      if (matches) {
        matches.forEach((tag: string) => {
          const cleanTag = tag.substring(1).toLowerCase();
          if (!hashtags.includes(cleanTag)) {
            hashtags.push(cleanTag);
          }
        });
      }
    }

    // Create the post inside a transaction
    const post = await prisma.$transaction(async (tx) => {
      const newPost = await tx.post.create({
        data: {
          userId,
          caption,
          location,
          photos: {
            create: processedPhotos,
          },
        },
        include: {
          photos: true,
          user: {
            include: { profile: true },
          },
        },
      });

      // Increment post count in profile
      await tx.profile.update({
        where: { userId },
        data: { postsCount: { increment: 1 } },
      });

      // Handle hashtag linking
      for (const tagName of hashtags) {
        const hashtag = await tx.hashtag.upsert({
          where: { name: tagName },
          create: { name: tagName },
          update: {},
        });

        await tx.postHashtag.create({
          data: {
            postId: newPost.id,
            hashtagId: hashtag.id,
          },
        });
      }

      return newPost;
    });

    res.status(201).json({ message: 'Post published successfully', post });
  } catch (error: any) {
    console.error('Post creation error:', error);
    res.status(500).json({ error: 'Error publishing post' });
  }
});

// 2. Personalized Home Feed (chronological posts from followed users)
router.get('/feed', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 10;
    const cursor = req.query.cursor as string;

    // Get list of followed user IDs
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = following.map((f) => f.followingId);
    
    // Add self to feed
    followingIds.push(userId);

    // Fetch posts
    const posts = await prisma.post.findMany({
      where: {
        userId: { in: followingIds },
        user: { isSuspended: false },
      },
      take: limit + 1, // Get 1 extra to check for next page cursor
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        photos: true,
        user: {
          include: { profile: true },
        },
        likes: {
          where: { userId },
        },
        savedPosts: {
          where: { userId },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    let nextCursor: string | null = null;
    if (posts.length > limit) {
      const nextItem = posts.pop();
      nextCursor = nextItem!.id;
    }

    // Format posts to indicate if liked/saved by current user
    const formattedPosts = posts.map((post) => ({
      id: post.id,
      caption: post.caption,
      location: post.location,
      createdAt: post.createdAt,
      user: {
        id: post.user.id,
        username: post.user.username,
        avatarUrl: post.user.profile?.avatarUrl,
        displayName: post.user.profile?.displayName,
      },
      photos: post.photos,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: post.likes.length > 0,
      isSaved: post.savedPosts.length > 0,
    }));

    res.json({ posts: formattedPosts, nextCursor });
  } catch (error: any) {
    console.error('Feed error:', error);
    res.status(500).json({ error: 'Error fetching feed' });
  }
});

// 3. Explore Feed (masonry / grid view, trending content, categories)
router.get('/explore', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    
    // Simple popularity formula: liked / commented posts that are not by self and not blocked
    // For local dev, return modern posts with highest likes + random posts
    const posts = await prisma.post.findMany({
      where: {
        user: {
          isSuspended: false,
          isPrivate: false,
          blocksReceived: { none: { blockerId: userId } },
          blocksSent: { none: { blockedId: userId } },
        },
      },
      take: 30,
      orderBy: { createdAt: 'desc' },
      include: {
        photos: true,
        user: {
          include: { profile: true },
        },
        likes: {
          where: { userId },
        },
        savedPosts: {
          where: { userId },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    const formattedPosts = posts.map((post) => ({
      id: post.id,
      caption: post.caption,
      location: post.location,
      createdAt: post.createdAt,
      user: {
        id: post.user.id,
        username: post.user.username,
        avatarUrl: post.user.profile?.avatarUrl,
        displayName: post.user.profile?.displayName,
      },
      photos: post.photos,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: post.likes.length > 0,
      isSaved: post.savedPosts.length > 0,
    }));

    // Fetch trending hashtags
    const hashtags = await prisma.hashtag.findMany({
      take: 5,
      include: {
        _count: {
          select: { posts: true },
        },
      },
      orderBy: {
        posts: { _count: 'desc' },
      },
    });

    res.json({ posts: formattedPosts, trendingHashtags: hashtags.map((h) => h.name) });
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching explore' });
  }
});

// 4. Like / Unlike Post (optimistic action support)
router.post('/:id/like', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const postId = req.params.id;

    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) return res.status(404).json({ error: 'Post not found' });

    const existingLike = await prisma.like.findUnique({
      where: {
        userId_postId: { userId, postId },
      },
    });

    if (existingLike) {
      await prisma.like.delete({
        where: {
          userId_postId: { userId, postId },
        },
      });

      const likesCount = await prisma.like.count({ where: { postId } });
      return res.json({ message: 'Post unliked', liked: false, likesCount });
    } else {
      await prisma.like.create({
        data: { userId, postId },
      });

      const likesCount = await prisma.like.count({ where: { postId } });

      // Send real-time notification to creator (if not self)
      if (post.userId !== userId) {
        const notification = await prisma.notification.create({
          data: {
            recipientId: post.userId,
            senderId: userId,
            type: 'LIKE',
            postId,
          },
          include: {
            sender: {
              include: { profile: true },
            },
          },
        });
        sendSocketMessage(post.userId, 'new_notification', notification);
      }

      return res.json({ message: 'Post liked', liked: true, likesCount });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Error processing like' });
  }
});

// 5. Save / Unsave Post
router.post('/:id/save', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const postId = req.params.id;

    const existingSave = await prisma.savedPost.findUnique({
      where: {
        userId_postId: { userId, postId },
      },
    });

    if (existingSave) {
      await prisma.savedPost.delete({
        where: {
          userId_postId: { userId, postId },
        },
      });
      return res.json({ message: 'Post unsaved', saved: false });
    } else {
      await prisma.savedPost.create({
        data: { userId, postId },
      });
      return res.json({ message: 'Post saved', saved: true });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Error saving post' });
  }
});

// 6. Global Search (People, Usernames, Photos/Captions, Hashtags)
router.get('/search/global', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const query = q.trim().toLowerCase();

    // 1. Search Users
    const users = await prisma.user.findMany({
      where: {
        isSuspended: false,
        OR: [
          { username: { contains: query } },
          { profile: { displayName: { contains: query } } },
        ],
      },
      take: 10,
      include: { profile: true },
    });

    // 2. Search Hashtags
    const hashtags = await prisma.hashtag.findMany({
      where: { name: { contains: query } },
      take: 10,
    });

    // 3. Search Posts by Hashtag or Caption
    const posts = await prisma.post.findMany({
      where: {
        OR: [
          { caption: { contains: query } },
          { hashtags: { some: { hashtag: { name: { contains: query } } } } },
        ],
      },
      take: 15,
      include: {
        photos: true,
        user: { include: { profile: true } },
      },
    });

    res.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.profile?.displayName,
        avatarUrl: u.profile?.avatarUrl,
      })),
      hashtags: hashtags.map((h) => h.name),
      posts: posts.map((p) => ({
        id: p.id,
        thumbnailUrl: p.photos[0]?.thumbnailUrl,
        aspectRatio: p.photos[0]?.aspectRatio,
        user: {
          username: p.user.username,
        },
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// 7. Get single post with photos & details
router.get('/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const requesterId = req.user!.id;
    const postId = req.params.id;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        photos: true,
        user: {
          include: { profile: true },
        },
        likes: {
          where: { userId: requesterId },
        },
        savedPosts: {
          where: { userId: requesterId },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    if (!post || post.user.isSuspended) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({
      id: post.id,
      caption: post.caption,
      location: post.location,
      createdAt: post.createdAt,
      user: {
        id: post.user.id,
        username: post.user.username,
        avatarUrl: post.user.profile?.avatarUrl,
        displayName: post.user.profile?.displayName,
      },
      photos: post.photos,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: post.likes.length > 0,
      isSaved: post.savedPosts.length > 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching post details' });
  }
});

// 8. Get posts by user ID
router.get('/user/:userId', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const requesterId = req.user!.id;
    const { userId } = req.params;

    const posts = await prisma.post.findMany({
      where: {
        userId,
        user: { isSuspended: false },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        photos: true,
        user: {
          include: { profile: true },
        },
        likes: {
          where: { userId: requesterId },
        },
        savedPosts: {
          where: { userId: requesterId },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    const formattedPosts = posts.map((post) => ({
      id: post.id,
      caption: post.caption,
      location: post.location,
      createdAt: post.createdAt,
      user: {
        id: post.user.id,
        username: post.user.username,
        avatarUrl: post.user.profile?.avatarUrl,
        displayName: post.user.profile?.displayName,
      },
      photos: post.photos,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: post.likes.length > 0,
      isSaved: post.savedPosts.length > 0,
    }));

    res.json({ posts: formattedPosts });
  } catch (error: any) {
    console.error('Error fetching user posts:', error);
    res.status(500).json({ error: 'Error fetching user posts' });
  }
});

export default router;
