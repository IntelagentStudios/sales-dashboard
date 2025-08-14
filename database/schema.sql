-- Lead Generation & Outreach System Database Schema
-- PostgreSQL Database - Using sales_agent schema

-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS sales_agent;

-- Set search path for this session
SET search_path TO sales_agent;

-- Enable necessary extensions (in public schema)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Main leads table
CREATE TABLE IF NOT EXISTS sales_agent.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    website_url VARCHAR(255) UNIQUE NOT NULL,
    industry VARCHAR(100),
    sub_industry VARCHAR(100),
    company_size VARCHAR(50),
    employee_range VARCHAR(50),
    estimated_revenue VARCHAR(50),
    country VARCHAR(100),
    state_province VARCHAR(100),
    city VARCHAR(100),
    postal_code VARCHAR(20),
    address TEXT,
    phone VARCHAR(50),
    language_code VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50),
    has_existing_chat BOOLEAN DEFAULT FALSE,
    chat_provider VARCHAR(100),
    website_technology JSONB DEFAULT '{}',
    social_profiles JSONB DEFAULT '{}',
    company_description TEXT,
    founded_year INTEGER,
    business_hours JSONB,
    tags TEXT[],
    source VARCHAR(100),
    source_url TEXT,
    status VARCHAR(50) DEFAULT 'new',
    quality_score INTEGER DEFAULT 0,
    last_enriched_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for leads
CREATE INDEX idx_sales_agent_leads_status ON sales_agent.leads(status);
CREATE INDEX idx_sales_agent_leads_industry ON sales_agent.leads(industry);
CREATE INDEX idx_sales_agent_leads_quality_score ON sales_agent.leads(quality_score);
CREATE INDEX idx_sales_agent_leads_created_at ON sales_agent.leads(created_at);
CREATE INDEX idx_sales_agent_leads_website_url ON sales_agent.leads(website_url);
CREATE INDEX idx_sales_agent_leads_has_chat ON sales_agent.leads(has_existing_chat);

-- Contact persons for each lead
CREATE TABLE IF NOT EXISTS sales_agent.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES sales_agent.leads(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    full_name VARCHAR(200),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    email_score FLOAT,
    email_provider VARCHAR(50),
    position VARCHAR(100),
    seniority_level VARCHAR(50),
    department VARCHAR(100),
    is_decision_maker BOOLEAN DEFAULT FALSE,
    linkedin_url VARCHAR(255),
    twitter_url VARCHAR(255),
    phone VARCHAR(50),
    phone_verified BOOLEAN DEFAULT FALSE,
    personal_email BOOLEAN DEFAULT FALSE,
    role_confidence FLOAT,
    status VARCHAR(50) DEFAULT 'active',
    last_contacted_at TIMESTAMP,
    total_emails_sent INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for contacts
CREATE INDEX idx_sales_agent_contacts_lead_id ON sales_agent.contacts(lead_id);
CREATE INDEX idx_sales_agent_contacts_email ON sales_agent.contacts(email);
CREATE INDEX idx_sales_agent_contacts_is_decision_maker ON sales_agent.contacts(is_decision_maker);
CREATE INDEX idx_sales_agent_contacts_status ON sales_agent.contacts(status);

-- Email campaigns and templates
CREATE TABLE IF NOT EXISTS sales_agent.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    campaign_type VARCHAR(50) DEFAULT 'cold_outreach',
    industry_target VARCHAR(100),
    company_size_target VARCHAR(50),
    geographic_target JSONB,
    template_group VARCHAR(100),
    subject_lines JSONB DEFAULT '[]',
    email_templates JSONB DEFAULT '[]',
    follow_up_sequences JSONB DEFAULT '[]',
    personalization_fields TEXT[],
    ab_testing_enabled BOOLEAN DEFAULT TRUE,
    send_time_optimization BOOLEAN DEFAULT TRUE,
    daily_send_limit INTEGER DEFAULT 100,
    total_sends INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    start_date DATE,
    end_date DATE,
    performance_metrics JSONB DEFAULT '{}',
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for campaigns
CREATE INDEX idx_sales_agent_campaigns_active ON sales_agent.campaigns(active);
CREATE INDEX idx_sales_agent_campaigns_industry ON sales_agent.campaigns(industry_target);

-- Outreach tracking
CREATE TABLE IF NOT EXISTS sales_agent.outreach_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES sales_agent.contacts(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES sales_agent.leads(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES sales_agent.campaigns(id),
    email_account_id UUID,
    message_id VARCHAR(255),
    thread_id VARCHAR(255),
    email_type VARCHAR(50) DEFAULT 'initial',
    subject_line TEXT,
    email_body TEXT,
    personalization_data JSONB,
    template_variant VARCHAR(50),
    email_sent_at TIMESTAMP,
    email_delivered_at TIMESTAMP,
    email_opened_at TIMESTAMP,
    email_clicked_at TIMESTAMP,
    email_replied_at TIMESTAMP,
    email_bounced_at TIMESTAMP,
    email_unsubscribed_at TIMESTAMP,
    email_marked_spam_at TIMESTAMP,
    bounce_type VARCHAR(50),
    bounce_reason TEXT,
    open_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    follow_up_number INTEGER DEFAULT 0,
    email_provider VARCHAR(50),
    tracking_pixel_id VARCHAR(100),
    clicked_links JSONB DEFAULT '[]',
    reply_sentiment VARCHAR(50),
    reply_intent VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for outreach_history
CREATE INDEX idx_sales_agent_outreach_contact_id ON sales_agent.outreach_history(contact_id);
CREATE INDEX idx_sales_agent_outreach_lead_id ON sales_agent.outreach_history(lead_id);
CREATE INDEX idx_sales_agent_outreach_campaign_id ON sales_agent.outreach_history(campaign_id);
CREATE INDEX idx_sales_agent_outreach_sent_at ON sales_agent.outreach_history(email_sent_at);
CREATE INDEX idx_sales_agent_outreach_message_id ON sales_agent.outreach_history(message_id);

-- Lead scoring and qualification
CREATE TABLE IF NOT EXISTS sales_agent.lead_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES sales_agent.leads(id) ON DELETE CASCADE,
    total_score INTEGER DEFAULT 0,
    company_score INTEGER DEFAULT 0,
    website_score INTEGER DEFAULT 0,
    engagement_score INTEGER DEFAULT 0,
    contact_score INTEGER DEFAULT 0,
    scoring_factors JSONB DEFAULT '{}',
    qualified BOOLEAN DEFAULT FALSE,
    qualification_reason TEXT,
    disqualification_reasons TEXT[],
    score_breakdown JSONB DEFAULT '{}',
    last_calculated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for lead_scores
CREATE INDEX idx_sales_agent_lead_scores_lead_id ON sales_agent.lead_scores(lead_id);
CREATE INDEX idx_sales_agent_lead_scores_qualified ON sales_agent.lead_scores(qualified);
CREATE INDEX idx_sales_agent_lead_scores_total ON sales_agent.lead_scores(total_score);

-- Email account rotation
CREATE TABLE IF NOT EXISTS sales_agent.email_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    provider VARCHAR(50),
    smtp_host VARCHAR(255),
    smtp_port INTEGER,
    smtp_secure BOOLEAN DEFAULT TRUE,
    smtp_username VARCHAR(255),
    smtp_password_encrypted TEXT,
    imap_host VARCHAR(255),
    imap_port INTEGER,
    imap_secure BOOLEAN DEFAULT TRUE,
    oauth_config JSONB,
    daily_limit INTEGER DEFAULT 50,
    hourly_limit INTEGER DEFAULT 10,
    emails_sent_today INTEGER DEFAULT 0,
    emails_sent_this_hour INTEGER DEFAULT 0,
    last_reset_date DATE,
    reputation_score FLOAT DEFAULT 100.0,
    bounce_rate FLOAT DEFAULT 0.0,
    complaint_rate FLOAT DEFAULT 0.0,
    warmup_status VARCHAR(50) DEFAULT 'new',
    warmup_day INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    last_used TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for email_accounts
CREATE INDEX idx_sales_agent_email_accounts_active ON sales_agent.email_accounts(active);
CREATE INDEX idx_sales_agent_email_accounts_reputation ON sales_agent.email_accounts(reputation_score);

-- Company research data
CREATE TABLE IF NOT EXISTS sales_agent.company_research (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES sales_agent.leads(id) ON DELETE CASCADE,
    research_date TIMESTAMP DEFAULT NOW(),
    website_content JSONB DEFAULT '{}',
    recent_news JSONB DEFAULT '[]',
    job_postings JSONB DEFAULT '[]',
    customer_reviews JSONB DEFAULT '{}',
    social_media_activity JSONB DEFAULT '{}',
    competitor_analysis JSONB DEFAULT '{}',
    pain_points TEXT[],
    growth_indicators TEXT[],
    unique_aspects TEXT[],
    website_tone VARCHAR(50),
    estimated_traffic INTEGER,
    traffic_sources JSONB,
    key_pages_content JSONB,
    seasonal_patterns JSONB,
    ai_insights JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for company_research
CREATE INDEX idx_sales_agent_research_lead_id ON sales_agent.company_research(lead_id);
CREATE INDEX idx_sales_agent_research_date ON sales_agent.company_research(research_date);

-- Email templates library
CREATE TABLE IF NOT EXISTS sales_agent.email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    industry VARCHAR(100),
    template_type VARCHAR(50) DEFAULT 'cold_email',
    subject_template TEXT,
    body_template TEXT,
    personalization_tokens TEXT[],
    required_data_points TEXT[],
    tone VARCHAR(50),
    length_category VARCHAR(50),
    performance_stats JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS sales_agent.api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_name VARCHAR(100) NOT NULL,
    endpoint VARCHAR(255),
    request_date DATE DEFAULT CURRENT_DATE,
    request_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    total_cost DECIMAL(10, 4) DEFAULT 0,
    avg_response_time INTEGER,
    rate_limit_hits INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for api_usage
CREATE INDEX idx_sales_agent_api_usage_name_date ON sales_agent.api_usage(api_name, request_date);

-- Webhook events
CREATE TABLE IF NOT EXISTS sales_agent.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    source VARCHAR(100),
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for webhook_events
CREATE INDEX idx_sales_agent_webhook_events_type ON sales_agent.webhook_events(event_type);
CREATE INDEX idx_sales_agent_webhook_events_processed ON sales_agent.webhook_events(processed);
CREATE INDEX idx_sales_agent_webhook_events_created ON sales_agent.webhook_events(created_at);

-- Unsubscribe list
CREATE TABLE IF NOT EXISTS sales_agent.unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    reason VARCHAR(255),
    campaign_id UUID REFERENCES sales_agent.campaigns(id),
    unsubscribed_at TIMESTAMP DEFAULT NOW()
);

-- Create index for unsubscribes
CREATE INDEX idx_sales_agent_unsubscribes_email ON sales_agent.unsubscribes(email);

-- Bounce list
CREATE TABLE IF NOT EXISTS sales_agent.bounces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    bounce_type VARCHAR(50),
    bounce_subtype VARCHAR(50),
    bounce_message TEXT,
    is_permanent BOOLEAN DEFAULT FALSE,
    retry_after TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for bounces
CREATE INDEX idx_sales_agent_bounces_email ON sales_agent.bounces(email);
CREATE INDEX idx_sales_agent_bounces_type ON sales_agent.bounces(bounce_type);

-- System configuration
CREATE TABLE IF NOT EXISTS sales_agent.system_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(255) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Activity logs
CREATE TABLE IF NOT EXISTS sales_agent.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(100),
    entity_id UUID,
    action VARCHAR(100),
    details JSONB,
    performed_by VARCHAR(100),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for activity_logs
CREATE INDEX idx_sales_agent_activity_logs_entity ON sales_agent.activity_logs(entity_type, entity_id);
CREATE INDEX idx_sales_agent_activity_logs_created ON sales_agent.activity_logs(created_at);

-- API Keys table
CREATE TABLE IF NOT EXISTS sales_agent.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    permissions JSONB,
    last_used TIMESTAMP,
    usage_count INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Job queue table (replacing Redis queues)
CREATE TABLE IF NOT EXISTS sales_agent.job_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(100) NOT NULL,
    priority INTEGER DEFAULT 5,
    payload JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_for TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for job_queue
CREATE INDEX idx_sales_agent_job_queue_status ON sales_agent.job_queue(status);
CREATE INDEX idx_sales_agent_job_queue_type ON sales_agent.job_queue(job_type);
CREATE INDEX idx_sales_agent_job_queue_scheduled ON sales_agent.job_queue(scheduled_for);
CREATE INDEX idx_sales_agent_job_queue_priority ON sales_agent.job_queue(priority DESC, scheduled_for ASC);

-- Create update trigger function
CREATE OR REPLACE FUNCTION sales_agent.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to tables with updated_at
CREATE TRIGGER update_sales_agent_leads_updated_at BEFORE UPDATE ON sales_agent.leads
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_contacts_updated_at BEFORE UPDATE ON sales_agent.contacts
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_campaigns_updated_at BEFORE UPDATE ON sales_agent.campaigns
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_lead_scores_updated_at BEFORE UPDATE ON sales_agent.lead_scores
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_email_accounts_updated_at BEFORE UPDATE ON sales_agent.email_accounts
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_company_research_updated_at BEFORE UPDATE ON sales_agent.company_research
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_email_templates_updated_at BEFORE UPDATE ON sales_agent.email_templates
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_system_config_updated_at BEFORE UPDATE ON sales_agent.system_config
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();

CREATE TRIGGER update_sales_agent_job_queue_updated_at BEFORE UPDATE ON sales_agent.job_queue
    FOR EACH ROW EXECUTE FUNCTION sales_agent.update_updated_at_column();