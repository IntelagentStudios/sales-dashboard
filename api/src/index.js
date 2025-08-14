import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { createServer } from 'http';
import winston from 'winston';
import cron from 'node-cron';

// Import database and job queue
import prisma from './config/database.js';
import jobQueue from './services/jobQueue.js';

// Import services for scheduled tasks
import leadDiscoveryService from './services/leadDiscovery.js';
import analyticsService from './services/analytics.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiterMiddleware } from './middleware/rateLimiter.js';
import { authentication } from './middleware/auth.js';
import { requestLogger } from './middleware/requestLogger.js';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'sales-agent' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Global middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'production',
    database: 'unknown',
    jobQueue: null
  };

  // Check database connection if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      health.database = 'connected';
    } catch (error) {
      health.database = 'disconnected';
      health.status = 'degraded';
      health.dbError = error.message;
    }
  } else {
    health.database = 'not_configured';
    health.status = 'degraded';
    health.dbError = 'DATABASE_URL not set';
  }

  // Check job queue if database is connected
  if (health.database === 'connected') {
    try {
      const jobStats = await jobQueue.getStats();
      health.jobQueue = {
        isProcessing: jobQueue.isProcessing,
        stats: jobStats
      };
    } catch (error) {
      health.jobQueue = { error: error.message };
    }
  }

  // Return appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : 
                     health.status === 'degraded' ? 200 : 503;
  
  res.status(statusCode).json(health);
});

// API Routes - We'll create these next
// app.use('/api/leads', rateLimiterMiddleware, authentication, leadsRouter);
// app.use('/api/contacts', rateLimiterMiddleware, authentication, contactsRouter);
// app.use('/api/campaigns', rateLimiterMiddleware, authentication, campaignsRouter);
// app.use('/api/email', rateLimiterMiddleware, authentication, emailRouter);
// app.use('/api/tracking', trackingRouter); // No auth for tracking pixels
// app.use('/api/analytics', rateLimiterMiddleware, authentication, analyticsRouter);
// app.use('/api/webhooks', webhooksRouter); // Webhook endpoints

// Temporary test endpoints
app.get('/api/test', authentication, (req, res) => {
  res.json({ message: 'API is working', auth: req.auth });
});

app.post('/api/discover/google-maps', authentication, async (req, res, next) => {
  try {
    const results = await leadDiscoveryService.discoverFromGoogleMaps(req.body);
    res.json({ success: true, leads: results });
  } catch (error) {
    next(error);
  }
});

app.post('/api/discover/directories', authentication, async (req, res, next) => {
  try {
    const { directory, ...params } = req.body;
    const results = await leadDiscoveryService.scrapeBusinessDirectories(directory, params);
    res.json({ success: true, leads: results });
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/stats', authentication, async (req, res, next) => {
  try {
    const stats = await jobQueue.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

app.get('/api/analytics/dashboard', authentication, async (req, res, next) => {
  try {
    const dateRange = parseInt(req.query.days) || 30;
    const metrics = await analyticsService.getDashboardMetrics(dateRange);
    res.json({ success: true, metrics });
  } catch (error) {
    next(error);
  }
});

// N8N Webhook endpoints
app.post('/webhook/n8n/:event', async (req, res) => {
  const { event } = req.params;
  const apiKey = req.headers['x-api-key'];
  
  // Simple API key check for N8N
  if (apiKey !== process.env.N8N_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  logger.info(`N8N webhook received: ${event}`, req.body);
  
  // Process webhook events
  try {
    switch(event) {
      case 'lead-discovered':
        await jobQueue.addJob('lead_enrichment', req.body, { priority: 7 });
        break;
      case 'email-replied':
        await jobQueue.addJob('process_reply', req.body, { priority: 10 });
        break;
      default:
        logger.warn(`Unknown webhook event: ${event}`);
    }
    
    res.json({ success: true, event });
  } catch (error) {
    logger.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Error handling
app.use(errorHandler);

// Schedule recurring tasks
const scheduleJobs = () => {
  // Daily lead discovery at 6 AM
  cron.schedule('0 6 * * *', async () => {
    logger.info('Running daily lead discovery');
    await jobQueue.addJob('daily_discovery', { source: 'scheduled' }, { priority: 8 });
  });

  // Lead enrichment every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    logger.info('Running lead enrichment batch');
    await jobQueue.addJob('batch_enrichment', { source: 'scheduled' }, { priority: 6 });
  });

  // Email campaign processing every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Processing email campaigns');
    await jobQueue.addJob('process_campaigns', { source: 'scheduled' }, { priority: 7 });
  });

  // Daily analytics report at 9 AM
  cron.schedule('0 9 * * *', async () => {
    logger.info('Generating daily analytics report');
    await jobQueue.addJob('daily_report', { source: 'scheduled' }, { priority: 5 });
  });

  // Cleanup old jobs every day at 2 AM
  cron.schedule('0 2 * * *', async () => {
    logger.info('Cleaning up old jobs');
    await jobQueue.cleanupOldJobs();
  });
};

// Start job processor
jobQueue.start(5000); // Check for jobs every 5 seconds
scheduleJobs();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  
  // Stop job processor
  jobQueue.stop();
  
  // Close server
  server.close(async () => {
    logger.info('HTTP server closed');
    
    // Close database connection
    await prisma.$disconnect();
    logger.info('Database connection closed');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  logger.info(`Sales Agent API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Database: Connected to Service 1 PostgreSQL`);
  logger.info(`Schema: sales_agent`);
  logger.info(`Job processor: Started`);
});

export default app;