import { query } from '../config/database.js';

// Simple in-memory rate limiter (since we don't have Redis)
class RateLimiter {
  constructor() {
    this.requests = new Map();
    
    // Clean up old entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  async checkLimit(key, limit = 100, windowMs = 60000) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const timestamps = this.requests.get(key);
    
    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(t => t > windowStart);
    
    if (validTimestamps.length >= limit) {
      const oldestTimestamp = validTimestamps[0];
      const resetTime = oldestTimestamp + windowMs;
      const retryAfter = Math.ceil((resetTime - now) / 1000);
      
      return {
        allowed: false,
        retryAfter
      };
    }
    
    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    
    return {
      allowed: true,
      remaining: limit - validTimestamps.length
    };
  }
  
  cleanup() {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    
    for (const [key, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(t => t > now - maxAge);
      
      if (validTimestamps.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validTimestamps);
      }
    }
  }
}

const rateLimiter = new RateLimiter();

// Middleware for rate limiting
export const rateLimiterMiddleware = async (req, res, next) => {
  const key = req.ip || req.connection.remoteAddress;
  const limit = 100; // 100 requests per minute
  
  try {
    const result = await rateLimiter.checkLimit(key, limit);
    
    if (!result.allowed) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        retryAfter: result.retryAfter
      });
    }
    
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    
    next();
  } catch (error) {
    console.error('Rate limiter error:', error);
    next(); // Continue on error
  }
};

// API-specific rate limiters
export const apiRateLimiter = (endpoint, customLimit) => {
  const limits = {
    leadDiscovery: 10,
    emailGeneration: 50,
    enrichment: 30,
    ...customLimit
  };
  
  return async (req, res, next) => {
    const key = `${endpoint}:${req.ip}`;
    const limit = limits[endpoint] || 100;
    
    try {
      const result = await rateLimiter.checkLimit(key, limit);
      
      if (!result.allowed) {
        return res.status(429).json({
          error: 'API Rate Limit',
          endpoint: endpoint,
          retryAfter: result.retryAfter
        });
      }
      
      next();
    } catch (error) {
      console.error('API rate limiter error:', error);
      next();
    }
  };
};