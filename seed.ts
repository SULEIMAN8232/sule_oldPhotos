import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Aether database...');

  // 1. Clean existing database
  await prisma.report.deleteMany();
  await prisma.block.deleteMany();
  await prisma.storyView.deleteMany();
  await prisma.story.deleteMany();
  await prisma.messageReceipt.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationParticipant.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.savedPost.deleteMany();
  await prisma.commentLike.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.like.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.postHashtag.deleteMany();
  await prisma.hashtag.deleteMany();
  await prisma.post.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();

  const salt = await bcrypt.genSalt(10);
  const userPasswordHash = await bcrypt.hash('password123', salt);
  const adminPasswordHash = await bcrypt.hash('admin123', salt);

  // 2. Create users
  const admin = await prisma.user.create({
    data: {
      username: 'aether_admin',
      email: 'admin@aether.social',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      emailVerified: true,
      profile: {
        create: {
          displayName: 'Aether Operations',
          bio: 'Official curator & administration account for Aether Social.',
          avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=200',
        },
      },
    },
  });

  const evelyn = await prisma.user.create({
    data: {
      username: 'visual_muse',
      email: 'evelyn@aether.social',
      passwordHash: userPasswordHash,
      emailVerified: true,
      profile: {
        create: {
          displayName: 'Evelyn Carter',
          bio: 'Visual artist exploring lighting, architecture, and editorial photography. Based in Copenhagen.',
          website: 'evelyncarter.co',
          avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=200',
        },
      },
    },
  });

  const marcus = await prisma.user.create({
    data: {
      username: 'monochrome',
      email: 'marcus@aether.social',
      passwordHash: userPasswordHash,
      emailVerified: true,
      profile: {
        create: {
          displayName: 'Marcus Sterling',
          bio: 'Chasing geometry, shadows, and high contrast in black & white. Architizer contributor.',
          website: 'marcussterling.xyz',
          avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200',
        },
      },
    },
  });

  const sofia = await prisma.user.create({
    data: {
      username: 'wanderlust',
      email: 'sofia@aether.social',
      passwordHash: userPasswordHash,
      emailVerified: true,
      profile: {
        create: {
          displayName: 'Sofia Alvarez',
          bio: 'Visual storyteller documenting remote cabins, micro-hotels, and slow-travel destinations.',
          website: 'sofiaalvarez.cc',
          avatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=200',
        },
      },
    },
  });

  console.log('Created accounts: admin, visual_muse, monochrome, wanderlust.');

  // 3. Create Follow relationships
  // visual_muse follows monochrome, monochrome follows visual_muse (mutual)
  await prisma.follow.createMany({
    data: [
      { followerId: evelyn.id, followingId: marcus.id },
      { followerId: marcus.id, followingId: evelyn.id },
      // wanderlust follows everyone
      { followerId: sofia.id, followingId: evelyn.id },
      { followerId: sofia.id, followingId: marcus.id },
    ],
  });

  // Update follow counts
  await prisma.profile.update({ where: { userId: evelyn.id }, data: { followersCount: 2, followingCount: 1 } });
  await prisma.profile.update({ where: { userId: marcus.id }, data: { followersCount: 2, followingCount: 1 } });
  await prisma.profile.update({ where: { userId: sofia.id }, data: { followersCount: 0, followingCount: 2 } });

  // 4. Create Posts
  // Post 1: Evelyn Carter
  const post1 = await prisma.post.create({
    data: {
      userId: evelyn.id,
      caption: 'Quiet mornings on the Baltic coast. #nordic #minimalist #copenhagen',
      location: 'Copenhagen, Denmark',
      photos: {
        create: {
          url: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?q=80&w=1200',
          thumbnailUrl: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?q=80&w=400',
          aspectRatio: 1.25,
          altText: 'A minimalist wooden cabin at the edge of a serene sea under soft early morning light.',
        },
      },
    },
  });

  // Post 2: Marcus Sterling
  const post2 = await prisma.post.create({
    data: {
      userId: marcus.id,
      caption: 'Light & Shadows. Vitra Design Museum concrete details. #architecture #monochrome #vitra',
      location: 'Weil am Rhein, Germany',
      photos: {
        create: {
          url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=1200',
          thumbnailUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=400',
          aspectRatio: 1.5,
          altText: 'Geometric concrete walls casting dramatic dark diagonal shadows in monochrome.',
        },
      },
    },
  });

  // Post 3: Sofia Alvarez
  const post3 = await prisma.post.create({
    data: {
      userId: sofia.id,
      caption: 'Found the perfect mountain hideout in Iceland. A frame cabin dreams. #wanderlust #slowtravel #cabin',
      location: 'Reykjavík, Iceland',
      photos: {
        create: {
          url: 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?q=80&w=1200',
          thumbnailUrl: 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?q=80&w=400',
          aspectRatio: 0.75,
          altText: 'A gorgeous wood-clad triangular A-frame cabin glowing warmly from the inside, surrounded by misty mountains.',
        },
      },
    },
  });

  // Post 4: Evelyn Carter (Multi-photo Post Carousel)
  const post4 = await prisma.post.create({
    data: {
      userId: evelyn.id,
      caption: 'A study in organic concrete curves. Exploring Zaha Hadids iconic designs. #architecture #zahahadid #design',
      location: 'Baku, Azerbaijan',
      photos: {
        createMany: {
          data: [
            {
              url: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?q=80&w=1200',
              thumbnailUrl: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?q=80&w=400',
              aspectRatio: 1.0,
              altText: 'Fluid curves of a massive modern white building meeting the sky.',
              order: 0,
            },
            {
              url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200',
              thumbnailUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=400',
              aspectRatio: 1.0,
              altText: 'Glass facade of a modern skyscraper reflecting golden hour sunlight.',
              order: 1,
            },
          ],
        },
      },
    },
  });

  // Update profile postsCounts
  await prisma.profile.update({ where: { userId: evelyn.id }, data: { postsCount: 2 } });
  await prisma.profile.update({ where: { userId: marcus.id }, data: { postsCount: 1 } });
  await prisma.profile.update({ where: { userId: sofia.id }, data: { postsCount: 1 } });

  // 5. Create engagement
  // Marcus likes Evelyn's first post
  await prisma.like.create({
    data: { userId: marcus.id, postId: post1.id },
  });

  // Sofia likes Evelyn's first post and Marcus's post
  await prisma.like.createMany({
    data: [
      { userId: sofia.id, postId: post1.id },
      { userId: sofia.id, postId: post2.id },
    ],
  });

  // 6. Create comments
  // Marcus comments on Evelyn's post
  const comment1 = await prisma.comment.create({
    data: {
      userId: marcus.id,
      postId: post1.id,
      text: 'The light in this is absolutely sublime, Evelyn. Reminds me of Hiroshi Sugimoto.',
    },
  });

  // Evelyn replies to Marcus
  await prisma.comment.create({
    data: {
      userId: evelyn.id,
      postId: post1.id,
      parentId: comment1.id,
      text: 'Thank you Marcus! SUGIMOTO was exactly my inspiration for this shot.',
    },
  });

  // Sofia comments on Marcus's post
  await prisma.comment.create({
    data: {
      userId: sofia.id,
      postId: post2.id,
      text: 'Stunning contrast here. The concrete texture is so tactile.',
    },
  });

  // 7. Seed stories
  const now = new Date();
  await prisma.story.create({
    data: {
      userId: evelyn.id,
      mediaUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=800',
      expiresAt: new Date(now.getTime() + 23 * 60 * 60 * 1000), // 23h from now
    },
  });

  await prisma.story.create({
    data: {
      userId: marcus.id,
      mediaUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=800',
      expiresAt: new Date(now.getTime() + 20 * 60 * 60 * 1000), // 20h from now
    },
  });

  console.log('Successfully seeded database with premium content.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
