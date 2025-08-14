"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TemplateModal } from "./templates-modal";
import api from "@/lib/api";
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
  BarChart3,
  Sparkles,
  ChevronRight,
  X,
  Filter,
  DollarSign,
  AlertCircle,
  Loader2
} from "lucide-react";

export default function DashboardWithAPI() {
  const [activeView, setActiveView] = useState<'campaigns' | 'templates' | 'analytics' | 'settings'>('campaigns');
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Data from API
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalLeads: 0,
    activeCampaigns: 0,
    emailsSent: 0,
    responseRate: 0,
  });

  // Campaign creation form state
  const [campaignStep, setCampaignStep] = useState<'template' | 'audience' | 'review'>('template');
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    templateId: null as string | null,
    searchMethod: 'ai_descriptive',
    searchQuery: '',
    location: '',
    radius: '10',
    industry: '',
    companySize: '',
    revenueRange: '',
    excludePrevious: true
  });

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load templates and campaigns in parallel
      const [templatesData, campaignsData] = await Promise.all([
        api.getTemplates(),
        api.getCampaigns()
      ]);

      setTemplates(templatesData);
      setCampaigns(campaignsData);

      // Calculate stats from campaigns
      const activeCampaigns = campaignsData.filter((c: any) => c.status === 'active').length;
      const totalLeads = campaignsData.reduce((sum: number, c: any) => sum + (c.leadsFound || 0), 0);
      const emailsSent = campaignsData.reduce((sum: number, c: any) => sum + (c.emailsSent || 0), 0);
      const totalResponses = campaignsData.reduce((sum: number, c: any) => sum + (c.emailsSent * c.responseRate / 100 || 0), 0);
      const responseRate = emailsSent > 0 ? (totalResponses / emailsSent * 100) : 0;

      setStats({
        totalLeads,
        activeCampaigns,
        emailsSent,
        responseRate
      });
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Failed to load data. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCampaign = async () => {
    try {
      let searchCriteria = '';
      
      if (newCampaign.searchMethod === 'ai_descriptive') {
        searchCriteria = newCampaign.searchQuery;
      } else {
        const filters = [];
        if (newCampaign.industry) filters.push(newCampaign.industry);
        if (newCampaign.companySize) filters.push(`${newCampaign.companySize} employees`);
        if (newCampaign.location) filters.push(`${newCampaign.location} (${newCampaign.radius} miles)`);
        if (newCampaign.revenueRange) filters.push(`Revenue: ${newCampaign.revenueRange}`);
        searchCriteria = filters.length > 0 ? filters.join(', ') : 'All businesses';
      }
      
      const campaignData = {
        name: newCampaign.name || `Campaign ${campaigns.length + 1}`,
        templateId: newCampaign.templateId,
        searchCriteria,
        searchMethod: newCampaign.searchMethod,
        industryTarget: newCampaign.industry,
        companySizeTarget: newCampaign.companySize,
        geographicTarget: newCampaign.location ? {
          location: newCampaign.location,
          radius: newCampaign.radius
        } : null
      };

      const newCampaignResponse = await api.createCampaign(campaignData);
      
      // Reload campaigns
      await loadData();
      
      setShowCampaignModal(false);
      setCampaignStep('template');
      
      // Reset form
      setNewCampaign({
        name: '',
        templateId: null,
        searchMethod: 'ai_descriptive',
        searchQuery: '',
        location: '',
        radius: '10',
        industry: '',
        companySize: '',
        revenueRange: '',
        excludePrevious: true
      });
    } catch (err) {
      console.error('Failed to create campaign:', err);
      alert('Failed to create campaign. Please try again.');
    }
  };

  const handleCampaignAction = async (campaignId: string, action: 'pause' | 'resume' | 'delete') => {
    try {
      if (action === 'delete') {
        await api.deleteCampaign(campaignId);
      } else {
        const status = action === 'pause' ? 'paused' : 'active';
        await api.updateCampaignStatus(campaignId, status);
      }
      await loadData();
    } catch (err) {
      console.error(`Failed to ${action} campaign:`, err);
      alert(`Failed to ${action} campaign. Please try again.`);
    }
  };

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive mb-4">
              <AlertCircle className="h-5 w-5" />
              <p className="font-medium">Connection Error</p>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={loadData} variant="outline" className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Rest of the component remains the same as the original page.tsx */}
      {/* Just replace state updates with API calls */}
      
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
              <button 
                onClick={() => setActiveView('templates')}
                className={`text-sm font-medium transition-colors ${
                  activeView === 'templates' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Templates
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

      {/* Main Content - continues with campaigns, templates views etc. */}
      {/* ... rest of the component */}

      {/* Template Modal with API integration */}
      <TemplateModal 
        showModal={showTemplateModal}
        setShowModal={setShowTemplateModal}
        editingTemplate={editingTemplate}
        setEditingTemplate={setEditingTemplate}
        templates={templates}
        setTemplates={async (newTemplates) => {
          // If it's a function, we need to handle the update differently
          if (typeof newTemplates === 'function') {
            const updated = newTemplates(templates);
            setTemplates(updated);
          } else {
            setTemplates(newTemplates);
          }
          // Reload from API to ensure consistency
          await loadData();
        }}
      />
    </div>
  );
}