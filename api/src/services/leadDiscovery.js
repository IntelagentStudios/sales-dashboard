import axios from 'axios';
import * as cheerio from 'cheerio';
import prisma, { cache } from '../config/database.js';
import jobQueue from './jobQueue.js';

class LeadDiscoveryService {
  constructor() {
    this.googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
    this.googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY;
    this.scraperApiKey = process.env.SCRAPER_API_KEY;
  }

  async discoverFromGoogleMaps(searchParams) {
    const { keyword, location, radius = 50000, industry } = searchParams;
    const leads = [];

    try {
      const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
      const params = {
        key: this.googlePlacesKey,
        location: location,
        radius: radius,
        keyword: keyword,
        type: 'establishment'
      };

      let nextPageToken = null;
      let pageCount = 0;
      const maxPages = 3;

      do {
        if (nextPageToken) {
          params.pagetoken = nextPageToken;
          await this.delay(2000);
        }

        const response = await axios.get(placesUrl, { params });
        const places = response.data.results;

        for (const place of places) {
          const leadData = await this.extractGooglePlaceData(place, industry);
          if (leadData) {
            leads.push(leadData);
          }
        }

        nextPageToken = response.data.next_page_token;
        pageCount++;
      } while (nextPageToken && pageCount < maxPages);

      await this.saveLeads(leads);
      return leads;
    } catch (error) {
      console.error('Google Maps discovery error:', error);
      throw error;
    }
  }

  async extractGooglePlaceData(place, industry) {
    try {
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json`;
      const params = {
        key: this.googlePlacesKey,
        place_id: place.place_id,
        fields: 'name,formatted_address,formatted_phone_number,website,opening_hours,rating,user_ratings_total,types,address_components,business_status,url'
      };

      const response = await axios.get(detailsUrl, { params });
      const details = response.data.result;

      if (!details.website || details.business_status !== 'OPERATIONAL') {
        return null;
      }

      const addressComponents = this.parseAddressComponents(details.address_components);

      return {
        company_name: details.name,
        website_url: this.cleanWebsiteUrl(details.website),
        phone: details.formatted_phone_number,
        address: details.formatted_address,
        city: addressComponents.city,
        state_province: addressComponents.state,
        country: addressComponents.country,
        postal_code: addressComponents.postal_code,
        industry: industry,
        business_hours: details.opening_hours?.weekday_text || null,
        source: 'google_maps',
        source_url: details.url,
        tags: details.types || [],
        social_profiles: {
          google_maps: details.url,
          rating: details.rating,
          review_count: details.user_ratings_total
        }
      };
    } catch (error) {
      console.error('Error extracting place details:', error);
      return null;
    }
  }

  async scrapeBusinessDirectories(directory, searchParams) {
    const leads = [];
    const scrapers = {
      yellowpages: this.scrapeYellowPages.bind(this),
      yelp: this.scrapeYelp.bind(this),
      trustpilot: this.scrapeTrustPilot.bind(this),
      chamberOfCommerce: this.scrapeChamberOfCommerce.bind(this)
    };

    if (scrapers[directory]) {
      try {
        const results = await scrapers[directory](searchParams);
        leads.push(...results);
        await this.saveLeads(leads);
      } catch (error) {
        console.error(`Error scraping ${directory}:`, error);
      }
    }

    return leads;
  }

  async scrapeYellowPages(searchParams) {
    const { keyword, location, maxPages = 5 } = searchParams;
    const leads = [];

    try {
      for (let page = 1; page <= maxPages; page++) {
        const url = `https://www.yellowpages.com/search`;
        const params = {
          search_terms: keyword,
          geo_location_terms: location,
          page: page
        };

        const html = await this.fetchWithScraperAPI(url, params);
        const $ = cheerio.load(html);

        $('.result').each((index, element) => {
          const $elem = $(element);
          const name = $elem.find('.business-name').text().trim();
          const website = $elem.find('.track-visit-website').attr('href');
          const phone = $elem.find('.phones').text().trim();
          const address = $elem.find('.street-address').text().trim();
          const city = $elem.find('.locality').text().trim();

          if (name && website) {
            leads.push({
              company_name: name,
              website_url: this.cleanWebsiteUrl(website),
              phone: phone,
              address: address,
              city: city,
              source: 'yellowpages',
              industry: searchParams.industry
            });
          }
        });

        await this.delay(2000);
      }
    } catch (error) {
      console.error('YellowPages scraping error:', error);
    }

    return leads;
  }

  async scrapeYelp(searchParams) {
    const { keyword, location, maxPages = 3 } = searchParams;
    const leads = [];

    try {
      for (let start = 0; start < maxPages * 10; start += 10) {
        const url = `https://www.yelp.com/search`;
        const params = {
          find_desc: keyword,
          find_loc: location,
          start: start
        };

        const html = await this.fetchWithScraperAPI(url, params);
        const $ = cheerio.load(html);

        $('[data-testid="serp-ia-card"]').each((index, element) => {
          const $elem = $(element);
          const name = $elem.find('h3 a').text().trim();
          const websiteLink = $elem.find('a:contains("Business website")').attr('href');
          const phone = $elem.find('[data-testid="button-container"] p').text().trim();

          if (name) {
            leads.push({
              company_name: name,
              website_url: websiteLink ? this.extractUrlFromYelpRedirect(websiteLink) : null,
              phone: phone,
              source: 'yelp',
              industry: searchParams.industry
            });
          }
        });

        await this.delay(3000);
      }
    } catch (error) {
      console.error('Yelp scraping error:', error);
    }

    return leads;
  }

  async scrapeTrustPilot(searchParams) {
    const { industry, location } = searchParams;
    const leads = [];

    try {
      const url = `https://www.trustpilot.com/categories/${industry}`;
      const params = { location: location };

      const html = await this.fetchWithScraperAPI(url, params);
      const $ = cheerio.load(html);

      $('.paper_paper__1PY90').each((index, element) => {
        const $elem = $(element);
        const name = $elem.find('.typography_heading-xs__jSwUm').text().trim();
        const websiteUrl = $elem.find('a.link_internal__7XN06').attr('href');
        const rating = $elem.find('.star-rating_starRating__4rrcf').attr('data-rating');

        if (name && websiteUrl) {
          leads.push({
            company_name: name,
            website_url: `https://www.trustpilot.com${websiteUrl}`,
            source: 'trustpilot',
            industry: searchParams.industry,
            social_profiles: {
              trustpilot_rating: rating
            }
          });
        }
      });
    } catch (error) {
      console.error('TrustPilot scraping error:', error);
    }

    return leads;
  }

  async scrapeChamberOfCommerce(searchParams) {
    const { city, state } = searchParams;
    const leads = [];

    try {
      const searchUrl = `https://www.chamberofcommerce.com/${state}/${city}`;
      const html = await this.fetchWithScraperAPI(searchUrl);
      const $ = cheerio.load(html);

      $('.business-listing').each((index, element) => {
        const $elem = $(element);
        const name = $elem.find('.business-name').text().trim();
        const website = $elem.find('.website-link').attr('href');
        const phone = $elem.find('.phone').text().trim();
        const address = $elem.find('.address').text().trim();

        if (name) {
          leads.push({
            company_name: name,
            website_url: website,
            phone: phone,
            address: address,
            city: city,
            state_province: state,
            source: 'chamber_of_commerce',
            industry: searchParams.industry
          });
        }
      });
    } catch (error) {
      console.error('Chamber of Commerce scraping error:', error);
    }

    return leads;
  }

  async discoverFromLinkedIn(searchParams) {
    const { industry, location, companySize } = searchParams;
    const leads = [];

    try {
      const searchUrl = 'https://www.linkedin.com/sales-api/salesApiCompanies';
      const headers = {
        'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      };

      const params = {
        q: 'search',
        query: `(industries:${industry},locations:${location},companySize:${companySize})`,
        start: 0,
        count: 100
      };

      const response = await axios.get(searchUrl, { headers, params });
      const companies = response.data.elements;

      for (const company of companies) {
        leads.push({
          company_name: company.name,
          website_url: company.websiteUrl,
          industry: company.industry,
          company_size: company.employeeCountRange,
          city: company.headquarters?.city,
          country: company.headquarters?.country,
          social_profiles: {
            linkedin: company.publicProfileUrl
          },
          source: 'linkedin'
        });
      }

      await this.saveLeads(leads);
      return leads;
    } catch (error) {
      console.error('LinkedIn discovery error:', error);
      return leads;
    }
  }

  async fetchWithScraperAPI(url, params = {}) {
    try {
      const scraperUrl = 'http://api.scraperapi.com';
      const apiParams = {
        api_key: this.scraperApiKey,
        url: url,
        render: true,
        ...params
      };

      const response = await axios.get(scraperUrl, { params: apiParams });
      return response.data;
    } catch (error) {
      console.error('ScraperAPI error:', error);
      throw error;
    }
  }

  async saveLeads(leads) {
    const savedLeads = [];

    for (const lead of leads) {
      try {
        // Check if lead already exists
        const existingLead = await prisma.lead.findUnique({
          where: { websiteUrl: lead.website_url }
        });

        if (!existingLead) {
          const newLead = await prisma.lead.create({
            data: {
              companyName: lead.company_name,
              websiteUrl: lead.website_url,
              industry: lead.industry,
              subIndustry: lead.sub_industry || null,
              companySize: lead.company_size || null,
              country: lead.country || null,
              stateProvince: lead.state_province || null,
              city: lead.city || null,
              postalCode: lead.postal_code || null,
              address: lead.address || null,
              phone: lead.phone || null,
              languageCode: lead.language_code || 'en',
              timezone: lead.timezone || null,
              socialProfiles: lead.social_profiles || {},
              businessHours: lead.business_hours || null,
              tags: lead.tags || [],
              source: lead.source,
              sourceUrl: lead.source_url || null,
              status: 'new'
            }
          });

          // Queue jobs for enrichment and analysis
          await jobQueue.addJob('lead_enrichment', { leadId: newLead.id }, { 
            priority: 5,
            scheduledFor: new Date(Date.now() + 5000)
          });
          
          await jobQueue.addJob('website_analysis', { leadId: newLead.id }, {
            priority: 3,
            scheduledFor: new Date(Date.now() + 10000)
          });

          savedLeads.push({ ...lead, id: newLead.id });
        }
      } catch (error) {
        console.error('Error saving lead:', error);
      }
    }

    return savedLeads;
  }

  cleanWebsiteUrl(url) {
    if (!url) return null;
    
    url = url.trim().toLowerCase();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}`;
    } catch {
      return url;
    }
  }

  extractUrlFromYelpRedirect(yelpUrl) {
    try {
      const urlParams = new URLSearchParams(yelpUrl.split('?')[1]);
      return urlParams.get('url') || yelpUrl;
    } catch {
      return yelpUrl;
    }
  }

  parseAddressComponents(components) {
    const parsed = {
      city: null,
      state: null,
      country: null,
      postal_code: null
    };

    if (!components) return parsed;

    for (const component of components) {
      const types = component.types;
      if (types.includes('locality')) {
        parsed.city = component.long_name;
      } else if (types.includes('administrative_area_level_1')) {
        parsed.state = component.short_name;
      } else if (types.includes('country')) {
        parsed.country = component.long_name;
      } else if (types.includes('postal_code')) {
        parsed.postal_code = component.long_name;
      }
    }

    return parsed;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new LeadDiscoveryService();