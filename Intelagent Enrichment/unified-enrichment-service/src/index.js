import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import winston from 'winston';
import { PrismaClient } from '@prisma/client';
import routes from './api/routes.js';
import CacheManager from './utils/cache.js';
import RateLimiter from './utils/rateLimiter.js';

// Load environment variables
dotenv.config();

// Initialize Prisma
const prisma = new PrismaClient();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'combined.log' 
    })
  ]
});

// Initialize services
const cacheManager = new CacheManager();
const rateLimiter = new RateLimiter();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress
    });
  });
  
  next();
});

// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Unified Enrichment Service',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      'POST /api/enrich/company': 'Full company enrichment',
      'POST /api/enrich/emails': 'Email finding only',
      'POST /api/enrich/scrape': 'Web scraping only',
      'POST /api/enrich/data': 'Company data enrichment only',
      'GET /api/enrich/status/:jobId': 'Check enrichment job status',
      'GET /api/health': 'Service health check',
      'GET /api/stats': 'Service statistics'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close database connection
  await prisma.$disconnect();
  logger.info('Database connection closed');
  
  // Stop rate limiter
  rateLimiter.stopCleanup();
  await rateLimiter.onIdle();
  logger.info('Rate limiter stopped');
  
  // Flush cache
  cacheManager.flushMemoryCache();
  logger.info('Cache flushed');
  
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
const server = app.listen(PORT, async () => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('Database connected successfully');
    
    // Start cache cleanup schedule
    cacheManager.startCleanupSchedule();
    logger.info('Cache cleanup schedule started');
    
    // Start rate limiter cleanup
    rateLimiter.startCleanup();
    logger.info('Rate limiter cleanup started');
    
    logger.info(`Unified Enrichment Service running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
});

// Export for testing and integration
export default app;

// Export modules for direct use in other services
export { default as EmailFinder } from './modules/emailFinder.js';
export { default as WebScraper } from './modules/webScraper.js';
export { default as CompanyEnricher } from './modules/companyEnricher.js';
export { default as CacheManager } from './utils/cache.js';
export { default as RateLimiter } from './utils/rateLimiter.js';
export { default as Validator } from './utils/validation.js';

// Export a unified enrichment function for direct integration
export async function enrichCompany(domain, options = {}) {
  try {
    const { EmailFinder, WebScraper, CompanyEnricher } = await import('./index.js');
    
    const emailFinder = new EmailFinder();
    const webScraper = new WebScraper();
    const companyEnricher = new CompanyEnricher();
    
    const result = {};
    
    // Scrape website
    if (options.includeScraping !== false) {
      result.scrapedData = await webScraper.scrapeWebsite(domain);
      
      // Find emails
      if (options.includeEmails !== false) {
        const allContent = result.scrapedData.pages
          .map(page => page.textContent || '')
          .join(' ');
        
        result.emails = await emailFinder.findEmails(domain, allContent);
      }
      
      // Enrich company data
      if (options.includeEnrichment !== false) {
        result.enrichedData = await companyEnricher.enrichCompany(domain, result.scrapedData);
      }
      
      await webScraper.close();
    } else if (options.includeEnrichment !== false) {
      result.enrichedData = await companyEnricher.enrichCompany(domain);
    }
    
    return result;
    
  } catch (error) {
    logger.error(`Error enriching company ${domain}:`, error);
    throw error;
  }
}