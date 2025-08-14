import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import WebsiteScraperService from './websiteScraper.js';
import EmailFinderService from './emailFinder.js';

const prisma = new PrismaClient();
const websiteScraper = new WebsiteScraperService();
const emailFinder = new EmailFinderService();

class LeadEnrichmentService {
  constructor() {
    // Company enrichment APIs
    this.clearbitApiKey = process.env.CLEARBIT_API_KEY;
    this.builtwithApiKey = process.env.BUILTWITH_API_KEY;
    
    // Social media APIs
    this.linkedinToken = process.env.LINKEDIN_ACCESS_TOKEN;
    this.facebookToken = process.env.FACEBOOK_APP_SECRET;
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

      console.log(`Starting enrichment for ${lead.companyName}`);

      // Track enrichment results
      const enrichmentResults = {
        leadId: leadId,
        companyName: lead.companyName,
        websiteUrl: lead.websiteUrl,
        startTime: new Date(),
        enrichmentSteps: []
      };

      // Step 1: Scrape website for basic information
      if (lead.websiteUrl && !lead.companyResearch?.websiteContent) {
        try {
          const websiteData = await websiteScraper.scrapeWebsite(lead.websiteUrl);
          await websiteScraper.saveScrapedData(leadId, websiteData);
          enrichmentResults.enrichmentSteps.push({
            step: 'website_scraping',
            status: 'success',
            dataFound: Object.keys(websiteData).length
          });
        } catch (error) {
          enrichmentResults.enrichmentSteps.push({
            step: 'website_scraping',
            status: 'failed',
            error: error.message
          });
        }
      }

      // Step 2: Find email addresses
      if (lead.contacts.length === 0) {
        try {
          const emails = await emailFinder.findEmailsForLead(leadId);
          enrichmentResults.enrichmentSteps.push({
            step: 'email_finding',
            status: 'success',
            dataFound: emails.length
          });
        } catch (error) {
          enrichmentResults.enrichmentSteps.push({
            step: 'email_finding',
            status: 'failed',
            error: error.message
          });
        }
      }

      // Step 3: Enrich company data from Clearbit
      if (this.clearbitApiKey) {
        try {
          const clearbitData = await this.enrichFromClearbit(lead.websiteUrl);
          await this.updateLeadWithClearbit(leadId, clearbitData);
          enrichmentResults.enrichmentSteps.push({
            step: 'clearbit_enrichment',
            status: 'success',
            dataFound: clearbitData ? 1 : 0
          });
        } catch (error) {
          enrichmentResults.enrichmentSteps.push({
            step: 'clearbit_enrichment',
            status: 'failed',
            error: error.message
          });
        }
      }

      // Step 4: Get technology stack from BuiltWith
      if (this.builtwithApiKey) {
        try {
          const techStack = await this.getTechStackFromBuiltWith(lead.websiteUrl);
          await this.updateLeadTechStack(leadId, techStack);
          enrichmentResults.enrichmentSteps.push({
            step: 'builtwith_tech',
            status: 'success',
            dataFound: techStack.technologies?.length || 0
          });
        } catch (error) {
          enrichmentResults.enrichmentSteps.push({
            step: 'builtwith_tech',
            status: 'failed',
            error: error.message
          });
        }
      }

      // Step 5: Get social media presence
      try {
        const socialData = await this.enrichSocialMediaPresence(lead);
        await this.updateLeadSocialData(leadId, socialData);
        enrichmentResults.enrichmentSteps.push({
          step: 'social_media',
          status: 'success',
          dataFound: Object.keys(socialData).length
        });
      } catch (error) {
        enrichmentResults.enrichmentSteps.push({
          step: 'social_media',
          status: 'failed',
          error: error.message
        });
      }

      // Step 6: Calculate lead quality score
      const qualityScore = await this.calculateLeadQualityScore(leadId);
      
      // Step 7: Identify pain points and opportunities
      const insights = await this.generateLeadInsights(leadId);

      // Update lead with enrichment results
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          qualityScore: qualityScore,
          enrichmentStatus: 'completed',
          lastEnrichedAt: new Date(),
          status: qualityScore >= 70 ? 'qualified' : 'needs_review'
        }
      });

      // Save enrichment log
      await prisma.enrichmentLog.create({
        data: {
          leadId: leadId,
          enrichmentResults: enrichmentResults,
          qualityScore: qualityScore,
          insights: insights,
          completedAt: new Date()
        }
      });

      enrichmentResults.endTime = new Date();
      enrichmentResults.qualityScore = qualityScore;
      enrichmentResults.insights = insights;

      console.log(`Enrichment completed for ${lead.companyName} with score ${qualityScore}`);
      return enrichmentResults;

    } catch (error) {
      console.error(`Error enriching lead ${leadId}:`, error);
      
      // Update lead status to indicate enrichment failed
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
   * Enrich company data from Clearbit
   */
  async enrichFromClearbit(websiteUrl) {
    if (!this.clearbitApiKey || !websiteUrl) return null;

    try {
      const domain = this.extractDomain(websiteUrl);
      const response = await axios.get(`https://company.clearbit.com/v2/companies/find`, {
        params: { domain: domain },
        headers: {
          'Authorization': `Bearer ${this.clearbitApiKey}`
        }
      });

      if (response.data) {
        return {
          name: response.data.name,
          legalName: response.data.legalName,
          description: response.data.description,
          category: response.data.category,
          industry: response.data.category?.industry,
          subIndustry: response.data.category?.subIndustry,
          tags: response.data.tags,
          employeeCount: response.data.metrics?.employees,
          employeeRange: response.data.metrics?.employeesRange,
          estimatedRevenue: response.data.metrics?.estimatedAnnualRevenue,
          fiscalYearEnd: response.data.metrics?.fiscalYearEnd,
          foundedYear: response.data.foundedYear,
          location: {
            street: response.data.location?.streetNumber + ' ' + response.data.location?.streetName,
            city: response.data.location?.city,
            state: response.data.location?.state,
            stateCode: response.data.location?.stateCode,
            country: response.data.location?.country,
            countryCode: response.data.location?.countryCode,
            postalCode: response.data.location?.postalCode,
            lat: response.data.location?.lat,
            lng: response.data.location?.lng,
            timeZone: response.data.location?.timeZone
          },
          logo: response.data.logo,
          facebook: response.data.facebook?.handle,
          linkedin: response.data.linkedin?.handle,
          twitter: response.data.twitter?.handle,
          crunchbase: response.data.crunchbase?.handle,
          emailProvider: response.data.emailProvider,
          type: response.data.type,
          ticker: response.data.ticker,
          phone: response.data.phone,
          techStack: response.data.tech
        };
      }
      
      return null;
    } catch (error) {
      console.error('Clearbit company enrichment error:', error.message);
      return null;
    }
  }

  /**
   * Get technology stack from BuiltWith
   */
  async getTechStackFromBuiltWith(websiteUrl) {
    if (!this.builtwithApiKey || !websiteUrl) return {};

    try {
      const domain = this.extractDomain(websiteUrl);
      const response = await axios.get(`https://api.builtwith.com/v20/api.json`, {
        params: {
          KEY: this.builtwithApiKey,
          LOOKUP: domain
        }
      });

      if (response.data && response.data.Results && response.data.Results[0]) {
        const result = response.data.Results[0];
        const techStack = {
          technologies: [],
          spend: result.Spend || 0,
          spendCategories: {}
        };

        // Extract technologies
        if (result.Result && result.Result.Paths) {
          result.Result.Paths.forEach(path => {
            if (path.Technologies) {
              path.Technologies.forEach(tech => {
                techStack.technologies.push({
                  name: tech.Name,
                  category: tech.Categories ? tech.Categories[0] : null,
                  firstDetected: tech.FirstDetected,
                  lastDetected: tech.LastDetected,
                  isPaid: tech.IsPaid || false
                });

                // Track spending by category
                if (tech.Categories && tech.IsPaid) {
                  const category = tech.Categories[0];
                  if (!techStack.spendCategories[category]) {
                    techStack.spendCategories[category] = 0;
                  }
                  techStack.spendCategories[category]++;
                }
              });
            }
          });
        }

        return techStack;
      }

      return {};
    } catch (error) {
      console.error('BuiltWith API error:', error.message);
      return {};
    }
  }

  /**
   * Enrich social media presence
   */
  async enrichSocialMediaPresence(lead) {
    const socialData = {};

    // Extract social links from website if we have scraped data
    if (lead.companyResearch?.websiteContent?.socialLinks) {
      Object.assign(socialData, lead.companyResearch.websiteContent.socialLinks);
    }

    // Try to get LinkedIn company data
    if (this.linkedinToken && (socialData.linkedin || lead.socialProfiles?.linkedin)) {
      try {
        const linkedinHandle = this.extractLinkedInHandle(
          socialData.linkedin || lead.socialProfiles.linkedin
        );
        
        if (linkedinHandle) {
          const linkedinData = await this.getLinkedInCompanyData(linkedinHandle);
          if (linkedinData) {
            socialData.linkedinData = linkedinData;
          }
        }
      } catch (error) {
        console.error('LinkedIn enrichment error:', error.message);
      }
    }

    // Try to get Facebook page data
    if (this.facebookToken && (socialData.facebook || lead.socialProfiles?.facebook)) {
      try {
        const facebookData = await this.getFacebookPageData(socialData.facebook);
        if (facebookData) {
          socialData.facebookData = facebookData;
        }
      } catch (error) {
        console.error('Facebook enrichment error:', error.message);
      }
    }

    return socialData;
  }

  /**
   * Get LinkedIn company data
   */
  async getLinkedInCompanyData(companyHandle) {
    try {
      const response = await axios.get(
        `https://api.linkedin.com/v2/organizations/${companyHandle}`,
        {
          headers: {
            'Authorization': `Bearer ${this.linkedinToken}`,
            'X-Restli-Protocol-Version': '2.0.0'
          }
        }
      );

      if (response.data) {
        return {
          followers: response.data.followersCount,
          employeeCount: response.data.staffCount,
          specialties: response.data.specialties,
          founded: response.data.foundedOn?.year,
          description: response.data.description,
          website: response.data.websiteUrl
        };
      }

      return null;
    } catch (error) {
      console.error('LinkedIn API error:', error.message);
      return null;
    }
  }

  /**
   * Get Facebook page data
   */
  async getFacebookPageData(pageUrl) {
    // Note: Facebook Graph API requires page access token
    // This is a simplified example
    try {
      const pageId = this.extractFacebookPageId(pageUrl);
      if (!pageId) return null;

      const response = await axios.get(
        `https://graph.facebook.com/v12.0/${pageId}`,
        {
          params: {
            fields: 'name,about,category,fan_count,website,phone,emails',
            access_token: this.facebookToken
          }
        }
      );

      if (response.data) {
        return {
          likes: response.data.fan_count,
          category: response.data.category,
          about: response.data.about,
          website: response.data.website,
          phone: response.data.phone
        };
      }

      return null;
    } catch (error) {
      console.error('Facebook API error:', error.message);
      return null;
    }
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
    const scoreBreakdown = {};

    // Website presence (20 points)
    if (lead.websiteUrl) {
      score += 10;
      scoreBreakdown.website = 10;
      
      if (lead.companyResearch?.websiteContent) {
        const content = lead.companyResearch.websiteContent;
        if (content.hasChat?.hasChat) score += 5;
        if (content.hasPricing) score += 3;
        if (content.technologies?.analytics?.length > 0) score += 2;
        scoreBreakdown.websiteQuality = score - 10;
      }
    }

    // Contact information (25 points)
    const validContacts = lead.contacts.filter(c => c.isValid);
    if (validContacts.length > 0) {
      score += Math.min(validContacts.length * 5, 15);
      scoreBreakdown.contacts = Math.min(validContacts.length * 5, 15);
    }
    
    const decisionMakers = lead.contacts.filter(c => c.isPrimary);
    if (decisionMakers.length > 0) {
      score += 10;
      scoreBreakdown.decisionMakers = 10;
    }

    // Company information (20 points)
    if (lead.companySize) {
      score += 5;
      scoreBreakdown.companySize = 5;
    }
    if (lead.industry) {
      score += 5;
      scoreBreakdown.industry = 5;
    }
    if (lead.estimatedRevenue) {
      score += 10;
      scoreBreakdown.revenue = 10;
    }

    // Social presence (15 points)
    const socialProfiles = lead.socialProfiles || {};
    const socialCount = Object.keys(socialProfiles).length;
    score += Math.min(socialCount * 3, 15);
    scoreBreakdown.socialPresence = Math.min(socialCount * 3, 15);

    // Location data (10 points)
    if (lead.city && lead.stateProvince) {
      score += 5;
      scoreBreakdown.location = 5;
    }
    if (lead.phone) {
      score += 5;
      scoreBreakdown.phone = 5;
    }

    // Technology indicators (10 points)
    if (lead.websiteTechnology) {
      const techCount = Object.values(lead.websiteTechnology)
        .flat()
        .filter(Boolean).length;
      score += Math.min(techCount * 2, 10);
      scoreBreakdown.technology = Math.min(techCount * 2, 10);
    }

    // Store score breakdown
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        qualityScore: score,
        scoreBreakdown: scoreBreakdown
      }
    });

    return score;
  }

  /**
   * Generate insights about the lead
   */
  async generateLeadInsights(leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contacts: true,
        companyResearch: true
      }
    });

    const insights = {
      opportunities: [],
      challenges: [],
      recommendations: [],
      bestTimeToContact: null,
      estimatedDealSize: null
    };

    // Analyze pain points
    if (lead.companyResearch?.painPoints?.length > 0) {
      lead.companyResearch.painPoints.forEach(painPoint => {
        insights.opportunities.push({
          type: 'pain_point',
          description: painPoint,
          priority: 'high'
        });
      });
    }

    // Analyze growth indicators
    if (lead.companyResearch?.growthIndicators?.length > 0) {
      lead.companyResearch.growthIndicators.forEach(indicator => {
        insights.opportunities.push({
          type: 'growth',
          description: indicator,
          priority: 'medium'
        });
      });
    }

    // Technology opportunities
    if (!lead.hasExistingChat) {
      insights.opportunities.push({
        type: 'technology',
        description: 'No chat support detected - opportunity for customer service solution',
        priority: 'high'
      });
    }

    // Contact challenges
    if (lead.contacts.length === 0) {
      insights.challenges.push({
        type: 'contact',
        description: 'No email contacts found',
        priority: 'critical'
      });
    } else if (!lead.contacts.some(c => c.isPrimary)) {
      insights.challenges.push({
        type: 'contact',
        description: 'No decision-maker contacts identified',
        priority: 'high'
      });
    }

    // Recommendations based on company size
    if (lead.companySize) {
      const employeeCount = parseInt(lead.companySize.split('-')[0]);
      if (employeeCount < 50) {
        insights.recommendations.push('Focus on cost-effective solutions');
        insights.recommendations.push('Emphasize easy implementation');
        insights.estimatedDealSize = '$5,000 - $25,000';
      } else if (employeeCount < 200) {
        insights.recommendations.push('Highlight scalability features');
        insights.recommendations.push('Offer pilot program');
        insights.estimatedDealSize = '$25,000 - $100,000';
      } else {
        insights.recommendations.push('Enterprise features and support');
        insights.recommendations.push('Custom integration capabilities');
        insights.estimatedDealSize = '$100,000+';
      }
    }

    // Best time to contact based on timezone
    if (lead.timezone) {
      insights.bestTimeToContact = {
        timezone: lead.timezone,
        recommendedHours: '9:00 AM - 11:00 AM local time',
        days: 'Tuesday - Thursday'
      };
    }

    // Store insights
    await prisma.companyResearch.update({
      where: { leadId: leadId },
      data: {
        insights: insights,
        researchDate: new Date()
      }
    });

    return insights;
  }

  /**
   * Update lead with Clearbit data
   */
  async updateLeadWithClearbit(leadId, clearbitData) {
    if (!clearbitData) return;

    const updateData = {};

    if (clearbitData.legalName) updateData.legalName = clearbitData.legalName;
    if (clearbitData.description) updateData.description = clearbitData.description;
    if (clearbitData.industry) updateData.industry = clearbitData.industry;
    if (clearbitData.subIndustry) updateData.subIndustry = clearbitData.subIndustry;
    if (clearbitData.employeeRange) updateData.companySize = clearbitData.employeeRange;
    if (clearbitData.estimatedRevenue) updateData.estimatedRevenue = clearbitData.estimatedRevenue;
    if (clearbitData.foundedYear) updateData.foundedYear = clearbitData.foundedYear;
    if (clearbitData.logo) updateData.logo = clearbitData.logo;
    if (clearbitData.phone) updateData.phone = clearbitData.phone;
    
    if (clearbitData.location) {
      if (clearbitData.location.city) updateData.city = clearbitData.location.city;
      if (clearbitData.location.stateCode) updateData.stateProvince = clearbitData.location.stateCode;
      if (clearbitData.location.country) updateData.country = clearbitData.location.country;
      if (clearbitData.location.postalCode) updateData.postalCode = clearbitData.location.postalCode;
      if (clearbitData.location.timeZone) updateData.timezone = clearbitData.location.timeZone;
    }

    // Merge social profiles
    const socialProfiles = {};
    if (clearbitData.facebook) socialProfiles.facebook = `https://facebook.com/${clearbitData.facebook}`;
    if (clearbitData.linkedin) socialProfiles.linkedin = `https://linkedin.com/company/${clearbitData.linkedin}`;
    if (clearbitData.twitter) socialProfiles.twitter = `https://twitter.com/${clearbitData.twitter}`;
    if (clearbitData.crunchbase) socialProfiles.crunchbase = `https://crunchbase.com/organization/${clearbitData.crunchbase}`;
    
    if (Object.keys(socialProfiles).length > 0) {
      updateData.socialProfiles = socialProfiles;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.lead.update({
        where: { id: leadId },
        data: updateData
      });
    }
  }

  /**
   * Update lead technology stack
   */
  async updateLeadTechStack(leadId, techStack) {
    if (!techStack || techStack.technologies?.length === 0) return;

    const technologyCategories = {};
    
    techStack.technologies.forEach(tech => {
      const category = tech.category || 'Other';
      if (!technologyCategories[category]) {
        technologyCategories[category] = [];
      }
      technologyCategories[category].push(tech.name);
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        websiteTechnology: technologyCategories,
        techSpend: techStack.spend || null
      }
    });
  }

  /**
   * Update lead social data
   */
  async updateLeadSocialData(leadId, socialData) {
    if (!socialData || Object.keys(socialData).length === 0) return;

    const updateData = {
      socialProfiles: {}
    };

    // Store social URLs
    ['facebook', 'linkedin', 'twitter', 'instagram', 'youtube'].forEach(platform => {
      if (socialData[platform]) {
        updateData.socialProfiles[platform] = socialData[platform];
      }
    });

    // Store social metrics
    if (socialData.linkedinData?.followers) {
      updateData.linkedinFollowers = socialData.linkedinData.followers;
    }
    if (socialData.facebookData?.likes) {
      updateData.facebookLikes = socialData.facebookData.likes;
    }

    if (Object.keys(updateData.socialProfiles).length > 0) {
      await prisma.lead.update({
        where: { id: leadId },
        data: updateData
      });
    }
  }

  /**
   * Helper: Extract domain from URL
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

  /**
   * Helper: Extract LinkedIn handle
   */
  extractLinkedInHandle(linkedinUrl) {
    if (!linkedinUrl) return null;
    
    const match = linkedinUrl.match(/linkedin\.com\/company\/([^\/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Helper: Extract Facebook page ID
   */
  extractFacebookPageId(facebookUrl) {
    if (!facebookUrl) return null;
    
    const match = facebookUrl.match(/facebook\.com\/([^\/]+)/);
    return match ? match[1] : null;
  }
}

export default new LeadEnrichmentService();