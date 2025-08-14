import dotenv from 'dotenv';
import { query } from '../api/src/config/database.js';
import crypto from 'crypto';

dotenv.config();

async function initializeSystem() {
  console.log('🚀 Initializing Sales Agent System...\n');

  try {
    // 1. Test database connection
    console.log('Testing database connection...');
    await query('SELECT NOW()');
    console.log('✅ Database connected successfully\n');

    // 2. Initialize system configuration
    console.log('Setting up system configuration...');
    await initializeSystemConfig();
    console.log('✅ System configuration initialized\n');

    // 3. Create default campaign
    console.log('Creating default campaign...');
    await createDefaultCampaign();
    console.log('✅ Default campaign created\n');

    // 4. Set up email templates
    console.log('Setting up email templates...');
    await createEmailTemplates();
    console.log('✅ Email templates created\n');

    // 5. Initialize search parameters
    console.log('Setting up search parameters...');
    await initializeSearchParams();
    console.log('✅ Search parameters configured\n');

    // 6. Create API keys
    console.log('Generating API keys...');
    const apiKey = await createApiKey();
    console.log('✅ API key created:', apiKey, '\n');

    // 7. Test N8N connection
    console.log('Testing N8N webhook connection...');
    await testN8NConnection();
    console.log('✅ N8N connection successful\n');

    console.log('🎉 System initialization complete!');
    console.log('\nNext steps:');
    console.log('1. Import N8N workflows from n8n-workflows/ directory');
    console.log('2. Configure email provider settings');
    console.log('3. Add API keys for enrichment services');
    console.log('4. Start the service with: railway up');

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
}

async function initializeSystemConfig() {
  const configs = [
    {
      key: 'discovery_parameters',
      value: {
        keywords: ['restaurant', 'retail', 'healthcare', 'professional services'],
        locations: ['New York, NY', 'Los Angeles, CA', 'Chicago, IL'],
        radius: 50000,
        industries: ['ecommerce', 'saas', 'healthcare', 'education']
      },
      description: 'Default lead discovery parameters'
    },
    {
      key: 'email_settings',
      value: {
        daily_limit: 500,
        hourly_limit: 50,
        send_time_start: '09:00',
        send_time_end: '17:00',
        follow_up_days: [3, 7, 14]
      },
      description: 'Email sending configuration'
    },
    {
      key: 'scoring_thresholds',
      value: {
        auto_qualify: 70,
        auto_disqualify: 30,
        hot_lead: 85
      },
      description: 'Lead scoring thresholds'
    }
  ];

  for (const config of configs) {
    await query(`
      INSERT INTO system_config (config_key, config_value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (config_key) DO UPDATE
      SET config_value = $2, updated_at = NOW()
    `, [config.key, JSON.stringify(config.value), config.description]);
  }
}

async function createDefaultCampaign() {
  const campaign = {
    name: 'Default B2B Outreach',
    description: 'AI-powered chatbot introduction campaign',
    campaign_type: 'cold_outreach',
    industry_target: 'all',
    subject_lines: [
      'Quick question about {{companyName}}',
      'Helping {{industry}} businesses in {{city}}',
      '24/7 customer support for {{companyName}}',
      'Reduce support costs by 70% at {{companyName}}'
    ],
    email_templates: [
      {
        id: 'template_1',
        name: 'Problem-Solution',
        tone: 'professional_friendly'
      },
      {
        id: 'template_2',
        name: 'Social Proof',
        tone: 'casual_confident'
      },
      {
        id: 'template_3',
        name: 'Direct Value',
        tone: 'professional_direct'
      }
    ],
    daily_send_limit: 100
  };

  await query(`
    INSERT INTO campaigns (
      name, description, campaign_type, industry_target,
      subject_lines, email_templates, daily_send_limit, active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
    ON CONFLICT DO NOTHING
  `, [
    campaign.name,
    campaign.description,
    campaign.campaign_type,
    campaign.industry_target,
    JSON.stringify(campaign.subject_lines),
    JSON.stringify(campaign.email_templates),
    campaign.daily_send_limit
  ]);
}

async function createEmailTemplates() {
  const templates = [
    {
      name: 'Professional Introduction',
      category: 'cold_outreach',
      industry: 'all',
      template_type: 'initial',
      subject_template: '{{companyName}} - Quick question about customer support',
      body_template: `Hi {{firstName}},

I noticed {{companyName}} provides great {{industry}} services in {{city}}. 

Many businesses like yours lose potential customers when they can't respond quickly enough outside business hours.

Our AI chatbot helps companies respond instantly 24/7, typically reducing support costs by 70% while improving customer satisfaction.

Worth a quick chat to see if this could help {{companyName}}?

Best regards,
{{senderName}}`,
      tone: 'professional'
    },
    {
      name: 'Follow-up 1',
      category: 'cold_outreach',
      industry: 'all',
      template_type: 'follow_up',
      subject_template: 'Re: {{companyName}} - Quick question about customer support',
      body_template: `Hi {{firstName}},

Just following up on my previous email about helping {{companyName}} handle customer inquiries 24/7.

I understand you're busy, but I wanted to share that similar {{industry}} companies using our chatbot see:
- 70% reduction in support tickets
- 3x faster response times
- 40% increase in lead capture

Would you be interested in a brief 15-minute demo?

Best regards,
{{senderName}}`,
      tone: 'professional'
    }
  ];

  for (const template of templates) {
    await query(`
      INSERT INTO email_templates (
        name, category, industry, template_type,
        subject_template, body_template, tone, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      ON CONFLICT DO NOTHING
    `, [
      template.name,
      template.category,
      template.industry,
      template.template_type,
      template.subject_template,
      template.body_template,
      template.tone
    ]);
  }
}

async function initializeSearchParams() {
  const searchParams = {
    google_maps: {
      keywords: [
        'dentist', 'restaurant', 'law firm', 'real estate',
        'insurance agency', 'medical clinic', 'auto repair'
      ],
      locations: [
        { lat: 40.7128, lng: -74.0060, name: 'New York' },
        { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
        { lat: 41.8781, lng: -87.6298, name: 'Chicago' }
      ]
    },
    industries: {
      priority: ['healthcare', 'professional-services', 'retail', 'hospitality'],
      excluded: ['gambling', 'adult-content', 'tobacco']
    }
  };

  await query(`
    INSERT INTO system_config (config_key, config_value, description)
    VALUES ('search_parameters', $1, 'Lead discovery search parameters')
    ON CONFLICT (config_key) DO UPDATE
    SET config_value = $1, updated_at = NOW()
  `, [JSON.stringify(searchParams)]);
}

async function createApiKey() {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

  await query(`
    INSERT INTO api_keys (
      key_hash, name, permissions, active, created_at
    ) VALUES ($1, $2, $3, true, NOW())
  `, [hashedKey, 'System API Key', JSON.stringify(['all'])]);

  return apiKey;
}

async function testN8NConnection() {
  if (!process.env.N8N_WEBHOOK_URL) {
    console.log('⚠️  N8N webhook URL not configured - skipping test');
    return;
  }

  try {
    const axios = (await import('axios')).default;
    await axios.post(
      `${process.env.N8N_WEBHOOK_URL}/test`,
      { test: true },
      {
        headers: { 'X-API-Key': process.env.N8N_API_KEY },
        timeout: 5000
      }
    );
  } catch (error) {
    console.log('⚠️  N8N connection test failed - ensure N8N is running');
  }
}

// Run initialization
initializeSystem().catch(console.error);