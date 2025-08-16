import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Integration service for Intelagent Enrichment
 * Replaces external services (Hunter, Apollo, Clearbit, etc.) with your custom solution
 */
class IntelagentEnrichmentService {
  constructor() {
    // Default to localhost, can be overridden with env variable
    this.apiUrl = process.env.ENRICHMENT_API_URL || 'http://localhost:3001';
    this.apiKey = process.env.ENRICHMENT_API_KEY; // Optional API key if you add auth
  }

  /**
   * Main enrichment method - orchestrates all enrichment activities
   */
  async enrichLead(leadId) {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: { 
          contacts: true,
          companyResearch: true 
        }
      });

      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      console.log(`Starting Intelagent enrichment for ${lead.companyName}`);

      // Extract domain from website URL
      const domain = this.extractDomain(lead.websiteUrl);
      if (!domain) {
        console.log(`No valid domain for lead ${leadId}`);
        return null;
      }

      // Call your unified enrichment service
      const enrichmentData = await this.callEnrichmentAPI(domain, {
        includeEmails: true,
        includeScraping: true,
        includeEnrichment: true,
        maxPages: 10,
        useCache: true
      });

      // Process and save the enrichment results
      await this.processEnrichmentResults(leadId, enrichmentData);

      // Calculate quality score
      const qualityScore = await this.calculateLeadQualityScore(leadId);

      // Update lead status
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          qualityScore: qualityScore,
          enrichmentStatus: 'completed',
          lastEnrichedAt: new Date(),
          status: qualityScore >= 70 ? 'qualified' : 'needs_review'
        }
      });

      console.log(`Enrichment completed for ${lead.companyName} with score ${qualityScore}`);
      return enrichmentData;

    } catch (error) {
      console.error(`Error enriching lead ${leadId}:`, error);
      
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          enrichmentStatus: 'failed',
          status: 'needs_review'
        }
      });

      throw error;
    }
  }

  /**
   * Call the Intelagent Enrichment API
   */
  async callEnrichmentAPI(domain, options) {
    try {
      const response = await axios.post(
        `${this.apiUrl}/api/enrich/company`,
        {
          domain: domain,
          type: 'full',
          options: options
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'x-api-key': this.apiKey })
          },
          timeout: 60000 // 60 second timeout
        }
      );

      // If async job, wait for completion
      if (response.data.jobId) {
        return await this.waitForJobCompletion(response.data.jobId);
      }

      return response.data;
    } catch (error) {
      console.error('Enrichment API error:', error.message);
      
      // Fallback to direct module import if API fails
      if (error.code === 'ECONNREFUSED') {
        console.log('API unavailable, attempting direct import...');
        return await this.enrichDirectly(domain, options);
      }
      
      throw error;
    }
  }

  /**
   * Direct enrichment using imported modules (fallback)
   */
  async enrichDirectly(domain, options) {
    try {
      // Dynamic import to avoid circular dependencies
      const { enrichCompany } = await import('../../Intelagent Enrichment/unified-enrichment-service/src/index.js');
      
      return await enrichCompany(domain, options);
    } catch (error) {
      console.error('Direct enrichment failed:', error.message);
      throw error;
    }
  }

  /**
   * Wait for async job completion
   */
  async waitForJobCompletion(jobId) {
    const maxAttempts = 30;
    const delayMs = 2000;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(
          `${this.apiUrl}/api/enrich/status/${jobId}`,
          {
            headers: this.apiKey ? { 'x-api-key': this.apiKey } : {}
          }
        );

        if (response.data.job.status === 'completed') {
          return response.data.job.result;
        } else if (response.data.job.status === 'failed') {
          throw new Error(response.data.job.error || 'Enrichment failed');
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        console.error('Error checking job status:', error.message);
        throw error;
      }
    }

    throw new Error('Job timeout - enrichment took too long');
  }

  /**
   * Process enrichment results and save to database
   */
  async processEnrichmentResults(leadId, enrichmentData) {
    if (!enrichmentData || !enrichmentData.data) return;

    const { emails, scrapedData, enrichedData } = enrichmentData.data;

    // Save emails as contacts
    if (emails && emails.emails) {
      await this.saveEmailContacts(leadId, emails.emails);
    }

    // Save scraped website data
    if (scrapedData) {
      await this.saveScrapedData(leadId, scrapedData);
    }

    // Update lead with enriched company data
    if (enrichedData) {
      await this.updateLeadWithEnrichedData(leadId, enrichedData);
    }
  }

  /**
   * Save email contacts to database
   */
  async saveEmailContacts(leadId, emails) {
    for (const emailData of emails) {
      try {
        // Check if contact already exists
        const existingContact = await prisma.contact.findFirst({
          where: {
            leadId: leadId,
            email: emailData.email
          }
        });

        if (!existingContact) {
          await prisma.contact.create({
            data: {
              leadId: leadId,
              email: emailData.email,
              confidence: Math.round(emailData.confidence * 100),
              verificationStatus: emailData.isValid ? 'valid' : 'unverified',
              source: emailData.source || 'intelagent',
              isValid: emailData.isValid || false,
              isPrimary: emailData.email.includes('contact') || 
                        emailData.email.includes('info') ||
                        emailData.email.includes('sales')
            }
          });
        }
      } catch (error) {
        console.error(`Error saving contact ${emailData.email}:`, error);
      }
    }
  }

  /**
   * Save scraped website data
   */
  async saveScrapedData(leadId, scrapedData) {
    try {
      const websiteContent = {
        domain: scrapedData.domain,
        totalPages: scrapedData.totalPages,
        pages: scrapedData.pages?.map(page => ({
          path: page.path,
          title: page.title,
          hasContent: !!page.textContent
        })),
        lastScraped: new Date()
      };

      await prisma.companyResearch.upsert({
        where: { leadId },
        create: {
          leadId,
          websiteContent: websiteContent,
          keyPagesContent: {},
          researchDate: new Date()
        },
        update: {
          websiteContent: websiteContent,
          researchDate: new Date()
        }
      });
    } catch (error) {
      console.error('Error saving scraped data:', error);
    }
  }

  /**
   * Update lead with enriched company data
   */
  async updateLeadWithEnrichedData(leadId, enrichedData) {
    try {
      const updateData = {};

      // Basic info
      if (enrichedData.basicInfo) {
        const info = enrichedData.basicInfo;
        if (info.name) updateData.companyName = info.name;
        if (info.description) updateData.description = info.description;
        if (info.industry) updateData.industry = info.industry;
        if (info.location) {
          const [city, state] = info.location.split(', ');
          if (city) updateData.city = city;
          if (state) updateData.stateProvince = state;
        }
        if (info.foundedYear) updateData.foundedYear = info.foundedYear;
        if (info.companySize?.range) updateData.companySize = info.companySize.range;
      }

      // Tech stack
      if (enrichedData.techStack) {
        updateData.websiteTechnology = enrichedData.techStack;
        
        // Check for chat widget
        if (enrichedData.techStack.chatWidgets?.length > 0) {
          updateData.hasExistingChat = true;
          updateData.chatProvider = enrichedData.techStack.chatWidgets[0];
        }
      }

      // Social media
      if (enrichedData.socialMedia) {
        updateData.socialProfiles = enrichedData.socialMedia;
      }

      // Estimated metrics
      if (enrichedData.estimatedMetrics) {
        if (enrichedData.estimatedMetrics.estimatedRevenue) {
          updateData.estimatedRevenue = enrichedData.estimatedMetrics.estimatedRevenue;
        }
      }

      // Update lead
      if (Object.keys(updateData).length > 0) {
        await prisma.lead.update({
          where: { id: leadId },
          data: updateData
        });
      }

      // Save insights
      await this.saveLeadInsights(leadId, enrichedData);

    } catch (error) {
      console.error('Error updating lead with enriched data:', error);
    }
  }

  /**
   * Save lead insights from enrichment
   */
  async saveLeadInsights(leadId, enrichedData) {
    const insights = {
      opportunities: [],
      challenges: [],
      recommendations: []
    };

    // Analyze tech stack for opportunities
    if (!enrichedData.techStack?.chatWidgets?.length) {
      insights.opportunities.push({
        type: 'technology',
        description: 'No chat support detected - opportunity for customer service solution',
        priority: 'high'
      });
    }

    // Company size recommendations
    if (enrichedData.basicInfo?.companySize?.label) {
      const size = enrichedData.basicInfo.companySize.label;
      if (size === 'Small' || size === 'Micro') {
        insights.recommendations.push('Focus on cost-effective solutions');
        insights.recommendations.push('Emphasize easy implementation');
      } else if (size === 'Medium') {
        insights.recommendations.push('Highlight scalability features');
        insights.recommendations.push('Offer pilot program');
      } else {
        insights.recommendations.push('Enterprise features and support');
        insights.recommendations.push('Custom integration capabilities');
      }
    }

    // Growth stage insights
    if (enrichedData.estimatedMetrics?.growthStage) {
      insights.opportunities.push({
        type: 'growth',
        description: `Company in ${enrichedData.estimatedMetrics.growthStage} stage`,
        priority: 'medium'
      });
    }

    // Save to company research
    await prisma.companyResearch.update({
      where: { leadId },
      data: {
        insights: insights,
        painPoints: insights.opportunities.map(o => o.description),
        growthIndicators: enrichedData.estimatedMetrics ? [
          enrichedData.estimatedMetrics.growthStage,
          enrichedData.estimatedMetrics.marketPosition
        ].filter(Boolean) : []
      }
    });
  }

  /**
   * Calculate lead quality score
   */
  async calculateLeadQualityScore(leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contacts: true,
        companyResearch: true
      }
    });

    let score = 0;

    // Website presence (20 points)
    if (lead.websiteUrl) score += 20;

    // Contacts found (25 points)
    const validContacts = lead.contacts.filter(c => c.isValid);
    if (validContacts.length > 0) {
      score += Math.min(validContacts.length * 5, 15);
    }
    if (lead.contacts.some(c => c.isPrimary)) {
      score += 10;
    }

    // Company information (20 points)
    if (lead.companySize) score += 5;
    if (lead.industry) score += 5;
    if (lead.estimatedRevenue) score += 10;

    // Social presence (15 points)
    const socialCount = Object.keys(lead.socialProfiles || {}).length;
    score += Math.min(socialCount * 3, 15);

    // Location data (10 points)
    if (lead.city && lead.stateProvince) score += 5;
    if (lead.phone) score += 5;

    // Technology indicators (10 points)
    if (lead.websiteTechnology) {
      const techCount = Object.values(lead.websiteTechnology)
        .flat()
        .filter(Boolean).length;
      score += Math.min(techCount * 2, 10);
    }

    return Math.min(score, 100);
  }

  /**
   * Find emails for a specific lead
   */
  async findEmailsForLead(leadId) {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId }
      });

      if (!lead || !lead.websiteUrl) {
        return [];
      }

      const domain = this.extractDomain(lead.websiteUrl);
      
      // Call email-specific endpoint
      const response = await axios.post(
        `${this.apiUrl}/api/enrich/emails`,
        { domain },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'x-api-key': this.apiKey })
          }
        }
      );

      if (response.data.emails) {
        await this.saveEmailContacts(leadId, response.data.emails);
        return response.data.emails;
      }

      return [];
    } catch (error) {
      console.error(`Error finding emails for lead ${leadId}:`, error);
      return [];
    }
  }

  /**
   * Scrape website for a specific lead
   */
  async scrapeWebsite(leadId) {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId }
      });

      if (!lead || !lead.websiteUrl) {
        return null;
      }

      const domain = this.extractDomain(lead.websiteUrl);
      
      // Call scraping-specific endpoint
      const response = await axios.post(
        `${this.apiUrl}/api/enrich/scrape`,
        { 
          domain,
          maxPages: 10
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { 'x-api-key': this.apiKey })
          }
        }
      );

      if (response.data) {
        await this.saveScrapedData(leadId, response.data);
        return response.data;
      }

      return null;
    } catch (error) {
      console.error(`Error scraping website for lead ${leadId}:`, error);
      return null;
    }
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    if (!url) return null;
    
    try {
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }
}

export default new IntelagentEnrichmentService();