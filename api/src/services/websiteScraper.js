import axios from 'axios';
import * as cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class WebsiteScraperService {
  constructor() {
    this.scraperApiKey = process.env.SCRAPER_API_KEY;
    this.scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY;
  }

  /**
   * Main scraping method
   */
  async scrapeWebsite(url) {
    console.log(`Scraping website: ${url}`);
    
    try {
      // Try different scraping methods in order of preference
      let html = null;
      
      if (this.scrapingBeeKey) {
        html = await this.scrapeWithScrapingBee(url);
      } else if (this.scraperApiKey) {
        html = await this.scrapeWithScraperAPI(url);
      } else {
        html = await this.scrapeDirectly(url);
      }

      if (!html) {
        throw new Error('Failed to scrape website');
      }

      // Parse the HTML and extract data
      const data = this.parseWebsiteData(html, url);
      
      return data;
    } catch (error) {
      console.error(`Error scraping ${url}:`, error.message);
      return this.getBasicWebsiteData(url);
    }
  }

  /**
   * Scrape using ScrapingBee API (handles JavaScript rendering)
   */
  async scrapeWithScrapingBee(url) {
    try {
      const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
        params: {
          api_key: this.scrapingBeeKey,
          url: url,
          render_js: 'true',
          premium_proxy: 'true',
          country_code: 'us'
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('ScrapingBee error:', error.message);
      return null;
    }
  }

  /**
   * Scrape using ScraperAPI
   */
  async scrapeWithScraperAPI(url) {
    try {
      const response = await axios.get('http://api.scraperapi.com', {
        params: {
          api_key: this.scraperApiKey,
          url: url,
          render: true
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('ScraperAPI error:', error.message);
      return null;
    }
  }

  /**
   * Direct scraping (no JavaScript rendering)
   */
  async scrapeDirectly(url) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      console.error('Direct scraping error:', error.message);
      return null;
    }
  }

  /**
   * Parse website HTML and extract relevant data
   */
  parseWebsiteData(html, url) {
    const $ = cheerio.load(html);
    
    const data = {
      title: this.extractTitle($),
      description: this.extractDescription($),
      emails: this.extractEmails(html),
      phones: this.extractPhones(html),
      socialLinks: this.extractSocialLinks($),
      aboutText: this.extractAboutText($),
      services: this.extractServices($),
      teamSize: this.inferTeamSize($),
      technologies: this.detectTechnologies(html, $),
      hasChat: this.detectChatWidget(html, $),
      hasPricing: this.detectPricingPage($),
      contactInfo: this.extractContactInfo($),
      addresses: this.extractAddresses($),
      keywords: this.extractKeywords($),
      lastUpdated: new Date()
    };

    return data;
  }

  /**
   * Extract page title
   */
  extractTitle($) {
    return $('title').text().trim() || 
           $('meta[property="og:title"]').attr('content') || 
           $('h1').first().text().trim();
  }

  /**
   * Extract meta description
   */
  extractDescription($) {
    return $('meta[name="description"]').attr('content') || 
           $('meta[property="og:description"]').attr('content') || 
           $('p').first().text().substring(0, 200);
  }

  /**
   * Extract email addresses from HTML
   */
  extractEmails(html) {
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
    const emails = html.match(emailRegex) || [];
    
    // Filter out common fake emails
    return [...new Set(emails)].filter(email => {
      const lower = email.toLowerCase();
      return !lower.includes('example.com') && 
             !lower.includes('domain.com') &&
             !lower.includes('email.com') &&
             !lower.includes('test.com');
    });
  }

  /**
   * Extract phone numbers
   */
  extractPhones(html) {
    // Multiple phone patterns
    const phonePatterns = [
      /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      /(\+\d{1,3}[-.\s]?)?\d{3}[-.\s]\d{3}[-.\s]\d{4}/g,
      /(\+\d{1,3}[-.\s]?)?\d{10}/g
    ];
    
    const phones = new Set();
    
    phonePatterns.forEach(pattern => {
      const matches = html.match(pattern) || [];
      matches.forEach(phone => phones.add(phone));
    });
    
    return Array.from(phones);
  }

  /**
   * Extract social media links
   */
  extractSocialLinks($) {
    const socialLinks = {};
    const socialPlatforms = {
      facebook: /facebook\.com/i,
      twitter: /twitter\.com|x\.com/i,
      linkedin: /linkedin\.com/i,
      instagram: /instagram\.com/i,
      youtube: /youtube\.com/i,
      github: /github\.com/i
    };

    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      for (const [platform, regex] of Object.entries(socialPlatforms)) {
        if (regex.test(href) && !socialLinks[platform]) {
          socialLinks[platform] = href;
        }
      }
    });

    return socialLinks;
  }

  /**
   * Extract about page text
   */
  extractAboutText($) {
    // Look for about section
    const aboutSelectors = [
      '#about', '.about', '[class*="about"]',
      '#about-us', '.about-us', '[class*="about-us"]'
    ];
    
    for (const selector of aboutSelectors) {
      const text = $(selector).text().trim();
      if (text && text.length > 100) {
        return text.substring(0, 1000);
      }
    }
    
    // Look for about in navigation
    const aboutLink = $('a:contains("About")').attr('href');
    if (aboutLink) {
      return `About page found at: ${aboutLink}`;
    }
    
    return null;
  }

  /**
   * Extract services or products
   */
  extractServices($) {
    const services = [];
    
    // Look for services/products sections
    const serviceSelectors = [
      '.services li', '.products li', '.features li',
      '[class*="service"] h3', '[class*="product"] h3'
    ];
    
    serviceSelectors.forEach(selector => {
      $(selector).each((i, elem) => {
        const text = $(elem).text().trim();
        if (text && text.length < 100) {
          services.push(text);
        }
      });
    });
    
    return services.slice(0, 10); // Limit to 10 services
  }

  /**
   * Infer team size from team page or about page
   */
  inferTeamSize($) {
    // Count team members
    const teamSelectors = [
      '.team-member', '.staff-member', '[class*="team"] .person'
    ];
    
    for (const selector of teamSelectors) {
      const count = $(selector).length;
      if (count > 0) {
        if (count <= 5) return '1-10';
        if (count <= 20) return '11-50';
        if (count <= 50) return '51-200';
        return '201-500';
      }
    }
    
    // Look for team size mentions in text
    const bodyText = $('body').text().toLowerCase();
    if (bodyText.includes('small team') || bodyText.includes('boutique')) return '1-10';
    if (bodyText.includes('growing team')) return '11-50';
    if (bodyText.includes('large team')) return '51-200';
    
    return null;
  }

  /**
   * Detect technologies used on the website
   */
  detectTechnologies(html, $) {
    const technologies = {
      cms: [],
      analytics: [],
      frameworks: [],
      ecommerce: [],
      marketing: []
    };

    // CMS Detection
    if (html.includes('wp-content') || html.includes('WordPress')) {
      technologies.cms.push('WordPress');
    }
    if (html.includes('Shopify.theme')) {
      technologies.cms.push('Shopify');
      technologies.ecommerce.push('Shopify');
    }
    if (html.includes('Wix.com')) {
      technologies.cms.push('Wix');
    }
    if (html.includes('Squarespace')) {
      technologies.cms.push('Squarespace');
    }

    // Analytics
    if (html.includes('google-analytics.com') || html.includes('gtag(')) {
      technologies.analytics.push('Google Analytics');
    }
    if (html.includes('facebook.com/tr')) {
      technologies.analytics.push('Facebook Pixel');
    }
    if (html.includes('hotjar.com')) {
      technologies.analytics.push('Hotjar');
    }

    // Frameworks
    if (html.includes('react')) {
      technologies.frameworks.push('React');
    }
    if (html.includes('vue')) {
      technologies.frameworks.push('Vue.js');
    }
    if (html.includes('angular')) {
      technologies.frameworks.push('Angular');
    }

    // Marketing tools
    if (html.includes('hubspot')) {
      technologies.marketing.push('HubSpot');
    }
    if (html.includes('mailchimp')) {
      technologies.marketing.push('Mailchimp');
    }
    if (html.includes('klaviyo')) {
      technologies.marketing.push('Klaviyo');
    }

    return technologies;
  }

  /**
   * Detect if website has chat widget
   */
  detectChatWidget(html, $) {
    const chatIndicators = [
      'intercom', 'drift', 'zendesk', 'tawk.to', 'livechat',
      'crisp', 'facebook.com/customerchat', 'tidio', 'olark'
    ];

    for (const indicator of chatIndicators) {
      if (html.toLowerCase().includes(indicator)) {
        return {
          hasChat: true,
          provider: indicator
        };
      }
    }

    // Check for generic chat elements
    if ($('#chat, .chat-widget, [class*="chat"]').length > 0) {
      return {
        hasChat: true,
        provider: 'unknown'
      };
    }

    return {
      hasChat: false,
      provider: null
    };
  }

  /**
   * Detect if website has pricing page
   */
  detectPricingPage($) {
    const pricingLinks = $('a:contains("Pricing"), a:contains("Plans"), a[href*="pricing"], a[href*="plans"]');
    return pricingLinks.length > 0;
  }

  /**
   * Extract contact information
   */
  extractContactInfo($) {
    const contact = {};
    
    // Look for contact section
    const contactSelectors = [
      '.contact', '#contact', '[class*="contact"]',
      'footer'
    ];
    
    contactSelectors.forEach(selector => {
      const section = $(selector);
      if (section.length) {
        const text = section.text();
        
        // Extract email
        const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
        if (emailMatch) contact.email = emailMatch[1];
        
        // Extract phone
        const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (phoneMatch) contact.phone = phoneMatch[0];
      }
    });
    
    return contact;
  }

  /**
   * Extract physical addresses
   */
  extractAddresses($) {
    const addresses = [];
    
    // Look for address microdata
    $('[itemtype*="PostalAddress"], address').each((i, elem) => {
      const address = $(elem).text().trim();
      if (address) addresses.push(address);
    });
    
    // Look for common address patterns
    const addressRegex = /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|square|sq|plaza|parkway|pkwy)[,.\s]+[\w\s]+[,.\s]+\w{2}\s+\d{5}/gi;
    $('body').text().match(addressRegex)?.forEach(addr => {
      addresses.push(addr);
    });
    
    return [...new Set(addresses)];
  }

  /**
   * Extract keywords from meta tags and content
   */
  extractKeywords($) {
    const keywords = [];
    
    // Meta keywords
    const metaKeywords = $('meta[name="keywords"]').attr('content');
    if (metaKeywords) {
      keywords.push(...metaKeywords.split(',').map(k => k.trim()));
    }
    
    // Common important words from headings
    $('h1, h2, h3').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text.length < 50) {
        keywords.push(text);
      }
    });
    
    return keywords.slice(0, 20);
  }

  /**
   * Get basic website data when scraping fails
   */
  getBasicWebsiteData(url) {
    try {
      const urlObj = new URL(url);
      return {
        domain: urlObj.hostname,
        url: url,
        title: urlObj.hostname,
        description: null,
        emails: [],
        phones: [],
        socialLinks: {},
        error: 'Failed to scrape website',
        lastUpdated: new Date()
      };
    } catch {
      return {
        url: url,
        error: 'Invalid URL',
        lastUpdated: new Date()
      };
    }
  }

  /**
   * Save scraped data to database
   */
  async saveScrapedData(leadId, scrapedData) {
    try {
      await prisma.companyResearch.upsert({
        where: { leadId },
        create: {
          leadId,
          websiteContent: scrapedData,
          keyPagesContent: {},
          painPoints: this.inferPainPoints(scrapedData),
          growthIndicators: this.inferGrowthIndicators(scrapedData),
          uniqueAspects: this.extractUniqueAspects(scrapedData)
        },
        update: {
          websiteContent: scrapedData,
          researchDate: new Date()
        }
      });

      // Update lead with technology info
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          websiteTechnology: scrapedData.technologies || {},
          hasExistingChat: scrapedData.hasChat?.hasChat || false,
          chatProvider: scrapedData.hasChat?.provider
        }
      });

      console.log(`Saved scraped data for lead ${leadId}`);
    } catch (error) {
      console.error(`Error saving scraped data:`, error);
    }
  }

  /**
   * Infer pain points from website data
   */
  inferPainPoints(data) {
    const painPoints = [];
    
    if (!data.hasChat?.hasChat) {
      painPoints.push('No chat support for customer inquiries');
    }
    
    if (!data.hasPricing) {
      painPoints.push('No transparent pricing information');
    }
    
    if (data.emails.length === 0) {
      painPoints.push('No visible contact email');
    }
    
    if (!data.socialLinks.linkedin) {
      painPoints.push('Limited professional social media presence');
    }
    
    return painPoints;
  }

  /**
   * Infer growth indicators
   */
  inferGrowthIndicators(data) {
    const indicators = [];
    
    if (data.teamSize && ['11-50', '51-200'].includes(data.teamSize)) {
      indicators.push('Growing team size');
    }
    
    if (data.technologies?.marketing?.length > 2) {
      indicators.push('Investment in marketing technology');
    }
    
    if (data.services?.length > 5) {
      indicators.push('Diverse service offering');
    }
    
    return indicators;
  }

  /**
   * Extract unique aspects
   */
  extractUniqueAspects(data) {
    const aspects = [];
    
    if (data.technologies?.ecommerce?.length > 0) {
      aspects.push('E-commerce enabled');
    }
    
    if (data.socialLinks && Object.keys(data.socialLinks).length > 3) {
      aspects.push('Strong social media presence');
    }
    
    if (data.hasChat?.hasChat) {
      aspects.push(`Live chat support via ${data.hasChat.provider}`);
    }
    
    return aspects;
  }
}

export default WebsiteScraperService;