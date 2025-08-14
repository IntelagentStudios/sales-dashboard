import axios from 'axios';
import { query } from '../config/database.js';
import { cache } from '../config/redis.js';
import { queues } from '../config/queue.js';

class LeadEnrichmentService {
  constructor() {
    this.apis = {
      clearbit: {
        key: process.env.CLEARBIT_API_KEY,
        baseUrl: 'https://company.clearbit.com/v2'
      },
      hunter: {
        key: process.env.HUNTER_API_KEY,
        baseUrl: 'https://api.hunter.io/v2'
      },
      apollo: {
        key: process.env.APOLLO_API_KEY,
        baseUrl: 'https://api.apollo.io/v1'
      },
      peopleDataLabs: {
        key: process.env.PEOPLEDATALABS_API_KEY,
        baseUrl: 'https://api.peopledatalabs.com/v5'
      }
    };
  }

  async enrichLead(leadId) {
    try {
      const lead = await this.getLeadById(leadId);
      if (!lead) {
        throw new Error(`Lead ${leadId} not found`);
      }

      const cacheKey = `enrichment:${lead.website_url}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        await this.updateLeadEnrichment(leadId, cached);
        return cached;
      }

      const enrichmentData = await this.gatherEnrichmentData(lead);
      
      await this.updateLeadEnrichment(leadId, enrichmentData);
      await cache.set(cacheKey, enrichmentData, 86400);

      if (enrichmentData.contacts && enrichmentData.contacts.length > 0) {
        await this.saveContacts(leadId, enrichmentData.contacts);
      }

      await queues.leadScoring.add('score', { leadId }, { delay: 5000 });

      return enrichmentData;
    } catch (error) {
      console.error(`Error enriching lead ${leadId}:`, error);
      throw error;
    }
  }

  async gatherEnrichmentData(lead) {
    const enrichmentData = {
      company: {},
      contacts: [],
      technology: {},
      social: {}
    };

    const enrichmentPromises = [
      this.enrichFromClearbit(lead.website_url),
      this.enrichFromHunter(lead.website_url),
      this.enrichFromApollo(lead.company_name, lead.website_url),
      this.enrichFromPeopleDataLabs(lead.company_name, lead.website_url)
    ];

    const results = await Promise.allSettled(enrichmentPromises);

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        
        if (index === 0 && data.clearbit) {
          Object.assign(enrichmentData.company, data.clearbit.company);
          Object.assign(enrichmentData.technology, data.clearbit.tech);
        } else if (index === 1 && data.hunter) {
          enrichmentData.contacts.push(...(data.hunter.contacts || []));
        } else if (index === 2 && data.apollo) {
          Object.assign(enrichmentData.company, data.apollo.company);
          enrichmentData.contacts.push(...(data.apollo.contacts || []));
        } else if (index === 3 && data.pdl) {
          Object.assign(enrichmentData.company, data.pdl.company);
        }
      }
    });

    enrichmentData.contacts = this.deduplicateContacts(enrichmentData.contacts);
    enrichmentData.contacts = await this.verifyEmails(enrichmentData.contacts);

    return enrichmentData;
  }

  async enrichFromClearbit(websiteUrl) {
    if (!this.apis.clearbit.key) return null;

    try {
      const domain = this.extractDomain(websiteUrl);
      const response = await axios.get(`${this.apis.clearbit.baseUrl}/companies/find`, {
        params: { domain },
        headers: { 'Authorization': `Bearer ${this.apis.clearbit.key}` }
      });

      return {
        clearbit: {
          company: {
            name: response.data.name,
            description: response.data.description,
            employee_range: response.data.metrics?.employeesRange,
            estimated_revenue: response.data.metrics?.estimatedAnnualRevenue,
            founded_year: response.data.foundedYear,
            industry: response.data.category?.industry,
            sub_industry: response.data.category?.subIndustry,
            tags: response.data.tags
          },
          tech: {
            technologies: response.data.tech || []
          },
          social: {
            linkedin: response.data.linkedin?.handle,
            twitter: response.data.twitter?.handle,
            facebook: response.data.facebook?.handle
          }
        }
      };
    } catch (error) {
      console.error('Clearbit enrichment error:', error.message);
      return null;
    }
  }

  async enrichFromHunter(websiteUrl) {
    if (!this.apis.hunter.key) return null;

    try {
      const domain = this.extractDomain(websiteUrl);
      const response = await axios.get(`${this.apis.hunter.baseUrl}/domain-search`, {
        params: {
          domain,
          api_key: this.apis.hunter.key,
          limit: 10
        }
      });

      const contacts = response.data.data.emails.map(email => ({
        email: email.value,
        email_score: email.confidence,
        first_name: email.first_name,
        last_name: email.last_name,
        position: email.position,
        department: email.department,
        linkedin_url: email.linkedin,
        email_provider: 'hunter',
        is_decision_maker: this.isDecisionMaker(email.position)
      }));

      return { hunter: { contacts } };
    } catch (error) {
      console.error('Hunter enrichment error:', error.message);
      return null;
    }
  }

  async enrichFromApollo(companyName, websiteUrl) {
    if (!this.apis.apollo.key) return null;

    try {
      const searchResponse = await axios.post(
        `${this.apis.apollo.baseUrl}/organizations/search`,
        {
          organization_name: companyName,
          website_url: websiteUrl,
          limit: 1
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apis.apollo.key
          }
        }
      );

      if (!searchResponse.data.organizations || searchResponse.data.organizations.length === 0) {
        return null;
      }

      const org = searchResponse.data.organizations[0];
      const orgId = org.id;

      const peopleResponse = await axios.post(
        `${this.apis.apollo.baseUrl}/people/search`,
        {
          organization_ids: [orgId],
          titles: ['CEO', 'Owner', 'President', 'Marketing Director', 'Operations Manager', 'Sales Director'],
          limit: 5
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apis.apollo.key
          }
        }
      );

      const contacts = peopleResponse.data.people.map(person => ({
        first_name: person.first_name,
        last_name: person.last_name,
        email: person.email,
        position: person.title,
        seniority_level: person.seniority,
        department: person.departments?.join(', '),
        linkedin_url: person.linkedin_url,
        is_decision_maker: this.isDecisionMaker(person.title),
        email_provider: 'apollo'
      }));

      return {
        apollo: {
          company: {
            name: org.name,
            employee_range: org.estimated_num_employees,
            industry: org.industry,
            description: org.short_description,
            founded_year: org.founded_year,
            city: org.city,
            state_province: org.state,
            country: org.country
          },
          contacts
        }
      };
    } catch (error) {
      console.error('Apollo enrichment error:', error.message);
      return null;
    }
  }

  async enrichFromPeopleDataLabs(companyName, websiteUrl) {
    if (!this.apis.peopleDataLabs.key) return null;

    try {
      const response = await axios.get(`${this.apis.peopleDataLabs.baseUrl}/company/enrich`, {
        params: {
          name: companyName,
          website: websiteUrl,
          pretty: true
        },
        headers: {
          'X-API-Key': this.apis.peopleDataLabs.key
        }
      });

      return {
        pdl: {
          company: {
            name: response.data.name,
            description: response.data.description,
            employee_range: response.data.employee_count_by_country?.total,
            founded_year: response.data.founded,
            industry: response.data.industry,
            tags: response.data.tags,
            social_profiles: {
              linkedin: response.data.linkedin_url,
              twitter: response.data.twitter_url,
              facebook: response.data.facebook_url
            }
          }
        }
      };
    } catch (error) {
      console.error('PeopleDataLabs enrichment error:', error.message);
      return null;
    }
  }

  async verifyEmails(contacts) {
    if (!process.env.NEVERBOUNCE_API_KEY) return contacts;

    const verifiedContacts = [];
    
    for (const contact of contacts) {
      try {
        const response = await axios.get('https://api.neverbounce.com/v4/single/check', {
          params: {
            key: process.env.NEVERBOUNCE_API_KEY,
            email: contact.email
          }
        });

        if (response.data.result !== 'invalid') {
          verifiedContacts.push({
            ...contact,
            email_verified: true,
            email_score: response.data.result === 'valid' ? 100 : 
                        response.data.result === 'catchall' ? 75 : 50
          });
        }
      } catch (error) {
        console.error(`Email verification error for ${contact.email}:`, error.message);
        verifiedContacts.push(contact);
      }
    }

    return verifiedContacts;
  }

  async saveContacts(leadId, contacts) {
    for (const contact of contacts) {
      try {
        const existingContact = await query(
          'SELECT id FROM contacts WHERE email = $1',
          [contact.email]
        );

        if (existingContact.rows.length === 0) {
          const insertQuery = `
            INSERT INTO contacts (
              lead_id, first_name, last_name, full_name, email,
              email_verified, email_score, email_provider, position,
              seniority_level, department, is_decision_maker,
              linkedin_url, twitter_url, phone, role_confidence
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id
          `;

          const values = [
            leadId,
            contact.first_name || null,
            contact.last_name || null,
            contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
            contact.email,
            contact.email_verified || false,
            contact.email_score || null,
            contact.email_provider || null,
            contact.position || null,
            contact.seniority_level || null,
            contact.department || null,
            contact.is_decision_maker || false,
            contact.linkedin_url || null,
            contact.twitter_url || null,
            contact.phone || null,
            contact.role_confidence || null
          ];

          await query(insertQuery, values);
        }
      } catch (error) {
        console.error('Error saving contact:', error);
      }
    }
  }

  async updateLeadEnrichment(leadId, enrichmentData) {
    const updateQuery = `
      UPDATE leads SET
        company_size = COALESCE($1, company_size),
        employee_range = COALESCE($2, employee_range),
        estimated_revenue = COALESCE($3, estimated_revenue),
        founded_year = COALESCE($4, founded_year),
        company_description = COALESCE($5, company_description),
        industry = COALESCE($6, industry),
        sub_industry = COALESCE($7, sub_industry),
        website_technology = COALESCE($8, website_technology),
        social_profiles = COALESCE($9, social_profiles),
        tags = COALESCE($10, tags),
        last_enriched_at = NOW()
      WHERE id = $11
    `;

    const values = [
      enrichmentData.company.company_size || null,
      enrichmentData.company.employee_range || null,
      enrichmentData.company.estimated_revenue || null,
      enrichmentData.company.founded_year || null,
      enrichmentData.company.description || null,
      enrichmentData.company.industry || null,
      enrichmentData.company.sub_industry || null,
      JSON.stringify(enrichmentData.technology || {}),
      JSON.stringify(enrichmentData.social || {}),
      enrichmentData.company.tags || [],
      leadId
    ];

    await query(updateQuery, values);
  }

  async getLeadById(leadId) {
    const result = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    return result.rows[0];
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    }
  }

  isDecisionMaker(position) {
    if (!position) return false;
    
    const decisionMakerTitles = [
      'ceo', 'owner', 'founder', 'president', 'director',
      'vp', 'vice president', 'head', 'chief', 'manager',
      'partner', 'principal'
    ];
    
    const lowerPosition = position.toLowerCase();
    return decisionMakerTitles.some(title => lowerPosition.includes(title));
  }

  deduplicateContacts(contacts) {
    const seen = new Set();
    return contacts.filter(contact => {
      if (!contact.email || seen.has(contact.email)) {
        return false;
      }
      seen.add(contact.email);
      return true;
    });
  }
}

export default new LeadEnrichmentService();