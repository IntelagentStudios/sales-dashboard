import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError(err) {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  }
});

redis.on('connect', () => {
  console.log('Redis connected');
});

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

export const cache = {
  async get(key) {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  },

  async set(key, value, ttlSeconds = 3600) {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  },

  async del(key) {
    await redis.del(key);
  },

  async exists(key) {
    return await redis.exists(key);
  },

  async expire(key, seconds) {
    await redis.expire(key, seconds);
  },

  async keys(pattern) {
    return await redis.keys(pattern);
  },

  async flushPattern(pattern) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
};

export default redis;