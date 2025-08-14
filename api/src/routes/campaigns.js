import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Get all campaigns
router.get('/', async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            outreachHistory: true,
            unsubscribes: true
          }
        }
      }
    });
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Get single campaign with details
router.get('/:id', async (req, res) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        outreachHistory: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: {
            outreachHistory: true,
            unsubscribes: true
          }
        }
      }
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    res.json(campaign);
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// Create new campaign
router.post('/', async (req, res) => {
  try {
    const {
      name,
      templateId,
      searchCriteria,
      searchMethod,
      industryTarget,
      companySizeTarget,
      geographicTarget,
      dailySendLimit
    } = req.body;

    const campaign = await prisma.campaign.create({
      data: {
        name,
        templateId,
        searchCriteria,
        searchMethod,
        industryTarget,
        companySizeTarget,
        geographicTarget,
        dailySendLimit: dailySendLimit || 100,
        status: 'discovering'
      }
    });

    // TODO: Trigger lead discovery job
    // This would typically add a job to the queue to start discovering leads
    await prisma.jobQueue.create({
      data: {
        jobType: 'discover_leads',
        payload: {
          campaignId: campaign.id,
          searchMethod,
          searchCriteria,
          filters: {
            industry: industryTarget,
            companySize: companySizeTarget,
            location: geographicTarget
          }
        },
        priority: 5
      }
    });

    res.status(201).json(campaign);
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// Update campaign status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['discovering', 'active', 'paused', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: { 
        status,
        active: status === 'active'
      }
    });

    res.json(campaign);
  } catch (error) {
    console.error('Error updating campaign status:', error);
    res.status(500).json({ error: 'Failed to update campaign status' });
  }
});

// Get campaign statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const campaignId = req.params.id;
    
    // Get various stats
    const [campaign, emailStats, leadCount] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id: campaignId }
      }),
      prisma.outreachHistory.aggregate({
        where: { campaignId },
        _count: {
          emailSentAt: true,
          emailOpenedAt: true,
          emailClickedAt: true,
          emailRepliedAt: true
        }
      }),
      prisma.outreachHistory.groupBy({
        by: ['leadId'],
        where: { campaignId },
        _count: true
      })
    ]);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const stats = {
      campaignName: campaign.name,
      status: campaign.status,
      leadsFound: campaign.leadsFound,
      emailsSent: emailStats._count.emailSentAt,
      emailsOpened: emailStats._count.emailOpenedAt,
      emailsClicked: emailStats._count.emailClickedAt,
      emailsReplied: emailStats._count.emailRepliedAt,
      uniqueLeads: leadCount.length,
      responseRate: emailStats._count.emailSentAt > 0 
        ? (emailStats._count.emailRepliedAt / emailStats._count.emailSentAt * 100).toFixed(2)
        : 0
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching campaign stats:', error);
    res.status(500).json({ error: 'Failed to fetch campaign statistics' });
  }
});

// Delete campaign (soft delete by setting inactive)
router.delete('/:id', async (req, res) => {
  try {
    await prisma.campaign.update({
      where: { id: req.params.id },
      data: { 
        active: false,
        status: 'completed'
      }
    });

    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

export default router;