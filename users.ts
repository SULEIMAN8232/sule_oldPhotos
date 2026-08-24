import { Router, Response } from 'express';
import { prisma, sendSocketMessage } from '../server';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { upload, processImage } from '../utils/upload';

const router = Router();

// 1. Get Profile Details
router.get('/:username', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const requesterId = req.user!.id;
    const { username } = req.params;

    const userProfile = await prisma.user.findFirst({
      where: { username: username.toLowerCase() },
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
    });

    if (!userProfile || userProfile.isSuspended) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if requester is following this user
    const isFollowing = await prisma.follow.findFirst({
      where: {
        followerId: requesterId,
        followingId: userProfile.id,
      },
    });

    // Check if requester is blocked by this user or vice versa
    const isBlocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: requesterId, blockedId: userProfile.id },
          { blockerId: userProfile.id, blockedId: requesterId },
        ],
      },
    });

    res.json({
      id: userProfile.id,
      username: userProfile.username,
      isPrivate: userProfile.isPrivate,
      profile: userProfile.profile,
      counts: {
        posts: userProfile._count.posts,
        followers: userProfile._count.followers,
        following: userProfile._count.following,
      },
      isFollowing: !!isFollowing,
      isBlocked: !!isBlocked,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching profile' });
  }
});

// 2. Follow / Unfollow User
router.post('/:id/follow', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const followerId = req.user!.id;
    const followingId = req.params.id;

    if (followerId === followingId) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: followingId },
      include: { profile: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check block
    const blockCheck = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: followerId, blockedId: followingId },
          { blockerId: followingId, blockedId: followerId },
        ],
      },
    });
    if (blockCheck) {
      return res.status(403).json({ error: 'Action block active between users' });
    }

    // Check if already following
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });

    if (existingFollow) {
      // Unfollow
      await prisma.follow.delete({
        where: {
          followerId_followingId: { followerId, followingId },
        },
      });

      // Recalculate counts in profiles
      await prisma.profile.update({
        where: { userId: followerId },
        data: { followingCount: { decrement: 1 } },
      });
      const updatedProfile = await prisma.profile.update({
        where: { userId: followingId },
        data: { followersCount: { decrement: 1 } },
      });

      return res.json({ message: 'Unfollowed successfully', following: false, profile: updatedProfile });
    } else {
      // Follow
      await prisma.follow.create({
        data: { followerId, followingId },
      });

      // Recalculate counts
      await prisma.profile.update({
        where: { userId: followerId },
        data: { followingCount: { increment: 1 } },
      });
      const updatedProfile = await prisma.profile.update({
        where: { userId: followingId },
        data: { followersCount: { increment: 1 } },
      });

      // Check if target follows back to mark notification type
      const targetFollowsBack = await prisma.follow.findUnique({
        where: {
          followerId_followingId: { followerId: followingId, followingId: followerId },
        },
      });

      const notifType = targetFollowsBack ? 'FOLLOW_BACK' : 'FOLLOW';

      // Create Notification
      const notification = await prisma.notification.create({
        data: {
          recipientId: followingId,
          senderId: followerId,
          type: notifType,
        },
        include: {
          sender: {
            include: { profile: true },
          },
        },
      });

      // Send Real-time notification
      sendSocketMessage(followingId, 'new_notification', notification);

      return res.json({ message: 'Followed successfully', following: true, profile: updatedProfile });
    }
  } catch (error: any) {
    console.error('Follow error:', error);
    res.status(500).json({ error: 'Error processing follow/unfollow request' });
  }
});

// 3. Update Profile
router.put('/profile/update', authenticateJWT, upload.single('avatar'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { displayName, bio, website, isPrivate } = req.body;

    const dataToUpdate: any = {};
    if (displayName) dataToUpdate.displayName = displayName;
    if (bio !== undefined) dataToUpdate.bio = bio;
    if (website !== undefined) dataToUpdate.website = website;

    if (req.file) {
      const processed = await processImage(req.file.filename);
      dataToUpdate.avatarUrl = processed.url;
    }

    const updatedProfile = await prisma.profile.update({
      where: { userId },
      data: dataToUpdate,
    });

    if (isPrivate !== undefined) {
      await prisma.user.update({
        where: { id: userId },
        data: { isPrivate: isPrivate === 'true' || isPrivate === true },
      });
    }

    res.json({ message: 'Profile updated successfully', profile: updatedProfile });
  } catch (error: any) {
    res.status(500).json({ error: 'Error updating profile' });
  }
});

// 4. Get Followers List
router.get('/:username/followers', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { username } = req.params;
    const user = await prisma.user.findFirst({ where: { username: username.toLowerCase() } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const followers = await prisma.follow.findMany({
      where: { followingId: user.id },
      include: {
        follower: {
          include: { profile: true },
        },
      },
    });

    const list = followers.map((f) => ({
      id: f.follower.id,
      username: f.follower.username,
      displayName: f.follower.profile?.displayName,
      avatarUrl: f.follower.profile?.avatarUrl,
    }));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching followers' });
  }
});

// 5. Get Following List
router.get('/:username/following', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { username } = req.params;
    const user = await prisma.user.findFirst({ where: { username: username.toLowerCase() } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const following = await prisma.follow.findMany({
      where: { followerId: user.id },
      include: {
        following: {
          include: { profile: true },
        },
      },
    });

    const list = following.map((f) => ({
      id: f.following.id,
      username: f.following.username,
      displayName: f.following.profile?.displayName,
      avatarUrl: f.following.profile?.avatarUrl,
    }));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching following' });
  }
});

// 6. Block User
router.post('/:id/block', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const blockerId = req.user!.id;
    const blockedId = req.params.id;

    if (blockerId === blockedId) return res.status(400).json({ error: 'Cannot block yourself' });

    // Create block
    await prisma.block.upsert({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
      create: { blockerId, blockedId },
      update: {},
    });

    // Automatically remove mutual follows
    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId },
        ],
      },
    });

    // Update follow counts for safety
    const updateCounts = async (userId: string) => {
      const followersCount = await prisma.follow.count({ where: { followingId: userId } });
      const followingCount = await prisma.follow.count({ where: { followerId: userId } });
      await prisma.profile.update({
        where: { userId },
        data: { followersCount, followingCount },
      });
    };

    await updateCounts(blockerId);
    await updateCounts(blockedId);

    res.json({ message: 'User blocked successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Error blocking user' });
  }
});

// 7. Report Entity (User, Post, Comment)
router.post('/report', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const reporterId = req.user!.id;
    const { reportedUserId, reportedPostId, reportedCommentId, reason } = req.body;

    if (!reason) return res.status(400).json({ error: 'Reason is required' });

    const report = await prisma.report.create({
      data: {
        reporterId,
        reportedUserId,
        reportedPostId,
        reportedCommentId,
        reason,
      },
    });

    res.json({ message: 'Report submitted successfully. Thank you for making Aether safe.', report });
  } catch (error: any) {
    res.status(500).json({ error: 'Error submitting report' });
  }
});

export default router;
