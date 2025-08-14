import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function initDatabase() {
  console.log('🚀 Starting database initialization...');
  
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Connected to database');

    // Create default system configurations
    await createSystemConfigs();
    
    // Create default campaign
    await createDefaultCampaign();
    
    // Create API key for service authentication
    const apiKey = await createApiKey();
    
    // Create sample email templates
    await createEmailTemplates();
    
    // Display setup information
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Database initialization completed successfully!');
    console.log('='.repeat(60));
    console.log('\n📋 Setup Information:');
    console.log('-------------------');
    console.log(`🔑 API Key: ${apiKey}`);
    console.log('   Store this key securely - it will not be shown again!');
    console.log('\n🌐 Service Endpoints:');
    console.log('   - Health Check: GET /health');
    console.log('   - Lead Discovery: POST /api/discover/google-maps');
    console.log('   - Job Stats: GET /api/jobs/stats');
    console.log('   - Analytics: GET /api/analytics/dashboard');
    console.log('\n📊 Prisma Studio:');
    console.log('   Run "npm run prisma:studio" to view your data');
    console.log('\n🔄 N8N Integration:');
    console.log('   1. Import workflows from n8n-workflows/ folder');
    console.log('   2. Update webhook URLs to point to this service');
    console.log('   3. Add API key to HTTP Authentication headers');
    console.log('\n' + '='.repeat(60));
    
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function createSystemConfigs() {
  console.log('📝 Creating system configurations...');
  
  const configs = [
    {
      configKey: 'scoring_weights',
      configValue: {
        company_size: 20,
        website_quality: 15,
        industry_match: 25,
        geographic_match: 10,
        technology_match: 15,
        engagement_signals: 15
      },
      description: 'Lead scoring weight configuration'
    },
    {
      configKey: 'email_settings',
      configValue: {
        daily_send_limit: 500,
        warmup_increment: 10,
        bounce_threshold: 5,
        complaint_threshold: 0.1,
        send_time_ranges: {
          weekday: { start: "09:00", end: "17:00" },
          weekend: { start: "10:00", end: "14:00" }
        }
      },
      description: 'Email sending configuration'
    },
    {
      configKey: 'enrichment_settings',
      configValue: {
        auto_enrich: true,
        batch_size: 10,
        priority_industries: ['saas', 'technology', 'finance'],
        required_data_points: ['email', 'company_size', 'industry']
      },
      description: 'Lead enrichment configuration'
    },
    {
      configKey: 'ai_settings',
      configValue: {
        model_preference: process.env.ANTHROPIC_API_KEY ? 'claude-3-opus' : 'gpt-4',
        max_tokens: 500,
        temperature: 0.7,
        personalization_depth: 'moderate',
        anti_creepiness_filter: true
      },
      description: 'AI generation settings'
    }
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { configKey: config.configKey },
      update: { configValue: config.configValue },
      create: config
    });
  }
  
  console.log(`✅ Created ${configs.length} system configurations`);
}

async function createDefaultCampaign() {
  console.log('📧 Creating default campaign...');
  
  const campaign = await prisma.campaign.create({
    data: {
      name: 'General Outreach Campaign',
      description: 'Default campaign for automated lead outreach',
      campaignType: 'cold_outreach',
      subjectLines: [
        'Quick question about {{company_name}}',
        'Noticed you\'re in {{industry}} - quick thought',
        '{{first_name}}, improving {{pain_point}} at {{company_name}}'
      ],
      emailTemplates: [
        {
          variant: 'A',
          template: `Hi {{first_name}},

I noticed {{company_name}} is {{unique_aspect}}. 

{{value_proposition}}

{{social_proof}}

Would you be open to a brief call to explore how we might help {{company_name}} {{benefit}}?

Best regards,
{{sender_name}}`
        },
        {
          variant: 'B',
          template: `Hi {{first_name}},

{{personalized_opener}}

{{pain_point_acknowledgment}}

{{solution_teaser}}

Worth a quick conversation?

{{sender_name}}`
        }
      ],
      followUpSequences: [
        {
          days_after: 3,
          template: `Hi {{first_name}},

Just wanted to follow up on my previous email. I understand you're busy.

{{brief_value_reminder}}

Would {{day_options}} work for a quick 15-minute call?

{{sender_name}}`
        },
        {
          days_after: 7,
          template: `Hi {{first_name}},

Last attempt - I promise!

{{final_value_proposition}}

If not interested, no worries at all. Just let me know and I'll stop reaching out.

{{sender_name}}`
        }
      ],
      personalizationFields: [
        'first_name',
        'company_name',
        'industry',
        'unique_aspect',
        'pain_point',
        'benefit'
      ],
      dailySendLimit: 100,
      active: true
    }
  });
  
  console.log(`✅ Created campaign: ${campaign.name}`);
  return campaign;
}

async function createApiKey() {
  console.log('🔐 Creating API key...');
  
  // Generate a secure API key
  const apiKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = await bcrypt.hash(apiKey, 10);
  
  await prisma.apiKey.create({
    data: {
      keyHash,
      name: 'Default Service Key',
      permissions: {
        read: true,
        write: true,
        admin: true
      },
      active: true
    }
  });
  
  console.log('✅ API key created');
  return apiKey;
}

async function createEmailTemplates() {
  console.log('📝 Creating email templates...');
  
  const templates = [
    {
      name: 'SaaS Cold Outreach',
      category: 'cold_email',
      industry: 'saas',
      templateType: 'cold_email',
      subjectTemplate: '{{company_name}} + {{our_company}}: Quick synergy check?',
      bodyTemplate: `Hi {{first_name}},

Noticed {{company_name}} is scaling rapidly in the {{industry}} space. Your recent {{recent_achievement}} caught my attention.

We help companies like yours {{value_proposition}}. Our clients typically see {{typical_results}}.

{{personalized_question}}

Worth exploring?

{{sender_signature}}`,
      personalizationTokens: [
        'first_name',
        'company_name',
        'industry',
        'recent_achievement',
        'value_proposition',
        'typical_results',
        'personalized_question'
      ],
      requiredDataPoints: ['first_name', 'company_name', 'industry'],
      tone: 'professional',
      lengthCategory: 'short'
    },
    {
      name: 'E-commerce Outreach',
      category: 'cold_email',
      industry: 'ecommerce',
      templateType: 'cold_email',
      subjectTemplate: 'Growing {{company_name}}\'s online revenue',
      bodyTemplate: `Hi {{first_name}},

I noticed {{company_name}} has {{unique_observation}}. 

In the competitive e-commerce landscape, {{pain_point_observation}}.

We've helped similar brands {{success_metric}}. 

{{specific_idea}}

Open to a quick chat this week?

{{sender_signature}}`,
      personalizationTokens: [
        'first_name',
        'company_name',
        'unique_observation',
        'pain_point_observation',
        'success_metric',
        'specific_idea'
      ],
      requiredDataPoints: ['first_name', 'company_name'],
      tone: 'casual',
      lengthCategory: 'medium'
    },
    {
      name: 'Follow-up Template',
      category: 'follow_up',
      templateType: 'follow_up',
      subjectTemplate: 'Re: {{original_subject}}',
      bodyTemplate: `Hi {{first_name}},

Hope this finds you well.

{{follow_up_context}}

{{gentle_reminder}}

{{easy_yes_option}}

{{sender_signature}}`,
      personalizationTokens: [
        'first_name',
        'follow_up_context',
        'gentle_reminder',
        'easy_yes_option'
      ],
      requiredDataPoints: ['first_name'],
      tone: 'friendly',
      lengthCategory: 'short'
    }
  ];

  for (const template of templates) {
    await prisma.emailTemplate.create({
      data: {
        ...template,
        performanceStats: {},
        active: true
      }
    });
  }
  
  console.log(`✅ Created ${templates.length} email templates`);
}

// Run initialization
initDatabase().catch(console.error);