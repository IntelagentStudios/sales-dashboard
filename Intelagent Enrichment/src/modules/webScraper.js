import puppeteer from 'puppeteer';
import cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import UserAgent from 'user-agents';
import { PrismaClient } from '@prisma/client';
import winston from 'winston';
import axios from 'axios';

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

class WebScraper {
  constructor(options = {}) {
    this.options = {
      headless: options.headless !== false,
      timeout: options.timeout || 30000,
      maxPages: options.maxPages || 10,
      respectRobots: options.respectRobots !== false,
      userAgent: process.env.SERVICE_NAME || 'IntelagentBot/1.0 (+https://intelagentstudios.com/bot)',
      rotateUserAgents: options.rotateUserAgents || false
    };
    
    this.priorityPaths = [
      '/',
      '/about',
      '/about-us',
      '/contact',
      '/contact-us',
      '/team',
      '/our-team',
      '/careers',
      '/jobs',
      '/blog',
      '/news',
      '/products',
      '/services'
    ];
    
    this.browser = null;
    this.robotsCache = new Map();
  }

  async initialize() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: this.options.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-extensions'
        ]
      });
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async scrapeWebsite(domain) {
    try {
      await this.initialize();
      
      const cleanDomain = this.cleanDomain(domain);
      const baseUrl = `https://${cleanDomain}`;
      
      // Check robots.txt
      if (this.options.respectRobots) {
        const canScrape = await this.checkRobotsTxt(baseUrl);
        if (!canScrape) {
          logger.warn(`Robots.txt disallows scraping ${baseUrl}`);
          return {
            domain: cleanDomain,
            pages: [],
            error: 'Blocked by robots.txt'
          };
        }
      }
      
      const scrapedPages = [];
      const visitedUrls = new Set();
      const urlsToVisit = this.priorityPaths.map(path => baseUrl + path);
      
      while (urlsToVisit.length > 0 && scrapedPages.length < this.options.maxPages) {
        const url = urlsToVisit.shift();
        
        if (visitedUrls.has(url)) continue;
        visitedUrls.add(url);
        
        try {
          const pageData = await this.scrapePage(url);
          
          if (pageData && pageData.statusCode === 200) {
            scrapedPages.push(pageData);
            
            // Store in database
            await this.storeScrapedPage(cleanDomain, pageData);
            
            // Extract and queue new URLs
            const newUrls = this.extractUrls(pageData.content, baseUrl);
            newUrls.forEach(newUrl => {
              if (!visitedUrls.has(newUrl) && this.isSameDomain(newUrl, baseUrl)) {
                urlsToVisit.push(newUrl);
              }
            });
          }
        } catch (error) {
          logger.error(`Error scraping ${url}:`, error.message);
        }
        
        // Rate limiting
        await this.delay(500);
      }
      
      logger.info(`Scraped ${scrapedPages.length} pages from ${cleanDomain}`);
      
      return {
        domain: cleanDomain,
        pages: scrapedPages,
        totalPages: scrapedPages.length,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error(`Error scraping website ${domain}:`, error);
      throw error;
    }
  }

  async scrapePage(url) {
    const page = await this.browser.newPage();
    
    try {
      // Set user agent
      const userAgent = this.options.rotateUserAgents 
        ? new UserAgent().toString()
        : this.options.userAgent;
      
      await page.setUserAgent(userAgent);
      
      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Navigate to page
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.options.timeout
      });
      
      const statusCode = response.status();
      
      // Wait for content to load
      await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
      
      // Get page content
      const content = await page.content();
      const $ = cheerio.load(content);
      
      // Extract metadata
      const metadata = this.extractMetadata($, url);
      
      // Extract structured data
      const structuredData = this.extractStructuredData($);
      
      // Extract text content
      const textContent = this.extractTextContent($);
      
      // Extract contact information
      const contactInfo = this.extractContactInfo($, textContent);
      
      return {
        url,
        path: new URL(url).pathname,
        statusCode,
        content,
        textContent,
        metadata,
        structuredData,
        contactInfo,
        scrapedAt: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error(`Error scraping page ${url}:`, error.message);
      throw error;
    } finally {
      await page.close();
    }
  }

  extractMetadata($, url) {
    const metadata = {
      title: $('title').text() || $('meta[property="og:title"]').attr('content') || '',
      description: $('meta[name="description"]').attr('content') || 
                   $('meta[property="og:description"]').attr('content') || '',
      keywords: $('meta[name="keywords"]').attr('content') || '',
      author: $('meta[name="author"]').attr('content') || '',
      ogImage: $('meta[property="og:image"]').attr('content') || '',
      canonical: $('link[rel="canonical"]').attr('href') || url,
      language: $('html').attr('lang') || 'en'
    };
    
    return metadata;
  }

  extractStructuredData($) {
    const structuredData = [];
    
    $('script[type="application/ld+json"]').each((i, elem) => {
      try {
        const data = JSON.parse($(elem).html());
        structuredData.push(data);
      } catch (error) {
        // Invalid JSON-LD
      }
    });
    
    return structuredData;
  }

  extractTextContent($) {
    // Remove script and style elements
    $('script, style, noscript').remove();
    
    // Get text content
    const textContent = $('body').text()
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
    
    return textContent;
  }

  extractContactInfo($, textContent) {
    const contactInfo = {
      emails: [],
      phones: [],
      addresses: [],
      socialLinks: {}
    };
    
    // Extract emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
    const emails = textContent.match(emailRegex) || [];
    contactInfo.emails = [...new Set(emails.map(e => e.toLowerCase()))];
    
    // Extract phone numbers
    const phoneRegex = /[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,4}/g;
    const phones = textContent.match(phoneRegex) || [];
    contactInfo.phones = [...new Set(phones)];
    
    // Extract social media links
    const socialPlatforms = {
      facebook: /facebook\.com\/[^\/\s]+/gi,
      twitter: /twitter\.com\/[^\/\s]+/gi,
      linkedin: /linkedin\.com\/(company|in)\/[^\/\s]+/gi,
      instagram: /instagram\.com\/[^\/\s]+/gi,
      youtube: /youtube\.com\/(c|channel|user)\/[^\/\s]+/gi
    };
    
    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      for (const [platform, regex] of Object.entries(socialPlatforms)) {
        if (regex.test(href)) {
          contactInfo.socialLinks[platform] = href;
        }
      }
    });
    
    // Extract addresses (basic implementation)
    const addressPatterns = [
      /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl)/gi,
      /(?:suite|ste|unit|apt|#)\s*\d+/gi
    ];
    
    addressPatterns.forEach(pattern => {
      const matches = textContent.match(pattern) || [];
      contactInfo.addresses.push(...matches);
    });
    
    return contactInfo;
  }

  extractUrls(content, baseUrl) {
    const $ = cheerio.load(content);
    const urls = new Set();
    
    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          urls.add(absoluteUrl);
        } catch (error) {
          // Invalid URL
        }
      }
    });
    
    return Array.from(urls);
  }

  async checkRobotsTxt(baseUrl) {
    try {
      if (this.robotsCache.has(baseUrl)) {
        const robots = this.robotsCache.get(baseUrl);
        return robots.isAllowed(baseUrl, this.options.userAgent);
      }
      
      const robotsUrl = new URL('/robots.txt', baseUrl).href;
      const response = await axios.get(robotsUrl, { 
        timeout: 5000,
        validateStatus: () => true 
      });
      
      if (response.status === 200) {
        const robots = robotsParser(robotsUrl, response.data);
        this.robotsCache.set(baseUrl, robots);
        return robots.isAllowed(baseUrl, this.options.userAgent);
      }
      
      return true; // No robots.txt found, assume allowed
    } catch (error) {
      return true; // Error fetching robots.txt, assume allowed
    }
  }

  async storeScrapedPage(domain, pageData) {
    try {
      await prisma.scrapedPage.upsert({
        where: {
          domain_path: {
            domain,
            path: pageData.path
          }
        },
        update: {
          content: pageData.textContent,
          metadata: {
            ...pageData.metadata,
            structuredData: pageData.structuredData,
            contactInfo: pageData.contactInfo
          },
          statusCode: pageData.statusCode,
          scrapedAt: new Date()
        },
        create: {
          domain,
          url: pageData.url,
          path: pageData.path,
          content: pageData.textContent,
          metadata: {
            ...pageData.metadata,
            structuredData: pageData.structuredData,
            contactInfo: pageData.contactInfo
          },
          statusCode: pageData.statusCode
        }
      });
    } catch (error) {
      logger.error('Error storing scraped page:', error);
    }
  }

  cleanDomain(domain) {
    return domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .toLowerCase();
  }

  isSameDomain(url, baseUrl) {
    try {
      const urlObj = new URL(url);
      const baseObj = new URL(baseUrl);
      return urlObj.hostname === baseObj.hostname;
    } catch (error) {
      return false;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async extractTechStack(content) {
    const techStack = {
      cms: null,
      analytics: [],
      frameworks: [],
      libraries: [],
      chatWidgets: [],
      payment: [],
      marketing: []
    };
    
    const $ = cheerio.load(content);
    
    // Detect CMS
    const cmsSignatures = {
      wordpress: ['wp-content', 'wp-includes', 'wordpress'],
      shopify: ['cdn.shopify', 'myshopify.com'],
      wix: ['wix.com', 'wixstatic.com'],
      squarespace: ['squarespace.com', 'sqsp.net'],
      webflow: ['webflow.com', 'webflow.io'],
      drupal: ['drupal.js', '/drupal'],
      joomla: ['joomla', '/media/system/js']
    };
    
    for (const [cms, signatures] of Object.entries(cmsSignatures)) {
      if (signatures.some(sig => content.includes(sig))) {
        techStack.cms = cms;
        break;
      }
    }
    
    // Detect analytics
    const analyticsSignatures = {
      'Google Analytics': ['google-analytics.com', 'googletagmanager.com', 'gtag'],
      'Facebook Pixel': ['facebook.com/tr', 'fbq'],
      'Hotjar': ['hotjar.com'],
      'Mixpanel': ['mixpanel.com'],
      'Segment': ['segment.com', 'segment.io'],
      'Amplitude': ['amplitude.com']
    };
    
    for (const [tool, signatures] of Object.entries(analyticsSignatures)) {
      if (signatures.some(sig => content.includes(sig))) {
        techStack.analytics.push(tool);
      }
    }
    
    // Detect chat widgets
    const chatSignatures = {
      'Intercom': ['intercom.io', 'widget.intercom.io'],
      'Drift': ['drift.com', 'driftt.com'],
      'Zendesk': ['zendesk.com', 'zdassets.com'],
      'LiveChat': ['livechat.com', 'livechatinc.com'],
      'Crisp': ['crisp.chat'],
      'Tawk.to': ['tawk.to']
    };
    
    for (const [tool, signatures] of Object.entries(chatSignatures)) {
      if (signatures.some(sig => content.includes(sig))) {
        techStack.chatWidgets.push(tool);
      }
    }
    
    return techStack;
  }
}

export default WebScraper;