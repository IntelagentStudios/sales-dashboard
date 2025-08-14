import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import sgMail from '@sendgrid/mail';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { query, transaction } from '../config/database.js';
import { cache } from '../config/redis.js';
import { queues } from '../config/queue.js';
import crypto from 'crypto';

class EmailOutreachService {
  constructor() {
    this.providers = this.initializeProviders();
    this.trackingDomain = process.env.TRACKING_DOMAIN || 'track.yourdomain.com';
    this.unsubscribeUrl = process.env.UNSUBSCRIBE_URL || 'https://yourdomain.com/unsubscribe';
  }

  initializeProviders() {
    const providers = {};

    // Resend as primary provider (fastest and most reliable)
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      providers.resend = {
        type: 'resend',
        client: resend,
        send: this.sendViaResend.bind(this)
      };
    }

    // Keep SendGrid as backup option
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      providers.sendgrid = {
        type: 'sendgrid',
        send: this.sendViaSendGrid.bind(this)
      };
    }

    if (process.env.MAILGUN_API_KEY) {
      const mailgun = new Mailgun(formData);
      providers.mailgun = {
        type: 'mailgun',
        client: mailgun.client({
          username: 'api',
          key: process.env.MAILGUN_API_KEY,
          url: 'https://api.mailgun.net'
        }),
        send: this.sendViaMailgun.bind(this)
      };
    }

    if (process.env.AWS_ACCESS_KEY_ID) {
      providers.ses = {
        type: 'ses',
        client: new SESClient({
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
          }
        }),
        send: this.sendViaSES.bind(this)
      };
    }

    if (process.env.SMTP_HOST) {
      providers.smtp = {
        type: 'smtp',
        transporter: nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        }),
        send: this.sendViaSMTP.bind(this)
      };
    }

    return providers;
  }

  async sendEmail(emailData) {
    try {
      const emailAccount = await this.selectEmailAccount();
      if (!emailAccount) {
        throw new Error('No available email accounts');
      }

      const preparedEmail = await this.prepareEmail(emailData, emailAccount);
      const trackingData = await this.addTracking(preparedEmail);
      
      const provider = await this.selectProvider(emailAccount);
      const result = await provider.send(preparedEmail, emailAccount);

      await this.recordOutreach(emailData, trackingData, result, emailAccount);
      await this.updateEmailAccountUsage(emailAccount.id);

      return {
        success: true,
        messageId: result.messageId,
        trackingId: trackingData.trackingId
      };
    } catch (error) {
      console.error('Email send error:', error);
      await this.handleSendError(emailData, error);
      throw error;
    }
  }

  async prepareEmail(emailData, emailAccount) {
    const { contactId, leadId, campaignId, subject, body, templateVariant } = emailData;

    const contact = await this.getContact(contactId);
    const lead = await this.getLead(leadId);
    const campaign = await this.getCampaign(campaignId);

    const personalizedBody = await this.personalizeContent(body, {
      contact,
      lead,
      campaign
    });

    const htmlBody = this.convertToHtml(personalizedBody);
    const textBody = this.stripHtml(personalizedBody);

    return {
      from: {
        email: emailAccount.email_address,
        name: emailAccount.display_name || 'Sales Team'
      },
      to: contact.email,
      subject: subject,
      html: htmlBody,
      text: textBody,
      headers: {
        'X-Campaign-ID': campaignId,
        'X-Lead-ID': leadId,
        'X-Contact-ID': contactId,
        'List-Unsubscribe': `<${this.unsubscribeUrl}?email=${contact.email}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      },
      metadata: {
        contactId,
        leadId,
        campaignId,
        templateVariant,
        sendTime: new Date().toISOString()
      }
    };
  }

  async addTracking(email) {
    const trackingId = crypto.randomBytes(16).toString('hex');
    const pixelId = crypto.randomBytes(8).toString('hex');

    const trackingPixel = `<img src="https://${this.trackingDomain}/pixel/${pixelId}" width="1" height="1" style="display:none;" alt="" />`;
    
    const trackedHtml = this.wrapLinksWithTracking(email.html, trackingId);
    email.html = trackedHtml + trackingPixel;

    await cache.set(`tracking:${trackingId}`, email.metadata, 2592000);
    await cache.set(`pixel:${pixelId}`, email.metadata, 2592000);

    return {
      trackingId,
      pixelId,
      trackedLinks: this.extractTrackedLinks(trackedHtml)
    };
  }

  wrapLinksWithTracking(html, trackingId) {
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    
    return html.replace(linkRegex, (match, url, linkText) => {
      if (url.includes('unsubscribe') || url.includes('mailto:') || url.startsWith('#')) {
        return match;
      }

      const linkId = crypto.randomBytes(4).toString('hex');
      const trackedUrl = `https://${this.trackingDomain}/click/${trackingId}/${linkId}?url=${encodeURIComponent(url)}`;
      
      return match.replace(url, trackedUrl);
    });
  }

  extractTrackedLinks(html) {
    const links = [];
    const regex = new RegExp(`https://${this.trackingDomain}/click/[^"'\\s]+`, 'g');
    const matches = html.match(regex);
    
    if (matches) {
      matches.forEach(url => {
        const urlParams = new URL(url);
        const originalUrl = urlParams.searchParams.get('url');
        if (originalUrl) {
          links.push({
            trackedUrl: url,
            originalUrl: decodeURIComponent(originalUrl)
          });
        }
      });
    }
    
    return links;
  }

  async selectEmailAccount() {
    const availableAccounts = await query(`
      SELECT * FROM email_accounts 
      WHERE active = true 
        AND emails_sent_today < daily_limit 
        AND reputation_score > 50
      ORDER BY emails_sent_today ASC, reputation_score DESC
      LIMIT 1
    `);

    if (availableAccounts.rows.length === 0) {
      await this.resetDailyLimits();
      return this.selectEmailAccount();
    }

    return availableAccounts.rows[0];
  }

  async selectProvider(emailAccount) {
    if (emailAccount.provider && this.providers[emailAccount.provider]) {
      return this.providers[emailAccount.provider];
    }

    const availableProviders = Object.keys(this.providers);
    if (availableProviders.length === 0) {
      throw new Error('No email providers configured');
    }

    return this.providers[availableProviders[0]];
  }

  async sendViaResend(email, emailAccount) {
    try {
      const response = await this.providers.resend.client.emails.send({
        from: `${email.from.name} <${email.from.email}>`,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: {
          'X-Campaign-ID': email.metadata?.campaignId || '',
          'X-Lead-ID': email.metadata?.leadId || '',
          'X-Contact-ID': email.metadata?.contactId || '',
          ...email.headers
        },
        tags: [
          { name: 'campaign', value: email.metadata?.campaignId || 'default' },
          { name: 'lead', value: email.metadata?.leadId || 'unknown' }
        ]
      });

      return {
        messageId: response.data?.id || response.id,
        provider: 'resend',
        response: response.data || response
      };
    } catch (error) {
      console.error('Resend API error:', error);
      throw error;
    }
  }

  async sendViaSendGrid(email, emailAccount) {
    const msg = {
      to: email.to,
      from: email.from,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers,
      customArgs: email.metadata
    };

    const response = await sgMail.send(msg);
    
    return {
      messageId: response[0].headers['x-message-id'],
      provider: 'sendgrid',
      response: response[0]
    };
  }

  async sendViaMailgun(email, emailAccount) {
    const messageData = {
      from: `${email.from.name} <${email.from.email}>`,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      'h:X-Campaign-ID': email.metadata.campaignId,
      'h:X-Lead-ID': email.metadata.leadId,
      'h:X-Contact-ID': email.metadata.contactId
    };

    const response = await this.providers.mailgun.client.messages.create(
      process.env.MAILGUN_DOMAIN,
      messageData
    );

    return {
      messageId: response.id,
      provider: 'mailgun',
      response
    };
  }

  async sendViaSES(email, emailAccount) {
    const params = {
      Source: `${email.from.name} <${email.from.email}>`,
      Destination: {
        ToAddresses: [email.to]
      },
      Message: {
        Subject: {
          Data: email.subject,
          Charset: 'UTF-8'
        },
        Body: {
          Text: {
            Data: email.text,
            Charset: 'UTF-8'
          },
          Html: {
            Data: email.html,
            Charset: 'UTF-8'
          }
        }
      },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET
    };

    const command = new SendEmailCommand(params);
    const response = await this.providers.ses.client.send(command);

    return {
      messageId: response.MessageId,
      provider: 'ses',
      response
    };
  }

  async sendViaSMTP(email, emailAccount) {
    const mailOptions = {
      from: `${email.from.name} <${email.from.email}>`,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers
    };

    const response = await this.providers.smtp.transporter.sendMail(mailOptions);

    return {
      messageId: response.messageId,
      provider: 'smtp',
      response
    };
  }

  async recordOutreach(emailData, trackingData, result, emailAccount) {
    await query(`
      INSERT INTO outreach_history (
        contact_id, lead_id, campaign_id, email_account_id,
        message_id, email_type, subject_line, email_body,
        template_variant, email_sent_at, email_provider,
        tracking_pixel_id, personalization_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12)
    `, [
      emailData.contactId,
      emailData.leadId,
      emailData.campaignId,
      emailAccount.id,
      result.messageId,
      emailData.emailType || 'initial',
      emailData.subject,
      emailData.body,
      emailData.templateVariant,
      result.provider,
      trackingData.pixelId,
      JSON.stringify(emailData.personalizationData || {})
    ]);

    await query(`
      UPDATE contacts 
      SET last_contacted_at = NOW(), 
          total_emails_sent = total_emails_sent + 1 
      WHERE id = $1
    `, [emailData.contactId]);
  }

  async updateEmailAccountUsage(accountId) {
    await query(`
      UPDATE email_accounts 
      SET emails_sent_today = emails_sent_today + 1,
          emails_sent_this_hour = emails_sent_this_hour + 1,
          last_used = NOW()
      WHERE id = $1
    `, [accountId]);
  }

  async handleSendError(emailData, error) {
    const errorLog = {
      emailData,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    await query(`
      INSERT INTO activity_logs (entity_type, entity_id, action, details)
      VALUES ('email_send', $1, 'error', $2)
    `, [emailData.contactId, JSON.stringify(errorLog)]);

    if (error.message.includes('bounce') || error.message.includes('invalid')) {
      await this.handleBounce(emailData.contactId, error.message);
    }
  }

  async handleBounce(contactId, bounceMessage) {
    const contact = await this.getContact(contactId);
    
    await query(`
      INSERT INTO bounces (email, bounce_type, bounce_message, is_permanent)
      VALUES ($1, $2, $3, $4)
    `, [
      contact.email,
      'hard',
      bounceMessage,
      true
    ]);

    await query(`
      UPDATE contacts SET status = 'bounced' WHERE id = $1
    `, [contactId]);
  }

  async handleEmailOpen(pixelId) {
    const metadata = await cache.get(`pixel:${pixelId}`);
    if (!metadata) return;

    await query(`
      UPDATE outreach_history 
      SET email_opened_at = COALESCE(email_opened_at, NOW()),
          open_count = open_count + 1
      WHERE tracking_pixel_id = $1
    `, [pixelId]);

    await this.triggerN8NWebhook('email_opened', metadata);
  }

  async handleLinkClick(trackingId, linkId, originalUrl) {
    const metadata = await cache.get(`tracking:${trackingId}`);
    if (!metadata) return;

    await transaction(async (client) => {
      const outreachResult = await client.query(`
        SELECT id, clicked_links FROM outreach_history 
        WHERE contact_id = $1 AND campaign_id = $2
        ORDER BY email_sent_at DESC LIMIT 1
      `, [metadata.contactId, metadata.campaignId]);

      if (outreachResult.rows.length > 0) {
        const outreach = outreachResult.rows[0];
        const clickedLinks = outreach.clicked_links || [];
        
        clickedLinks.push({
          url: originalUrl,
          clickedAt: new Date().toISOString(),
          linkId
        });

        await client.query(`
          UPDATE outreach_history 
          SET email_clicked_at = COALESCE(email_clicked_at, NOW()),
              click_count = click_count + 1,
              clicked_links = $1
          WHERE id = $2
        `, [JSON.stringify(clickedLinks), outreach.id]);
      }
    });

    await this.triggerN8NWebhook('link_clicked', {
      ...metadata,
      clickedUrl: originalUrl
    });
  }

  async handleReply(emailData) {
    const { messageId, replyText, sentiment, intent } = emailData;

    await query(`
      UPDATE outreach_history 
      SET email_replied_at = NOW(),
          reply_sentiment = $1,
          reply_intent = $2
      WHERE message_id = $3
    `, [sentiment, intent, messageId]);

    const metadata = await this.getOutreachMetadata(messageId);
    
    if (intent === 'positive' || intent === 'interested') {
      await this.createDeal(metadata);
    }

    await this.triggerN8NWebhook('email_replied', {
      ...metadata,
      replyText,
      sentiment,
      intent
    });
  }

  async handleUnsubscribe(email) {
    await query(`
      INSERT INTO unsubscribes (email, reason, unsubscribed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (email) DO NOTHING
    `, [email, 'user_requested']);

    await query(`
      UPDATE contacts SET status = 'unsubscribed' WHERE email = $1
    `, [email]);
  }

  async scheduleFollowUp(contactId, campaignId, followUpNumber) {
    const delay = (followUpNumber + 1) * 3 * 24 * 60 * 60 * 1000;
    
    await queues.emailSending.add('follow_up', {
      contactId,
      campaignId,
      followUpNumber: followUpNumber + 1,
      emailType: 'follow_up'
    }, {
      delay,
      attempts: 3
    });
  }

  async resetDailyLimits() {
    const lastReset = await cache.get('email:last_daily_reset');
    const today = new Date().toDateString();
    
    if (lastReset !== today) {
      await query(`
        UPDATE email_accounts 
        SET emails_sent_today = 0, 
            last_reset_date = CURRENT_DATE
        WHERE last_reset_date < CURRENT_DATE OR last_reset_date IS NULL
      `);
      
      await cache.set('email:last_daily_reset', today, 86400);
    }
  }

  async resetHourlyLimits() {
    await query(`
      UPDATE email_accounts 
      SET emails_sent_this_hour = 0
      WHERE EXTRACT(HOUR FROM last_used) != EXTRACT(HOUR FROM NOW())
    `);
  }

  async optimizeSendTime(contactId, timezone) {
    const bestTimes = {
      'monday': { start: 10, end: 11 },
      'tuesday': { start: 14, end: 15 },
      'wednesday': { start: 9, end: 10 },
      'thursday': { start: 14, end: 15 },
      'friday': { start: 9, end: 10 }
    };

    const now = new Date();
    const dayOfWeek = now.toLocaleLowerCase('en-US', { weekday: 'long', timeZone: timezone });
    const bestTime = bestTimes[dayOfWeek] || { start: 10, end: 11 };

    const sendHour = Math.floor(Math.random() * (bestTime.end - bestTime.start)) + bestTime.start;
    const sendMinute = Math.floor(Math.random() * 60);

    const sendTime = new Date();
    sendTime.setHours(sendHour, sendMinute, 0, 0);

    if (sendTime < now) {
      sendTime.setDate(sendTime.getDate() + 1);
    }

    return sendTime;
  }

  async createDeal(metadata) {
    const deal = {
      leadId: metadata.leadId,
      contactId: metadata.contactId,
      campaignId: metadata.campaignId,
      stage: 'qualified',
      createdAt: new Date().toISOString()
    };

    await this.triggerN8NWebhook('deal_created', deal);
  }

  async triggerN8NWebhook(event, data) {
    try {
      const webhookUrl = `${process.env.N8N_WEBHOOK_URL}/sales-agent/${event}`;
      
      await axios.post(webhookUrl, {
        event,
        data,
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'X-API-Key': process.env.N8N_API_KEY
        }
      });
    } catch (error) {
      console.error(`N8N webhook error for ${event}:`, error.message);
    }
  }

  async getContact(contactId) {
    const result = await query('SELECT * FROM contacts WHERE id = $1', [contactId]);
    return result.rows[0];
  }

  async getLead(leadId) {
    const result = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
    return result.rows[0];
  }

  async getCampaign(campaignId) {
    const result = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    return result.rows[0];
  }

  async getOutreachMetadata(messageId) {
    const result = await query(`
      SELECT o.*, l.company_name, c.first_name, c.last_name, c.email
      FROM outreach_history o
      JOIN leads l ON o.lead_id = l.id
      JOIN contacts c ON o.contact_id = c.id
      WHERE o.message_id = $1
    `, [messageId]);
    
    return result.rows[0];
  }

  personalizeContent(content, data) {
    let personalized = content;
    
    const replacements = {
      '{{firstName}}': data.contact.first_name || 'there',
      '{{lastName}}': data.contact.last_name || '',
      '{{companyName}}': data.lead.company_name,
      '{{position}}': data.contact.position || 'Team',
      '{{city}}': data.lead.city || 'your city',
      '{{industry}}': data.lead.industry || 'your industry'
    };

    for (const [token, value] of Object.entries(replacements)) {
      personalized = personalized.replace(new RegExp(token, 'g'), value);
    }

    return personalized;
  }

  convertToHtml(content) {
    const paragraphs = content.split('\n\n');
    const htmlParagraphs = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`);
    
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            p { margin: 1em 0; }
            a { color: #0066cc; }
          </style>
        </head>
        <body>
          ${htmlParagraphs.join('')}
          <p style="margin-top: 2em; font-size: 0.9em; color: #666;">
            <a href="${this.unsubscribeUrl}">Unsubscribe</a>
          </p>
        </body>
      </html>
    `;
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

export default new EmailOutreachService();