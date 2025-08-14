import Groq from 'groq-sdk';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { query } from '../config/database.js';
import { cache } from '../config/redis.js';

class EmailGenerationService {
  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });

    // Using Groq's fast models - llama-3.3-70b or mixtral-8x7b
    this.aiModel = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
    
    this.personalzationDepths = {
      heavy: { references: 3, specificity: 'high' },
      medium: { references: 2, specificity: 'medium' },
      light: { references: 1, specificity: 'low' }
    };

    this.antiCreepinessRules = {
      safeToMention: [
        'company_homepage',
        'main_services',
        'recent_blog_titles',
        'business_expansion',
        'industry',
        'location',
        'business_hours',
        'general_pain_points'
      ],
      neverMention: [
        'specific_employee_names',
        'personal_social_posts',
        'customer_names',
        'exact_revenue',
        'internal_problems',
        'competitors_by_name',
        'deep_website_pages',
        'old_news'
      ]
    };
  }

  async generatePersonalizedEmail(leadId, contactId, campaignId) {
    try {
      const lead = await this.getLeadData(leadId);
      const contact = await this.getContactData(contactId);
      const campaign = await this.getCampaignData(campaignId);
      const research = await this.conductCompanyResearch(lead);

      const cacheKey = `email:${leadId}:${contactId}:${campaignId}`;
      const cached = await cache.get(cacheKey);
      if (cached && !campaign.ab_testing_enabled) {
        return cached;
      }

      const personalizationData = await this.gatherPersonalizationData(lead, contact, research);
      const emailContent = await this.generateEmailContent(personalizationData, campaign);
      
      const qualityChecked = await this.performQualityCheck(emailContent, personalizationData);
      
      if (!qualityChecked.passed) {
        const regenerated = await this.regenerateEmail(personalizationData, campaign, qualityChecked.issues);
        await cache.set(cacheKey, regenerated, 3600);
        return regenerated;
      }

      await cache.set(cacheKey, emailContent, 3600);
      return emailContent;
    } catch (error) {
      console.error('Error generating personalized email:', error);
      throw error;
    }
  }

  async conductCompanyResearch(lead) {
    const research = {
      websiteContent: {},
      recentNews: [],
      jobPostings: [],
      customerReviews: {},
      socialMedia: {},
      painPoints: [],
      growthIndicators: [],
      uniqueAspects: [],
      websiteTone: null,
      seasonalPatterns: {}
    };

    try {
      const existingResearch = await this.getExistingResearch(lead.id);
      if (existingResearch && this.isResearchFresh(existingResearch.research_date)) {
        return existingResearch;
      }

      research.websiteContent = await this.scrapeWebsiteContent(lead.website_url);
      research.recentNews = await this.searchRecentNews(lead.company_name);
      research.jobPostings = await this.searchJobPostings(lead.company_name);
      research.customerReviews = await this.aggregateReviews(lead);
      research.socialMedia = await this.analyzeSocialMedia(lead.social_profiles);
      
      const insights = await this.extractInsights(research);
      Object.assign(research, insights);

      await this.saveResearch(lead.id, research);
      return research;
    } catch (error) {
      console.error('Company research error:', error);
      return research;
    }
  }

  async scrapeWebsiteContent(websiteUrl) {
    const content = {
      homepage: null,
      about: null,
      services: null,
      blog: [],
      news: null
    };

    try {
      const pages = ['', '/about', '/services', '/blog', '/news'];
      
      for (const page of pages) {
        const url = `${websiteUrl}${page}`;
        const html = await this.fetchPage(url);
        
        if (html) {
          const $ = cheerio.load(html);
          
          $('script, style, nav, footer, header').remove();
          
          const pageContent = {
            title: $('title').text(),
            headings: $('h1, h2, h3').map((i, el) => $(el).text()).get().slice(0, 5),
            paragraphs: $('p').map((i, el) => $(el).text()).get().slice(0, 10),
            meta_description: $('meta[name="description"]').attr('content')
          };

          if (page === '') {
            content.homepage = pageContent;
          } else if (page === '/about') {
            content.about = pageContent;
          } else if (page === '/services') {
            content.services = pageContent;
          } else if (page === '/blog') {
            const blogPosts = $('.blog-post, article').slice(0, 3);
            blogPosts.each((i, el) => {
              content.blog.push({
                title: $(el).find('h1, h2, h3').first().text(),
                excerpt: $(el).find('p').first().text(),
                date: $(el).find('.date, time').text()
              });
            });
          } else if (page === '/news') {
            content.news = pageContent;
          }
        }
      }
    } catch (error) {
      console.error('Website scraping error:', error);
    }

    return content;
  }

  async searchRecentNews(companyName) {
    const news = [];
    
    try {
      const searchQuery = `"${companyName}" news announcement`;
      const searchUrl = `https://www.googleapis.com/customsearch/v1`;
      
      const response = await axios.get(searchUrl, {
        params: {
          key: process.env.GOOGLE_SEARCH_API_KEY,
          cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
          q: searchQuery,
          dateRestrict: 'm3',
          num: 5
        }
      });

      if (response.data.items) {
        for (const item of response.data.items) {
          news.push({
            title: item.title,
            snippet: item.snippet,
            link: item.link,
            date: item.pagemap?.metatags?.[0]?.['article:published_time']
          });
        }
      }
    } catch (error) {
      console.error('News search error:', error);
    }

    return news;
  }

  async searchJobPostings(companyName) {
    const jobPostings = [];
    
    try {
      const searchQuery = `site:linkedin.com/jobs OR site:indeed.com "${companyName}"`;
      
      const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: process.env.GOOGLE_SEARCH_API_KEY,
          cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
          q: searchQuery,
          num: 5
        }
      });

      if (response.data.items) {
        for (const item of response.data.items) {
          const isCustomerService = item.title.toLowerCase().includes('customer') || 
                                   item.snippet.toLowerCase().includes('support');
          
          jobPostings.push({
            title: item.title,
            snippet: item.snippet,
            indicatesGrowth: true,
            indicatesCustomerServiceNeed: isCustomerService
          });
        }
      }
    } catch (error) {
      console.error('Job search error:', error);
    }

    return jobPostings;
  }

  async extractInsights(research) {
    const prompt = `Analyze this company research data and extract key insights for cold email personalization:

Website Content: ${JSON.stringify(research.websiteContent.homepage?.headings || [])}
Recent News: ${JSON.stringify(research.recentNews.slice(0, 3))}
Job Postings: ${JSON.stringify(research.jobPostings.slice(0, 3))}
Reviews: ${JSON.stringify(research.customerReviews)}

Extract:
1. Main pain points (focus on customer service, availability, response time)
2. Growth indicators (expansion, hiring, new products)
3. Unique aspects of their business
4. Website tone (formal, casual, technical, friendly)
5. Seasonal patterns or busy periods mentioned

Format as JSON with keys: painPoints, growthIndicators, uniqueAspects, websiteTone, seasonalPatterns`;

    try {
      const insights = await this.callAI(prompt, 'analysis');
      return JSON.parse(insights);
    } catch (error) {
      console.error('Insight extraction error:', error);
      return {
        painPoints: ['customer service efficiency'],
        growthIndicators: ['steady growth'],
        uniqueAspects: ['established local business'],
        websiteTone: 'professional',
        seasonalPatterns: {}
      };
    }
  }

  async gatherPersonalizationData(lead, contact, research) {
    return {
      lead: {
        companyName: lead.company_name,
        website: lead.website_url,
        industry: lead.industry,
        city: lead.city,
        country: lead.country,
        companySize: lead.company_size,
        businessHours: lead.business_hours
      },
      contact: {
        firstName: contact.first_name,
        lastName: contact.last_name,
        position: contact.position,
        email: contact.email,
        isDecisionMaker: contact.is_decision_maker
      },
      research: {
        recentNews: research.recentNews?.[0]?.title,
        jobPosting: research.jobPostings?.find(j => j.indicatesCustomerServiceNeed),
        painPoints: research.painPoints || [],
        growthIndicator: research.growthIndicators?.[0],
        uniqueAspect: research.uniqueAspects?.[0],
        websiteTone: research.websiteTone || 'professional',
        reviewThemes: research.customerReviews?.themes || []
      },
      calculated: {
        estimatedMissedLeads: this.calculateMissedLeads(lead),
        costSavings: this.calculateCostSavings(lead),
        responseTimeImprovement: '24/7 instant vs. business hours only',
        localCompetitorAdvantage: `Be the only ${lead.industry} in ${lead.city} with 24/7 chat`
      }
    };
  }

  async generateEmailContent(personalizationData, campaign) {
    const depth = this.selectPersonalizationDepth(campaign);
    const template = this.selectTemplate(campaign, personalizationData);
    
    const prompt = this.buildEmailPrompt(personalizationData, template, depth);
    const generatedEmail = await this.callAI(prompt, 'email');
    
    const subjectLine = await this.generateSubjectLine(personalizationData, campaign);
    
    return {
      subject: subjectLine,
      body: generatedEmail,
      personalizationDepth: depth,
      templateUsed: template.id,
      generatedAt: new Date().toISOString()
    };
  }

  buildEmailPrompt(data, template, depth) {
    const depthInstructions = {
      heavy: 'Include 3+ specific references to their business. Be very specific.',
      medium: 'Include 1-2 specific references. Balance personalization with brevity.',
      light: 'Keep it industry-specific but not overly personalized.'
    };

    return `Write a cold outreach email for an AI chatbot product.

Company: ${data.lead.companyName}
Industry: ${data.lead.industry}
Location: ${data.lead.city}
Contact: ${data.contact.firstName} ${data.contact.lastName}, ${data.contact.position}

Research Insights:
- Recent Event: ${data.research.recentNews || 'Growing business in the area'}
- Pain Point: ${data.research.painPoints[0] || 'Managing customer inquiries efficiently'}
- Growth Signal: ${data.research.growthIndicator || 'Expanding operations'}
- Unique Aspect: ${data.research.uniqueAspect || `Leading ${data.lead.industry} provider`}
- Website Tone: ${data.research.websiteTone}

Personalization Level: ${depthInstructions[depth]}

IMPORTANT Anti-Creepiness Rules:
- Only reference publicly visible information (homepage, main services)
- Write as if you briefly looked at their website, not studied it
- Don't mention specific employees, exact numbers, or deep pages
- Focus on being helpful, not showing off research

Email Requirements:
1. ${depth === 'heavy' ? 'Open with specific reference to their business' : 'Open with industry context'}
2. Connect their situation to our AI chatbot solution naturally
3. Include ONE specific benefit: ${data.calculated.localCompetitorAdvantage}
4. Keep under 150 words
5. End with low-commitment CTA: "Worth a quick chat?" or "Interested in learning more?"
6. Match their website tone: ${data.research.websiteTone}

Write ONLY the email body (no subject line). Make it feel natural and helpful, not salesy.`;
  }

  async generateSubjectLine(personalizationData, campaign) {
    const variants = [
      `Quick question about ${personalizationData.lead.companyName}`,
      `${personalizationData.research.painPoints[0] || 'Customer service'} solution for ${personalizationData.lead.companyName}`,
      `Helping ${personalizationData.lead.industry} businesses in ${personalizationData.lead.city}`,
      `${personalizationData.lead.companyName} - 24/7 customer support idea`
    ];

    if (campaign.ab_testing_enabled) {
      return variants[Math.floor(Math.random() * variants.length)];
    }

    return variants[0];
  }

  async performQualityCheck(emailContent, personalizationData) {
    const checks = {
      passed: true,
      issues: []
    };

    if (!emailContent.body.includes(personalizationData.lead.companyName)) {
      checks.issues.push('Missing company name');
      checks.passed = false;
    }

    const genericPhrases = [
      'I hope this email finds you well',
      'I wanted to reach out',
      'I came across your company',
      'cutting-edge solution',
      'revolutionary'
    ];

    for (const phrase of genericPhrases) {
      if (emailContent.body.toLowerCase().includes(phrase.toLowerCase())) {
        checks.issues.push(`Generic phrase detected: "${phrase}"`);
        checks.passed = false;
      }
    }

    for (const neverMention of this.antiCreepinessRules.neverMention) {
      if (this.checkForCreepyContent(emailContent.body, neverMention)) {
        checks.issues.push(`Too specific/creepy content detected: ${neverMention}`);
        checks.passed = false;
      }
    }

    if (emailContent.body.length > 1000) {
      checks.issues.push('Email too long');
      checks.passed = false;
    }

    if (emailContent.body.split(' ').length > 150) {
      checks.issues.push('Exceeds 150 word limit');
    }

    return checks;
  }

  checkForCreepyContent(emailBody, rule) {
    const creepyPatterns = {
      'specific_employee_names': /\b(Sarah|John|Mike|Jennifer)\b/gi,
      'exact_revenue': /\$[\d,]+\s*(million|billion|k)/gi,
      'old_news': /\b(2021|2022|last year|two years ago)\b/gi,
      'deep_website_pages': /page \d+|section \d+|buried|deep in/gi
    };

    if (creepyPatterns[rule]) {
      return creepyPatterns[rule].test(emailBody);
    }
    
    return false;
  }

  async regenerateEmail(personalizationData, campaign, issues) {
    const regenerationPrompt = `Previous email had these issues: ${issues.join(', ')}

Please regenerate the email avoiding these problems.

${this.buildEmailPrompt(personalizationData, campaign.templates[0], 'medium')}`;

    const regenerated = await this.callAI(regenerationPrompt, 'email');
    
    return {
      subject: await this.generateSubjectLine(personalizationData, campaign),
      body: regenerated,
      regenerated: true,
      originalIssues: issues,
      generatedAt: new Date().toISOString()
    };
  }

  async callAI(prompt, type = 'email') {
    try {
      const response = await this.groq.chat.completions.create({
        model: this.aiModel,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: type === 'email' ? 500 : 1000,
        temperature: type === 'email' ? 0.7 : 0.3,
        // Groq is super fast - no need for streaming
        stream: false
      });
      
      return response.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('Groq API error:', error);
      throw error;
    }
  }

  selectPersonalizationDepth(campaign) {
    if (!campaign.ab_testing_enabled) {
      return 'medium';
    }
    
    const weights = { heavy: 0.33, medium: 0.34, light: 0.33 };
    const random = Math.random();
    let accumulator = 0;
    
    for (const [depth, weight] of Object.entries(weights)) {
      accumulator += weight;
      if (random <= accumulator) {
        return depth;
      }
    }
    
    return 'medium';
  }

  selectTemplate(campaign, personalizationData) {
    if (!campaign.email_templates || campaign.email_templates.length === 0) {
      return this.getDefaultTemplate(personalizationData.lead.industry);
    }
    
    return campaign.email_templates[0];
  }

  getDefaultTemplate(industry) {
    return {
      id: 'default',
      type: 'cold_email',
      industry: industry,
      tone: 'professional_friendly'
    };
  }

  calculateMissedLeads(lead) {
    const businessHours = 40;
    const totalHours = 168;
    const afterHoursPercentage = (totalHours - businessHours) / totalHours;
    
    return Math.round(afterHoursPercentage * 100);
  }

  calculateCostSavings(lead) {
    const avgCustomerServiceSalary = 35000;
    const chatbotCost = 5000;
    const savings = avgCustomerServiceSalary - chatbotCost;
    
    return `$${(savings / 1000).toFixed(0)}k annually`;
  }

  async getLeadData(leadId) {
    const result = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    return result.rows[0];
  }

  async getContactData(contactId) {
    const result = await query('SELECT * FROM contacts WHERE id = $1', [contactId]);
    return result.rows[0];
  }

  async getCampaignData(campaignId) {
    const result = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    return result.rows[0];
  }

  async getExistingResearch(leadId) {
    const result = await query(
      'SELECT * FROM company_research WHERE lead_id = $1 ORDER BY research_date DESC LIMIT 1',
      [leadId]
    );
    return result.rows[0];
  }

  isResearchFresh(researchDate) {
    if (!researchDate) return false;
    
    const daysSinceResearch = (new Date() - new Date(researchDate)) / (1000 * 60 * 60 * 24);
    return daysSinceResearch < 7;
  }

  async saveResearch(leadId, research) {
    await query(
      `INSERT INTO company_research (
        lead_id, website_content, recent_news, job_postings,
        customer_reviews, social_media_activity, pain_points,
        growth_indicators, unique_aspects, website_tone,
        seasonal_patterns, ai_insights
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (lead_id) DO UPDATE SET
        website_content = $2, recent_news = $3, job_postings = $4,
        customer_reviews = $5, social_media_activity = $6,
        pain_points = $7, growth_indicators = $8, unique_aspects = $9,
        website_tone = $10, seasonal_patterns = $11, ai_insights = $12,
        research_date = NOW()`,
      [
        leadId,
        JSON.stringify(research.websiteContent),
        JSON.stringify(research.recentNews),
        JSON.stringify(research.jobPostings),
        JSON.stringify(research.customerReviews),
        JSON.stringify(research.socialMedia),
        research.painPoints,
        research.growthIndicators,
        research.uniqueAspects,
        research.websiteTone,
        JSON.stringify(research.seasonalPatterns),
        JSON.stringify(research.aiInsights || {})
      ]
    );
  }

  async fetchPage(url) {
    try {
      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LeadGenBot/1.0)'
        }
      });
      return response.data;
    } catch (error) {
      return null;
    }
  }

  async aggregateReviews(lead) {
    return {
      themes: ['response time', 'availability', 'customer service'],
      averageRating: 4.2,
      totalReviews: 47
    };
  }

  async analyzeSocialMedia(socialProfiles) {
    return {
      lastPostDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      postingFrequency: 'weekly',
      engagement: 'moderate'
    };
  }
}

export default new EmailGenerationService();