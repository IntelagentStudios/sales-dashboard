import axios from 'axios';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

class ProxyRotator {
  constructor(options = {}) {
    this.proxies = [];
    this.currentIndex = 0;
    this.failedProxies = new Map();
    this.maxFailures = options.maxFailures || 3;
    this.testTimeout = options.testTimeout || 5000;
    this.useProxies = options.useProxies || false;
    
    // Free proxy sources (use with caution in production)
    this.proxySources = [
      'https://www.proxy-list.download/api/v1/get?type=https',
      'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=5000&ssl=yes'
    ];
  }

  async initialize() {
    if (!this.useProxies) {
      logger.info('Proxy rotation disabled');
      return;
    }
    
    await this.fetchProxies();
    
    if (this.proxies.length === 0) {
      logger.warn('No proxies available, continuing without proxy');
      this.useProxies = false;
    } else {
      logger.info(`Initialized with ${this.proxies.length} proxies`);
    }
  }

  async fetchProxies() {
    const fetchedProxies = [];
    
    for (const source of this.proxySources) {
      try {
        const response = await axios.get(source, { timeout: 10000 });
        const proxyList = response.data.split('\n')
          .filter(line => line.trim())
          .map(line => {
            const parts = line.trim().split(':');
            if (parts.length === 2) {
              return {
                host: parts[0],
                port: parseInt(parts[1]),
                protocol: 'http'
              };
            }
            return null;
          })
          .filter(proxy => proxy !== null);
        
        fetchedProxies.push(...proxyList);
      } catch (error) {
        logger.error(`Failed to fetch proxies from ${source}:`, error.message);
      }
    }
    
    // Test proxies and keep only working ones
    const workingProxies = await this.testProxies(fetchedProxies.slice(0, 20)); // Test first 20
    this.proxies = workingProxies;
  }

  async testProxies(proxies) {
    const workingProxies = [];
    
    const testPromises = proxies.map(async (proxy) => {
      try {
        const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
        const response = await axios.get('https://httpbin.org/ip', {
          proxy: {
            host: proxy.host,
            port: proxy.port
          },
          timeout: this.testTimeout
        });
        
        if (response.status === 200) {
          logger.info(`Proxy working: ${proxyUrl}`);
          return proxy;
        }
      } catch (error) {
        // Proxy failed test
      }
      return null;
    });
    
    const results = await Promise.all(testPromises);
    return results.filter(proxy => proxy !== null);
  }

  getNextProxy() {
    if (!this.useProxies || this.proxies.length === 0) {
      return null;
    }
    
    // Find next working proxy
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      const proxyKey = `${proxy.host}:${proxy.port}`;
      
      // Check if proxy has failed too many times
      const failures = this.failedProxies.get(proxyKey) || 0;
      if (failures < this.maxFailures) {
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
      }
      
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      attempts++;
    }
    
    // All proxies have failed
    logger.warn('All proxies have failed, continuing without proxy');
    this.useProxies = false;
    return null;
  }

  markProxyFailed(proxy) {
    if (!proxy) return;
    
    const proxyKey = `${proxy.host}:${proxy.port}`;
    const failures = this.failedProxies.get(proxyKey) || 0;
    this.failedProxies.set(proxyKey, failures + 1);
    
    logger.warn(`Proxy failed: ${proxyKey} (${failures + 1} failures)`);
    
    // Remove proxy if it has failed too many times
    if (failures + 1 >= this.maxFailures) {
      this.removeProxy(proxy);
    }
  }

  markProxySuccess(proxy) {
    if (!proxy) return;
    
    const proxyKey = `${proxy.host}:${proxy.port}`;
    this.failedProxies.delete(proxyKey);
  }

  removeProxy(proxy) {
    const index = this.proxies.findIndex(p => 
      p.host === proxy.host && p.port === proxy.port
    );
    
    if (index !== -1) {
      this.proxies.splice(index, 1);
      logger.info(`Removed failed proxy: ${proxy.host}:${proxy.port}`);
      
      if (this.proxies.length === 0) {
        logger.warn('No more proxies available');
        this.useProxies = false;
      }
    }
  }

  getProxyConfig(proxy) {
    if (!proxy) return null;
    
    return {
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol || 'http'
    };
  }

  async makeRequestWithProxy(url, options = {}) {
    const proxy = this.getNextProxy();
    
    const config = {
      ...options,
      url,
      timeout: options.timeout || 10000
    };
    
    if (proxy) {
      config.proxy = this.getProxyConfig(proxy);
    }
    
    try {
      const response = await axios(config);
      this.markProxySuccess(proxy);
      return response;
    } catch (error) {
      this.markProxyFailed(proxy);
      
      // Retry without proxy if all proxies fail
      if (!this.useProxies) {
        return await axios({ ...options, url });
      }
      
      throw error;
    }
  }

  getStats() {
    return {
      totalProxies: this.proxies.length,
      failedProxies: this.failedProxies.size,
      currentIndex: this.currentIndex,
      useProxies: this.useProxies
    };
  }

  reset() {
    this.currentIndex = 0;
    this.failedProxies.clear();
    logger.info('Proxy rotator reset');
  }

  async refreshProxies() {
    logger.info('Refreshing proxy list...');
    this.proxies = [];
    this.failedProxies.clear();
    this.currentIndex = 0;
    await this.initialize();
  }
}

export default ProxyRotator;