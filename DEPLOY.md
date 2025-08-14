# Sales Agent Dashboard Deployment Guide

## Quick Deployment Options

### Option 1: Direct Server Deployment (Recommended)

1. **Transfer files to your server:**
```bash
# On your local machine
cd dashboard
npm run build

# Transfer to server (replace with your server details)
scp -r .next package.json package-lock.json public your-server:/var/www/sales-dashboard/
```

2. **On your server:**
```bash
cd /var/www/sales-dashboard
npm install --production
npm install pm2 -g  # If not already installed
```

3. **Update environment variables in ecosystem.config.js:**
```javascript
env: {
  NODE_ENV: 'production',
  PORT: 3001,
  NEXT_PUBLIC_API_URL: 'https://your-railway-api.railway.app'  // Your API URL
}
```

4. **Start with PM2:**
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # To auto-start on server reboot
```

5. **Configure Nginx:**
```bash
# Copy nginx.conf to your nginx sites-available
sudo cp nginx.conf /etc/nginx/sites-available/sales.intelagentstudios.com
sudo ln -s /etc/nginx/sites-available/sales.intelagentstudios.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

6. **Add DNS Record:**
```
Type: A
Name: sales
Value: [Your Server IP]
TTL: 3600
```

### Option 2: Docker Deployment

1. **Build and run with Docker:**
```bash
# Build the image
docker build -t sales-dashboard .

# Run the container
docker run -d \
  --name sales-dashboard \
  -p 3001:3000 \
  -e NEXT_PUBLIC_API_URL=https://your-railway-api.railway.app \
  --restart unless-stopped \
  sales-dashboard
```

2. **Configure Nginx** (same as Option 1, step 5)

3. **Add DNS Record** (same as Option 1, step 6)

### Option 3: Docker Compose (Full Stack)

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  dashboard:
    build: ./dashboard
    ports:
      - "3001:3000"
    environment:
      - NEXT_PUBLIC_API_URL=https://your-railway-api.railway.app
    restart: unless-stopped
```

Run: `docker-compose up -d`

## Environment Variables

Set these in your deployment:
- `PORT`: Port for the dashboard (default: 3001)
- `NEXT_PUBLIC_API_URL`: Your Railway API URL
- `NODE_ENV`: Set to "production"

## SSL Certificate

If using Let's Encrypt:
```bash
sudo certbot --nginx -d sales.intelagentstudios.com
```

## Monitoring

Check application status:
```bash
pm2 status
pm2 logs sales-agent-dashboard
```

## Updates

To deploy updates:
```bash
# Build locally
npm run build

# Transfer new build
scp -r .next your-server:/var/www/sales-dashboard/

# Restart on server
pm2 restart sales-agent-dashboard
```

## Troubleshooting

1. **Port conflicts:** Make sure port 3001 is not in use
2. **Permissions:** Ensure the user has access to the deployment directory
3. **API connection:** Verify NEXT_PUBLIC_API_URL is correct
4. **Logs:** Check `pm2 logs` for any errors

## URLs After Deployment

- Dashboard: https://sales.intelagentstudios.com
- API: https://your-api.railway.app
- Health Check: https://sales.intelagentstudios.com/api/health