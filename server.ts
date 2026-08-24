import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Load environment variables
dotenv.config();

export const prisma = new PrismaClient();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for local testing
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads folder if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
// Serve static uploads
app.use('/uploads', express.static(uploadsDir));

// Socket.io User Map for Real-time Messaging and Notifications
// Map of userId -> Set of socketIds (to handle multiple logins from same user)
export const userSockets = new Map<string, Set<string>>();

io.on('connection', (socket) => {
  let authenticatedUserId: string | null = null;

  socket.on('authenticate', (userId: string) => {
    if (!userId) return;
    authenticatedUserId = userId;
    
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)?.add(socket.id);
    
    // Broadcast user online status
    socket.broadcast.emit('user_status', { userId, status: 'online' });
  });

  socket.on('disconnect', () => {
    if (authenticatedUserId && userSockets.has(authenticatedUserId)) {
      const sockets = userSockets.get(authenticatedUserId);
      sockets?.delete(socket.id);
      if (sockets?.size === 0) {
        userSockets.delete(authenticatedUserId);
        // Broadcast user offline status
        socket.broadcast.emit('user_status', { userId: authenticatedUserId, status: 'offline' });
      }
    }
  });

  // Typing status in conversation
  socket.on('typing', (data: { conversationId: string; userId: string; isTyping: boolean }) => {
    socket.broadcast.emit(`typing:${data.conversationId}`, data);
  });
});

// Helper to push real-time notifications/messages
export function sendSocketMessage(userId: string, eventName: string, data: any) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.forEach((socketId) => {
      io.to(socketId).emit(eventName, data);
    });
  }
}

// Log requests middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Import Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import postRoutes from './routes/posts';
import commentRoutes from './routes/comments';
import storyRoutes from './routes/stories';
import chatRoutes from './routes/chats';
import notificationRoutes from './routes/notifications';
import adminRoutes from './routes/admin';

// Register Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500,
    },
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`[Aether Backend] Running at http://localhost:${PORT}`);
});
