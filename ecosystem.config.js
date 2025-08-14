module.exports = {
  apps: [{
    name: 'sales-agent-dashboard',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/sales-dashboard',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      NEXT_PUBLIC_API_URL: 'https://your-api.railway.app'  // Update this
    }
  }]
};