import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import templatesRouter from './routes/templates.js';
import campaignsRouter from './routes/campaigns.js';
import jobQueue from './services/jobQueue.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/templates', templatesRouter);
app.use('/api/campaigns', campaignsRouter);

// Simple health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'production',
    port: PORT,
    message: 'Server is running (minimal mode)'
  });
});

// Basic root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Sales Agent API',
    version: '1.0.0',
    status: 'running'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  
  // Start job queue processor
  jobQueue.start(5000);
  console.log('✅ Job queue processor started');
  
  // Schedule recurring jobs
  // Daily lead enrichment check at 2 AM
  jobQueue.scheduleRecurring('0 2 * * *', 'daily_enrichment_check', {});
  
  // Campaign processing every 30 minutes
  jobQueue.scheduleRecurring('*/30 * * * *', 'process_active_campaigns', {});
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  
  // Stop job queue processor
  jobQueue.stop();
  
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export default app;