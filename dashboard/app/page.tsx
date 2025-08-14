"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Users, 
  Mail, 
  TrendingUp, 
  Target,
  Search,
  Send,
  BarChart3,
  Activity,
  Filter,
  Plus,
  RefreshCw,
  ChevronRight,
  CheckCircle,
  Clock,
  AlertCircle
} from "lucide-react";

export default function Dashboard() {
  const [stats] = useState({
    totalLeads: 1248,
    activeCompans: 3,
    emailsSent: 847,
    responseRate: 12.3,
  });

  const [recentLeads] = useState([
    { id: 1, company: "TechCorp Solutions", contact: "John Smith", status: "qualified", score: 92, addedAt: "2 hours ago" },
    { id: 2, company: "Global Industries", contact: "Sarah Johnson", status: "contacted", score: 78, addedAt: "4 hours ago" },
    { id: 3, company: "Innovation Labs", contact: "Mike Chen", status: "new", score: 85, addedAt: "5 hours ago" },
    { id: 4, company: "Future Systems", contact: "Emily Davis", status: "replied", score: 94, addedAt: "1 day ago" },
  ]);

  const [campaigns] = useState([
    { id: 1, name: "SaaS Outreach Q4", status: "active", sent: 245, opened: 187, replied: 23 },
    { id: 2, name: "Enterprise Sales", status: "active", sent: 412, opened: 298, replied: 41 },
    { id: 3, name: "Startup Pipeline", status: "scheduled", sent: 0, opened: 0, replied: 0 },
  ]);

  const statusColors = {
    new: "text-blue-400 bg-blue-400/10",
    contacted: "text-yellow-400 bg-yellow-400/10",
    qualified: "text-green-400 bg-green-400/10",
    replied: "text-purple-400 bg-purple-400/10",
  };

  const campaignStatusColors = {
    active: "text-green-400",
    scheduled: "text-yellow-400",
    paused: "text-gray-400",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Sales Agent</h1>
              <p className="text-sm text-muted-foreground">AI-powered B2B outreach automation</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync
              </Button>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                New Campaign
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalLeads.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-green-400">+12%</span> from last month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeCompans}</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-green-400">2 performing well</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Emails Sent</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.emailsSent}</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-green-400">76%</span> open rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Response Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.responseRate}%</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-green-400">+2.3%</span> from last week
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Action Cards */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Card className="border-primary/20 hover:border-primary/40 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Discover Leads
              </CardTitle>
              <CardDescription>Find new prospects from multiple sources</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="w-full justify-between" size="sm">
                Google Maps Search
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" className="w-full justify-between mt-2" size="sm">
                LinkedIn Scraper
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" className="w-full justify-between mt-2" size="sm">
                Directory Import
                <ChevronRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          <Card className="border-primary/20 hover:border-primary/40 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Create Campaign
              </CardTitle>
              <CardDescription>Launch targeted email outreach</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span>AI personalization</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span>Smart scheduling</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span>Follow-up sequences</span>
                </div>
              </div>
              <Button className="w-full mt-4" size="sm">
                Start New Campaign
              </Button>
            </CardContent>
          </Card>

          <Card className="border-primary/20 hover:border-primary/40 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Analytics
              </CardTitle>
              <CardDescription>Track performance metrics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Open Rate</span>
                  <span className="text-sm font-semibold">76%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Click Rate</span>
                  <span className="text-sm font-semibold">18%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Conversion</span>
                  <span className="text-sm font-semibold">4.2%</span>
                </div>
              </div>
              <Button variant="outline" className="w-full mt-4" size="sm">
                View Full Report
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Tables Section */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Recent Leads */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Leads</CardTitle>
                <Button variant="ghost" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentLeads.map((lead) => (
                  <div key={lead.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex-1">
                      <div className="font-medium">{lead.company}</div>
                      <div className="text-sm text-muted-foreground">{lead.contact}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusColors[lead.status as keyof typeof statusColors]}`}>
                        {lead.status}
                      </span>
                      <div className="text-right">
                        <div className="text-sm font-medium">Score: {lead.score}</div>
                        <div className="text-xs text-muted-foreground">{lead.addedAt}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Active Campaigns */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Active Campaigns</CardTitle>
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium">{campaign.name}</div>
                      <span className={`text-xs flex items-center gap-1 ${campaignStatusColors[campaign.status as keyof typeof campaignStatusColors]}`}>
                        {campaign.status === 'active' ? <Activity className="h-3 w-3" /> : 
                         campaign.status === 'scheduled' ? <Clock className="h-3 w-3" /> : 
                         <AlertCircle className="h-3 w-3" />}
                        {campaign.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Sent</span>
                        <div className="font-semibold">{campaign.sent}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Opened</span>
                        <div className="font-semibold">{campaign.opened}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Replied</span>
                        <div className="font-semibold text-green-400">{campaign.replied}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}