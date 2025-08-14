import Bull from 'bull';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const defaultJobOptions = {
  removeOnComplete: 100,
  removeOnFail: 500,
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000
  }
};

export const queues = {
  leadDiscovery: new Bull('lead-discovery', REDIS_URL, { defaultJobOptions }),
  leadEnrichment: new Bull('lead-enrichment', REDIS_URL, { defaultJobOptions }),
  leadScoring: new Bull('lead-scoring', REDIS_URL, { defaultJobOptions }),
  emailGeneration: new Bull('email-generation', REDIS_URL, { defaultJobOptions }),
  emailSending: new Bull('email-sending', REDIS_URL, { defaultJobOptions }),
  webhookProcessing: new Bull('webhook-processing', REDIS_URL, { defaultJobOptions }),
  websiteAnalysis: new Bull('website-analysis', REDIS_URL, { defaultJobOptions })
};

export const createQueue = (name, options = {}) => {
  return new Bull(name, REDIS_URL, { 
    defaultJobOptions: { ...defaultJobOptions, ...options }
  });
};

export const getQueueStatus = async (queue) => {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount()
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed
  };
};

export const clearQueue = async (queue) => {
  await queue.empty();
  await queue.clean(0, 'completed');
  await queue.clean(0, 'failed');
  await queue.clean(0, 'delayed');
  await queue.clean(0, 'wait');
  await queue.clean(0, 'active');
};

Object.values(queues).forEach(queue => {
  queue.on('error', (error) => {
    console.error(`Queue ${queue.name} error:`, error);
  });

  queue.on('stalled', (job) => {
    console.warn(`Job ${job.id} in queue ${queue.name} stalled`);
  });
});

export default queues;