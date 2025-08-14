import { query } from '../config/database.js';
import { cache } from '../config/redis.js';

class LeadScoringService {
  constructor() {
    this.scoringWeights = {
      company: 0.35,
      website: 0.25,
      engagement: 0.20,
      contact: 0.20
    };

    this.scoringFactors = {
      companySize: {
        '1-10': 10,
        '11-50': 15,
        '51-200': 20,
        '201-500': 15,
        '501-1000': 10,
        '1000+': 5
      },
      industryFit: {
        'ecommerce': 20,
        'saas': 18,
        'professional-services': 16,
        'healthcare': 15,
        'education': 14,
        'retail': 13,
        'hospitality': 12,
        'real-estate': 11,
        'financial-services': 10,
        'manufacturing': 8,
        'other': 5
      },
      websiteTechnology: {
        hasWordPress: 5,
        hasShopify: 8,
        hasWix: 3,
        hasSquarespace: 4,
        hasCustomCMS: 10,
        noExistingChat: 10,
        hasBasicChat: -5,
        hasAdvancedChat: -15
      },
      onlinePresence: {
        activeWebsite: 10,
        recentBlogPosts: 5,
        socialMediaActive: 5,
        highWebTraffic: 10,
        sslCertificate: 3,
        mobileOptimized: 5
      },
      contactQuality: {
        verifiedEmail: 10,
        decisionMakerRole: 10,
        multipleContacts: 5,
        personalEmail: -5
      },
      businessIndicators: {
        growthStage: 8,
        recentFunding: 10,
        hiringActive: 7,
        multipleLocations: 5,
        establishedBusiness: 3
      }
    };

    this.disqualificationCriteria = [
      'hasAdvancedChat',
      'websiteNotFunctional',
      'businessClosed',
      'blacklistedIndustry',
      'tooSmall',
      'tooLarge',
      'noContactInfo',
      'competitorCompany'
    ];

    this.blacklistedIndustries = [
      'gambling',
      'adult-content',
      'tobacco',
      'cryptocurrency',
      'mlm',
      'payday-loans'
    ];
  }

  async scoreLead(leadId) {
    try {
      const lead = await this.getLeadWithDetails(leadId);
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      const disqualificationReasons = await this.checkDisqualification(lead);
      if (disqualificationReasons.length > 0) {
        await this.saveScore(leadId, 0, false, disqualificationReasons);
        return {
          leadId,
          totalScore: 0,
          qualified: false,
          disqualificationReasons
        };
      }

      const scores = await this.calculateScores(lead);
      const totalScore = this.calculateTotalScore(scores);
      const qualified = totalScore >= (process.env.MIN_QUALITY_SCORE || 70);

      await this.saveScore(leadId, totalScore, qualified, [], scores);

      if (qualified) {
        await this.updateLeadStatus(leadId, 'qualified');
      } else if (totalScore < (process.env.AUTO_DISQUALIFY_SCORE || 30)) {
        await this.updateLeadStatus(leadId, 'disqualified');
      }

      return {
        leadId,
        totalScore,
        qualified,
        scores,
        breakdown: this.generateScoreBreakdown(scores)
      };
    } catch (error) {
      console.error(`Error scoring lead ${leadId}:`, error);
      throw error;
    }
  }

  async calculateScores(lead) {
    const scores = {
      company: 0,
      website: 0,
      engagement: 0,
      contact: 0
    };

    scores.company = this.scoreCompany(lead);
    scores.website = await this.scoreWebsite(lead);
    scores.engagement = this.scoreEngagement(lead);
    scores.contact = this.scoreContacts(lead.contacts);

    return scores;
  }

  scoreCompany(lead) {
    let score = 0;
    const maxScore = 50;

    const sizeScore = this.getCompanySizeScore(lead.employee_range || lead.company_size);
    score += sizeScore;

    const industryScore = this.getIndustryScore(lead.industry);
    score += industryScore;

    if (lead.founded_year) {
      const age = new Date().getFullYear() - lead.founded_year;
      if (age >= 2 && age <= 10) {
        score += 5;
      } else if (age > 10) {
        score += 3;
      }
    }

    if (lead.estimated_revenue) {
      const revenue = this.parseRevenue(lead.estimated_revenue);
      if (revenue > 1000000) score += 5;
      if (revenue > 10000000) score += 5;
    }

    if (lead.city && lead.country) {
      score += 3;
    }

    return Math.min(score, maxScore);
  }

  async scoreWebsite(lead) {
    let score = 0;
    const maxScore = 50;

    if (!lead.website_url) {
      return 0;
    }

    const techData = lead.website_technology || {};

    if (!techData.hasChat || techData.chatProvider === 'none') {
      score += this.scoringFactors.websiteTechnology.noExistingChat;
    } else if (this.isBasicChat(techData.chatProvider)) {
      score += this.scoringFactors.websiteTechnology.hasBasicChat;
    } else if (this.isAdvancedChat(techData.chatProvider)) {
      return 0;
    }

    if (techData.cms) {
      const cmsScores = {
        wordpress: this.scoringFactors.websiteTechnology.hasWordPress,
        shopify: this.scoringFactors.websiteTechnology.hasShopify,
        wix: this.scoringFactors.websiteTechnology.hasWix,
        squarespace: this.scoringFactors.websiteTechnology.hasSquarespace,
        custom: this.scoringFactors.websiteTechnology.hasCustomCMS
      };
      
      const cms = techData.cms.toLowerCase();
      score += cmsScores[cms] || 0;
    }

    if (techData.ssl) {
      score += this.scoringFactors.onlinePresence.sslCertificate;
    }

    if (techData.mobileOptimized) {
      score += this.scoringFactors.onlinePresence.mobileOptimized;
    }

    if (techData.lastUpdated) {
      const daysSinceUpdate = this.daysSince(techData.lastUpdated);
      if (daysSinceUpdate < 30) {
        score += this.scoringFactors.onlinePresence.activeWebsite;
      } else if (daysSinceUpdate < 90) {
        score += 5;
      }
    }

    const trafficScore = await this.estimateTrafficScore(lead.website_url);
    score += trafficScore;

    return Math.min(score, maxScore);
  }

  scoreEngagement(lead) {
    let score = 0;
    const maxScore = 30;

    const socialProfiles = lead.social_profiles || {};
    
    if (socialProfiles.linkedin) score += 3;
    if (socialProfiles.facebook) score += 2;
    if (socialProfiles.twitter) score += 2;
    if (socialProfiles.instagram) score += 2;

    if (socialProfiles.linkedin_followers > 100) score += 3;
    if (socialProfiles.facebook_likes > 500) score += 3;

    if (socialProfiles.recent_activity) {
      const daysSinceActivity = this.daysSince(socialProfiles.last_post_date);
      if (daysSinceActivity < 7) {
        score += this.scoringFactors.onlinePresence.socialMediaActive;
      } else if (daysSinceActivity < 30) {
        score += 3;
      }
    }

    if (lead.tags && lead.tags.includes('verified')) {
      score += 5;
    }

    return Math.min(score, maxScore);
  }

  scoreContacts(contacts) {
    if (!contacts || contacts.length === 0) {
      return 0;
    }

    let score = 0;
    const maxScore = 20;

    const verifiedContacts = contacts.filter(c => c.email_verified);
    const decisionMakers = contacts.filter(c => c.is_decision_maker);

    if (verifiedContacts.length > 0) {
      score += this.scoringFactors.contactQuality.verifiedEmail;
    }

    if (decisionMakers.length > 0) {
      score += this.scoringFactors.contactQuality.decisionMakerRole;
    }

    if (contacts.length >= 3) {
      score += this.scoringFactors.contactQuality.multipleContacts;
    }

    const personalEmails = contacts.filter(c => this.isPersonalEmail(c.email));
    if (personalEmails.length === contacts.length) {
      score += this.scoringFactors.contactQuality.personalEmail;
    }

    return Math.min(score, maxScore);
  }

  async checkDisqualification(lead) {
    const reasons = [];

    if (!lead.website_url) {
      reasons.push('No website URL');
    }

    if (this.blacklistedIndustries.includes(lead.industry?.toLowerCase())) {
      reasons.push('Blacklisted industry');
    }

    const techData = lead.website_technology || {};
    if (this.isAdvancedChat(techData.chatProvider)) {
      reasons.push('Has advanced chat solution');
    }

    const companySize = this.parseCompanySize(lead.employee_range || lead.company_size);
    if (companySize && companySize < 2) {
      reasons.push('Company too small');
    }
    if (companySize && companySize > 10000) {
      reasons.push('Company too large');
    }

    if (!lead.contacts || lead.contacts.length === 0) {
      const hasPhone = lead.phone;
      if (!hasPhone) {
        reasons.push('No contact information available');
      }
    }

    if (lead.status === 'closed' || lead.business_status === 'CLOSED_PERMANENTLY') {
      reasons.push('Business closed');
    }

    const isCompetitor = await this.checkIfCompetitor(lead.company_name, lead.website_url);
    if (isCompetitor) {
      reasons.push('Competitor company');
    }

    return reasons;
  }

  calculateTotalScore(scores) {
    const weightedScore = 
      (scores.company * this.scoringWeights.company) +
      (scores.website * this.scoringWeights.website) +
      (scores.engagement * this.scoringWeights.engagement) +
      (scores.contact * this.scoringWeights.contact);
    
    return Math.round(weightedScore);
  }

  generateScoreBreakdown(scores) {
    return {
      company: {
        score: scores.company,
        weight: this.scoringWeights.company,
        contribution: scores.company * this.scoringWeights.company
      },
      website: {
        score: scores.website,
        weight: this.scoringWeights.website,
        contribution: scores.website * this.scoringWeights.website
      },
      engagement: {
        score: scores.engagement,
        weight: this.scoringWeights.engagement,
        contribution: scores.engagement * this.scoringWeights.engagement
      },
      contact: {
        score: scores.contact,
        weight: this.scoringWeights.contact,
        contribution: scores.contact * this.scoringWeights.contact
      }
    };
  }

  async saveScore(leadId, totalScore, qualified, disqualificationReasons, scores = {}) {
    const existingScore = await query(
      'SELECT id FROM lead_scores WHERE lead_id = $1',
      [leadId]
    );

    const scoreData = {
      total_score: totalScore,
      company_score: scores.company || 0,
      website_score: scores.website || 0,
      engagement_score: scores.engagement || 0,
      contact_score: scores.contact || 0,
      qualified: qualified,
      disqualification_reasons: disqualificationReasons,
      score_breakdown: JSON.stringify(this.generateScoreBreakdown(scores)),
      scoring_factors: JSON.stringify(scores)
    };

    if (existingScore.rows.length > 0) {
      await query(
        `UPDATE lead_scores SET
          total_score = $1, company_score = $2, website_score = $3,
          engagement_score = $4, contact_score = $5, qualified = $6,
          disqualification_reasons = $7, score_breakdown = $8,
          scoring_factors = $9, last_calculated = NOW()
        WHERE lead_id = $10`,
        [
          scoreData.total_score,
          scoreData.company_score,
          scoreData.website_score,
          scoreData.engagement_score,
          scoreData.contact_score,
          scoreData.qualified,
          scoreData.disqualification_reasons,
          scoreData.score_breakdown,
          scoreData.scoring_factors,
          leadId
        ]
      );
    } else {
      await query(
        `INSERT INTO lead_scores (
          lead_id, total_score, company_score, website_score,
          engagement_score, contact_score, qualified,
          disqualification_reasons, score_breakdown, scoring_factors
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          leadId,
          scoreData.total_score,
          scoreData.company_score,
          scoreData.website_score,
          scoreData.engagement_score,
          scoreData.contact_score,
          scoreData.qualified,
          scoreData.disqualification_reasons,
          scoreData.score_breakdown,
          scoreData.scoring_factors
        ]
      );
    }
  }

  async updateLeadStatus(leadId, status) {
    await query(
      'UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, leadId]
    );
  }

  async getLeadWithDetails(leadId) {
    const leadResult = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (leadResult.rows.length === 0) return null;

    const lead = leadResult.rows[0];
    
    const contactsResult = await query('SELECT * FROM contacts WHERE lead_id = $1', [leadId]);
    lead.contacts = contactsResult.rows;

    return lead;
  }

  getCompanySizeScore(sizeRange) {
    if (!sizeRange) return 0;
    
    for (const [range, score] of Object.entries(this.scoringFactors.companySize)) {
      if (sizeRange.includes(range) || sizeRange === range) {
        return score;
      }
    }
    
    return 5;
  }

  getIndustryScore(industry) {
    if (!industry) return this.scoringFactors.industryFit.other;
    
    const industryLower = industry.toLowerCase();
    
    for (const [key, score] of Object.entries(this.scoringFactors.industryFit)) {
      if (industryLower.includes(key.replace('-', ' ')) || industryLower === key) {
        return score;
      }
    }
    
    return this.scoringFactors.industryFit.other;
  }

  parseCompanySize(sizeStr) {
    if (!sizeStr) return null;
    
    const numbers = sizeStr.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      return parseInt(numbers[numbers.length - 1]);
    }
    
    return null;
  }

  parseRevenue(revenueStr) {
    if (!revenueStr) return 0;
    
    const numbers = revenueStr.match(/\d+/g);
    if (!numbers || numbers.length === 0) return 0;
    
    let revenue = parseInt(numbers[0]);
    
    if (revenueStr.toLowerCase().includes('m') || revenueStr.toLowerCase().includes('million')) {
      revenue *= 1000000;
    } else if (revenueStr.toLowerCase().includes('b') || revenueStr.toLowerCase().includes('billion')) {
      revenue *= 1000000000;
    } else if (revenueStr.toLowerCase().includes('k') || revenueStr.toLowerCase().includes('thousand')) {
      revenue *= 1000;
    }
    
    return revenue;
  }

  isBasicChat(provider) {
    const basicProviders = ['tawk.to', 'tidio', 'jivochat', 'purechat', 'chatra'];
    return provider && basicProviders.includes(provider.toLowerCase());
  }

  isAdvancedChat(provider) {
    const advancedProviders = ['intercom', 'drift', 'zendesk', 'salesforce', 'hubspot', 'livechat'];
    return provider && advancedProviders.includes(provider.toLowerCase());
  }

  isPersonalEmail(email) {
    const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];
    const domain = email.split('@')[1];
    return personalDomains.includes(domain?.toLowerCase());
  }

  async checkIfCompetitor(companyName, websiteUrl) {
    const competitors = ['intercom', 'drift', 'zendesk', 'freshchat', 'livechat'];
    
    if (companyName) {
      const nameLower = companyName.toLowerCase();
      if (competitors.some(comp => nameLower.includes(comp))) {
        return true;
      }
    }
    
    if (websiteUrl) {
      const urlLower = websiteUrl.toLowerCase();
      if (competitors.some(comp => urlLower.includes(comp))) {
        return true;
      }
    }
    
    return false;
  }

  async estimateTrafficScore(websiteUrl) {
    return Math.floor(Math.random() * 10);
  }

  daysSince(dateStr) {
    if (!dateStr) return Infinity;
    
    const date = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }
}

export default new LeadScoringService();