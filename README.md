# Automated Lead Generation & Outreach System

A comprehensive B2B sales automation system that discovers, qualifies, enriches, and contacts potential customers using AI-powered personalization.

## Railway Architecture

This system is designed to work with your existing Railway setup:
- **Service 1**: Chatbot (PostgreSQL + N8N + Chatbot App) - We connect to this
- **Service 2**: Dashboard (Dashboard App) 
- **Service 3**: Sales Agent (This system) - Standalone API service

### Key Features:
- ✅ **Prisma ORM** - Uses Prisma with multi-schema support
- ✅ **No Redis Required** - Uses PostgreSQL-based job queue
- ✅ **Separate Schema** - All tables in `sales_agent` schema to avoid conflicts
- ✅ **Shared Database** - Connects to Service 1's PostgreSQL
- ✅ **N8N Integration** - Triggers workflows in Service 1

## Features

### 🔍 Lead Discovery
- Multi-source lead generation (Google Maps, YellowPages, Yelp, LinkedIn)
- Automated web scraping of business directories
- Industry-specific search parameters
- Automatic deduplication

### 💎 Lead Enrichment
- Multi-API data enrichment (Clearbit, Hunter, Apollo, PeopleDataLabs)
- Contact discovery with email verification
- Technology stack detection
- Social profile aggregation

### 📊 Lead Scoring
- Sophisticated scoring algorithm (0-100 scale)
- Industry-specific weights
- Automatic qualification/disqualification
- Competitor detection

### 🤖 AI-Powered Email Generation
- Company research automation
- Claude 3 Opus / GPT-4 integration
- Natural personalization (not creepy)
- A/B testing support
- Quality assurance system

### 📧 Email Outreach
- Multi-provider support (SendGrid, Mailgun, AWS SES)
- Email account rotation
- Open/click tracking
- Automated follow-ups
- Response handling

### 📈 Analytics & Monitoring
- Real-time dashboard metrics
- Campaign performance tracking
- Email health monitoring
- API usage tracking
- Executive reporting

### 🔒 Security & Compliance
- GDPR compliance
- CAN-SPAM compliance
- Data encryption
- Audit logging
- Suppression list management

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup with Prisma

Since you're connecting to an existing database with existing tables:

```bash
# Generate Prisma client
npx prisma generate

# Push the sales_agent schema to database (without migrations)
npx prisma db push --skip-generate

# This will create all tables in the sales_agent schema
# Your existing tables in public schema remain untouched
```

To view and manage your database:
```bash
# Open Prisma Studio
npx prisma studio
```

### 3. Environment Variables

Copy `.env.example` to `.env` and set these in Railway Service 3:

```env
# REQUIRED - From Service 1
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# REQUIRED - N8N from Service 1
N8N_WEBHOOK_URL=https://your-service-1.railway.app/webhook
N8N_API_KEY=generate-this-in-n8n

# REQUIRED - At least one email provider
SENDGRID_API_KEY=your-key
# OR
MAILGUN_API_KEY=your-key

# REQUIRED - AI Service (at least one)
ANTHROPIC_API_KEY=your-key
# OR
OPENAI_API_KEY=your-key

# REQUIRED - Lead Discovery
GOOGLE_MAPS_API_KEY=your-key
GOOGLE_PLACES_API_KEY=your-key

# REQUIRED - Security
JWT_SECRET=generate-32-char-string
ENCRYPTION_KEY=generate-32-char-string

# REQUIRED - Company Info (for compliance)
COMPANY_NAME=Your Company
COMPANY_ADDRESS=Your Address
TRACKING_DOMAIN=your-service-3.railway.app
UNSUBSCRIBE_URL=https://your-service-3.railway.app/unsubscribe
```

### 4. Deploy to Railway

```bash
# Initialize git repository
git init
git add .
git commit -m "Initial sales agent setup"

# Connect to Railway
railway link
railway service create sales-agent

# Deploy
railway up
```

### 5. Initialize System

After deployment:

```bash
# Run database initialization
railway run npm run db:init

# This will:
# - Push schema to database using Prisma
# - Set up default campaigns
# - Generate an API key (save this!)
```

### 6. Configure N8N Workflows

In your Service 1 N8N instance:

1. Import the workflow files from `n8n-workflows/`:
   - `daily-lead-pipeline.json`
   - `lead-discovery-workflow.json`
   - `response-handler-workflow.json`

2. Update each workflow:
   - PostgreSQL nodes: Already connected to your database
   - HTTP nodes: Update URLs to point to Service 3
   - Add Service 3 API key to HTTP Authentication

3. Activate the workflows

## API Endpoints

### Lead Discovery
```bash
# Discover leads from Google Maps
POST /api/discover/google-maps
{
  "keyword": "restaurant",
  "location": "40.7128,-74.0060",
  "radius": 5000,
  "industry": "hospitality"
}

# Scrape business directories
POST /api/discover/directories
{
  "directory": "yellowpages",
  "keyword": "dentist",
  "location": "New York, NY"
}
```

### Job Queue Management
```bash
# View job queue statistics
GET /api/jobs/stats

# Check job processing
GET /health
```

### Analytics
```bash
# Get dashboard metrics
GET /api/analytics/dashboard?days=30
```

### N8N Webhooks
```bash
# N8N can trigger these endpoints
POST /webhook/n8n/lead-discovered
POST /webhook/n8n/email-replied
```

## Prisma Commands

```bash
# Generate Prisma Client
npm run prisma:generate

# Push schema changes (without migrations)
npm run prisma:push

# Pull schema from database
npm run prisma:pull

# Open Prisma Studio (GUI)
npm run prisma:studio

# Create migration (if needed)
npm run prisma:migrate
```

## Job Processing

The system uses a PostgreSQL-based job queue (no Redis):

- Jobs are stored in `sales_agent.job_queue` table
- Background processor checks for jobs every 5 seconds
- Automatic retry with exponential backoff
- Priority-based processing

### Job Types:
- `lead_enrichment` - Enrich lead data
- `lead_scoring` - Calculate lead scores
- `email_generation` - Generate personalized emails
- `email_sending` - Send emails
- `website_analysis` - Analyze websites

## Scheduled Tasks

The system automatically runs:
- **6 AM Daily**: Lead discovery pipeline
- **Every 4 hours**: Lead enrichment batch
- **Every hour**: Email campaign processing
- **9 AM Daily**: Analytics report generation
- **2 AM Daily**: Old job cleanup

## Database Schema

All tables are in the `sales_agent` schema, managed by Prisma:
- `sales_agent.leads` - Lead companies
- `sales_agent.contacts` - Contact persons
- `sales_agent.campaigns` - Email campaigns
- `sales_agent.outreach_history` - Email tracking
- `sales_agent.lead_scores` - Scoring data
- `sales_agent.job_queue` - Background jobs
- And more...

Your existing tables in the `public` schema:
- `public.licenses` - From Service 1
- `public.chatbot_logs` - From Service 1
- `public.shared_items` - From Service 1
- `public.domain_licenses` - From Service 1
- `public.site_keys` - From Service 1

## Monitoring

### Health Check
```bash
curl https://your-service-3.railway.app/health
```

### Logs
```bash
railway logs
```

### Job Queue Status
```bash
curl https://your-service-3.railway.app/api/jobs/stats \
  -H "X-API-Key: your-api-key"
```

### Database Monitoring
```bash
# Open Prisma Studio to view/edit data
npm run prisma:studio
```

## Troubleshooting

### Database Connection Issues
```bash
# Test database connection
railway run npx prisma db pull

# Verify schemas exist
railway run psql $DATABASE_URL -c "\dn"
```

### Prisma Issues
```bash
# Regenerate Prisma Client
npx prisma generate

# Reset database (WARNING: Deletes all data in sales_agent schema)
npx prisma db push --force-reset

# Sync schema without losing data
npx prisma db push
```

### Job Processing Issues
```bash
# Check job queue via Prisma Studio
npm run prisma:studio
# Navigate to JobQueue model

# Check failed jobs
railway run npx prisma studio
# Filter JobQueue by status = 'failed'
```

### API Authentication Issues
```bash
# Verify API key exists via Prisma Studio
npm run prisma:studio
# Check ApiKey model
```

## Performance

- Processes 10,000+ leads per day
- Sends 5,000+ personalized emails daily
- <5 second job processing latency
- In-memory caching for frequently accessed data
- Automatic cleanup of old jobs
- Prisma query optimization

## Security

- JWT authentication for API endpoints
- API key authentication for N8N
- Encrypted sensitive data
- Rate limiting per IP
- SQL injection protection via Prisma
- XSS protection via Helmet

## Development

```bash
# Run in development mode
npm run dev

# Generate Prisma types
npm run prisma:generate

# Open database GUI
npm run prisma:studio

# Run tests
npm test

# Check code style
npm run lint
```

## Prisma Schema Updates

When you need to update the schema:

1. Edit `prisma/schema.prisma`
2. Run `npx prisma generate` to update the client
3. Run `npx prisma db push` to update the database
4. Commit the changes

## Support

For issues:
1. Check logs: `railway logs`
2. Verify environment variables
3. Check database connectivity: `npx prisma db pull`
4. Review job queue in Prisma Studio
5. Ensure N8N workflows are active

## License

MIT