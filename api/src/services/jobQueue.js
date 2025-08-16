import prisma from '../config/database.js';
import cron from 'node-cron';

class JobQueueService {
  constructor() {
    this.processors = new Map();
    this.isProcessing = false;
    this.processingInterval = null;
  }

  // Register a job processor
  registerProcessor(jobType, processor) {
    this.processors.set(jobType, processor);
    console.log(`Registered processor for job type: ${jobType}`);
  }

  // Add a job to the queue
  async addJob(jobType, payload, options = {}) {
    const {
      priority = 5,
      scheduledFor = new Date(),
      maxAttempts = 3
    } = options;

    try {
      const job = await prisma.jobQueue.create({
        data: {
          jobType,
          priority,
          payload,
          scheduledFor,
          maxAttempts,
          status: 'pending'
        }
      });

      return job.id;
    } catch (error) {
      console.error('Failed to add job to queue:', error.message);
      // Return null if database is not available
      return null;
    }
  }

  // Process pending jobs
  async processJobs() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;

    try {
      // Get and lock next available job using a transaction
      const job = await prisma.$transaction(async (tx) => {
        // Find next pending job
        const nextJob = await tx.jobQueue.findFirst({
          where: {
            status: 'pending',
            scheduledFor: { lte: new Date() },
            attempts: { lt: prisma.jobQueue.fields.maxAttempts }
          },
          orderBy: [
            { priority: 'desc' },
            { scheduledFor: 'asc' }
          ]
        });

        if (!nextJob) return null;

        // Update it to processing
        const updatedJob = await tx.jobQueue.update({
          where: { id: nextJob.id },
          data: {
            status: 'processing',
            startedAt: new Date()
          }
        });

        return updatedJob;
      });

      if (!job) {
        this.isProcessing = false;
        return;
      }

      const processor = this.processors.get(job.jobType);

      if (!processor) {
        await this.failJob(job.id, `No processor found for job type: ${job.jobType}`);
        this.isProcessing = false;
        return;
      }

      try {
        // Process the job
        await processor(job.payload);
        
        // Mark job as completed
        await prisma.jobQueue.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            completedAt: new Date()
          }
        });

        console.log(`Job ${job.id} (${job.jobType}) completed successfully`);
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
        await this.handleJobError(job, error);
      }
    } catch (error) {
      console.error('Error in job processing:', error);
    } finally {
      this.isProcessing = false;
    }

    // Process next job immediately if available
    setImmediate(() => this.processJobs());
  }

  // Handle job processing errors
  async handleJobError(job, error) {
    const attempts = job.attempts + 1;
    
    if (attempts >= job.maxAttempts) {
      await this.failJob(job.id, error.message);
    } else {
      // Exponential backoff for retry
      const delayMinutes = Math.pow(2, attempts);
      const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000);
      
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: {
          status: 'pending',
          attempts,
          scheduledFor,
          errorMessage: error.message
        }
      });
    }
  }

  // Mark job as failed
  async failJob(jobId, errorMessage) {
    await prisma.jobQueue.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage
      }
    });
  }

  // Start the job processor
  start(intervalMs = 5000) {
    if (this.processingInterval) {
      console.log('Job processor already running');
      return;
    }

    console.log('Starting job processor...');
    
    // Process jobs immediately
    this.processJobs();
    
    // Set up interval for continuous processing
    this.processingInterval = setInterval(() => {
      this.processJobs();
    }, intervalMs);

    // Clean up old completed jobs daily
    cron.schedule('0 0 * * *', () => {
      this.cleanupOldJobs();
    });
  }

  // Stop the job processor
  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('Job processor stopped');
    }
  }

  // Clean up old completed jobs
  async cleanupOldJobs() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    const result = await prisma.jobQueue.deleteMany({
      where: {
        status: { in: ['completed', 'failed'] },
        completedAt: { lt: cutoffDate }
      }
    });

    console.log(`Cleaned up ${result.count} old jobs`);
  }

  // Get job statistics
  async getStats() {
    try {
      const stats = await prisma.jobQueue.groupBy({
        by: ['jobType', 'status'],
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        _count: true
      });

      return stats.map(stat => ({
        job_type: stat.jobType,
        status: stat.status,
        count: stat._count
      }));
    } catch (error) {
      console.error('Failed to get job stats:', error.message);
      return [];
    }
  }

  // Schedule a recurring job
  scheduleRecurring(cronExpression, jobType, payload) {
    cron.schedule(cronExpression, async () => {
      await this.addJob(jobType, payload, { priority: 10 });
    });
    
    console.log(`Scheduled recurring job: ${jobType} with cron: ${cronExpression}`);
  }
}

// Create singleton instance
const jobQueue = new JobQueueService();

// Register default job processors
jobQueue.registerProcessor('lead_enrichment', async (payload) => {
  const { default: intelagentEnrichment } = await import('./intelagentEnrichment.js');
  await intelagentEnrichment.enrichLead(payload.leadId);
});

jobQueue.registerProcessor('lead_scoring', async (payload) => {
  const { default: scoringService } = await import('./leadScoring.js');
  await scoringService.scoreLead(payload.leadId);
});

jobQueue.registerProcessor('email_generation', async (payload) => {
  const { default: emailService } = await import('./emailGeneration.js');
  await emailService.generatePersonalizedEmail(
    payload.leadId,
    payload.contactId,
    payload.campaignId
  );
});

jobQueue.registerProcessor('email_sending', async (payload) => {
  const { default: outreachService } = await import('./emailOutreach.js');
  await outreachService.sendEmail(payload);
});

jobQueue.registerProcessor('website_analysis', async (payload) => {
  const { default: intelagentEnrichment } = await import('./intelagentEnrichment.js');
  await intelagentEnrichment.scrapeWebsite(payload.leadId);
});

jobQueue.registerProcessor('discover_leads', async (payload) => {
  const { default: discoveryService } = await import('./leadDiscovery.js');
  const { campaignId, searchCriteria, method } = payload;
  
  if (method === 'google_maps') {
    await discoveryService.discoverFromGoogleMaps(searchCriteria);
  } else if (method === 'directories') {
    await discoveryService.scrapeBusinessDirectories(searchCriteria.directory, searchCriteria);
  } else if (method === 'linkedin') {
    await discoveryService.discoverFromLinkedIn(searchCriteria);
  }
});

jobQueue.registerProcessor('find_emails', async (payload) => {
  const { default: intelagentEnrichment } = await import('./intelagentEnrichment.js');
  await intelagentEnrichment.findEmailsForLead(payload.leadId);
});

jobQueue.registerProcessor('enrich_contact', async (payload) => {
  // Contact enrichment now handled by Intelagent Enrichment during lead enrichment
  const { default: intelagentEnrichment } = await import('./intelagentEnrichment.js');
  await intelagentEnrichment.enrichLead(payload.leadId);
});

jobQueue.registerProcessor('campaign_processing', async (payload) => {
  const { campaignId } = payload;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { leads: true }
  });
  
  if (!campaign) return;
  
  // Queue lead discovery
  await jobQueue.addJob('discover_leads', {
    campaignId,
    searchCriteria: campaign.searchCriteria,
    method: campaign.searchMethod || 'google_maps'
  }, { priority: 10 });
  
  // Process existing leads
  for (const lead of campaign.leads) {
    // Queue enrichment for each lead
    await jobQueue.addJob('lead_enrichment', { leadId: lead.id }, {
      priority: 5,
      scheduledFor: new Date(Date.now() + 5000)
    });
    
    // Queue email finding
    await jobQueue.addJob('find_emails', { leadId: lead.id }, {
      priority: 4,
      scheduledFor: new Date(Date.now() + 10000)
    });
  }
});

export default jobQueue;