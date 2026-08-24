import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../server';
import { upload, processImage } from '../utils/upload';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'aether-super-secret-jwt-key-2026';

// 1. Sign Up (Registration)
router.post('/register', upload.single('avatar'), async (req: Request, res: Response) => {
  try {
    const { username, email, password, displayName, bio, website, verificationCode } = req.body;

    if (!username || !email || !password || !displayName || !verificationCode) {
      return res.status(400).json({ error: 'Username, email, password, display name, and verification code are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = verificationCode.trim();

    // Validate code (must be between 01 and 26)
    const codeRegex = /^(0[1-9]|1[0-9]|2[0-6])$/;
    if (!codeRegex.test(cleanCode)) {
      return res.status(400).json({ error: 'Index number must be between 01 and 26 (e.g. 01, 09, 15, 26). 00 and index numbers > 26 do not exist.' });
    }

    // Check if code is already taken by another user
    const existingCode = await prisma.user.findFirst({
      where: { verificationCode: cleanCode },
    });
    if (existingCode) {
      return res.status(400).json({ error: `Index number ${cleanCode} is already taken. Please choose another number.` });
    }

    // Check for existing username or email
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanUsername },
          { email: cleanEmail },
        ],
      },
    });

    if (existingUser) {
      if (existingUser.username === cleanUsername) {
        return res.status(400).json({ error: 'Username is already taken' });
      }
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Process avatar if uploaded
    let avatarUrl = '/uploads/default-avatar.png';
    if (req.file) {
      const processed = await processImage(req.file.filename);
      avatarUrl = processed.url;
    }

    // Create User, Profile
    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: cleanEmail,
        passwordHash,
        verificationCode: cleanCode,
        emailVerified: true, // auto-verified upon choosing a valid, unique verification code!
        profile: {
          create: {
            displayName,
            bio: bio || '',
            avatarUrl,
            website: website || '',
          },
        },
      },
      include: {
        profile: true,
      },
    });

    console.log(`[Aether Email Service] Registered user ${cleanUsername} with unique code: ${cleanCode}`);

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      message: 'Registration successful! Verification email sent.',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        profile: user.profile,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message || 'Error creating user' });
  }
});

// 2. Log In
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { usernameOrEmail, password } = req.body;

    if (!usernameOrEmail || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    const cleanInput = usernameOrEmail.trim().toLowerCase();

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanInput },
          { email: cleanInput },
        ],
      },
      include: {
        profile: true,
      },
    });

    if (!user || user.isSuspended) {
      return res.status(401).json({ error: 'Invalid credentials or account suspended' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        profile: user.profile,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error logging in' });
  }
});

// 3. Email Verification
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: 'User ID and verification code are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.verificationCode === code) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          emailVerified: true,
          verificationCode: null,
        },
      });
      return res.json({ success: true, message: 'Email verified successfully!' });
    }

    res.status(400).json({ error: 'Invalid verification code' });
  } catch (error: any) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// 4. Forgot Password (Request Code)
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    
    if (!user) {
      // Return success to prevent email enumeration
      return res.json({ message: 'If email is registered, recovery code has been sent.' });
    }

    const recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationCode: recoveryCode },
    });

    console.log(`[Aether Email Service] Password Recovery Code for ${cleanEmail}: ${recoveryCode}`);
    res.json({ message: 'If email is registered, recovery code has been sent.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Password recovery request failed' });
  }
});

// 5. Reset Password (with Code)
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (!user || user.verificationCode !== code) {
      return res.status(400).json({ error: 'Invalid email or recovery code' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        verificationCode: null,
      },
    });

    res.json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Reset password failed' });
  }
});

export default router;
