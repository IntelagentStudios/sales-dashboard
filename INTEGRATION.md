# Intelagent Enrichment Integration

This document explains how the Intelagent Enrichment service is integrated with the Sales Agent system.

## Architecture Overview

The Sales Agent now uses your custom **Intelagent Enrichment Service** instead of external APIs (Hunter, Apollo, Clearbit, etc.). This provides:

- **Complete control** over data enrichment
- **No API costs** for enrichment services
- **GDPR compliance** built-in
- **Intelligent caching** to minimize requests
- **Unified API** for all enrichment needs

## System Components

```
┌─────────────────────────────────────┐
│         Sales Dashboard             │
│        (Next.js - Port 3000)        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│        Sales Agent API              │
│      (Express - Port 3000)          │
│                                     │
│  • Campaign Management              │
│  • Lead Discovery (Google Maps)     │
│  • Job Queue Processing             │
│  • Email Generation & Sending       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Intelagent Enrichment Service     │
│      (Express - Port 3001)          │
│                                     │
│  • Email Finding                    │
│  • Web Scraping                     │
│  • Company Enrichment               │
│  • Technology Detection             │
└─────────────────────────────────────┘
```

## How It Works

### 1. Lead Discovery
- Sales Agent discovers leads using Google Maps API
- Creates lead records in database

### 2. Enrichment Process
When a lead needs enrichment, the Sales Agent:
1. Calls `IntelagentEnrichmentService.enrichLead(leadId)`
2. This service extracts the domain from the lead's website
3. Makes HTTP request to Intelagent Enrichment API
4. Enrichment service performs:
   - Web scraping (up to 10 pages)
   - Email extraction from scraped content
   - Company data enrichment
   - Technology stack detection
5. Returns enriched data to Sales Agent
6. Sales Agent saves all data to database

### 3. Data Flow

```javascript
// Job Queue triggers enrichment
jobQueue.addJob('lead_enrichment', { leadId: 'abc123' })
    ↓
// IntelagentEnrichmentService handles the job
intelagentEnrichment.enrichLead('abc123')
    ↓
// Calls your enrichment API
POST http://localhost:3001/api/enrich/company
{
  domain: "example.com",
  type: "full",
  options: {
    includeEmails: true,
    includeScraping: true,
    includeEnrichment: true
  }
}
    ↓
// Returns enriched data
{
  emails: [...],
  scrapedData: {...},
  enrichedData: {...}
}
    ↓
// Saves to database as contacts, company research, etc.
```

## Starting the System

### Option 1: Start All Services Together
```bash
npm start
```
This runs the startup script that launches both services.

### Option 2: Start Services Individually

Terminal 1 - Enrichment Service:
```bash
cd "Intelagent Enrichment/unified-enrichment-service"
npm start
```

Terminal 2 - Sales Agent API:
```bash
cd api
npm start
```

Terminal 3 - Dashboard:
```bash
cd dashboard
npm run dev
```

### Option 3: Development Mode (with concurrently)
```bash
npm run dev
```
Starts all three services with live reload.

## Configuration

### Sales Agent (.env)
```env
# Intelagent Enrichment Service
ENRICHMENT_API_URL=http://localhost:3001
ENRICHMENT_API_KEY=  # Optional, if you add authentication

# Only need Google APIs for lead discovery
GOOGLE_MAPS_API_KEY=your-key
GOOGLE_PLACES_API_KEY=your-key
```

### Enrichment Service (.env)
```env
# Database (shared with Sales Agent)
DATABASE_URL=postgresql://user:password@localhost:5432/sales_agent

# Service Configuration
PORT=3001
NODE_ENV=development

# No Redis required - uses database for job queue

# Rate Limiting
MAX_REQUESTS_PER_SECOND=2
MAX_CONCURRENT_SCRAPES=5
```

## API Endpoints Used

The Sales Agent uses these Intelagent Enrichment endpoints:

- `POST /api/enrich/company` - Full enrichment (emails + scraping + company data)
- `POST /api/enrich/emails` - Email finding only
- `POST /api/enrich/scrape` - Web scraping only
- `GET /api/enrich/status/{jobId}` - Check async job status

## Features Provided by Intelagent Enrichment

### Email Finding
- Extracts emails from websites
- Searches contact, about, and team pages
- Validates emails using DNS MX records
- Provides confidence scores

### Web Scraping
- Respects robots.txt
- Handles JavaScript-rendered sites
- Extracts structured data (addresses, phones, social links)
- Caches results for 30 days

### Company Enrichment
- Company size and industry detection
- Technology stack identification
- Social media presence analysis
- Business hours and timezone detection
- Estimated revenue/funding

## Database Integration

Both services share the same PostgreSQL database. The enrichment service reads from and writes to:

- `Lead` table - Updates company information
- `Contact` table - Saves discovered emails
- `CompanyResearch` table - Stores scraped data and insights

## Advantages Over External Services

| Feature | External APIs | Intelagent Enrichment |
|---------|--------------|----------------------|
| Cost | $100-1000+/month | Free (self-hosted) |
| Rate Limits | Strict limits | You control |
| Data Privacy | Data sent to 3rd parties | Data stays in-house |
| Customization | Limited | Full control |
| Caching | Usually not included | 30-day intelligent cache |
| GDPR Compliance | Varies | Built-in |

## Troubleshooting

### Enrichment Service Not Starting
1. Check if port 3001 is available
2. Ensure Redis is running (if configured)
3. Check database connection

### No Enrichment Data
1. Verify enrichment service is running: `curl http://localhost:3001/api/health`
2. Check Sales Agent logs for connection errors
3. Ensure domain is valid and website is accessible

### Fallback Mode
If the Enrichment API is unavailable, the Sales Agent will attempt to import the enrichment modules directly. This requires both services to be in the same project structure.

## Monitoring

Check service health:
```bash
# Enrichment Service
curl http://localhost:3001/api/health

# Sales Agent API
curl http://localhost:3000/health
```

View enrichment job status:
```bash
curl http://localhost:3001/api/enrich/status/{jobId}
```

## Future Enhancements

- Add authentication to enrichment API
- Implement webhook notifications for completed jobs
- Add more data sources to enrichment
- Create admin dashboard for enrichment service
- Add metrics and monitoring

## Support

For issues with the Intelagent Enrichment service, check:
- `/Intelagent Enrichment/unified-enrichment-service/README.md`
- Service logs in the console
- Database connection status