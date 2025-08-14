const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ApiConfig {
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
    return this.token;
  }

  async request(endpoint: string, config: ApiConfig = {}) {
    const url = `${API_URL}${endpoint}`;
    const token = this.getToken();
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: config.method || 'GET',
        headers,
        body: config.body ? JSON.stringify(config.body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Request failed:', error);
      throw error;
    }
  }

  // Lead Discovery
  async discoverLeads(source: string, params: Record<string, unknown>) {
    return this.request(`/api/discover/${source}`, {
      method: 'POST',
      body: params,
    });
  }

  // Campaign Management
  async getCampaigns() {
    return this.request('/api/campaigns');
  }

  async createCampaign(data: Record<string, unknown>) {
    return this.request('/api/campaigns', {
      method: 'POST',
      body: data,
    });
  }

  // Lead Management
  async getLeads(filters?: Record<string, string>) {
    const queryString = filters ? `?${new URLSearchParams(filters).toString()}` : '';
    return this.request(`/api/leads${queryString}`);
  }

  async getLead(id: string) {
    return this.request(`/api/leads/${id}`);
  }

  // Analytics
  async getAnalytics(days: number = 30) {
    return this.request(`/api/analytics/dashboard?days=${days}`);
  }

  // Email Operations
  async sendEmail(data: Record<string, unknown>) {
    return this.request('/api/email/send', {
      method: 'POST',
      body: data,
    });
  }

  // Job Queue Stats
  async getJobStats() {
    return this.request('/api/jobs/stats');
  }
}

export const api = new ApiClient();
export default api;