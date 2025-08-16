import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
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

// Process enrichment jobs from database queue
async function processEnrichmentJobs() {
  try {
    // Get next pending job
    const job = await prisma.enrichmentJob.findFirst({
      where: { 
        status: 'pending',
        attempts: { lt: 3 }
      },
      orderBy: { createdAt: 'asc' }
    });

    if (!job) {
      // No jobs to process
      return;
    }

    // Mark job as processing
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: { 
        status: 'processing',
        startedAt: new Date()
      }
    });

    try {
      // Process the enrichment
      const result = await performEnrichment(job.domain, job.type, job.options);
      
      // Save result and mark as completed
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          result: result,
          completedAt: new Date()
        }
      });

      // Cache the result
      await cacheManager.set(job.domain, result, 'database');
      
    } catch (error) {
      // Mark job as failed
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: error.message,
          attempts: { increment: 1 }
        }
      });
      
      logger.error(`Job ${job.id} failed:`, error);
    }
  } catch (error) {
    logger.error('Error processing jobs:', error);
  }
}

// Start job processor (runs every 5 seconds)
setInterval(processEnrichmentJobs, 5000);

// Perform the actual enrichment
async function performEnrichment(domain, type, options = {}) {
  const result = {
    domain,
    timestamp: new Date().toISOString()
  };

  try {
    // Scrape website
    if (type === 'full' || type === 'scrape') {
      logger.info(`Scraping ${domain}...`);
      const scrapedData = await webScraper.scrapeWebsite(domain);
      result.scrapedData = scrapedData;
      
      // Find emails from scraped content
      if (type === 'full' || type === 'emails') {
        const allContent = scrapedData.pages
          .map(page => page.textContent || '')
          .join(' ');
        
        result.emails = await emailFinder.findEmails(domain, allContent);
      }
      
      // Enrich company data
      if (type === 'full' || type === 'data') {
        result.enrichedData = await companyEnricher.enrichCompany(domain, scrapedData);
      }
      
      await webScraper.close();
    } else if (type === 'emails') {
      // Just find emails without full scraping
      logger.info(`Finding emails for ${domain}...`);
      result.emails = await emailFinder.findEmails(domain);
    } else if (type === 'data') {
      // Just enrich company data
      logger.info(`Enriching company data for ${domain}...`);
      result.enrichedData = await companyEnricher.enrichCompany(domain);
    }
    
    return result;
  } catch (error) {
    logger.error(`Error enriching ${domain}:`, error);
    throw error;
  }
}

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
    
    // Check rate limit
    const allowed = await rateLimiter.checkLimit(cleanDomain);
    if (!allowed) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.' 
      });
    }
    
    // For synchronous processing (if domain is small or urgent)
    if (options?.sync) {
      try {
        const result = await performEnrichment(cleanDomain, type || 'full', options);
        
        // Cache the result
        await cacheManager.set(cleanDomain, result, 'database');
        
        return res.json({
          success: true,
          data: result
        });
      } catch (error) {
        return res.status(500).json({
          error: 'Enrichment failed',
          message: error.message
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
        status: 'pending',
        options: options || {}
      }
    });
    
    res.json({
      success: true,
      jobId,
      message: 'Enrichment job created. Check status endpoint for results.'
    });
    
  } catch (error) {
    logger.error('Error creating enrichment job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/enrich/emails - Email finding only
router.post('/enrich/emails', validateRequest, async (req, res) => {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    
    const domainValidation = Validator.validateDomain(domain);
    
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }
    
    const cleanDomain = domainValidation.cleanDomain;
    
    // Check rate limit
    const allowed = await rateLimiter.checkLimit(cleanDomain);
    if (!allowed) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.' 
      });
    }
    
    const emails = await emailFinder.findEmails(cleanDomain);
    
    res.json({
      success: true,
      domain: cleanDomain,
      emails: emails.emails || [],
      totalFound: emails.totalFound || 0,
      highConfidence: emails.highConfidence || 0
    });
    
  } catch (error) {
    logger.error('Error finding emails:', error);
    res.status(500).json({ error: 'Failed to find emails' });
  }
});

// POST /api/enrich/scrape - Web scraping only
router.post('/enrich/scrape', validateRequest, async (req, res) => {
  try {
    const { domain, maxPages = 10 } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    
    const domainValidation = Validator.validateDomain(domain);
    
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }
    
    const cleanDomain = domainValidation.cleanDomain;
    
    // Check rate limit
    const allowed = await rateLimiter.checkLimit(cleanDomain);
    if (!allowed) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.' 
      });
    }
    
    const scrapedData = await webScraper.scrapeWebsite(cleanDomain, { maxPages });
    await webScraper.close();
    
    res.json({
      success: true,
      domain: cleanDomain,
      pages: scrapedData.pages || [],
      totalPages: scrapedData.totalPages || 0
    });
    
  } catch (error) {
    logger.error('Error scraping website:', error);
    await webScraper.close();
    res.status(500).json({ error: 'Failed to scrape website' });
  }
});

// POST /api/enrich/data - Company data enrichment only
router.post('/enrich/data', validateRequest, async (req, res) => {
  try {
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    
    const domainValidation = Validator.validateDomain(domain);
    
    if (!domainValidation.valid) {
      return res.status(400).json({ error: domainValidation.error });
    }
    
    const cleanDomain = domainValidation.cleanDomain;
    
    // Check rate limit
    const allowed = await rateLimiter.checkLimit(cleanDomain);
    if (!allowed) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.' 
      });
    }
    
    const enrichedData = await companyEnricher.enrichCompany(cleanDomain);
    
    res.json({
      success: true,
      domain: cleanDomain,
      data: enrichedData
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
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: job.result,
        error: job.error,
        attempts: job.attempts
      }
    });
    
  } catch (error) {
    logger.error('Error checking job status:', error);
    res.status(500).json({ error: 'Failed to check job status' });
  }
});

// GET /api/health - Health check
router.get('/health', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Get job stats
    const pendingJobs = await prisma.enrichmentJob.count({
      where: { status: 'pending' }
    });
    
    const processingJobs = await prisma.enrichmentJob.count({
      where: { status: 'processing' }
    });
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      jobs: {
        pending: pendingJobs,
        processing: processingJobs
      }
    });
    
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// GET /api/stats - Service statistics
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const stats = await prisma.enrichmentJob.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: today }
      },
      _count: true
    });
    
    const totalJobs = await prisma.enrichmentJob.count();
    const todayJobs = await prisma.enrichmentJob.count({
      where: { createdAt: { gte: today } }
    });
    
    res.json({
      total: totalJobs,
      today: todayJobs,
      byStatus: stats.reduce((acc, s) => {
        acc[s.status] = s._count;
        return acc;
      }, {})
    });
    
  } catch (error) {
    logger.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Cleanup old jobs (run periodically)
async function cleanupOldJobs() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const deleted = await prisma.enrichmentJob.deleteMany({
      where: {
        completedAt: { lt: thirtyDaysAgo }
      }
    });
    
    if (deleted.count > 0) {
      logger.info(`Cleaned up ${deleted.count} old jobs`);
    }
  } catch (error) {
    logger.error('Error cleaning up old jobs:', error);
  }
}

// Run cleanup daily
setInterval(cleanupOldJobs, 24 * 60 * 60 * 1000);

export default router;