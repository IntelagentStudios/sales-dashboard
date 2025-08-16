import NodeCache from 'node-cache';
import { PrismaClient } from '@prisma/client';
import winston from 'winston';

const prisma = new PrismaClient();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class CacheManager {
  constructor(options = {}) {
    this.memoryCache = new NodeCache({
      stdTTL: options.ttl || 3600, // 1 hour default
      checkperiod: options.checkPeriod || 600, // Check every 10 minutes
      useClones: false
    });
    
    this.cacheTTLDays = parseInt(process.env.CACHE_TTL_DAYS) || 30;
  }

  async get(key, type = 'memory') {
    if (type === 'memory') {
      return this.memoryCache.get(key);
    }
    
    if (type === 'database') {
      return await this.getDatabaseCache(key);
    }
    
    return null;
  }

  async set(key, value, type = 'memory', ttlSeconds = null) {
    if (type === 'memory') {
      const ttl = ttlSeconds || this.memoryCache.options.stdTTL;
      return this.memoryCache.set(key, value, ttl);
    }
    
    if (type === 'database') {
      return await this.setDatabaseCache(key, value);
    }
    
    return false;
  }

  async getDatabaseCache(domain) {
    try {
      const cached = await prisma.enrichmentCache.findUnique({
        where: { domain }
      });
      
      if (!cached) {
        return null;
      }
      
      // Check if cache is expired
      if (new Date(cached.expiresAt) < new Date()) {
        await this.invalidateDatabaseCache(domain);
        return null;
      }
      
      logger.info(`Cache hit for domain: ${domain}`);
      
      return {
        scrapedData: cached.scrapedData,
        emails: cached.emails,
        enrichedData: cached.enrichedData,
        lastUpdated: cached.lastUpdated
      };
      
    } catch (error) {
      logger.error(`Error getting database cache for ${domain}:`, error);
      return null;
    }
  }

  async setDatabaseCache(domain, data) {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + this.cacheTTLDays);
      
      await prisma.enrichmentCache.upsert({
        where: { domain },
        update: {
          scrapedData: data.scrapedData || null,
          emails: data.emails || null,
          enrichedData: data.enrichedData || null,
          expiresAt,
          lastUpdated: new Date()
        },
        create: {
          domain,
          scrapedData: data.scrapedData || null,
          emails: data.emails || null,
          enrichedData: data.enrichedData || null,
          expiresAt
        }
      });
      
      logger.info(`Cached data for domain: ${domain}`);
      return true;
      
    } catch (error) {
      logger.error(`Error setting database cache for ${domain}:`, error);
      return false;
    }
  }

  async invalidateDatabaseCache(domain) {
    try {
      await prisma.enrichmentCache.delete({
        where: { domain }
      });
      
      logger.info(`Invalidated cache for domain: ${domain}`);
      return true;
      
    } catch (error) {
      logger.error(`Error invalidating cache for ${domain}:`, error);
      return false;
    }
  }

  async cleanExpiredCache() {
    try {
      const result = await prisma.enrichmentCache.deleteMany({
        where: {
          expiresAt: {
            lt: new Date()
          }
        }
      });
      
      logger.info(`Cleaned ${result.count} expired cache entries`);
      return result.count;
      
    } catch (error) {
      logger.error('Error cleaning expired cache:', error);
      return 0;
    }
  }

  invalidateMemoryCache(key) {
    return this.memoryCache.del(key);
  }

  flushMemoryCache() {
    this.memoryCache.flushAll();
    logger.info('Memory cache flushed');
  }

  getMemoryStats() {
    return {
      keys: this.memoryCache.keys(),
      stats: this.memoryCache.getStats()
    };
  }

  async getCacheSize() {
    try {
      const count = await prisma.enrichmentCache.count();
      return {
        memoryCache: this.memoryCache.keys().length,
        databaseCache: count
      };
    } catch (error) {
      logger.error('Error getting cache size:', error);
      return {
        memoryCache: this.memoryCache.keys().length,
        databaseCache: 0
      };
    }
  }

  startCleanupSchedule() {
    // Clean expired cache every day
    setInterval(async () => {
      await this.cleanExpiredCache();
    }, 24 * 60 * 60 * 1000);
    
    logger.info('Cache cleanup schedule started');
  }
}

export default CacheManager;