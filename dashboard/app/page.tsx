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
  MapPin,
  Building2,
  Plus,
  Play,
  Pause,
  Download,
  Eye,
  Settings,
  BarChart3,
  Sparkles,
  ChevronRight,
  X
} from "lucide-react";

export default function Dashboard() {
  const [activeView, setActiveView] = useState<'campaigns' | 'analytics' | 'settings'>('campaigns');
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  
  // Real stats starting at 0
  const [stats] = useState({
    totalLeads: 0,
    activeCampaigns: 0,
    emailsSent: 0,
    responseRate: 0,
  });

  // Campaign creation form state
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    searchMethod: 'google_maps',
    searchQuery: '',
    location: '',
    businessType: '',
    industry: '',
    radius: '5',
    excludePrevious: true
  });

  const industries = [
    'Restaurants & Food',
    'Retail & Shopping', 
    'Healthcare & Medical',
    'Professional Services',
    'Real Estate',
    'Automotive',
    'Beauty & Wellness',
    'Home Services',
    'Financial Services',
    'Technology',
    'Manufacturing',
    'Education',
    'Entertainment',
    'Non-Profit'
  ];

  const handleCreateCampaign = () => {
    const campaign = {
      id: Date.now(),
      name: newCampaign.name || `Campaign ${campaigns.length + 1}`,
      searchCriteria: newCampaign.searchMethod === 'google_maps' 
        ? `${newCampaign.businessType} in ${newCampaign.location}`
        : newCampaign.searchMethod === 'industry'
        ? `${newCampaign.industry} businesses`
        : newCampaign.searchQuery,
      status: 'discovering',
      leadsFound: 0,
      emailsSent: 0,
      responseRate: 0,
      createdAt: new Date().toISOString()
    };
    
    setCampaigns([...campaigns, campaign]);
    setShowCampaignModal(false);
    
    // Reset form
    setNewCampaign({
      name: '',
      searchMethod: 'google_maps',
      searchQuery: '',
      location: '',
      businessType: '',
      industry: '',
      radius: '5',
      excludePrevious: true
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Sales Agent</h1>
              <p className="text-sm text-muted-foreground">Find and connect with your ideal customers</p>
            </div>
            <nav className="flex gap-6">
              <button 
                onClick={() => setActiveView('campaigns')}
                className={`text-sm font-medium transition-colors ${
                  activeView === 'campaigns' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Campaigns
              </button>
              {stats.totalLeads > 0 && (
                <button 
                  onClick={() => setActiveView('analytics')}
                  className={`text-sm font-medium transition-colors ${
                    activeView === 'analytics' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Analytics
                </button>
              )}
              <button 
                onClick={() => setActiveView('settings')}
                className={`text-sm font-medium transition-colors ${
                  activeView === 'settings' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {activeView === 'campaigns' && (
          <>
            {/* Stats Grid - Only show if there's data */}
            {campaigns.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.totalLeads}</div>
                    <p className="text-xs text-muted-foreground">
                      From {campaigns.length} campaigns
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
                    <Target className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.activeCampaigns}</div>
                    <p className="text-xs text-muted-foreground">
                      Currently running
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
                      Total outreach
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
                      Average across campaigns
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Campaigns Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Campaigns</h2>
                <Button onClick={() => setShowCampaignModal(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Start New Campaign
                </Button>
              </div>

              {campaigns.length === 0 ? (
                // Empty state
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Target className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No campaigns yet</h3>
                    <p className="text-sm text-muted-foreground text-center mb-6 max-w-sm">
                      Start discovering and reaching out to potential customers
                    </p>
                    <Button onClick={() => setShowCampaignModal(true)}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Start Your First Campaign
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                // Campaign list
                <div className="space-y-3">
                  {campaigns.map(campaign => (
                    <Card key={campaign.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-medium">{campaign.name}</h3>
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                campaign.status === 'active' 
                                  ? 'bg-green-400/10 text-green-400'
                                  : campaign.status === 'discovering'
                                  ? 'bg-blue-400/10 text-blue-400'
                                  : 'bg-gray-400/10 text-gray-400'
                              }`}>
                                {campaign.status}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-3">{campaign.searchCriteria}</p>
                            <div className="flex gap-6 text-sm">
                              <div>
                                <span className="text-muted-foreground">Leads: </span>
                                <span className="font-medium">{campaign.leadsFound}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Sent: </span>
                                <span className="font-medium">{campaign.emailsSent}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Responses: </span>
                                <span className="font-medium">{campaign.responseRate}%</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              {campaign.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeView === 'analytics' && (
          <div className="flex items-center justify-center py-12">
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No analytics data yet</h3>
                <p className="text-sm text-muted-foreground text-center">
                  Analytics will appear here once you start running campaigns
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {activeView === 'settings' && (
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Configure your sales agent preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Settings configuration coming soon...
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Campaign Creation Modal */}
      {showCampaignModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Start New Campaign</CardTitle>
                <CardDescription>Find and connect with your ideal customers</CardDescription>
              </div>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowCampaignModal(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Campaign Name */}
              <div>
                <label className="text-sm font-medium mb-2 block">Campaign Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                  placeholder="e.g., Q4 Restaurant Outreach"
                  value={newCampaign.name}
                  onChange={(e) => setNewCampaign({...newCampaign, name: e.target.value})}
                />
              </div>

              {/* Search Method */}
              <div>
                <label className="text-sm font-medium mb-2 block">Search Method</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setNewCampaign({...newCampaign, searchMethod: 'google_maps'})}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      newCampaign.searchMethod === 'google_maps' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <MapPin className="h-5 w-5 mx-auto mb-1" />
                    <div className="text-sm font-medium">Google Maps</div>
                    <div className="text-xs text-muted-foreground">Location-based</div>
                  </button>
                  
                  <button
                    onClick={() => setNewCampaign({...newCampaign, searchMethod: 'industry'})}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      newCampaign.searchMethod === 'industry' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <Building2 className="h-5 w-5 mx-auto mb-1" />
                    <div className="text-sm font-medium">Industry</div>
                    <div className="text-xs text-muted-foreground">By category</div>
                  </button>
                  
                  <button
                    onClick={() => setNewCampaign({...newCampaign, searchMethod: 'custom'})}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      newCampaign.searchMethod === 'custom' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <Search className="h-5 w-5 mx-auto mb-1" />
                    <div className="text-sm font-medium">Custom AI</div>
                    <div className="text-xs text-muted-foreground">Natural language</div>
                  </button>
                </div>
              </div>

              {/* Search Parameters based on method */}
              {newCampaign.searchMethod === 'google_maps' && (
                <>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Business Type</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                      placeholder="e.g., dentist, restaurant, gym"
                      value={newCampaign.businessType}
                      onChange={(e) => setNewCampaign({...newCampaign, businessType: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Location</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                      placeholder="e.g., Austin, TX or 78701"
                      value={newCampaign.location}
                      onChange={(e) => setNewCampaign({...newCampaign, location: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Search Radius</label>
                    <select 
                      className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                      value={newCampaign.radius}
                      onChange={(e) => setNewCampaign({...newCampaign, radius: e.target.value})}
                    >
                      <option value="1">1 mile</option>
                      <option value="5">5 miles</option>
                      <option value="10">10 miles</option>
                      <option value="25">25 miles</option>
                      <option value="50">50 miles</option>
                    </select>
                  </div>
                </>
              )}

              {newCampaign.searchMethod === 'industry' && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Select Industry</label>
                  <select 
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                    value={newCampaign.industry}
                    onChange={(e) => setNewCampaign({...newCampaign, industry: e.target.value})}
                  >
                    <option value="">Choose an industry...</option>
                    {industries.map(industry => (
                      <option key={industry} value={industry}>{industry}</option>
                    ))}
                  </select>
                </div>
              )}

              {newCampaign.searchMethod === 'custom' && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Describe Your Ideal Customers</label>
                  <textarea
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm min-h-[100px]"
                    placeholder="e.g., Find all eco-friendly restaurants in London with outdoor seating and websites mentioning vegan options"
                    value={newCampaign.searchQuery}
                    onChange={(e) => setNewCampaign({...newCampaign, searchQuery: e.target.value})}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    AI will interpret your request and find matching businesses
                  </p>
                </div>
              )}

              {/* Additional Options */}
              <div className="border-t pt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={newCampaign.excludePrevious}
                    onChange={(e) => setNewCampaign({...newCampaign, excludePrevious: e.target.checked})}
                    className="rounded"
                  />
                  <span className="text-sm">Exclude previously contacted businesses</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <Button 
                  onClick={handleCreateCampaign}
                  disabled={
                    (newCampaign.searchMethod === 'google_maps' && (!newCampaign.businessType || !newCampaign.location)) ||
                    (newCampaign.searchMethod === 'industry' && !newCampaign.industry) ||
                    (newCampaign.searchMethod === 'custom' && !newCampaign.searchQuery)
                  }
                  className="flex-1"
                >
                  Start Campaign
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setShowCampaignModal(false)}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}