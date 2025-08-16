#!/usr/bin/env node

/**
 * Startup script to run both the Sales Agent API and Intelagent Enrichment Service
 * This ensures both services are available for the complete system to work
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting Intelagent Sales Agent System...\n');

// Start Intelagent Enrichment Service
console.log('📊 Starting Intelagent Enrichment Service...');
const enrichmentService = spawn('npm', ['start'], {
  cwd: join(__dirname, 'Intelagent Enrichment'),
  shell: true,
  stdio: 'pipe'
});

enrichmentService.stdout.on('data', (data) => {
  console.log(`[Enrichment] ${data.toString().trim()}`);
});

enrichmentService.stderr.on('data', (data) => {
  console.error(`[Enrichment Error] ${data.toString().trim()}`);
});

// Wait a moment for enrichment service to start
setTimeout(() => {
  console.log('\n🔧 Starting Sales Agent API...');
  
  const apiService = spawn('npm', ['start'], {
    cwd: join(__dirname, 'api'),
    shell: true,
    stdio: 'pipe'
  });

  apiService.stdout.on('data', (data) => {
    console.log(`[API] ${data.toString().trim()}`);
  });

  apiService.stderr.on('data', (data) => {
    console.error(`[API Error] ${data.toString().trim()}`);
  });

  apiService.on('close', (code) => {
    console.log(`API service exited with code ${code}`);
    process.exit(code);
  });
}, 3000);

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down services...');
  enrichmentService.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Shutting down services...');
  enrichmentService.kill();
  process.exit(0);
});

enrichmentService.on('close', (code) => {
  console.log(`Enrichment service exited with code ${code}`);
  if (code !== 0) {
    console.error('❌ Enrichment service failed to start. Please check the logs.');
    process.exit(1);
  }
});

console.log(`
✅ Services starting...

📍 Enrichment Service: http://localhost:3001
📍 Sales Agent API: http://localhost:3000
📍 Dashboard: http://localhost:3000 (or your Next.js port)

Press Ctrl+C to stop all services.
`);