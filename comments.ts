import { Router, Response } from 'express';
import { prisma, sendSocketMessage } from '../server';
import { authenticateJWT, AuthRequest } from '../middleware/auth';

const router = Router();

// 1. Get Threaded Comments for a Post
router.get('/:postId', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.id;

    // Fetch top-level comments (where parentId is null)
    const comments = await prisma.comment.findMany({
      where: {
        postId,
        parentId: null,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          include: { profile: true },
        },
        likes: {
          where: { userId },
        },
        replies: {
          include: {
            user: {
              include: { profile: true },
            },
            likes: {
              where: { userId },
            },
            _count: {
              select: { likes: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            likes: true,
            replies: true,
          },
        },
      },
    });

    const formattedComments = comments.map((comment) => ({
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: {
        id: comment.user.id,
        username: comment.user.username,
        avatarUrl: comment.user.profile?.avatarUrl,
        displayName: comment.user.profile?.displayName,
      },
      likesCount: comment._count.likes,
      isLiked: comment.likes.length > 0,
      replies: comment.replies.map((reply) => ({
        id: reply.id,
        text: reply.text,
        createdAt: reply.createdAt,
        user: {
          id: reply.user.id,
          username: reply.user.username,
          avatarUrl: reply.user.profile?.avatarUrl,
          displayName: reply.user.profile?.displayName,
        },
        likesCount: reply._count.likes,
        isLiked: reply.likes.length > 0,
      })),
    }));

    res.json(formattedComments);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching comments' });
  }
});

// 2. Add Comment (or Reply)
router.post('/:postId', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = req.user!.id;
    const { text, parentId } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Comment text cannot be empty' });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        userId,
        postId,
        parentId: parentId || null,
        text,
      },
      include: {
        user: {
          include: { profile: true },
        },
      },
    });

    // Handle real-time notifications
    // A. If it's a reply
    if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId },
      });

      if (parentComment && parentComment.userId !== userId) {
        const notif = await prisma.notification.create({
          data: {
            recipientId: parentComment.userId,
            senderId: userId,
            type: 'REPLY',
            postId,
            commentId: comment.id,
          },
          include: {
            sender: { include: { profile: true } },
          },
        });
        sendSocketMessage(parentComment.userId, 'new_notification', notif);
      }
    } else {
      // B. If it's a main comment, notify post author
      if (post.userId !== userId) {
        const notif = await prisma.notification.create({
          data: {
            recipientId: post.userId,
            senderId: userId,
            type: 'COMMENT',
            postId,
            commentId: comment.id,
          },
          include: {
            sender: { include: { profile: true } },
          },
        });
        sendSocketMessage(post.userId, 'new_notification', notif);
      }
    }

    // C. Process mentions (@username) in the comment text
    const mentions = text.match(/@\w+/g);
    if (mentions) {
      for (const mention of mentions) {
        const usernameToNotify = mention.substring(1).toLowerCase();
        const userToNotify = await prisma.user.findFirst({
          where: { username: usernameToNotify },
        });

        // Make sure we don't notify ourselves or double-notify if we already did above
        if (userToNotify && userToNotify.id !== userId && userToNotify.id !== post.userId) {
          const notif = await prisma.notification.create({
            data: {
              recipientId: userToNotify.id,
              senderId: userId,
              type: 'MENTION',
              postId,
              commentId: comment.id,
            },
            include: {
              sender: { include: { profile: true } },
            },
          });
          sendSocketMessage(userToNotify.id, 'new_notification', notif);
        }
      }
    }

    res.status(201).json(comment);
  } catch (error: any) {
    res.status(500).json({ error: 'Error publishing comment' });
  }
});

// 3. Like a Comment
router.post('/like/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const commentId = req.params.id;

    const existingLike = await prisma.commentLike.findUnique({
      where: {
        userId_commentId: { userId, commentId },
      },
    });

    if (existingLike) {
      await prisma.commentLike.delete({
        where: {
          userId_commentId: { userId, commentId },
        },
      });
      const likesCount = await prisma.commentLike.count({ where: { commentId } });
      return res.json({ message: 'Comment unliked', liked: false, likesCount });
    } else {
      await prisma.commentLike.create({
        data: { userId, commentId },
      });
      const likesCount = await prisma.commentLike.count({ where: { commentId } });
      return res.json({ message: 'Comment liked', liked: true, likesCount });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Error toggling comment like' });
  }
});

// 4. Delete Comment
router.delete('/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const commentId = req.params.id;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { post: true },
    });

    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // User can delete their own comment, OR post owner can delete any comment on their post
    if (comment.userId === userId || comment.post.userId === userId) {
      await prisma.comment.delete({
        where: { id: commentId },
      });
      return res.json({ success: true, message: 'Comment deleted successfully' });
    }

    res.status(403).json({ error: 'Unauthorized to delete this comment' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error deleting comment' });
  }
});

export default router;
