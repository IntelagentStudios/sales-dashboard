/**
 * Integration Examples for Unified Enrichment Service
 * 
 * This file demonstrates how to integrate the enrichment service
 * with your existing sales-agent or other applications.
 */

import axios from 'axios';
import { enrichCompany, EmailFinder, WebScraper, CompanyEnricher } from '../src/index.js';

// ============================================
// Example 1: Using REST API
// ============================================

async function enrichViaAPI(domain) {
  const API_URL = process.env.ENRICHMENT_API_URL || 'http://localhost:3001';
  const API_KEY = process.env.ENRICHMENT_API_KEY; // Optional API key
  
  try {
    // Full enrichment
    const response = await axios.post(
      `${API_URL}/api/enrich/company`,
      {
        domain: domain,
        type: 'full',
        options: {
          includeEmails: true,
          includeScraping: true,
          includeEnrichment: true,
          maxPages: 10,
          useCache: true
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY // If API key is required
        }
      }
    );
    
    // Check job status if async
    if (response.data.jobId) {
      return await checkJobStatus(API_URL, response.data.jobId);
    }
    
    return response.data;
    
  } catch (error) {
    console.error('API enrichment failed:', error.message);
    throw error;
  }
}

async function checkJobStatus(apiUrl, jobId) {
  let attempts = 0;
  const maxAttempts = 30;
  const delayMs = 2000;
  
  while (attempts < maxAttempts) {
    try {
      const response = await axios.get(`${apiUrl}/api/enrich/status/${jobId}`);
      
      if (response.data.job.status === 'completed') {
        return response.data.job.result;
      } else if (response.data.job.status === 'failed') {
        throw new Error(response.data.job.error || 'Enrichment failed');
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempts++;
      
    } catch (error) {
      console.error('Error checking job status:', error.message);
      throw error;
    }
  }
  
  throw new Error('Job timeout - enrichment took too long');
}

// ============================================
// Example 2: Direct Function Import
// ============================================

async function enrichDirectly(domain) {
  try {
    const result = await enrichCompany(domain, {
      includeEmails: true,
      includeScraping: true,
      includeEnrichment: true,
      maxPages: 10
    });
    
    return result;
    
  } catch (error) {
    console.error('Direct enrichment failed:', error.message);
    throw error;
  }
}

// ============================================
// Example 3: Using Individual Modules
// ============================================

async function customEnrichment(domain) {
  const emailFinder = new EmailFinder();
  const webScraper = new WebScraper({ maxPages: 5 });
  const companyEnricher = new CompanyEnricher();
  
  try {
    // Step 1: Scrape website
    console.log('Scraping website...');
    const scrapedData = await webScraper.scrapeWebsite(domain);
    
    // Step 2: Find emails from scraped content
    console.log('Finding emails...');
    const allContent = scrapedData.pages
      .map(page => page.textContent || '')
      .join(' ');
    
    const emails = await emailFinder.findEmails(domain, allContent);
    
    // Step 3: Extract team member names for additional email generation
    const teamNames = extractTeamNames(scrapedData);
    const nameBasedEmails = await emailFinder.findEmailsFromNames(domain, teamNames);
    
    // Step 4: Enrich company data
    console.log('Enriching company data...');
    const enrichedData = await companyEnricher.enrichCompany(domain, scrapedData);
    
    // Step 5: Close browser
    await webScraper.close();
    
    // Combine results
    return {
      domain,
      emails: {
        scraped: emails,
        nameBased: nameBasedEmails,
        total: emails.totalFound + nameBasedEmails.length
      },
      company: enrichedData,
      scrapedPages: scrapedData.pages.length
    };
    
  } catch (error) {
    console.error('Custom enrichment failed:', error.message);
    await webScraper.close();
    throw error;
  }
}

function extractTeamNames(scrapedData) {
  const names = [];
  
  // Look for team/about pages
  const teamPages = scrapedData.pages.filter(page => 
    page.path.includes('team') || 
    page.path.includes('about') ||
    page.path.includes('people')
  );
  
  teamPages.forEach(page => {
    // Simple name extraction (customize based on your needs)
    const namePattern = /(?:[A-Z][a-z]+ [A-Z][a-z]+)/g;
    const matches = page.textContent?.match(namePattern) || [];
    names.push(...matches);
  });
  
  // Remove duplicates
  return [...new Set(names)];
}

// ============================================
// Example 4: Integration with Sales Agent
// ============================================

class EnrichedLeadProcessor {
  constructor(enrichmentService) {
    this.enrichmentService = enrichmentService;
  }
  
  async processLead(lead) {
    try {
      // Extract domain from email or website
      const domain = this.extractDomain(lead.email || lead.website);
      
      if (!domain) {
        console.log('No domain found for lead:', lead.id);
        return lead;
      }
      
      // Enrich the lead
      const enrichmentData = await this.enrichmentService(domain);
      
      // Merge enrichment data with lead
      const enrichedLead = {
        ...lead,
        enrichment: {
          emails: enrichmentData.emails,
          company: enrichmentData.enrichedData,
          scrapedAt: new Date().toISOString()
        },
        // Update lead fields with enriched data
        companyName: enrichmentData.enrichedData?.basicInfo?.name || lead.companyName,
        industry: enrichmentData.enrichedData?.basicInfo?.industry || lead.industry,
        companySize: enrichmentData.enrichedData?.basicInfo?.companySize?.label || lead.companySize,
        location: enrichmentData.enrichedData?.basicInfo?.location || lead.location,
        techStack: enrichmentData.enrichedData?.techStack || lead.techStack
      };
      
      // Score the lead based on enrichment
      enrichedLead.score = this.calculateLeadScore(enrichedLead);
      
      return enrichedLead;
      
    } catch (error) {
      console.error(`Failed to enrich lead ${lead.id}:`, error.message);
      return lead;
    }
  }
  
  extractDomain(input) {
    if (!input) return null;
    
    // Extract domain from email
    if (input.includes('@')) {
      return input.split('@')[1];
    }
    
    // Extract domain from URL
    try {
      const url = input.startsWith('http') ? input : `https://${input}`;
      const parsed = new URL(url);
      return parsed.hostname.replace('www.', '');
    } catch (error) {
      return null;
    }
  }
  
  calculateLeadScore(lead) {
    let score = 0;
    
    // Score based on company size
    const sizeScores = {
      'Enterprise': 100,
      'Large': 80,
      'Mid-Market': 60,
      'Medium': 40,
      'Small': 20,
      'Micro': 10
    };
    score += sizeScores[lead.companySize] || 0;
    
    // Score based on tech stack
    if (lead.techStack) {
      score += lead.techStack.analytics?.length * 5 || 0;
      score += lead.techStack.chatWidgets?.length * 10 || 0;
    }
    
    // Score based on emails found
    if (lead.enrichment?.emails) {
      score += Math.min(lead.enrichment.emails.totalFound * 2, 20);
    }
    
    return Math.min(score, 100); // Cap at 100
  }
}

// ============================================
// Example 5: Batch Processing
// ============================================

async function batchEnrichment(domains, options = {}) {
  const results = [];
  const batchSize = options.batchSize || 5;
  const delayMs = options.delayMs || 1000;
  
  console.log(`Processing ${domains.length} domains in batches of ${batchSize}`);
  
  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(domains.length / batchSize)}`);
    
    const batchPromises = batch.map(domain => 
      enrichCompany(domain, options)
        .then(result => ({ domain, success: true, data: result }))
        .catch(error => ({ domain, success: false, error: error.message }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Delay between batches
    if (i + batchSize < domains.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`Batch enrichment complete: ${successful} successful, ${failed} failed`);
  
  return results;
}

// ============================================
// Example Usage
// ============================================

async function main() {
  const testDomain = 'example.com';
  
  console.log('Testing different integration methods...\n');
  
  // Test 1: API Integration
  console.log('1. Testing API integration...');
  try {
    const apiResult = await enrichViaAPI(testDomain);
    console.log('API Result:', apiResult);
  } catch (error) {
    console.log('API test failed:', error.message);
  }
  
  // Test 2: Direct Import
  console.log('\n2. Testing direct import...');
  try {
    const directResult = await enrichDirectly(testDomain);
    console.log('Direct Result:', directResult);
  } catch (error) {
    console.log('Direct test failed:', error.message);
  }
  
  // Test 3: Custom Module Usage
  console.log('\n3. Testing custom module usage...');
  try {
    const customResult = await customEnrichment(testDomain);
    console.log('Custom Result:', customResult);
  } catch (error) {
    console.log('Custom test failed:', error.message);
  }
  
  // Test 4: Lead Processing
  console.log('\n4. Testing lead processing...');
  const processor = new EnrichedLeadProcessor(enrichDirectly);
  const testLead = {
    id: '123',
    email: 'contact@example.com',
    companyName: 'Example Corp'
  };
  
  const enrichedLead = await processor.processLead(testLead);
  console.log('Enriched Lead:', enrichedLead);
  
  // Test 5: Batch Processing
  console.log('\n5. Testing batch processing...');
  const testDomains = ['example.com', 'google.com', 'github.com'];
  const batchResults = await batchEnrichment(testDomains, {
    batchSize: 2,
    includeEmails: true,
    maxPages: 3
  });
  console.log('Batch Results:', batchResults);
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  enrichViaAPI,
  enrichDirectly,
  customEnrichment,
  EnrichedLeadProcessor,
  batchEnrichment
};