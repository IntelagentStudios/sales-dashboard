import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import Bull from 'bull';
import winston from 'winston';
import EmailFinder from '../modules/emailFinder.js';
import WebScraper from '../modules/webScraper.js';
import CompanyEnricher from '../modules/companyEnricher.js';
import CacheManager from '../utils/cache.js';
import RateLimiter from '../utils/rateLimiter.js';
import Validator from '../utils/validation.js';

const router = express.Router();
const prisma = new PrismaClient();

// Initialize services
const emailFinder = new EmailFinder();
const webScraper = new WebScraper();
const companyEnricher = new CompanyEnricher();
const cacheManager = new CacheManager();
const rateLimiter = new RateLimiter();

// Initialize job queue
const enrichmentQueue = new Bull('enrichment', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379'
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Middleware for request validation
const validateRequest = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  // Simple API key validation (implement proper auth in production)
  if (process.env.NODE_ENV === 'production' && !apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  next();
};

// POST /api/enrich/company - Full enrichment
router.post('/enrich/company', validateRequest, async (req, res) => {
  try {
    const validation = Validator.validateEnrichmentRequest(req.body);
    
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const { domain, type, options } = validation.data;
    const domainValidation = Validator.validateDomain(domain);
    
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }
    
    const cleanDomain = domainValidation.cleanDomain;
    
    // Check cache if enabled
    if (options?.useCache) {
      const cached = await cacheManager.get(cleanDomain, 'database');
      if (cached) {
        logger.info(`Returning cached data for ${cleanDomain}`);
        return res.json({
          success: true,
          fromCache: true,
          data: cached
        });
      }
    }
    
    // Create job for async processing
    const jobId = uuidv4();
    
    // Store job in database
    await prisma.enrichmentJob.create({
      data: {
        id: jobId,
        domain: cleanDomain,
        type: type || 'full',
        status: 'pending'
      }
    });
    
    // Add to queue
    await enrichmentQueue.add('enrich', {
      jobId,
      domain: cleanDomain,
      type,
      options
    });
    
    res.json({
      success: true,
      jobId,
      message: 'Enrichment job created',
      statusUrl: `/api/enrich/status/${jobId}`
    });
    
  } catch (error) {
    logger.error('Error creating enrichment job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/enrich/emails - Just email finding
router.post('/enrich/emails', validateRequest, async (req, res) => {
  try {
    const { domain } = req.body;
    const domainValidation = Validator.validateDomain(domain);
    
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }
    
    const cleanDomain = domainValidation.cleanDomain;
    
    // Execute with rate limiting
    const result = await rateLimiter.executeWithLimit(cleanDomain, async () => {
      // First scrape the website for content
      const scrapedData = await webScraper.scrapeWebsite(cleanDomain);
      
      // Combine all scraped content
      const allContent = scrapedData.pages
        .map(page => page.textContent || '')
        .join(' ');
      
      // Find emails
      return await emailFinder.findEmails(cleanDomain, allContent);
    });
    
    await webScraper.close();
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    logger.error('Error finding emails:', error);
    res.status(500).json({ error: 'Failed to find emails' });
  }
});

// POST /api/enrich/scrape - Just web scraping
router.post('/enrich/scrape', validateRequest, async (req, res) => {
  try {
    const { domain, maxPages = 10 } = req.body;
    const domainValidation = Validator.validateDomain(domain);
    
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }
    
    const cleanDomain = domainValidation.cleanDomain;
    
    // Execute with rate limiting
    const result = await rateLimiter.executeWithLimit(cleanDomain, async () => {
      const scraper = new WebScraper({ maxPages });
      const data = await scraper.scrapeWebsite(cleanDomain);
      await scraper.close();
      return data;
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    logger.error('Error scraping website:', error);
    res.status(500).json({ error: 'Failed to scrape website' });
  }
});

// POST /api/enrich/data - Just company data enrichment
router.post('/enrich/data', validateRequest, async (req, res) => {
  try {
    const { domain } = req.body;
    const domainValidation = Validator.validateDomain(domain);
    
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }
    
    const cleanDomain = domainValidation.cleanDomain;
    
    // Execute with rate limiting
    const result = await rateLimiter.executeWithLimit(cleanDomain, async () => {
      return await companyEnricher.enrichCompany(cleanDomain);
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    logger.error('Error enriching company data:', error);
    res.status(500).json({ error: 'Failed to enrich company data' });
  }
});

// GET /api/enrich/status/:jobId - Check job status
router.get('/enrich/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!Validator.isValidJobId(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    
    // Get job from database
    const job = await prisma.enrichmentJob.findUnique({
      where: { id: jobId }
    });
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json({
      success: true,
      job: {
        id: job.id,
        domain: job.domain,
        status: job.status,
        type: job.type,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        result: job.result,
        error: job.error
      }
    });
    
  } catch (error) {
    logger.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// GET /api/health - Health check
router.get('/health', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Get queue stats
    const queueHealth = await enrichmentQueue.getJobCounts();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        queue: queueHealth,
        rateLimiter: rateLimiter.getQueueStats(),
        cache: await cacheManager.getCacheSize()
      }
    });
    
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// GET /api/stats - Service statistics
router.get('/stats', validateRequest, async (req, res) => {
  try {
    const stats = await prisma.enrichmentJob.groupBy({
      by: ['status'],
      _count: {
        id: true
      }
    });
    
    const recentJobs = await prisma.enrichmentJob.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        domain: true,
        status: true,
        type: true,
        createdAt: true
      }
    });
    
    res.json({
      success: true,
      stats: {
        jobCounts: stats,
        recentJobs,
        cache: await cacheManager.getCacheSize(),
        rateLimiter: rateLimiter.getQueueStats()
      }
    });
    
  } catch (error) {
    logger.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Process enrichment queue
enrichmentQueue.process('enrich', async (job) => {
  const { jobId, domain, type, options } = job.data;
  
  try {
    logger.info(`Processing enrichment job ${jobId} for ${domain}`);
    
    // Update job status
    await prisma.enrichmentJob.update({
      where: { id: jobId },
      data: { 
        status: 'processing',
        attempts: { increment: 1 }
      }
    });
    
    let result = {};
    
    // Execute based on type
    if (type === 'full' || options?.includeScraping) {
      const scrapedData = await rateLimiter.executeWithLimit(domain, async () => {
        const scraper = new WebScraper({ maxPages: options?.maxPages || 10 });
        const data = await scraper.scrapeWebsite(domain);
        await scraper.close();
        return data;
      });
      
      result.scrapedData = scrapedData;
      
      if (type === 'full' || options?.includeEmails) {
        const allContent = scrapedData.pages
          .map(page => page.textContent || '')
          .join(' ');
        
        result.emails = await emailFinder.findEmails(domain, allContent);
      }
      
      if (type === 'full' || options?.includeEnrichment) {
        result.enrichedData = await companyEnricher.enrichCompany(domain, scrapedData);
      }
    } else if (type === 'emails') {
      const scrapedData = await webScraper.scrapeWebsite(domain);
      const allContent = scrapedData.pages
        .map(page => page.textContent || '')
        .join(' ');
      
      result = await emailFinder.findEmails(domain, allContent);
      await webScraper.close();
    } else if (type === 'scrape') {
      result = await rateLimiter.executeWithLimit(domain, async () => {
        const scraper = new WebScraper({ maxPages: options?.maxPages || 10 });
        const data = await scraper.scrapeWebsite(domain);
        await scraper.close();
        return data;
      });
    } else if (type === 'data') {
      result = await companyEnricher.enrichCompany(domain);
    }
    
    // Cache result
    await cacheManager.set(domain, result, 'database');
    
    // Update job as completed
    await prisma.enrichmentJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        result,
        completedAt: new Date()
      }
    });
    
    logger.info(`Completed enrichment job ${jobId} for ${domain}`);
    
  } catch (error) {
    logger.error(`Failed enrichment job ${jobId}:`, error);
    
    // Update job as failed
    await prisma.enrichmentJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: error.message,
        completedAt: new Date()
      }
    });
    
    throw error;
  }
});

// Clean up old jobs periodically
setInterval(async () => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const deleted = await prisma.enrichmentJob.deleteMany({
      where: {
        createdAt: {
          lt: thirtyDaysAgo
        }
      }
    });
    
    if (deleted.count > 0) {
      logger.info(`Cleaned up ${deleted.count} old enrichment jobs`);
    }
  } catch (error) {
    logger.error('Error cleaning up old jobs:', error);
  }
}, 24 * 60 * 60 * 1000); // Run daily

export default router;