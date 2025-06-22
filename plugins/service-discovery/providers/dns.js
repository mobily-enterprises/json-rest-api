import dns from 'dns/promises';
import { EventEmitter } from 'events';

export class DNSProvider extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.domain = options.domain || 'service.local';
    this.resolver = new dns.Resolver();
    
    if (options.servers) {
      this.resolver.setServers(options.servers);
    }
    
    this.serviceFormat = options.serviceFormat || '_{service}._tcp.{domain}';
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 60000; // 1 minute
  }

  async register(service) {
    // DNS registration typically requires dynamic DNS update
    // or integration with DNS management API
    console.log(`DNS registration for ${service.name} requires external DNS management`);
    
    // For development, you might update a local DNS server
    // or use a service like Consul DNS
    
    return service;
  }

  async deregister(serviceId) {
    console.log(`DNS deregistration for ${serviceId} requires external DNS management`);
  }

  async discover(serviceName, options = {}) {
    const cacheKey = `${serviceName}:${JSON.stringify(options)}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.services;
      }
    }
    
    try {
      const services = [];
      
      // Try SRV records first
      const srvName = this.serviceFormat
        .replace('{service}', serviceName)
        .replace('{domain}', options.domain || this.domain);
      
      try {
        const srvRecords = await this.resolver.resolveSrv(srvName);
        
        for (const record of srvRecords) {
          // Resolve A/AAAA records for the target
          const addresses = await this.resolveAddresses(record.name);
          
          for (const address of addresses) {
            services.push({
              id: `${serviceName}-${address}-${record.port}`,
              name: serviceName,
              address: address,
              port: record.port,
              priority: record.priority,
              weight: record.weight,
              tags: [],
              metadata: {
                srvRecord: record,
                dnsName: record.name
              },
              health: { status: 'healthy' } // DNS records are assumed healthy
            });
          }
        }
      } catch (srvError) {
        // SRV lookup failed, try direct A/AAAA lookup
        const directName = options.directLookup || `${serviceName}.${this.domain}`;
        const addresses = await this.resolveAddresses(directName);
        
        for (const address of addresses) {
          services.push({
            id: `${serviceName}-${address}`,
            name: serviceName,
            address: address,
            port: options.defaultPort || 80,
            tags: [],
            metadata: {
              dnsName: directName
            },
            health: { status: 'healthy' }
          });
        }
      }
      
      // Try TXT records for metadata
      try {
        const txtName = `_${serviceName}._txt.${this.domain}`;
        const txtRecords = await this.resolver.resolveTxt(txtName);
        
        // Parse TXT records for service metadata
        for (const record of txtRecords) {
          const txt = record.join('');
          if (txt.startsWith('tags=')) {
            const tags = txt.substring(5).split(',');
            services.forEach(service => {
              service.tags = tags;
            });
          }
        }
      } catch (txtError) {
        // TXT records are optional
      }
      
      // Update cache
      this.cache.set(cacheKey, {
        services,
        timestamp: Date.now()
      });
      
      return services;
    } catch (error) {
      console.error('DNS discovery failed:', error);
      
      // Return cached results if available
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey).services;
      }
      
      throw error;
    }
  }

  async checkHealth(service) {
    // DNS doesn't provide health information
    // We can only check if the DNS record still exists
    try {
      const addresses = await this.resolveAddresses(
        service.metadata?.dnsName || service.name
      );
      
      const stillExists = addresses.includes(service.address);
      
      return {
        status: stillExists ? 'healthy' : 'unhealthy',
        reason: stillExists ? 'DNS record exists' : 'DNS record not found'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  async updateHealth(serviceId, health) {
    // DNS doesn't support health updates
    console.log(`Health updates not supported for DNS provider`);
  }

  async resolveAddresses(hostname) {
    const addresses = [];
    
    // Try IPv4
    try {
      const ipv4 = await this.resolver.resolve4(hostname);
      addresses.push(...ipv4);
    } catch (err) {
      // IPv4 lookup failed
    }
    
    // Try IPv6
    try {
      const ipv6 = await this.resolver.resolve6(hostname);
      addresses.push(...ipv6);
    } catch (err) {
      // IPv6 lookup failed
    }
    
    if (addresses.length === 0) {
      throw new Error(`No addresses found for ${hostname}`);
    }
    
    return addresses;
  }

  // DNS-specific features
  async discoverWithNAPTR(serviceName, protocol = 'tcp') {
    try {
      const naptrName = `${serviceName}.${this.domain}`;
      const records = await this.resolver.resolveNaptr(naptrName);
      
      const services = [];
      
      for (const record of records) {
        if (record.service === protocol) {
          // Follow the replacement
          const srvRecords = await this.resolver.resolveSrv(record.replacement);
          
          for (const srv of srvRecords) {
            const addresses = await this.resolveAddresses(srv.name);
            
            for (const address of addresses) {
              services.push({
                id: `${serviceName}-${address}-${srv.port}`,
                name: serviceName,
                address: address,
                port: srv.port,
                priority: record.order,
                preference: record.preference,
                tags: [record.service],
                metadata: {
                  flags: record.flags,
                  regexp: record.regexp,
                  replacement: record.replacement
                },
                health: { status: 'healthy' }
              });
            }
          }
        }
      }
      
      return services;
    } catch (error) {
      console.error('NAPTR discovery failed:', error);
      return [];
    }
  }

  async watchService(serviceName, callback, pollInterval = 30000) {
    let lastResults = [];
    
    const poll = async () => {
      try {
        const services = await this.discover(serviceName);
        
        // Check if results changed
        const changed = JSON.stringify(services) !== JSON.stringify(lastResults);
        
        if (changed) {
          lastResults = services;
          callback(services);
        }
      } catch (error) {
        console.error('DNS watch error:', error);
      }
    };
    
    // Initial poll
    poll();
    
    // Set up polling
    const interval = setInterval(poll, pollInterval);
    
    // Return cleanup function
    return {
      stop: () => clearInterval(interval)
    };
  }

  clearCache() {
    this.cache.clear();
  }
}