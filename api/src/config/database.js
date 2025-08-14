import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Prisma Client
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Handle connection errors - don't exit immediately in production
let isConnected = false;

prisma.$connect()
  .then(() => {
    console.log('✅ Connected to PostgreSQL via Prisma');
    isConnected = true;
  })
  .catch((error) => {
    console.error('❌ Failed to connect to database:', error);
    console.log('⚠️  Application will start without database connection');
    console.log('⚠️  Please set DATABASE_URL environment variable');
    // Don't exit in production - let healthcheck handle it
    if (process.env.NODE_ENV === 'development') {
      process.exit(1);
    }
  });

// Export connection status
export const isDatabaseConnected = () => isConnected;

// Simple in-memory cache for frequently accessed data
class SimpleCache {
  constructor() {
    this.cache = new Map();
  }

  set(key, value, ttlSeconds = 3600) {
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { value, expiresAt });
    
    // Clean up expired entries periodically
    if (this.cache.size > 1000) {
      this.cleanup();
    }
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  delete(key) {
    this.cache.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
  }
}

export const cache = new SimpleCache();

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;