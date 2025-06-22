export class LoadBalancer {
  constructor(strategy = 'round-robin') {
    this.strategy = strategy;
    this.counters = new Map();
    this.weights = new Map();
    this.stats = new Map();
    this.customStrategies = new Map();
    
    // Built-in strategies
    this.strategies = {
      'round-robin': this.roundRobin.bind(this),
      'random': this.random.bind(this),
      'least-connections': this.leastConnections.bind(this),
      'weighted': this.weighted.bind(this),
      'ip-hash': this.ipHash.bind(this),
      'least-latency': this.leastLatency.bind(this),
      'first': this.first.bind(this)
    };
  }

  next(serviceName, services, context = {}) {
    if (!services || services.length === 0) {
      throw new Error('No services available');
    }

    if (services.length === 1) {
      this.recordSelection(serviceName, services[0]);
      return services[0];
    }

    const strategyFn = this.strategies[this.strategy] || 
                      this.customStrategies.get(this.strategy) ||
                      this.strategies['round-robin'];

    const selected = strategyFn(serviceName, services, context);
    this.recordSelection(serviceName, selected);
    
    return selected;
  }

  // Round-robin strategy
  roundRobin(serviceName, services) {
    const counter = this.counters.get(serviceName) || 0;
    const index = counter % services.length;
    this.counters.set(serviceName, counter + 1);
    
    return services[index];
  }

  // Random strategy
  random(serviceName, services) {
    const index = Math.floor(Math.random() * services.length);
    return services[index];
  }

  // Least connections (requires connection tracking)
  leastConnections(serviceName, services) {
    let minConnections = Infinity;
    let selected = services[0];
    
    for (const service of services) {
      const key = `${service.address}:${service.port}`;
      const stats = this.stats.get(key) || { connections: 0 };
      
      if (stats.connections < minConnections) {
        minConnections = stats.connections;
        selected = service;
      }
    }
    
    return selected;
  }

  // Weighted round-robin
  weighted(serviceName, services) {
    const weights = this.weights.get(serviceName) || this.calculateWeights(services);
    this.weights.set(serviceName, weights);
    
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    
    if (totalWeight === 0) {
      return this.roundRobin(serviceName, services);
    }
    
    const counter = this.counters.get(serviceName) || 0;
    this.counters.set(serviceName, counter + 1);
    
    let random = (counter % totalWeight) + 1;
    let accumulated = 0;
    
    for (let i = 0; i < weights.length; i++) {
      accumulated += weights[i].weight;
      if (random <= accumulated) {
        return weights[i].service;
      }
    }
    
    return services[0];
  }

  // IP hash (for session affinity)
  ipHash(serviceName, services, context) {
    const ip = context.clientIp || context.ip || '127.0.0.1';
    const hash = this.hashString(ip);
    const index = hash % services.length;
    
    return services[index];
  }

  // Least latency (requires latency tracking)
  leastLatency(serviceName, services) {
    let minLatency = Infinity;
    let selected = services[0];
    
    for (const service of services) {
      const key = `${service.address}:${service.port}`;
      const stats = this.stats.get(key) || { latency: 0 };
      
      if (stats.latency < minLatency) {
        minLatency = stats.latency;
        selected = service;
      }
    }
    
    return selected;
  }

  // First available
  first(serviceName, services) {
    return services[0];
  }

  // Set strategy
  setStrategy(strategy) {
    if (!this.strategies[strategy] && !this.customStrategies.has(strategy)) {
      throw new Error(`Unknown load balancing strategy: ${strategy}`);
    }
    this.strategy = strategy;
  }

  // Add custom strategy
  addStrategy(name, strategyFn) {
    this.customStrategies.set(name, strategyFn);
  }

  // Set weights for weighted strategy
  setWeights(serviceName, weights) {
    const weightMap = weights.map(w => ({
      service: w.service,
      weight: w.weight || 1
    }));
    this.weights.set(serviceName, weightMap);
  }

  // Calculate default weights based on service metadata
  calculateWeights(services) {
    return services.map(service => ({
      service,
      weight: service.weight || service.metadata?.weight || 1
    }));
  }

  // Update statistics
  updateStats(serviceKey, stats) {
    const current = this.stats.get(serviceKey) || {
      connections: 0,
      requests: 0,
      errors: 0,
      latency: 0,
      lastUpdate: new Date()
    };
    
    this.stats.set(serviceKey, {
      ...current,
      ...stats,
      lastUpdate: new Date()
    });
  }

  // Record connection
  recordConnection(service, increment = 1) {
    const key = `${service.address}:${service.port}`;
    const stats = this.stats.get(key) || { connections: 0 };
    stats.connections += increment;
    this.stats.set(key, stats);
  }

  // Record latency
  recordLatency(service, latency) {
    const key = `${service.address}:${service.port}`;
    const stats = this.stats.get(key) || { latency: 0, latencyCount: 0 };
    
    // Calculate moving average
    stats.latencyCount = (stats.latencyCount || 0) + 1;
    stats.latency = ((stats.latency * (stats.latencyCount - 1)) + latency) / stats.latencyCount;
    
    this.stats.set(key, stats);
  }

  // Record selection
  recordSelection(serviceName, service) {
    const key = `${service.address}:${service.port}`;
    const stats = this.stats.get(key) || { selections: 0 };
    stats.selections = (stats.selections || 0) + 1;
    stats.lastSelected = new Date();
    this.stats.set(key, stats);
  }

  // Hash string to number
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // Get statistics
  getStats() {
    const stats = {
      strategy: this.strategy,
      services: {}
    };
    
    for (const [key, value] of this.stats.entries()) {
      stats.services[key] = value;
    }
    
    return stats;
  }

  // Reset statistics
  resetStats() {
    this.stats.clear();
    this.counters.clear();
  }

  // Health-aware selection
  selectHealthy(serviceName, services, context = {}) {
    const healthy = services.filter(s => 
      !s.health || s.health.status === 'healthy'
    );
    
    if (healthy.length === 0) {
      // Fall back to degraded services
      const degraded = services.filter(s => 
        s.health && s.health.status === 'degraded'
      );
      
      if (degraded.length > 0) {
        return this.next(serviceName, degraded, context);
      }
      
      throw new Error('No healthy services available');
    }
    
    return this.next(serviceName, healthy, context);
  }
}