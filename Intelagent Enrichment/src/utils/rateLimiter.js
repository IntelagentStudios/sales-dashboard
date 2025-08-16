import PQueue from 'p-queue';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class RateLimiter {
  constructor(options = {}) {
    this.maxRequestsPerSecond = options.maxRequestsPerSecond || 
                                parseInt(process.env.MAX_REQUESTS_PER_SECOND) || 2;
    this.maxConcurrent = options.maxConcurrent || 
                        parseInt(process.env.MAX_CONCURRENT_SCRAPES) || 5;
    
    // Domain-specific queues
    this.domainQueues = new Map();
    
    // Global queue for all requests
    this.globalQueue = new PQueue({
      concurrency: this.maxConcurrent,
      interval: 1000,
      intervalCap: this.maxRequestsPerSecond * 5 // Allow burst of 5x rate for short periods
    });
    
    // Track request counts
    this.requestCounts = new Map();
    this.resetCountsInterval = null;
  }

  async executeWithLimit(domain, fn) {
    // Get or create domain-specific queue
    if (!this.domainQueues.has(domain)) {
      this.domainQueues.set(domain, new PQueue({
        concurrency: 1, // One request at a time per domain
        interval: 1000 / this.maxRequestsPerSecond, // Space out requests
        intervalCap: 1
      }));
    }
    
    const domainQueue = this.domainQueues.get(domain);
    
    // Track request count
    this.trackRequest(domain);
    
    // Execute in both domain queue and global queue
    return await this.globalQueue.add(async () => {
      return await domainQueue.add(async () => {
        logger.info(`Executing request for domain: ${domain}`);
        return await fn();
      });
    });
  }

  trackRequest(domain) {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const key = `${domain}:${minute}`;
    
    if (!this.requestCounts.has(key)) {
      this.requestCounts.set(key, 0);
    }
    
    this.requestCounts.set(key, this.requestCounts.get(key) + 1);
  }

  getRequestCount(domain, minutes = 1) {
    const now = Date.now();
    let total = 0;
    
    for (let i = 0; i < minutes; i++) {
      const minute = Math.floor((now - i * 60000) / 60000);
      const key = `${domain}:${minute}`;
      total += this.requestCounts.get(key) || 0;
    }
    
    return total;
  }

  async waitForCapacity(domain) {
    const domainQueue = this.domainQueues.get(domain);
    
    if (!domainQueue) {
      return true;
    }
    
    // Wait if queue is full
    while (domainQueue.pending >= 1 || domainQueue.size > 0) {
      await this.delay(100);
    }
    
    return true;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeWithRetry(domain, fn, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeWithLimit(domain, fn);
      } catch (error) {
        lastError = error;
        logger.warn(`Attempt ${attempt} failed for ${domain}: ${error.message}`);
        
        if (attempt < maxRetries) {
          // Exponential backoff
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          logger.info(`Retrying in ${backoffMs}ms...`);
          await this.delay(backoffMs);
        }
      }
    }
    
    throw lastError;
  }

  getQueueStats() {
    const stats = {
      global: {
        pending: this.globalQueue.pending,
        size: this.globalQueue.size
      },
      domains: {}
    };
    
    for (const [domain, queue] of this.domainQueues.entries()) {
      stats.domains[domain] = {
        pending: queue.pending,
        size: queue.size,
        recentRequests: this.getRequestCount(domain, 5)
      };
    }
    
    return stats;
  }

  clearDomainQueue(domain) {
    const queue = this.domainQueues.get(domain);
    if (queue) {
      queue.clear();
      this.domainQueues.delete(domain);
      logger.info(`Cleared queue for domain: ${domain}`);
    }
  }

  clearAllQueues() {
    this.globalQueue.clear();
    
    for (const [domain, queue] of this.domainQueues.entries()) {
      queue.clear();
    }
    
    this.domainQueues.clear();
    this.requestCounts.clear();
    
    logger.info('All queues cleared');
  }

  startCleanup() {
    // Clean old request counts every 5 minutes
    this.resetCountsInterval = setInterval(() => {
      const now = Date.now();
      const fiveMinutesAgo = Math.floor((now - 5 * 60000) / 60000);
      
      for (const key of this.requestCounts.keys()) {
        const minute = parseInt(key.split(':')[1]);
        if (minute < fiveMinutesAgo) {
          this.requestCounts.delete(key);
        }
      }
      
      logger.info(`Cleaned request counts. Active domains: ${this.domainQueues.size}`);
    }, 5 * 60000);
  }

  stopCleanup() {
    if (this.resetCountsInterval) {
      clearInterval(this.resetCountsInterval);
      this.resetCountsInterval = null;
    }
  }

  async pause() {
    await this.globalQueue.onIdle();
    this.globalQueue.pause();
    
    for (const queue of this.domainQueues.values()) {
      queue.pause();
    }
    
    logger.info('Rate limiter paused');
  }

  resume() {
    this.globalQueue.start();
    
    for (const queue of this.domainQueues.values()) {
      queue.start();
    }
    
    logger.info('Rate limiter resumed');
  }

  async onIdle() {
    await this.globalQueue.onIdle();
    
    for (const queue of this.domainQueues.values()) {
      await queue.onIdle();
    }
  }
}

export default RateLimiter;