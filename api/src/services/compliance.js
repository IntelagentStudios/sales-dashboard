import { query } from '../config/database.js';
import crypto from 'crypto';

class ComplianceService {
  constructor() {
    this.encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
    this.gdprEnabled = process.env.GDPR_COMPLIANCE === 'true';
    this.canSpamEnabled = process.env.CAN_SPAM_COMPLIANCE === 'true';
    this.dataRetentionDays = parseInt(process.env.DATA_RETENTION_DAYS || '180');
  }

  async checkGDPRCompliance(lead) {
    if (!this.gdprEnabled) return { compliant: true };

    const euCountries = [
      'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic',
      'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary',
      'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta',
      'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia',
      'Spain', 'Sweden', 'United Kingdom'
    ];

    if (euCountries.includes(lead.country)) {
      return {
        compliant: false,
        reason: 'GDPR country - requires explicit consent',
        requirements: [
          'Obtain explicit consent before sending emails',
          'Provide clear privacy policy',
          'Include data processing information',
          'Offer right to erasure'
        ]
      };
    }

    return { compliant: true };
  }

  async checkCANSPAMCompliance(email) {
    if (!this.canSpamEnabled) return { compliant: true };

    const requirements = [];
    let compliant = true;

    if (!email.from || !email.from.email) {
      requirements.push('Valid sender email required');
      compliant = false;
    }

    if (!email.subject || email.subject.includes('FREE') || email.subject.includes('$$$')) {
      requirements.push('Non-deceptive subject line required');
      compliant = false;
    }

    if (!email.html?.includes('unsubscribe')) {
      requirements.push('Unsubscribe link required');
      compliant = false;
    }

    if (!email.html?.includes(process.env.COMPANY_ADDRESS)) {
      requirements.push('Physical postal address required');
      compliant = false;
    }

    return {
      compliant,
      requirements,
      fixes: this.generateComplianceFixes(requirements)
    };
  }

  generateComplianceFixes(requirements) {
    const fixes = {};

    if (requirements.includes('Unsubscribe link required')) {
      fixes.unsubscribeFooter = `
        <p style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ccc; font-size: 12px; color: #666;">
          If you no longer wish to receive these emails, you can 
          <a href="${process.env.UNSUBSCRIBE_URL}">unsubscribe here</a>.
        </p>
      `;
    }

    if (requirements.includes('Physical postal address required')) {
      fixes.addressFooter = `
        <p style="font-size: 12px; color: #666;">
          ${process.env.COMPANY_NAME}<br>
          ${process.env.COMPANY_ADDRESS}<br>
          ${process.env.COMPANY_CITY}, ${process.env.COMPANY_STATE} ${process.env.COMPANY_ZIP}
        </p>
      `;
    }

    return fixes;
  }

  encryptSensitiveData(data) {
    const algorithm = 'aes-256-cbc';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, this.encryptionKey, iv);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encrypted,
      iv: iv.toString('hex')
    };
  }

  decryptSensitiveData(encryptedData, iv) {
    const algorithm = 'aes-256-cbc';
    const decipher = crypto.createDecipheriv(
      algorithm,
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  async handleDataDeletionRequest(email) {
    const contact = await query(
      'SELECT * FROM contacts WHERE email = $1',
      [email]
    );

    if (contact.rows.length === 0) {
      return { success: false, message: 'No data found for this email' };
    }

    await query('BEGIN');

    try {
      await query('DELETE FROM outreach_history WHERE contact_id = $1', [contact.rows[0].id]);
      await query('DELETE FROM contacts WHERE email = $1', [email]);
      await query('INSERT INTO deletion_log (email, deleted_at) VALUES ($1, NOW())', [email]);
      
      await query('COMMIT');

      return {
        success: true,
        message: 'All personal data has been deleted',
        deletedItems: ['contact information', 'email history', 'tracking data']
      };
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  }

  async exportPersonalData(email) {
    const contact = await query(
      `SELECT c.*, l.company_name, l.website_url
       FROM contacts c
       LEFT JOIN leads l ON c.lead_id = l.id
       WHERE c.email = $1`,
      [email]
    );

    if (contact.rows.length === 0) {
      return null;
    }

    const emailHistory = await query(
      `SELECT email_sent_at, subject_line, email_opened_at, email_clicked_at
       FROM outreach_history
       WHERE contact_id = $1
       ORDER BY email_sent_at DESC`,
      [contact.rows[0].id]
    );

    return {
      personalInfo: {
        name: `${contact.rows[0].first_name} ${contact.rows[0].last_name}`,
        email: contact.rows[0].email,
        position: contact.rows[0].position,
        company: contact.rows[0].company_name
      },
      communicationHistory: emailHistory.rows,
      exportedAt: new Date().toISOString()
    };
  }

  async enforceDataRetention() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.dataRetentionDays);

    const result = await query(`
      DELETE FROM outreach_history
      WHERE email_sent_at < $1
      RETURNING COUNT(*) as deleted_count
    `, [cutoffDate]);

    await query(`
      DELETE FROM leads
      WHERE created_at < $1
        AND status = 'disqualified'
        AND id NOT IN (
          SELECT DISTINCT lead_id 
          FROM outreach_history 
          WHERE email_replied_at IS NOT NULL
        )
    `, [cutoffDate]);

    return {
      recordsDeleted: result.rows[0]?.deleted_count || 0,
      retentionPeriod: this.dataRetentionDays,
      cutoffDate: cutoffDate.toISOString()
    };
  }

  async auditLog(action, entity, entityId, userId, details = {}) {
    await query(`
      INSERT INTO activity_logs (
        entity_type, entity_id, action, details, performed_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
    `, [entity, entityId, action, JSON.stringify(details), userId]);
  }

  async validateEmailList(emails) {
    const violations = [];
    const suppressed = await this.getSuppressionList();

    for (const email of emails) {
      if (suppressed.unsubscribes.includes(email)) {
        violations.push({
          email,
          violation: 'unsubscribed',
          action: 'remove'
        });
      }

      if (suppressed.bounces.includes(email)) {
        violations.push({
          email,
          violation: 'hard_bounce',
          action: 'remove'
        });
      }

      if (suppressed.complaints.includes(email)) {
        violations.push({
          email,
          violation: 'spam_complaint',
          action: 'remove'
        });
      }
    }

    return {
      clean: emails.filter(e => !violations.find(v => v.email === e)),
      violations
    };
  }

  async getSuppressionList() {
    const unsubscribes = await query('SELECT email FROM unsubscribes');
    const bounces = await query('SELECT email FROM bounces WHERE is_permanent = true');
    const complaints = await query(
      'SELECT DISTINCT c.email FROM contacts c JOIN outreach_history oh ON c.id = oh.contact_id WHERE oh.email_marked_spam_at IS NOT NULL'
    );

    return {
      unsubscribes: unsubscribes.rows.map(r => r.email),
      bounces: bounces.rows.map(r => r.email),
      complaints: complaints.rows.map(r => r.email)
    };
  }

  async generatePrivacyPolicy() {
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      dataCollected: [
        'Company name and website',
        'Contact name and email',
        'Business location',
        'Industry information'
      ],
      dataSources: [
        'Public business directories',
        'Company websites',
        'Public APIs'
      ],
      dataUsage: [
        'Send relevant product information',
        'Personalize communications',
        'Improve our services'
      ],
      dataRetention: `${this.dataRetentionDays} days`,
      userRights: [
        'Access your personal data',
        'Request data deletion',
        'Opt-out of communications',
        'Export your data'
      ],
      contactInfo: {
        email: process.env.PRIVACY_EMAIL || 'privacy@yourcompany.com',
        address: process.env.COMPANY_ADDRESS
      }
    };
  }

  async checkBlacklist(domain) {
    const blacklists = [
      'government.gov',
      'military.mil',
      'education.edu'
    ];

    for (const blacklisted of blacklists) {
      if (domain.includes(blacklisted)) {
        return {
          blacklisted: true,
          reason: `Domain type ${blacklisted} is blacklisted`
        };
      }
    }

    const customBlacklist = await query(
      'SELECT domain FROM blacklisted_domains WHERE domain = $1',
      [domain]
    );

    if (customBlacklist.rows.length > 0) {
      return {
        blacklisted: true,
        reason: 'Domain is in custom blacklist'
      };
    }

    return { blacklisted: false };
  }
}

export default new ComplianceService();