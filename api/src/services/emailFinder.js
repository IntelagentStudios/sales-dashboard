import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class EmailFinderService {
  constructor() {
    // Primary email finding services
    this.hunterApiKey = process.env.HUNTER_API_KEY;
    this.apolloApiKey = process.env.APOLLO_API_KEY;
    this.clearbitApiKey = process.env.CLEARBIT_API_KEY;
    this.peopleDataLabsApiKey = process.env.PEOPLEDATALABS_API_KEY;
    
    // Email verification services
    this.neverBounceApiKey = process.env.NEVERBOUNCE_API_KEY;
    this.emailListVerifyApiKey = process.env.EMAILLISTVERIFY_API_KEY;
  }

  /**
   * Main method to find emails for a lead
   */
  async findEmailsForLead(leadId) {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: { contacts: true }
      });

      if (!lead) {
        throw new Error('Lead not found');
      }

      console.log(`Finding emails for ${lead.companyName}`);

      // Try multiple methods to find emails
      const emails = new Set();
      
      // 1. Try Hunter.io
      if (this.hunterApiKey) {
        const hunterEmails = await this.findWithHunter(lead.websiteUrl, lead.companyName);
        hunterEmails.forEach(email => emails.add(JSON.stringify(email)));
      }

      // 2. Try Apollo
      if (this.apolloApiKey) {
        const apolloEmails = await this.findWithApollo(lead.companyName, lead.websiteUrl);
        apolloEmails.forEach(email => emails.add(JSON.stringify(email)));
      }

      // 3. Try Clearbit
      if (this.clearbitApiKey) {
        const clearbitEmails = await this.findWithClearbit(lead.websiteUrl);
        clearbitEmails.forEach(email => emails.add(JSON.stringify(email)));
      }

      // 4. Try PeopleDataLabs
      if (this.peopleDataLabsApiKey) {
        const pdlEmails = await this.findWithPeopleDataLabs(lead.companyName, lead.websiteUrl);
        pdlEmails.forEach(email => emails.add(JSON.stringify(email)));
      }

      // 5. Try pattern-based email generation
      const patternEmails = await this.generatePatternEmails(lead.websiteUrl);
      patternEmails.forEach(email => emails.add(JSON.stringify(email)));

      // Convert back from JSON strings to objects
      const uniqueEmails = Array.from(emails).map(str => JSON.parse(str));

      // Verify emails if verification service is available
      const verifiedEmails = await this.verifyEmails(uniqueEmails);

      // Save contacts to database
      await this.saveContacts(leadId, verifiedEmails);

      return verifiedEmails;
    } catch (error) {
      console.error(`Error finding emails for lead ${leadId}:`, error);
      throw error;
    }
  }

  /**
   * Find emails using Hunter.io
   */
  async findWithHunter(domain, companyName) {
    try {
      const emails = [];
      
      // Extract domain from URL
      const cleanDomain = this.extractDomain(domain);
      
      // Domain search to find all emails
      const domainSearchUrl = 'https://api.hunter.io/v2/domain-search';
      const domainResponse = await axios.get(domainSearchUrl, {
        params: {
          domain: cleanDomain,
          api_key: this.hunterApiKey
        }
      });

      if (domainResponse.data.data.emails) {
        domainResponse.data.data.emails.forEach(email => {
          emails.push({
            email: email.value,
            firstName: email.first_name,
            lastName: email.last_name,
            position: email.position,
            department: email.department,
            confidence: email.confidence,
            source: 'hunter.io',
            verificationStatus: email.verification?.status || 'unknown'
          });
        });
      }

      // Also try email finder for common roles
      const roles = ['CEO', 'owner', 'sales', 'marketing', 'founder'];
      
      for (const role of roles) {
        try {
          const finderUrl = 'https://api.hunter.io/v2/email-finder';
          const finderResponse = await axios.get(finderUrl, {
            params: {
              domain: cleanDomain,
              company: companyName,
              full_name: role,
              api_key: this.hunterApiKey
            }
          });

          if (finderResponse.data.data.email) {
            emails.push({
              email: finderResponse.data.data.email,
              position: role,
              confidence: finderResponse.data.data.score,
              source: 'hunter.io',
              verificationStatus: finderResponse.data.data.verification?.status || 'unknown'
            });
          }
        } catch (err) {
          // Ignore individual role lookup failures
        }
      }

      return emails;
    } catch (error) {
      console.error('Hunter.io error:', error.message);
      return [];
    }
  }

  /**
   * Find emails using Apollo.io
   */
  async findWithApollo(companyName, websiteUrl) {
    try {
      const emails = [];
      
      // Search for organization
      const orgSearchUrl = 'https://api.apollo.io/v1/organizations/search';
      const orgResponse = await axios.post(orgSearchUrl, {
        api_key: this.apolloApiKey,
        q_organization_name: companyName,
        q_organization_domain: this.extractDomain(websiteUrl)
      });

      if (orgResponse.data.organizations && orgResponse.data.organizations.length > 0) {
        const orgId = orgResponse.data.organizations[0].id;
        
        // Search for people in the organization
        const peopleSearchUrl = 'https://api.apollo.io/v1/mixed_people/search';
        const peopleResponse = await axios.post(peopleSearchUrl, {
          api_key: this.apolloApiKey,
          q_organization_ids: [orgId],
          page: 1,
          per_page: 10
        });

        if (peopleResponse.data.people) {
          peopleResponse.data.people.forEach(person => {
            if (person.email) {
              emails.push({
                email: person.email,
                firstName: person.first_name,
                lastName: person.last_name,
                position: person.title,
                department: person.departments?.join(', '),
                linkedIn: person.linkedin_url,
                source: 'apollo.io',
                confidence: person.email_confidence || 85
              });
            }
          });
        }
      }

      return emails;
    } catch (error) {
      console.error('Apollo.io error:', error.message);
      return [];
    }
  }

  /**
   * Find emails using Clearbit
   */
  async findWithClearbit(websiteUrl) {
    try {
      const emails = [];
      const domain = this.extractDomain(websiteUrl);
      
      // Prospector API to find people
      const prospectorUrl = 'https://prospector.clearbit.com/v1/people/search';
      const response = await axios.get(prospectorUrl, {
        params: {
          domain: domain,
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${this.clearbitApiKey}`
        }
      });

      if (response.data && response.data.results) {
        response.data.results.forEach(person => {
          if (person.email) {
            emails.push({
              email: person.email,
              firstName: person.name?.givenName,
              lastName: person.name?.familyName,
              position: person.title,
              seniority: person.seniority,
              source: 'clearbit',
              confidence: 90
            });
          }
        });
      }

      return emails;
    } catch (error) {
      console.error('Clearbit error:', error.message);
      return [];
    }
  }

  /**
   * Find emails using PeopleDataLabs
   */
  async findWithPeopleDataLabs(companyName, websiteUrl) {
    try {
      const emails = [];
      
      // Search for people at the company
      const searchUrl = 'https://api.peopledatalabs.com/v5/person/search';
      const response = await axios.post(searchUrl, {
        sql: `SELECT * FROM person WHERE company.name = '${companyName}' OR company.website = '${websiteUrl}'`,
        size: 10,
        pretty: true
      }, {
        headers: {
          'X-Api-Key': this.peopleDataLabsApiKey
        }
      });

      if (response.data && response.data.data) {
        response.data.data.forEach(person => {
          if (person.work_email || person.personal_emails?.length > 0) {
            const email = person.work_email || person.personal_emails[0];
            emails.push({
              email: email,
              firstName: person.first_name,
              lastName: person.last_name,
              position: person.job_title,
              company: person.job_company_name,
              linkedIn: person.linkedin_url,
              source: 'peopledatalabs',
              confidence: person.work_email ? 95 : 70
            });
          }
        });
      }

      return emails;
    } catch (error) {
      console.error('PeopleDataLabs error:', error.message);
      return [];
    }
  }

  /**
   * Generate emails based on common patterns
   */
  async generatePatternEmails(websiteUrl) {
    const domain = this.extractDomain(websiteUrl);
    if (!domain) return [];

    const patterns = [];
    const commonRoles = ['info', 'contact', 'sales', 'hello', 'support', 'admin'];
    const commonNames = [
      { first: 'john', last: 'smith' },
      { first: 'jane', last: 'doe' },
      { first: 'michael', last: 'johnson' },
      { first: 'sarah', last: 'williams' }
    ];

    // Generic role-based emails
    commonRoles.forEach(role => {
      patterns.push({
        email: `${role}@${domain}`,
        position: role,
        type: 'generic',
        source: 'pattern',
        confidence: 30
      });
    });

    // Common name patterns (lower confidence)
    commonNames.forEach(name => {
      patterns.push({
        email: `${name.first}@${domain}`,
        firstName: name.first,
        lastName: name.last,
        source: 'pattern',
        confidence: 15
      });
      patterns.push({
        email: `${name.first}.${name.last}@${domain}`,
        firstName: name.first,
        lastName: name.last,
        source: 'pattern',
        confidence: 15
      });
      patterns.push({
        email: `${name.first[0]}${name.last}@${domain}`,
        firstName: name.first,
        lastName: name.last,
        source: 'pattern',
        confidence: 10
      });
    });

    return patterns;
  }

  /**
   * Verify emails using available services
   */
  async verifyEmails(emails) {
    if (!this.neverBounceApiKey && !this.emailListVerifyApiKey) {
      // No verification service available, return emails with unknown status
      return emails.map(email => ({
        ...email,
        verificationStatus: email.verificationStatus || 'unverified'
      }));
    }

    const verifiedEmails = [];

    for (const emailData of emails) {
      let verified = false;
      let status = 'unverified';

      // Try NeverBounce first
      if (this.neverBounceApiKey) {
        try {
          const response = await axios.post('https://api.neverbounce.com/v4/single/check', {
            email: emailData.email,
            api_key: this.neverBounceApiKey
          });

          if (response.data.result === 'valid') {
            verified = true;
            status = 'valid';
          } else if (response.data.result === 'invalid') {
            status = 'invalid';
          } else {
            status = response.data.result;
          }
        } catch (error) {
          console.error('NeverBounce verification error:', error.message);
        }
      }

      // If not verified and EmailListVerify is available, try it
      if (!verified && this.emailListVerifyApiKey) {
        try {
          const response = await axios.get('https://apps.emaillistverify.com/api/verifyEmail', {
            params: {
              secret: this.emailListVerifyApiKey,
              email: emailData.email
            }
          });

          if (response.data === 'ok' || response.data === 'ok_for_all') {
            verified = true;
            status = 'valid';
          } else if (response.data === 'error') {
            status = 'invalid';
          } else {
            status = response.data;
          }
        } catch (error) {
          console.error('EmailListVerify error:', error.message);
        }
      }

      // Only include emails with reasonable confidence or verified status
      if (verified || emailData.confidence >= 30 || emailData.verificationStatus === 'valid') {
        verifiedEmails.push({
          ...emailData,
          verificationStatus: status,
          verified: verified
        });
      }
    }

    return verifiedEmails;
  }

  /**
   * Save contacts to database
   */
  async saveContacts(leadId, emails) {
    const savedContacts = [];

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
          const contact = await prisma.contact.create({
            data: {
              leadId: leadId,
              email: emailData.email,
              firstName: emailData.firstName || null,
              lastName: emailData.lastName || null,
              position: emailData.position || null,
              department: emailData.department || null,
              seniority: emailData.seniority || null,
              linkedinUrl: emailData.linkedIn || null,
              confidence: emailData.confidence || 50,
              verificationStatus: emailData.verificationStatus || 'unverified',
              source: emailData.source || 'unknown',
              isValid: emailData.verificationStatus === 'valid',
              isPrimary: emailData.position?.toLowerCase().includes('ceo') || 
                        emailData.position?.toLowerCase().includes('owner') ||
                        emailData.position?.toLowerCase().includes('founder')
            }
          });

          savedContacts.push(contact);
        }
      } catch (error) {
        console.error(`Error saving contact ${emailData.email}:`, error);
      }
    }

    // Update lead with contact count
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        contactsFound: savedContacts.length,
        hasValidEmails: savedContacts.some(c => c.isValid),
        lastEnrichedAt: new Date()
      }
    });

    console.log(`Saved ${savedContacts.length} contacts for lead ${leadId}`);
    return savedContacts;
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    if (!url) return null;
    
    try {
      // Add protocol if missing
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      // Try to extract from string
      return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  /**
   * Enrich contact with additional information
   */
  async enrichContact(contactId) {
    try {
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        include: { lead: true }
      });

      if (!contact) {
        throw new Error('Contact not found');
      }

      const enrichedData = {};

      // Try to enrich with Clearbit
      if (this.clearbitApiKey) {
        try {
          const response = await axios.get(`https://person.clearbit.com/v2/people/find`, {
            params: {
              email: contact.email
            },
            headers: {
              'Authorization': `Bearer ${this.clearbitApiKey}`
            }
          });

          if (response.data) {
            enrichedData.firstName = response.data.name?.givenName || contact.firstName;
            enrichedData.lastName = response.data.name?.familyName || contact.lastName;
            enrichedData.position = response.data.employment?.title || contact.position;
            enrichedData.seniority = response.data.employment?.seniority || contact.seniority;
            enrichedData.linkedinUrl = response.data.linkedin?.handle ? 
              `https://linkedin.com/in/${response.data.linkedin.handle}` : contact.linkedinUrl;
            enrichedData.location = response.data.location || contact.location;
            enrichedData.bio = response.data.bio;
          }
        } catch (error) {
          console.error('Clearbit enrichment error:', error.message);
        }
      }

      // Update contact with enriched data
      if (Object.keys(enrichedData).length > 0) {
        await prisma.contact.update({
          where: { id: contactId },
          data: enrichedData
        });
      }

      return { ...contact, ...enrichedData };
    } catch (error) {
      console.error(`Error enriching contact ${contactId}:`, error);
      throw error;
    }
  }

  /**
   * Score email quality
   */
  scoreEmailQuality(email) {
    let score = 50; // Base score

    // Increase score for professional emails
    if (email.verificationStatus === 'valid') score += 30;
    if (email.firstName && email.lastName) score += 10;
    if (email.position) score += 10;
    
    // Decision maker positions
    const decisionMakerKeywords = ['ceo', 'owner', 'founder', 'president', 'director', 'manager', 'head'];
    if (email.position && decisionMakerKeywords.some(keyword => 
      email.position.toLowerCase().includes(keyword))) {
      score += 20;
    }

    // Source reliability
    const sourceScores = {
      'hunter.io': 15,
      'apollo.io': 15,
      'clearbit': 20,
      'peopledatalabs': 15,
      'pattern': -10,
      'unknown': 0
    };
    score += sourceScores[email.source] || 0;

    // Generic emails are less valuable
    const genericPatterns = ['info@', 'contact@', 'sales@', 'support@', 'hello@', 'admin@'];
    if (genericPatterns.some(pattern => email.email.startsWith(pattern))) {
      score -= 20;
    }

    // Cap score at 100
    return Math.min(Math.max(score, 0), 100);
  }
}

export default EmailFinderService;