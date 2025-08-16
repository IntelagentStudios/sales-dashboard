import validator from 'validator';
import { z } from 'zod';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Zod schemas for API validation
const enrichmentRequestSchema = z.object({
  domain: z.string().min(1).refine(val => {
    // Basic domain validation
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
    return domainRegex.test(val.replace(/^https?:\/\//, '').replace(/^www\./, ''));
  }, {
    message: 'Invalid domain format'
  }),
  type: z.enum(['full', 'emails', 'scrape', 'data']).optional().default('full'),
  options: z.object({
    includeEmails: z.boolean().optional().default(true),
    includeScraping: z.boolean().optional().default(true),
    includeEnrichment: z.boolean().optional().default(true),
    maxPages: z.number().min(1).max(50).optional().default(10),
    useCache: z.boolean().optional().default(true)
  }).optional()
});

const emailValidationSchema = z.object({
  email: z.string().email(),
  checkMx: z.boolean().optional().default(true)
});

const scrapeRequestSchema = z.object({
  url: z.string().url(),
  options: z.object({
    waitForSelector: z.string().optional(),
    timeout: z.number().min(1000).max(60000).optional().default(30000),
    screenshot: z.boolean().optional().default(false)
  }).optional()
});

class Validator {
  static validateDomain(domain) {
    if (!domain || typeof domain !== 'string') {
      return { valid: false, error: 'Domain is required' };
    }
    
    // Clean the domain
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .toLowerCase();
    
    // Check if it's a valid domain format
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
    
    if (!domainRegex.test(cleanDomain)) {
      return { valid: false, error: 'Invalid domain format' };
    }
    
    // Check for common invalid patterns
    if (cleanDomain.includes('..') || cleanDomain.startsWith('.') || cleanDomain.endsWith('.')) {
      return { valid: false, error: 'Invalid domain format' };
    }
    
    return { valid: true, cleanDomain };
  }

  static validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: 'Email is required' };
    }
    
    if (!validator.isEmail(email)) {
      return { valid: false, error: 'Invalid email format' };
    }
    
    // Additional checks
    const parts = email.split('@');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid email format' };
    }
    
    const [localPart, domain] = parts;
    
    // Check local part length
    if (localPart.length > 64) {
      return { valid: false, error: 'Email local part too long' };
    }
    
    // Check domain
    const domainValidation = this.validateDomain(domain);
    if (!domainValidation.valid) {
      return { valid: false, error: 'Invalid email domain' };
    }
    
    return { valid: true, email: email.toLowerCase() };
  }

  static validateUrl(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL is required' };
    }
    
    if (!validator.isURL(url, { 
      protocols: ['http', 'https'],
      require_protocol: false,
      require_valid_protocol: true 
    })) {
      return { valid: false, error: 'Invalid URL format' };
    }
    
    // Ensure protocol
    let validUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      validUrl = 'https://' + url;
    }
    
    try {
      new URL(validUrl);
      return { valid: true, url: validUrl };
    } catch (error) {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  static validateEnrichmentRequest(data) {
    try {
      const validated = enrichmentRequestSchema.parse(data);
      return { valid: true, data: validated };
    } catch (error) {
      return { 
        valid: false, 
        error: error.errors ? error.errors[0].message : 'Invalid request data' 
      };
    }
  }

  static validateEmailValidationRequest(data) {
    try {
      const validated = emailValidationSchema.parse(data);
      return { valid: true, data: validated };
    } catch (error) {
      return { 
        valid: false, 
        error: error.errors ? error.errors[0].message : 'Invalid request data' 
      };
    }
  }

  static validateScrapeRequest(data) {
    try {
      const validated = scrapeRequestSchema.parse(data);
      return { valid: true, data: validated };
    } catch (error) {
      return { 
        valid: false, 
        error: error.errors ? error.errors[0].message : 'Invalid request data' 
      };
    }
  }

  static sanitizeString(str, maxLength = 1000) {
    if (!str || typeof str !== 'string') {
      return '';
    }
    
    // Remove control characters and trim
    let sanitized = str.replace(/[\x00-\x1F\x7F]/g, '').trim();
    
    // Limit length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }
    
    return sanitized;
  }

  static sanitizeHtml(html) {
    if (!html || typeof html !== 'string') {
      return '';
    }
    
    // Basic HTML sanitization (remove script tags, etc.)
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/on\w+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }

  static isValidJobId(jobId) {
    // UUID v4 validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(jobId);
  }

  static validatePaginationParams(params) {
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 10;
    
    if (page < 1) {
      return { valid: false, error: 'Page must be greater than 0' };
    }
    
    if (limit < 1 || limit > 100) {
      return { valid: false, error: 'Limit must be between 1 and 100' };
    }
    
    return { 
      valid: true, 
      page, 
      limit,
      skip: (page - 1) * limit
    };
  }

  static validateDateRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime())) {
      return { valid: false, error: 'Invalid start date' };
    }
    
    if (isNaN(end.getTime())) {
      return { valid: false, error: 'Invalid end date' };
    }
    
    if (start > end) {
      return { valid: false, error: 'Start date must be before end date' };
    }
    
    // Max range of 90 days
    const daysDiff = (end - start) / (1000 * 60 * 60 * 24);
    if (daysDiff > 90) {
      return { valid: false, error: 'Date range cannot exceed 90 days' };
    }
    
    return { valid: true, startDate: start, endDate: end };
  }

  static isGDPRCompliant(email) {
    // Check if email appears to be from a public source
    const publicPatterns = [
      'info@', 'contact@', 'sales@', 'support@', 
      'hello@', 'admin@', 'office@', 'enquiries@'
    ];
    
    const emailLower = email.toLowerCase();
    const isPublicPattern = publicPatterns.some(pattern => emailLower.startsWith(pattern));
    
    // Personal emails (firstname.lastname pattern) need extra caution
    const personalPattern = /^[a-z]+\.[a-z]+@/;
    const isPersonalPattern = personalPattern.test(emailLower);
    
    return {
      likelyPublic: isPublicPattern,
      likelyPersonal: isPersonalPattern,
      requiresConsent: isPersonalPattern && !isPublicPattern
    };
  }

  static validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return { valid: false, error: 'API key is required' };
    }
    
    // Basic API key format validation (customize as needed)
    if (apiKey.length < 32) {
      return { valid: false, error: 'Invalid API key format' };
    }
    
    return { valid: true };
  }
}

export default Validator;