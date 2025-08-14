"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  X,
  Palette,
  Code,
  FileText,
  ChevronRight,
  ArrowLeft,
  Upload,
  Wand2
} from "lucide-react";

interface TemplateModalProps {
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  editingTemplate: any;
  setEditingTemplate: (template: any) => void;
  templates: any[];
  setTemplates: (templates: any[]) => void;
}

export function TemplateModal({ 
  showModal, 
  setShowModal, 
  editingTemplate, 
  setEditingTemplate,
  templates,
  setTemplates 
}: TemplateModalProps) {
  const [currentStep, setCurrentStep] = useState<'basic' | 'design' | 'preview'>('basic');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importedEmail, setImportedEmail] = useState('');
  
  const [templateData, setTemplateData] = useState({
    name: editingTemplate?.name || '',
    description: editingTemplate?.description || '',
    productService: editingTemplate?.productService || '',
    painPoints: editingTemplate?.painPoints?.join('\n') || '',
    valueProps: editingTemplate?.valueProps?.join('\n') || '',
    callToAction: editingTemplate?.callToAction || '',
    pricing: editingTemplate?.pricing || '',
    successStories: editingTemplate?.successStories || '',
    tone: editingTemplate?.tone || 'professional',
    emailDesign: editingTemplate?.emailDesign || 'plain',
    customHTML: editingTemplate?.customHTML || '',
    brandColors: editingTemplate?.brandColors || { primary: '#000000', secondary: '#666666' },
    logo: editingTemplate?.logo || ''
  });

  const handleImportEmail = () => {
    // Extract patterns from the pasted email
    const lines = importedEmail.split('\n');
    
    // Extract greeting style
    const greetingMatch = importedEmail.match(/^(Hi|Hello|Dear|Hey)\s+(\[?\w+\]?)/m);
    
    // Extract signature
    const signatureStart = importedEmail.lastIndexOf('\n\n');
    const signature = signatureStart > -1 ? importedEmail.substring(signatureStart).trim() : '';
    
    // Extract any "Best regards", "Sincerely", etc.
    const closingMatch = importedEmail.match(/(Best regards|Sincerely|Thanks|Best|Regards|Cheers),?\s*\n/i);
    
    // Extract potential company name from signature
    const companyMatch = signature.match(/(?:^|\n)([A-Z][A-Za-z\s&]+(?:Inc|LLC|Ltd|Corporation|Corp|Co|Company))/);
    
    // Build a smart template structure
    const smartTemplate = `Hi {{recipientName}},

{{personalizedIntro}}

${templateData.productService || '{{productDescription}}'}

{{valueProps}}

{{callToAction}}

${closingMatch ? closingMatch[1] : 'Best regards'},
{{senderName}}
${signature.replace(/^(Best regards|Sincerely|Thanks|Best|Regards|Cheers),?\s*\n/i, '').trim()}`;

    // Update template with extracted style
    setTemplateData({
      ...templateData,
      customHTML: smartTemplate,
      emailDesign: 'custom',
      tone: greetingMatch && greetingMatch[1].toLowerCase() === 'hey' ? 'friendly' : 'professional'
    });
    
    setShowImportDialog(false);
    setImportedEmail('');
    
    // Move to design step to show the imported template
    setCurrentStep('design');
  };

  const handleSaveTemplate = () => {
    const template = {
      id: editingTemplate?.id || Date.now(),
      name: templateData.name,
      description: templateData.description,
      productService: templateData.productService,
      painPoints: templateData.painPoints.split('\n').filter(p => p.trim()),
      valueProps: templateData.valueProps.split('\n').filter(v => v.trim()),
      callToAction: templateData.callToAction,
      pricing: templateData.pricing,
      successStories: templateData.successStories,
      tone: templateData.tone,
      emailDesign: templateData.emailDesign,
      customHTML: templateData.customHTML,
      brandColors: templateData.brandColors,
      logo: templateData.logo
    };

    if (editingTemplate) {
      setTemplates(templates.map(t => t.id === editingTemplate.id ? template : t));
    } else {
      setTemplates([...templates, template]);
    }

    setShowModal(false);
    setEditingTemplate(null);
    setCurrentStep('basic');
  };

  if (!showModal) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{editingTemplate ? 'Edit Template' : 'Create Outreach Template'}</CardTitle>
            <CardDescription>
              {currentStep === 'basic' && 'Define your product and messaging'}
              {currentStep === 'design' && 'Customize email design and branding'}
              {currentStep === 'preview' && 'Review your template'}
            </CardDescription>
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => {
              setShowModal(false);
              setEditingTemplate(null);
              setCurrentStep('basic');
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className={`flex items-center gap-2 ${currentStep === 'basic' ? 'text-primary' : 'text-muted-foreground'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${currentStep === 'basic' ? 'border-primary bg-primary/10' : 'border-muted-foreground'}`}>
                1
              </div>
              <span className="text-sm font-medium">Messaging</span>
            </div>
            <div className="w-12 h-0.5 bg-border" />
            <div className={`flex items-center gap-2 ${currentStep === 'design' ? 'text-primary' : 'text-muted-foreground'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${currentStep === 'design' ? 'border-primary bg-primary/10' : 'border-muted-foreground'}`}>
                2
              </div>
              <span className="text-sm font-medium">Design</span>
            </div>
            <div className="w-12 h-0.5 bg-border" />
            <div className={`flex items-center gap-2 ${currentStep === 'preview' ? 'text-primary' : 'text-muted-foreground'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${currentStep === 'preview' ? 'border-primary bg-primary/10' : 'border-muted-foreground'}`}>
                3
              </div>
              <span className="text-sm font-medium">Preview</span>
            </div>
          </div>

          {/* Basic Info Step */}
          {currentStep === 'basic' && (
            <div className="space-y-4">
              {/* Import Email Button */}
              <div className="flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowImportDialog(true)}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import from Existing Email
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Template Name *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                    placeholder="e.g., SaaS Platform - Enterprise"
                    value={templateData.name}
                    onChange={(e) => setTemplateData({...templateData, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Call to Action *</label>
                  <select 
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                    value={templateData.callToAction}
                    onChange={(e) => setTemplateData({...templateData, callToAction: e.target.value})}
                  >
                    <option value="">Select CTA...</option>
                    <option value="Book a Demo">Book a Demo</option>
                    <option value="Start Free Trial">Start Free Trial</option>
                    <option value="Schedule Consultation">Schedule Consultation</option>
                    <option value="Get Quote">Get Quote</option>
                    <option value="Learn More">Learn More</option>
                    <option value="Download Resource">Download Resource</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Product/Service Description *</label>
                <textarea
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                  rows={3}
                  placeholder="Briefly describe what you're offering..."
                  value={templateData.productService}
                  onChange={(e) => setTemplateData({...templateData, productService: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Pain Points You Solve *</label>
                  <textarea
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                    rows={4}
                    placeholder="One per line:
• Slow manual processes
• High operational costs
• Poor customer visibility"
                    value={templateData.painPoints}
                    onChange={(e) => setTemplateData({...templateData, painPoints: e.target.value})}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Key Value Propositions *</label>
                  <textarea
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                    rows={4}
                    placeholder="One per line:
• 50% time savings
• ROI in 3 months
• 24/7 support"
                    value={templateData.valueProps}
                    onChange={(e) => setTemplateData({...templateData, valueProps: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Pricing Information (Optional)</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                  placeholder="e.g., Starting at $99/month or Custom pricing"
                  value={templateData.pricing}
                  onChange={(e) => setTemplateData({...templateData, pricing: e.target.value})}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Success Stories (Optional)</label>
                <textarea
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                  rows={3}
                  placeholder="Brief case studies or client wins..."
                  value={templateData.successStories}
                  onChange={(e) => setTemplateData({...templateData, successStories: e.target.value})}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Tone of Voice</label>
                <select 
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                  value={templateData.tone}
                  onChange={(e) => setTemplateData({...templateData, tone: e.target.value})}
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly & Casual</option>
                  <option value="authoritative">Authoritative</option>
                  <option value="conversational">Conversational</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
          )}

          {/* Design Step */}
          {currentStep === 'design' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Email Design Style</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setTemplateData({...templateData, emailDesign: 'plain'})}
                    className={`p-4 rounded-lg border text-center transition-colors ${
                      templateData.emailDesign === 'plain' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <FileText className="h-6 w-6 mx-auto mb-2" />
                    <div className="text-sm font-medium">Plain Text</div>
                    <div className="text-xs text-muted-foreground mt-1">Simple, deliverable</div>
                  </button>
                  
                  <button
                    onClick={() => setTemplateData({...templateData, emailDesign: 'branded'})}
                    className={`p-4 rounded-lg border text-center transition-colors ${
                      templateData.emailDesign === 'branded' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <Palette className="h-6 w-6 mx-auto mb-2" />
                    <div className="text-sm font-medium">Branded</div>
                    <div className="text-xs text-muted-foreground mt-1">With your colors & logo</div>
                  </button>
                  
                  <button
                    onClick={() => setTemplateData({...templateData, emailDesign: 'custom'})}
                    className={`p-4 rounded-lg border text-center transition-colors ${
                      templateData.emailDesign === 'custom' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <Code className="h-6 w-6 mx-auto mb-2" />
                    <div className="text-sm font-medium">Custom HTML</div>
                    <div className="text-xs text-muted-foreground mt-1">Full control</div>
                  </button>
                </div>
              </div>

              {templateData.emailDesign === 'branded' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Primary Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          className="w-12 h-10 rounded border"
                          value={templateData.brandColors.primary}
                          onChange={(e) => setTemplateData({...templateData, brandColors: {...templateData.brandColors, primary: e.target.value}})}
                        />
                        <input
                          type="text"
                          className="flex-1 px-3 py-2 bg-background border rounded-md text-sm"
                          value={templateData.brandColors.primary}
                          onChange={(e) => setTemplateData({...templateData, brandColors: {...templateData.brandColors, primary: e.target.value}})}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Secondary Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          className="w-12 h-10 rounded border"
                          value={templateData.brandColors.secondary}
                          onChange={(e) => setTemplateData({...templateData, brandColors: {...templateData.brandColors, secondary: e.target.value}})}
                        />
                        <input
                          type="text"
                          className="flex-1 px-3 py-2 bg-background border rounded-md text-sm"
                          value={templateData.brandColors.secondary}
                          onChange={(e) => setTemplateData({...templateData, brandColors: {...templateData.brandColors, secondary: e.target.value}})}
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Logo URL</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                      placeholder="https://yourcompany.com/logo.png"
                      value={templateData.logo}
                      onChange={(e) => setTemplateData({...templateData, logo: e.target.value})}
                    />
                  </div>
                </>
              )}

              {templateData.emailDesign === 'custom' && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Custom HTML Template</label>
                  <textarea
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono"
                    rows={12}
                    placeholder="Enter your HTML email template with variables:
{{recipientName}} - Recipient's name
{{recipientCompany}} - Company name
{{productService}} - Your product/service
{{valueProps}} - Value propositions
{{callToAction}} - CTA button
{{senderName}} - Your name
{{senderTitle}} - Your title"
                    value={templateData.customHTML}
                    onChange={(e) => setTemplateData({...templateData, customHTML: e.target.value})}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Use variables above to personalize your template. They will be replaced with actual data.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Preview Step */}
          {currentStep === 'preview' && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Template Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="font-medium">Name:</span> {templateData.name}
                    </div>
                    <div>
                      <span className="font-medium">CTA:</span> {templateData.callToAction}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Product:</span> {templateData.productService}
                  </div>
                  <div>
                    <span className="font-medium">Email Style:</span> {templateData.emailDesign}
                  </div>
                  <div>
                    <span className="font-medium">Tone:</span> {templateData.tone}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sample Email Preview</CardTitle>
                  <CardDescription>This is how your email might look</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={`p-4 rounded border ${templateData.emailDesign === 'branded' ? 'bg-white' : 'bg-background'}`}>
                    {templateData.emailDesign === 'branded' && templateData.logo && (
                      <img src={templateData.logo} alt="Logo" className="h-8 mb-4" />
                    )}
                    <p className="mb-3">Hi [Recipient Name],</p>
                    <p className="mb-3">I noticed [Personalized observation about their company].</p>
                    <p className="mb-3">{templateData.productService}</p>
                    {templateData.painPoints && (
                      <p className="mb-3">We help companies like yours solve: {templateData.painPoints.split('\n')[0]}</p>
                    )}
                    {templateData.valueProps && (
                      <p className="mb-3">Our clients typically see: {templateData.valueProps.split('\n')[0]}</p>
                    )}
                    <p className="mb-4">Would you be interested in a brief conversation to explore how we could help [Their Company]?</p>
                    <div className="mt-4">
                      <Button 
                        style={{
                          backgroundColor: templateData.emailDesign === 'branded' ? templateData.brandColors.primary : undefined
                        }}
                      >
                        {templateData.callToAction}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between pt-4 border-t">
            <div>
              {currentStep !== 'basic' && (
                <Button 
                  variant="outline"
                  onClick={() => {
                    if (currentStep === 'design') setCurrentStep('basic');
                    if (currentStep === 'preview') setCurrentStep('design');
                  }}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowModal(false);
                  setEditingTemplate(null);
                  setCurrentStep('basic');
                }}
              >
                Cancel
              </Button>
              {currentStep !== 'preview' ? (
                <Button 
                  onClick={() => {
                    if (currentStep === 'basic') setCurrentStep('design');
                    if (currentStep === 'design') setCurrentStep('preview');
                  }}
                  disabled={
                    !templateData.name || 
                    !templateData.productService || 
                    !templateData.painPoints || 
                    !templateData.valueProps ||
                    !templateData.callToAction
                  }
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={handleSaveTemplate}>
                  {editingTemplate ? 'Update Template' : 'Create Template'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import Email Dialog */}
      {showImportDialog && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Import Email Style</CardTitle>
                <CardDescription>
                  Paste an existing email to automatically extract its style and structure
                </CardDescription>
              </div>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setShowImportDialog(false);
                  setImportedEmail('');
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Paste Your Email</label>
                <textarea
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono"
                  rows={12}
                  placeholder="Copy and paste an email you've sent before. Include everything from greeting to signature.

Example:
Hi John,

I hope this email finds you well. I wanted to reach out because...

[Your message content]

Best regards,
Sarah Smith
Sales Director
Acme Corporation
sarah@acme.com
(555) 123-4567"
                  value={importedEmail}
                  onChange={(e) => setImportedEmail(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  The system will extract your greeting style, closing, signature format, and overall structure.
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <Button 
                  variant="outline"
                  onClick={() => {
                    setShowImportDialog(false);
                    setImportedEmail('');
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleImportEmail}
                  disabled={!importedEmail.trim()}
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Extract Style
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}