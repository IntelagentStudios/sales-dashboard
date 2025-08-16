# Unified Data Enrichment Service

A comprehensive data enrichment service that combines email finding, web scraping, and company data enrichment into one powerful tool. Built for production use with GDPR compliance, intelligent caching, and rate limiting.

## Features

### 🔍 Email Finder Module
- Extract emails from company websites (contact pages, about pages)
- Search for common patterns: firstname.lastname@, info@, contact@, sales@
- Validate emails using DNS MX record checks
- Store confidence scores for each email found
- GDPR compliance: only process publicly available emails

### 🌐 Web Scraper Module
- Intelligent website crawling (respects robots.txt)
- Extract key pages: home, about, contact, team, careers, blog
- Handle JavaScript-rendered sites using Puppeteer
- Rotating user agents and rate limiting
- Extract structured data: addresses, phone numbers, social links
- 30-day cache to avoid re-scraping

### 🏢 Company Enrichment Module
- Basic info: company size, industry, location, founded year
- Tech stack detection (CMSs, analytics tools, chat widgets)
- Recent company updates: job postings, news, blog posts
- Social media presence and activity levels
- Business hours and timezone detection
- Estimated revenue/funding from public sources

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd unified-enrichment-service

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate
```

## Configuration

Update the `.env` file with your settings:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sales_agent?schema=sales_agent"

# Service Configuration
PORT=3001
NODE_ENV=development

# No Redis required - uses database for job queue

# Rate Limiting
MAX_REQUESTS_PER_SECOND=2
MAX_CONCURRENT_SCRAPES=5

# Cache Settings
CACHE_TTL_DAYS=30
```

## Usage

### Starting the Service

```bash
# Development mode
npm run dev

# Production mode
npm start
```

### API Endpoints

#### Full Company Enrichment
```bash
POST /api/enrich/company
Content-Type: application/json

{
  "domain": "example.com",
  "type": "full",
  "options": {
    "includeEmails": true,
    "includeScraping": true,
    "includeEnrichment": true,
    "maxPages": 10,
    "useCache": true
  }
}
```

#### Email Finding Only
```bash
POST /api/enrich/emails
Content-Type: application/json

{
  "domain": "example.com"
}
```

#### Web Scraping Only
```bash
POST /api/enrich/scrape
Content-Type: application/json

{
  "domain": "example.com",
  "maxPages": 10
}
```

#### Company Data Only
```bash
POST /api/enrich/data
Content-Type: application/json

{
  "domain": "example.com"
}
```

#### Check Job Status
```bash
GET /api/enrich/status/{jobId}
```

#### Health Check
```bash
GET /api/health
```

### Integration with Sales Agent

#### Method 1: Direct Import
```javascript
// In your sales-agent project
import { enrichCompany } from '../unified-enrichment-service';

// Use in your lead enrichment
const enrichmentData = await enrichCompany('example.com', {
  includeEmails: true,
  includeScraping: true,
  includeEnrichment: true
});
```

#### Method 2: HTTP API
```javascript
// In your sales-agent project
import axios from 'axios';

async function enrichLead(domain) {
  const response = await axios.post('http://localhost:3001/api/enrich/company', {
    domain: domain,
    type: 'full'
  });
  
  return response.data;
}
```

#### Method 3: Import Individual Modules
```javascript
import { EmailFinder, WebScraper, CompanyEnricher } from '../unified-enrichment-service';

const emailFinder = new EmailFinder();
const scraper = new WebScraper();
const enricher = new CompanyEnricher();

// Use modules individually as needed
const emails = await emailFinder.findEmails('example.com');
const scrapedData = await scraper.scrapeWebsite('example.com');
const companyData = await enricher.enrichCompany('example.com');
```

## Response Format

### Full Enrichment Response
```json
{
  "success": true,
  "data": {
    "scrapedData": {
      "domain": "example.com",
      "pages": [...],
      "totalPages": 10
    },
    "emails": {
      "domain": "example.com",
      "emails": [
        {
          "email": "contact@example.com",
          "source": "scraped",
          "confidence": 0.95,
          "isValid": true
        }
      ],
      "totalFound": 5,
      "highConfidence": 3
    },
    "enrichedData": {
      "domain": "example.com",
      "basicInfo": {
        "name": "Example Company",
        "description": "Company description",
        "industry": "technology",
        "location": "San Francisco, CA",
        "foundedYear": 2010,
        "companySize": {
          "range": "51-200",
          "label": "Medium"
        }
      },
      "techStack": {
        "cms": "wordpress",
        "analytics": ["Google Analytics"],
        "chatWidgets": ["Intercom"]
      },
      "socialMedia": {
        "facebook": "https://facebook.com/example",
        "linkedin": "https://linkedin.com/company/example"
      },
      "estimatedMetrics": {
        "estimatedRevenue": "$10-50M",
        "growthStage": "Growth",
        "marketPosition": "Challenger"
      }
    }
  }
}
```

## Deployment

### Railway Deployment

1. Create a new Railway project
2. Add PostgreSQL service (no Redis needed)
3. Deploy the service:

```bash
# In your Railway project
railway link
railway up
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

# Install Chromium for Puppeteer
RUN apk add --no-cache chromium

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npx prisma generate

EXPOSE 3001

CMD ["npm", "start"]
```

## Compliance & Best Practices

- ✅ Respects robots.txt and meta tags
- ✅ Rate limiting: max 2 requests/second per domain
- ✅ User-Agent: "IntelagentBot/1.0 (+https://intelagentstudios.com/bot)"
- ✅ Caches everything to minimize repeat requests
- ✅ Only collects publicly available information
- ✅ GDPR compliant email processing
- ✅ Comprehensive error handling and logging

## Testing

```bash
# Test email finding
curl -X POST http://localhost:3001/api/enrich/emails \
  -H "Content-Type: application/json" \
  -d '{"domain": "example.com"}'

# Test full enrichment
curl -X POST http://localhost:3001/api/enrich/company \
  -H "Content-Type: application/json" \
  -d '{"domain": "example.com", "type": "full"}'
```

## Troubleshooting

### Common Issues

1. **Puppeteer fails to launch**
   - Ensure Chrome/Chromium dependencies are installed
   - Check Puppeteer args in webScraper.js

2. **Database connection errors**
   - Verify DATABASE_URL in .env
   - Run `npx prisma migrate dev` to ensure schema is updated

3. **Job queue not processing**
   - Check database connection
   - Verify EnrichmentJob table exists in database
   - Check logs for processing errors

## License

MIT

## Support

For issues or questions, please contact Intelagent Studios.