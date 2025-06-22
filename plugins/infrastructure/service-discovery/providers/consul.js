import Consul from 'consul';

export class ConsulProvider {
  constructor(options = {}) {
    this.consul = new Consul({
      host: options.host || '127.0.0.1',
      port: options.port || 8500,
      secure: options.secure || false,
      token: options.token,
      ...options
    });
    
    this.checkInterval = options.checkInterval || '30s';
    this.deregisterAfter = options.deregisterAfter || '2m';
  }

  async register(service) {
    const registration = {
      id: service.id,
      name: service.name,
      address: service.address,
      port: parseInt(service.port),
      tags: service.tags || [],
      meta: service.metadata || {},
      check: this.buildHealthCheck(service),
      enableTagOverride: false
    };

    await this.consul.agent.service.register(registration);

    return service;
  }

  async deregister(serviceId) {
    await this.consul.agent.service.deregister(serviceId);
  }

  async discover(serviceName, options = {}) {
    const opts = {
      service: serviceName,
      passing: options.healthyOnly !== false
    };

    if (options.tag) {
      opts.tag = options.tag;
    }

    const services = await this.consul.health.service(opts);
    
    return services.map(entry => ({
      id: entry.Service.ID,
      name: entry.Service.Service,
      address: entry.Service.Address || entry.Node.Address,
      port: entry.Service.Port,
      tags: entry.Service.Tags || [],
      metadata: entry.Service.Meta || {},
      health: {
        status: this.getHealthStatus(entry.Checks),
        checks: entry.Checks
      },
      node: {
        name: entry.Node.Node,
        address: entry.Node.Address,
        metadata: entry.Node.Meta
      }
    }));
  }

  async checkHealth(service) {
    try {
      const checks = await this.consul.health.checks(service.name);
      const serviceChecks = checks.filter(check => 
        check.ServiceID === service.id
      );
      
      return {
        status: this.getHealthStatus(serviceChecks),
        checks: serviceChecks,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  async updateHealth(serviceId, health) {
    // In Consul, health is updated via the check endpoint
    const checkId = `service:${serviceId}`;
    
    if (health.status === 'healthy') {
      await this.consul.agent.check.pass(checkId);
    } else if (health.status === 'unhealthy') {
      await this.consul.agent.check.fail(checkId, health.reason || 'Health check failed');
    } else {
      await this.consul.agent.check.warn(checkId, health.reason || 'Service degraded');
    }
  }

  buildHealthCheck(service) {
    const check = {
      interval: this.checkInterval,
      deregistercriticalserviceafter: this.deregisterAfter
    };

    if (service.healthEndpoint) {
      check.http = `http://${service.address}:${service.port}${service.healthEndpoint}`;
      check.method = service.healthMethod || 'GET';
    } else if (service.tcpCheck !== false) {
      check.tcp = `${service.address}:${service.port}`;
    } else {
      // TTL check - service must update health periodically
      check.ttl = this.checkInterval;
    }

    if (service.healthTimeout) {
      check.timeout = service.healthTimeout;
    }

    return check;
  }

  getHealthStatus(checks) {
    if (!checks || checks.length === 0) {
      return 'healthy';
    }

    const hasFailure = checks.some(check => 
      check.Status === 'critical'
    );
    
    if (hasFailure) {
      return 'unhealthy';
    }

    const hasWarning = checks.some(check => 
      check.Status === 'warning'
    );
    
    if (hasWarning) {
      return 'degraded';
    }

    return 'healthy';
  }

  // Consul-specific features
  async getServiceConfig(serviceName, key) {
    try {
      const result = await this.consul.kv.get(`service/${serviceName}/${key}`);
      return result ? result.Value : null;
    } catch (error) {
      return null;
    }
  }

  async setServiceConfig(serviceName, key, value) {
    await this.consul.kv.set(
      `service/${serviceName}/${key}`,
      typeof value === 'string' ? value : JSON.stringify(value)
    );
  }

  async watchService(serviceName, callback) {
    const watch = this.consul.watch({
      method: this.consul.health.service,
      options: {
        service: serviceName,
        passing: true
      }
    });

    watch.on('change', (data, res) => {
      const services = data.map(entry => ({
        id: entry.Service.ID,
        name: entry.Service.Service,
        address: entry.Service.Address || entry.Node.Address,
        port: entry.Service.Port,
        tags: entry.Service.Tags || [],
        metadata: entry.Service.Meta || {}
      }));
      
      callback(services);
    });

    watch.on('error', err => {
      console.error('Consul watch error:', err);
    });

    return watch;
  }
}