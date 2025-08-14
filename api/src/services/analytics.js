import prisma, { cache } from '../config/database.js';

class AnalyticsService {
  async getDashboardMetrics(dateRange = 30) {
    const cacheKey = `analytics:dashboard:${dateRange}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - dateRange);

    const metrics = await Promise.all([
      this.getLeadMetrics(startDate, endDate),
      this.getEmailMetrics(startDate, endDate),
      this.getCampaignMetrics(startDate, endDate),
      this.getConversionMetrics(startDate, endDate),
      this.getApiUsageMetrics(startDate, endDate)
    ]);

    const dashboard = {
      leads: metrics[0],
      emails: metrics[1],
      campaigns: metrics[2],
      conversions: metrics[3],
      apiUsage: metrics[4],
      generatedAt: new Date().toISOString()
    };

    cache.set(cacheKey, dashboard, 3600);
    return dashboard;
  }

  async getLeadMetrics(startDate, endDate) {
    // Get lead counts
    const [totalLeads, newLeads, qualifiedLeads, opportunities] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({
        where: {
          createdAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.lead.count({
        where: {
          status: 'qualified',
          createdAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.lead.count({
        where: {
          hasExistingChat: false,
          createdAt: { gte: startDate, lte: endDate }
        }
      })
    ]);

    // Get average score
    const avgScore = await prisma.leadScore.aggregate({
      _avg: { totalScore: true },
      where: {
        lead: {
          createdAt: { gte: startDate, lte: endDate }
        }
      }
    });

    // Get industry breakdown
    const industryBreakdown = await prisma.lead.groupBy({
      by: ['industry'],
      where: {
        createdAt: { gte: startDate, lte: endDate },
        industry: { not: null }
      },
      _count: true,
      orderBy: {
        _count: { industry: 'desc' }
      },
      take: 10
    });

    // Get daily trend
    const dailyTrend = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM sales_agent.leads
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    return {
      total: totalLeads,
      new: newLeads,
      qualified: qualifiedLeads,
      opportunities,
      avgScore: avgScore._avg.totalScore || 0,
      industryBreakdown: industryBreakdown.map(item => ({
        industry: item.industry,
        count: item._count
      })),
      dailyTrend
    };
  }

  async getEmailMetrics(startDate, endDate) {
    const [totalSent, totalOpened, totalClicked, totalReplied, totalBounced] = await Promise.all([
      prisma.outreachHistory.count({
        where: {
          emailSentAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.outreachHistory.count({
        where: {
          emailOpenedAt: { not: null },
          emailSentAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.outreachHistory.count({
        where: {
          emailClickedAt: { not: null },
          emailSentAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.outreachHistory.count({
        where: {
          emailRepliedAt: { not: null },
          emailSentAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.outreachHistory.count({
        where: {
          emailBouncedAt: { not: null },
          emailSentAt: { gte: startDate, lte: endDate }
        }
      })
    ]);

    const openRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0;
    const clickRate = totalSent > 0 ? (totalClicked / totalSent) * 100 : 0;
    const replyRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;
    const bounceRate = totalSent > 0 ? (totalBounced / totalSent) * 100 : 0;

    // Get email performance by template variant
    const templatePerformance = await prisma.outreachHistory.groupBy({
      by: ['templateVariant'],
      where: {
        emailSentAt: { gte: startDate, lte: endDate },
        templateVariant: { not: null }
      },
      _count: {
        _all: true,
        emailOpenedAt: true,
        emailClickedAt: true,
        emailRepliedAt: true
      }
    });

    // Get hourly send distribution
    const hourlySends = await prisma.$queryRaw`
      SELECT 
        EXTRACT(HOUR FROM email_sent_at) as hour,
        COUNT(*) as count
      FROM sales_agent.outreach_history
      WHERE email_sent_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY EXTRACT(HOUR FROM email_sent_at)
      ORDER BY hour
    `;

    return {
      sent: totalSent,
      opened: totalOpened,
      clicked: totalClicked,
      replied: totalReplied,
      bounced: totalBounced,
      openRate,
      clickRate,
      replyRate,
      bounceRate,
      templatePerformance,
      hourlySends
    };
  }

  async getCampaignMetrics(startDate, endDate) {
    const campaigns = await prisma.campaign.findMany({
      where: {
        OR: [
          { createdAt: { gte: startDate, lte: endDate } },
          { active: true }
        ]
      },
      include: {
        _count: {
          select: {
            outreachHistory: true,
            unsubscribes: true
          }
        }
      }
    });

    const campaignPerformance = await Promise.all(
      campaigns.map(async (campaign) => {
        const stats = await prisma.outreachHistory.aggregate({
          where: {
            campaignId: campaign.id,
            emailSentAt: { gte: startDate, lte: endDate }
          },
          _count: {
            _all: true,
            emailOpenedAt: true,
            emailClickedAt: true,
            emailRepliedAt: true
          }
        });

        return {
          id: campaign.id,
          name: campaign.name,
          active: campaign.active,
          sent: stats._count._all || 0,
          opened: stats._count.emailOpenedAt || 0,
          clicked: stats._count.emailClickedAt || 0,
          replied: stats._count.emailRepliedAt || 0,
          unsubscribes: campaign._count.unsubscribes
        };
      })
    );

    return {
      total: campaigns.length,
      active: campaigns.filter(c => c.active).length,
      performance: campaignPerformance
    };
  }

  async getConversionMetrics(startDate, endDate) {
    // Get funnel metrics
    const [discovered, enriched, qualified, contacted, responded] = await Promise.all([
      prisma.lead.count({
        where: { createdAt: { gte: startDate, lte: endDate } }
      }),
      prisma.lead.count({
        where: {
          lastEnrichedAt: { not: null },
          createdAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.leadScore.count({
        where: {
          qualified: true,
          createdAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.outreachHistory.count({
        where: {
          emailSentAt: { gte: startDate, lte: endDate }
        }
      }),
      prisma.outreachHistory.count({
        where: {
          emailRepliedAt: { not: null },
          emailSentAt: { gte: startDate, lte: endDate }
        }
      })
    ]);

    const conversionFunnel = {
      discovered,
      enriched,
      qualified,
      contacted,
      responded,
      discoveryToEnrichment: discovered > 0 ? (enriched / discovered) * 100 : 0,
      enrichmentToQualification: enriched > 0 ? (qualified / enriched) * 100 : 0,
      qualificationToContact: qualified > 0 ? (contacted / qualified) * 100 : 0,
      contactToResponse: contacted > 0 ? (responded / contacted) * 100 : 0
    };

    // Get response sentiment breakdown
    const sentimentBreakdown = await prisma.outreachHistory.groupBy({
      by: ['replySentiment'],
      where: {
        emailRepliedAt: { not: null },
        replySentiment: { not: null },
        emailSentAt: { gte: startDate, lte: endDate }
      },
      _count: true
    });

    return {
      funnel: conversionFunnel,
      sentimentBreakdown: sentimentBreakdown.map(item => ({
        sentiment: item.replySentiment,
        count: item._count
      }))
    };
  }

  async getApiUsageMetrics(startDate, endDate) {
    const apiUsage = await prisma.apiUsage.groupBy({
      by: ['apiName'],
      where: {
        requestDate: { gte: startDate, lte: endDate }
      },
      _sum: {
        requestCount: true,
        successCount: true,
        errorCount: true,
        totalCost: true
      },
      _avg: {
        avgResponseTime: true
      }
    });

    const dailyApiCosts = await prisma.$queryRaw`
      SELECT 
        DATE(request_date) as date,
        SUM(total_cost) as cost
      FROM sales_agent.api_usage
      WHERE request_date BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE(request_date)
      ORDER BY date DESC
    `;

    return {
      byProvider: apiUsage.map(item => ({
        provider: item.apiName,
        requests: item._sum.requestCount || 0,
        successful: item._sum.successCount || 0,
        failed: item._sum.errorCount || 0,
        cost: Number(item._sum.totalCost) || 0,
        avgResponseTime: item._avg.avgResponseTime || 0
      })),
      dailyCosts: dailyApiCosts,
      totalCost: apiUsage.reduce((sum, item) => sum + (Number(item._sum.totalCost) || 0), 0)
    };
  }

  async generateReport(reportType = 'daily') {
    const dateRange = reportType === 'daily' ? 1 : reportType === 'weekly' ? 7 : 30;
    const metrics = await this.getDashboardMetrics(dateRange);

    const report = {
      type: reportType,
      period: {
        start: new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000),
        end: new Date()
      },
      metrics,
      insights: await this.generateInsights(metrics),
      recommendations: await this.generateRecommendations(metrics)
    };

    // Store report
    await prisma.activityLog.create({
      data: {
        entityType: 'report',
        action: 'generated',
        details: report
      }
    });

    return report;
  }

  async generateInsights(metrics) {
    const insights = [];

    // Lead quality insight
    if (metrics.leads.avgScore < 50) {
      insights.push({
        type: 'warning',
        message: 'Average lead score is below 50. Consider refining discovery criteria.'
      });
    }

    // Email performance insight
    if (metrics.emails.openRate < 20) {
      insights.push({
        type: 'warning',
        message: 'Email open rate is below 20%. Consider improving subject lines.'
      });
    }

    if (metrics.emails.replyRate > 5) {
      insights.push({
        type: 'success',
        message: `Reply rate of ${metrics.emails.replyRate.toFixed(1)}% is above industry average.`
      });
    }

    // Conversion insight
    if (metrics.conversions.funnel.contactToResponse < 2) {
      insights.push({
        type: 'warning',
        message: 'Low response rate. Consider improving email personalization.'
      });
    }

    return insights;
  }

  async generateRecommendations(metrics) {
    const recommendations = [];

    // Based on metrics, generate actionable recommendations
    if (metrics.emails.bounceRate > 5) {
      recommendations.push({
        priority: 'high',
        action: 'Clean email list',
        reason: `Bounce rate of ${metrics.emails.bounceRate.toFixed(1)}% is above recommended threshold`
      });
    }

    if (metrics.leads.opportunities > 100) {
      recommendations.push({
        priority: 'medium',
        action: 'Increase daily send limit',
        reason: `${metrics.leads.opportunities} untapped opportunities available`
      });
    }

    // Check best performing template
    const bestTemplate = metrics.emails.templatePerformance
      .sort((a, b) => b._count.emailRepliedAt - a._count.emailRepliedAt)[0];
    
    if (bestTemplate) {
      recommendations.push({
        priority: 'medium',
        action: `Use template variant ${bestTemplate.templateVariant} more frequently`,
        reason: 'This variant has the highest reply rate'
      });
    }

    return recommendations;
  }
}

export default new AnalyticsService();