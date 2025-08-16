import cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';
import winston from 'winston';
import WebScraper from './webScraper.js';

const prisma = new PrismaClient();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class CompanyEnricher {
  constructor() {
    this.scraper = new WebScraper();
    
    this.industryKeywords = {
      'technology': ['software', 'saas', 'cloud', 'ai', 'machine learning', 'data', 'platform', 'digital', 'tech'],
      'finance': ['financial', 'banking', 'investment', 'fintech', 'payment', 'insurance', 'capital'],
      'healthcare': ['health', 'medical', 'clinic', 'hospital', 'pharma', 'biotech', 'wellness'],
      'retail': ['shop', 'store', 'ecommerce', 'marketplace', 'retail', 'fashion', 'consumer'],
      'education': ['education', 'learning', 'training', 'school', 'university', 'course', 'edtech'],
      'marketing': ['marketing', 'advertising', 'agency', 'digital marketing', 'seo', 'content', 'brand'],
      'consulting': ['consulting', 'advisory', 'strategy', 'management', 'professional services'],
      'manufacturing': ['manufacturing', 'production', 'industrial', 'factory', 'assembly'],
      'real-estate': ['real estate', 'property', 'realty', 'housing', 'commercial', 'residential']
    };
    
    this.companySizeRanges = [
      { range: '1-10', min: 1, max: 10, label: 'Micro' },
      { range: '11-50', min: 11, max: 50, label: 'Small' },
      { range: '51-200', min: 51, max: 200, label: 'Medium' },
      { range: '201-500', min: 201, max: 500, label: 'Mid-Market' },
      { range: '501-1000', min: 501, max: 1000, label: 'Large' },
      { range: '1000+', min: 1001, max: null, label: 'Enterprise' }
    ];
  }

  async enrichCompany(domain, scrapedData = null) {
    try {
      const cleanDomain = this.cleanDomain(domain);
      
      // Check cache first
      const cached = await this.getCachedEnrichment(cleanDomain);
      if (cached) {
        logger.info(`Using cached enrichment for ${cleanDomain}`);
        return cached;
      }
      
      // Scrape if no data provided
      if (!scrapedData) {
        logger.info(`Scraping website for ${cleanDomain}`);
        scrapedData = await this.scraper.scrapeWebsite(cleanDomain);
        await this.scraper.close();
      }
      
      // Extract enrichment data
      const enrichedData = await this.extractEnrichmentData(cleanDomain, scrapedData);
      
      // Store in cache
      await this.cacheEnrichment(cleanDomain, enrichedData);
      
      logger.info(`Successfully enriched company data for ${cleanDomain}`);
      
      return enrichedData;
      
    } catch (error) {
      logger.error(`Error enriching company ${domain}:`, error);
      throw error;
    }
  }

  async extractEnrichmentData(domain, scrapedData) {
    const enrichedData = {
      domain,
      basicInfo: {},
      techStack: {},
      socialMedia: {},
      companyUpdates: [],
      businessInfo: {},
      estimatedMetrics: {},
      enrichedAt: new Date().toISOString()
    };
    
    if (!scrapedData.pages || scrapedData.pages.length === 0) {
      return enrichedData;
    }
    
    // Combine all page data
    const allContent = scrapedData.pages.map(p => p.textContent || '').join(' ');
    const allMetadata = scrapedData.pages.map(p => p.metadata || {});
    const allStructuredData = scrapedData.pages.flatMap(p => p.structuredData || []);
    const allContactInfo = scrapedData.pages.map(p => p.contactInfo || {});
    
    // Extract basic info
    enrichedData.basicInfo = this.extractBasicInfo(allMetadata, allStructuredData, allContent);
    
    // Extract tech stack
    const homePage = scrapedData.pages.find(p => p.path === '/');
    if (homePage) {
      enrichedData.techStack = await this.scraper.extractTechStack(homePage.content);
    }
    
    // Extract social media
    enrichedData.socialMedia = this.extractSocialMedia(allContactInfo);
    
    // Extract company updates
    enrichedData.companyUpdates = this.extractCompanyUpdates(scrapedData.pages);
    
    // Extract business info
    enrichedData.businessInfo = this.extractBusinessInfo(allContent, allStructuredData);
    
    // Estimate metrics
    enrichedData.estimatedMetrics = this.estimateMetrics(enrichedData);
    
    return enrichedData;
  }

  extractBasicInfo(metadataList, structuredDataList, content) {
    const basicInfo = {
      name: null,
      description: null,
      industry: null,
      location: null,
      foundedYear: null,
      companySize: null,
      website: null
    };
    
    // Extract from structured data (JSON-LD)
    const orgData = structuredDataList.find(data => 
      data['@type'] === 'Organization' || 
      data['@type'] === 'Corporation' ||
      data['@type'] === 'LocalBusiness'
    );
    
    if (orgData) {
      basicInfo.name = orgData.name || null;
      basicInfo.description = orgData.description || null;
      basicInfo.foundedYear = orgData.foundingDate ? new Date(orgData.foundingDate).getFullYear() : null;
      
      if (orgData.address) {
        basicInfo.location = this.formatAddress(orgData.address);
      }
      
      if (orgData.numberOfEmployees) {
        basicInfo.companySize = this.parseCompanySize(orgData.numberOfEmployees);
      }
    }
    
    // Extract from metadata
    if (!basicInfo.name && metadataList.length > 0) {
      basicInfo.name = metadataList[0].title?.split('|')[0]?.trim() || null;
    }
    
    if (!basicInfo.description && metadataList.length > 0) {
      basicInfo.description = metadataList[0].description || null;
    }
    
    // Detect industry from content
    if (!basicInfo.industry) {
      basicInfo.industry = this.detectIndustry(content);
    }
    
    // Extract company size from content
    if (!basicInfo.companySize) {
      basicInfo.companySize = this.extractCompanySize(content);
    }
    
    // Extract location from content
    if (!basicInfo.location) {
      basicInfo.location = this.extractLocation(content);
    }
    
    // Extract founded year from content
    if (!basicInfo.foundedYear) {
      basicInfo.foundedYear = this.extractFoundedYear(content);
    }
    
    return basicInfo;
  }

  detectIndustry(content) {
    const contentLower = content.toLowerCase();
    const industryScores = {};
    
    for (const [industry, keywords] of Object.entries(this.industryKeywords)) {
      let score = 0;
      keywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = contentLower.match(regex);
        if (matches) {
          score += matches.length;
        }
      });
      
      if (score > 0) {
        industryScores[industry] = score;
      }
    }
    
    // Get the industry with highest score
    const sortedIndustries = Object.entries(industryScores)
      .sort((a, b) => b[1] - a[1]);
    
    return sortedIndustries.length > 0 ? sortedIndustries[0][0] : 'Unknown';
  }

  extractCompanySize(content) {
    const patterns = [
      /(\d+)[+\-]?\s*employees?/gi,
      /team\s+of\s+(\d+)/gi,
      /(\d+)\s+people/gi,
      /staff\s+of\s+(\d+)/gi
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const number = parseInt(match[0].match(/\d+/)[0]);
        return this.categorizeCompanySize(number);
      }
    }
    
    return null;
  }

  categorizeCompanySize(employeeCount) {
    for (const size of this.companySizeRanges) {
      if (employeeCount >= size.min && (!size.max || employeeCount <= size.max)) {
        return {
          range: size.range,
          label: size.label,
          estimatedCount: employeeCount
        };
      }
    }
    return null;
  }

  extractLocation(content) {
    // Look for common location patterns
    const patterns = [
      /(?:headquartered?|based|located)\s+in\s+([^,.]+(?:,\s*[^,.]+)?)/gi,
      /(?:offices?\s+in|presence\s+in)\s+([^,.]+(?:,\s*[^,.]+)?)/gi
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  extractFoundedYear(content) {
    const patterns = [
      /(?:founded|established|started)\s+(?:in\s+)?(\d{4})/gi,
      /since\s+(\d{4})/gi,
      /(\d{4})\s+(?:founding|establishment)/gi
    ];
    
    const currentYear = new Date().getFullYear();
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const year = parseInt(match[0].match(/\d{4}/)[0]);
        if (year >= 1800 && year <= currentYear) {
          return year;
        }
      }
    }
    
    return null;
  }

  extractSocialMedia(contactInfoList) {
    const socialMedia = {
      facebook: null,
      twitter: null,
      linkedin: null,
      instagram: null,
      youtube: null
    };
    
    contactInfoList.forEach(contactInfo => {
      if (contactInfo.socialLinks) {
        Object.keys(socialMedia).forEach(platform => {
          if (!socialMedia[platform] && contactInfo.socialLinks[platform]) {
            socialMedia[platform] = contactInfo.socialLinks[platform];
          }
        });
      }
    });
    
    return socialMedia;
  }

  extractCompanyUpdates(pages) {
    const updates = [];
    
    // Look for blog/news pages
    const updatePages = pages.filter(p => 
      p.path.includes('blog') || 
      p.path.includes('news') || 
      p.path.includes('updates') ||
      p.path.includes('press')
    );
    
    updatePages.forEach(page => {
      if (page.metadata && page.metadata.title) {
        updates.push({
          type: this.getUpdateType(page.path),
          title: page.metadata.title,
          description: page.metadata.description,
          url: page.url,
          date: page.scrapedAt
        });
      }
    });
    
    // Look for job postings
    const careerPages = pages.filter(p => 
      p.path.includes('career') || 
      p.path.includes('jobs') || 
      p.path.includes('hiring')
    );
    
    if (careerPages.length > 0) {
      updates.push({
        type: 'hiring',
        title: 'Company is actively hiring',
        description: 'Open positions available',
        url: careerPages[0].url,
        date: new Date().toISOString()
      });
    }
    
    return updates.slice(0, 10); // Return top 10 updates
  }

  getUpdateType(path) {
    if (path.includes('blog')) return 'blog';
    if (path.includes('news')) return 'news';
    if (path.includes('press')) return 'press';
    if (path.includes('career') || path.includes('job')) return 'hiring';
    return 'update';
  }

  extractBusinessInfo(content, structuredData) {
    const businessInfo = {
      businessHours: null,
      timezone: null,
      languages: [],
      certifications: [],
      awards: []
    };
    
    // Extract from structured data
    const localBusiness = structuredData.find(data => 
      data['@type'] === 'LocalBusiness' || 
      data.openingHours
    );
    
    if (localBusiness) {
      businessInfo.businessHours = localBusiness.openingHours || null;
    }
    
    // Detect timezone from location or content
    businessInfo.timezone = this.detectTimezone(content);
    
    // Extract certifications
    const certPatterns = [
      /ISO\s*\d{4,5}/gi,
      /SOC\s*[12]/gi,
      /GDPR\s+compliant/gi,
      /HIPAA\s+compliant/gi
    ];
    
    certPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        businessInfo.certifications.push(...matches);
      }
    });
    
    return businessInfo;
  }

  detectTimezone(content) {
    const timezonePatterns = {
      'America/New_York': ['EST', 'EDT', 'Eastern Time', 'New York'],
      'America/Chicago': ['CST', 'CDT', 'Central Time', 'Chicago'],
      'America/Denver': ['MST', 'MDT', 'Mountain Time', 'Denver'],
      'America/Los_Angeles': ['PST', 'PDT', 'Pacific Time', 'Los Angeles', 'San Francisco'],
      'Europe/London': ['GMT', 'BST', 'London Time', 'UK'],
      'Europe/Paris': ['CET', 'CEST', 'Paris', 'Berlin'],
      'Asia/Tokyo': ['JST', 'Tokyo', 'Japan Time'],
      'Australia/Sydney': ['AEDT', 'AEST', 'Sydney', 'Melbourne']
    };
    
    for (const [timezone, patterns] of Object.entries(timezonePatterns)) {
      if (patterns.some(pattern => content.includes(pattern))) {
        return timezone;
      }
    }
    
    return null;
  }

  estimateMetrics(enrichedData) {
    const metrics = {
      estimatedRevenue: null,
      estimatedFunding: null,
      growthStage: null,
      marketPosition: null
    };
    
    // Estimate based on company size and industry
    if (enrichedData.basicInfo.companySize) {
      const size = enrichedData.basicInfo.companySize;
      
      if (size.label === 'Micro') {
        metrics.estimatedRevenue = '$0-1M';
        metrics.growthStage = 'Seed';
      } else if (size.label === 'Small') {
        metrics.estimatedRevenue = '$1-10M';
        metrics.growthStage = 'Early Stage';
      } else if (size.label === 'Medium') {
        metrics.estimatedRevenue = '$10-50M';
        metrics.growthStage = 'Growth';
      } else if (size.label === 'Mid-Market') {
        metrics.estimatedRevenue = '$50-100M';
        metrics.growthStage = 'Expansion';
      } else if (size.label === 'Large' || size.label === 'Enterprise') {
        metrics.estimatedRevenue = '$100M+';
        metrics.growthStage = 'Mature';
      }
    }
    
    // Adjust based on tech stack (more sophisticated stack = likely more funding)
    if (enrichedData.techStack) {
      const techCount = 
        (enrichedData.techStack.analytics?.length || 0) +
        (enrichedData.techStack.frameworks?.length || 0) +
        (enrichedData.techStack.chatWidgets?.length || 0);
      
      if (techCount > 5) {
        metrics.marketPosition = 'Leader';
      } else if (techCount > 2) {
        metrics.marketPosition = 'Challenger';
      } else {
        metrics.marketPosition = 'Emerging';
      }
    }
    
    return metrics;
  }

  formatAddress(address) {
    if (typeof address === 'string') return address;
    
    const parts = [];
    if (address.streetAddress) parts.push(address.streetAddress);
    if (address.addressLocality) parts.push(address.addressLocality);
    if (address.addressRegion) parts.push(address.addressRegion);
    if (address.postalCode) parts.push(address.postalCode);
    if (address.addressCountry) parts.push(address.addressCountry);
    
    return parts.join(', ');
  }

  parseCompanySize(numberOfEmployees) {
    if (typeof numberOfEmployees === 'number') {
      return this.categorizeCompanySize(numberOfEmployees);
    }
    
    if (typeof numberOfEmployees === 'object' && numberOfEmployees.value) {
      return this.categorizeCompanySize(parseInt(numberOfEmployees.value));
    }
    
    return null;
  }

  async getCachedEnrichment(domain) {
    try {
      const cached = await prisma.enrichmentCache.findUnique({
        where: { domain }
      });
      
      if (cached && new Date(cached.expiresAt) > new Date()) {
        return cached.enrichedData;
      }
      
      return null;
    } catch (error) {
      logger.error('Error getting cached enrichment:', error);
      return null;
    }
  }

  async cacheEnrichment(domain, enrichedData) {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days cache
      
      await prisma.enrichmentCache.upsert({
        where: { domain },
        update: {
          enrichedData,
          expiresAt,
          lastUpdated: new Date()
        },
        create: {
          domain,
          enrichedData,
          expiresAt
        }
      });
    } catch (error) {
      logger.error('Error caching enrichment:', error);
    }
  }

  cleanDomain(domain) {
    return domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .toLowerCase();
  }
}

export default CompanyEnricher;