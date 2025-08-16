import dns from 'dns';
import { promisify } from 'util';
import validator from 'validator';
import { PrismaClient } from '@prisma/client';
import winston from 'winston';

const resolveMx = promisify(dns.resolveMx);
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

class EmailFinder {
  constructor() {
    this.emailPatterns = [
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
    ];
    
    this.commonPatterns = [
      'info', 'contact', 'sales', 'support', 'hello', 'admin',
      'team', 'careers', 'hr', 'jobs', 'press', 'media',
      'marketing', 'enquiries', 'inquiry', 'general'
    ];
    
    this.namePatterns = [
      '{firstname}.{lastname}',
      '{firstname}{lastname}',
      '{f}{lastname}',
      '{firstname}_{lastname}',
      '{firstname}-{lastname}',
      '{lastname}.{firstname}',
      '{f}.{lastname}',
      '{firstname}'
    ];
  }

  async findEmails(domain, scrapedContent = '') {
    try {
      const emails = new Set();
      const emailDetails = [];
      
      // Extract emails from scraped content
      if (scrapedContent) {
        const extractedEmails = this.extractEmailsFromText(scrapedContent);
        extractedEmails.forEach(email => {
          if (this.isValidDomainEmail(email, domain)) {
            emails.add(email.toLowerCase());
          }
        });
      }
      
      // Generate common email patterns
      const generatedEmails = this.generateCommonEmails(domain);
      
      // Validate all emails
      for (const email of [...emails, ...generatedEmails]) {
        const validation = await this.validateEmail(email, domain);
        if (validation.isValid || validation.confidence > 0.3) {
          emailDetails.push({
            email: email.toLowerCase(),
            source: emails.has(email) ? 'scraped' : 'generated',
            confidence: validation.confidence,
            isValid: validation.isValid,
            mxRecords: validation.mxRecords
          });
        }
      }
      
      // Sort by confidence
      emailDetails.sort((a, b) => b.confidence - a.confidence);
      
      // Store validations in database
      await this.storeEmailValidations(emailDetails, domain);
      
      logger.info(`Found ${emailDetails.length} emails for domain ${domain}`);
      
      return {
        domain,
        emails: emailDetails,
        totalFound: emailDetails.length,
        highConfidence: emailDetails.filter(e => e.confidence > 0.7).length
      };
      
    } catch (error) {
      logger.error(`Error finding emails for ${domain}:`, error);
      throw error;
    }
  }

  extractEmailsFromText(text) {
    const emails = new Set();
    
    // Clean the text
    const cleanText = text.replace(/\\n/g, ' ').replace(/\\t/g, ' ');
    
    // Extract using regex patterns
    this.emailPatterns.forEach(pattern => {
      const matches = cleanText.match(pattern) || [];
      matches.forEach(email => {
        if (validator.isEmail(email)) {
          emails.add(email.toLowerCase());
        }
      });
    });
    
    // Look for obfuscated emails
    const obfuscatedPatterns = [
      /([a-zA-Z0-9._%+-]+)\s*\[\s*at\s*\]\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /([a-zA-Z0-9._%+-]+)\s*\(\s*at\s*\)\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /([a-zA-Z0-9._%+-]+)\s*@\s*([a-zA-Z0-9.-]+)\s*\.\s*([a-zA-Z]{2,})/gi,
    ];
    
    obfuscatedPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(cleanText)) !== null) {
        const email = match[0].replace(/\s*\[\s*at\s*\]\s*/gi, '@')
                              .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
                              .replace(/\s+/g, '');
        if (validator.isEmail(email)) {
          emails.add(email.toLowerCase());
        }
      }
    });
    
    return Array.from(emails);
  }

  generateCommonEmails(domain) {
    const emails = [];
    
    // Clean domain
    const cleanDomain = domain.replace(/^www\./, '');
    
    // Generate common pattern emails
    this.commonPatterns.forEach(pattern => {
      emails.push(`${pattern}@${cleanDomain}`);
    });
    
    return emails;
  }

  async generateNameBasedEmails(domain, names = []) {
    const emails = [];
    const cleanDomain = domain.replace(/^www\./, '');
    
    names.forEach(name => {
      const parts = name.toLowerCase().split(/\s+/);
      if (parts.length >= 2) {
        const firstname = parts[0];
        const lastname = parts[parts.length - 1];
        const firstInitial = firstname[0];
        
        this.namePatterns.forEach(pattern => {
          const email = pattern
            .replace('{firstname}', firstname)
            .replace('{lastname}', lastname)
            .replace('{f}', firstInitial) + '@' + cleanDomain;
          
          if (validator.isEmail(email)) {
            emails.push(email);
          }
        });
      }
    });
    
    return emails;
  }

  isValidDomainEmail(email, domain) {
    const cleanDomain = domain.replace(/^www\./, '');
    const emailDomain = email.split('@')[1];
    
    if (!emailDomain) return false;
    
    // Check if email belongs to the domain or its variants
    return emailDomain === cleanDomain || 
           emailDomain.endsWith('.' + cleanDomain) ||
           cleanDomain.endsWith('.' + emailDomain);
  }

  async validateEmail(email, domain) {
    try {
      // Check cache first
      const cached = await prisma.emailValidation.findUnique({
        where: { email: email.toLowerCase() }
      });
      
      if (cached && this.isCacheValid(cached.lastChecked)) {
        return {
          isValid: cached.isValid,
          confidence: cached.confidence,
          mxRecords: cached.mxRecords
        };
      }
      
      // Basic validation
      if (!validator.isEmail(email)) {
        return { isValid: false, confidence: 0, mxRecords: null };
      }
      
      const emailDomain = email.split('@')[1];
      let confidence = 0.5; // Base confidence
      let mxRecords = null;
      
      // Check MX records
      try {
        mxRecords = await resolveMx(emailDomain);
        if (mxRecords && mxRecords.length > 0) {
          confidence += 0.3;
        }
      } catch (error) {
        // No MX records found
        confidence -= 0.2;
      }
      
      // Check email pattern confidence
      if (email.startsWith('info@') || email.startsWith('contact@')) {
        confidence += 0.1;
      } else if (email.startsWith('sales@') || email.startsWith('support@')) {
        confidence += 0.15;
      } else if (email.match(/^[a-z]+\.[a-z]+@/)) {
        // Firstname.lastname pattern
        confidence += 0.05;
      }
      
      // Ensure confidence is between 0 and 1
      confidence = Math.max(0, Math.min(1, confidence));
      
      return {
        isValid: confidence > 0.5,
        confidence,
        mxRecords
      };
      
    } catch (error) {
      logger.error(`Error validating email ${email}:`, error);
      return { isValid: false, confidence: 0, mxRecords: null };
    }
  }

  async storeEmailValidations(emailDetails, domain) {
    try {
      const operations = emailDetails.map(detail => 
        prisma.emailValidation.upsert({
          where: { email: detail.email },
          update: {
            isValid: detail.isValid,
            confidence: detail.confidence,
            mxRecords: detail.mxRecords,
            lastChecked: new Date(),
            domain: domain
          },
          create: {
            email: detail.email,
            isValid: detail.isValid,
            confidence: detail.confidence,
            mxRecords: detail.mxRecords,
            source: detail.source,
            domain: domain
          }
        })
      );
      
      await Promise.all(operations);
    } catch (error) {
      logger.error('Error storing email validations:', error);
    }
  }

  isCacheValid(lastChecked) {
    const daysSinceCheck = (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceCheck < 7; // Cache valid for 7 days
  }

  async findEmailsFromNames(domain, names) {
    const nameBasedEmails = await this.generateNameBasedEmails(domain, names);
    const validatedEmails = [];
    
    for (const email of nameBasedEmails) {
      const validation = await this.validateEmail(email, domain);
      if (validation.confidence > 0.3) {
        validatedEmails.push({
          email,
          source: 'name-based',
          confidence: validation.confidence,
          isValid: validation.isValid
        });
      }
    }
    
    return validatedEmails;
  }
}

export default EmailFinder;