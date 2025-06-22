import https from 'https';
import fs from 'fs';
import { EventEmitter } from 'events';

export class KubernetesProvider extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.namespace = options.namespace || 'default';
    this.labelSelector = options.selector || {};
    this.fieldSelector = options.fieldSelector || {};
    
    // Auto-detect if running in cluster
    if (fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token')) {
      // In-cluster configuration
      this.token = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
      this.ca = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8');
      this.apiServer = 'https://kubernetes.default.svc';
    } else {
      // External configuration
      this.apiServer = options.apiServer || 'https://localhost:6443';
      this.token = options.token || process.env.K8S_TOKEN;
      this.ca = options.ca;
      
      // Try to load from kubeconfig
      if (!this.token && options.kubeconfig) {
        this.loadKubeconfig(options.kubeconfig);
      }
    }
    
    this.watchConnections = new Map();
  }

  async register(service) {
    // In Kubernetes, services are typically managed by deployments
    // This is a no-op for most cases
    console.log(`Service ${service.name} registration managed by Kubernetes`);
    return service;
  }

  async deregister(serviceId) {
    // In Kubernetes, pod lifecycle is managed by the platform
    console.log(`Service ${serviceId} deregistration managed by Kubernetes`);
  }

  async discover(serviceName, options = {}) {
    try {
      // Get service endpoints
      const endpoints = await this.getEndpoints(serviceName);
      
      if (!endpoints || !endpoints.subsets) {
        return [];
      }
      
      const services = [];
      
      for (const subset of endpoints.subsets) {
        const ports = subset.ports || [];
        const addresses = subset.addresses || [];
        
        for (const address of addresses) {
          for (const port of ports) {
            const service = {
              id: `${serviceName}-${address.ip}-${port.port}`,
              name: serviceName,
              address: address.ip,
              port: port.port,
              tags: [],
              metadata: {
                namespace: this.namespace,
                portName: port.name,
                protocol: port.protocol,
                nodeName: address.nodeName,
                podName: address.targetRef?.name,
                podNamespace: address.targetRef?.namespace
              },
              health: {
                status: 'healthy', // Kubernetes only includes ready endpoints
                ready: true
              }
            };
            
            // Add pod labels as tags if available
            if (address.targetRef) {
              const pod = await this.getPod(address.targetRef.name);
              if (pod && pod.metadata.labels) {
                service.tags = Object.entries(pod.metadata.labels)
                  .map(([key, value]) => `${key}=${value}`);
              }
            }
            
            services.push(service);
          }
        }
      }
      
      return services;
    } catch (error) {
      console.error('Failed to discover services:', error);
      throw error;
    }
  }

  async checkHealth(service) {
    try {
      if (service.metadata?.podName) {
        const pod = await this.getPod(service.metadata.podName);
        
        if (!pod) {
          return { status: 'unhealthy', reason: 'Pod not found' };
        }
        
        const containerStatuses = pod.status.containerStatuses || [];
        const allReady = containerStatuses.every(status => status.ready);
        
        return {
          status: allReady ? 'healthy' : 'unhealthy',
          conditions: pod.status.conditions,
          containers: containerStatuses,
          phase: pod.status.phase
        };
      }
      
      return { status: 'healthy' };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  async updateHealth(serviceId, health) {
    // Health in Kubernetes is managed by readiness/liveness probes
    console.log(`Health update for ${serviceId} managed by Kubernetes probes`);
  }

  // Watch for service changes
  async watchService(serviceName, callback) {
    const watchPath = `/api/v1/namespaces/${this.namespace}/endpoints/${serviceName}`;
    
    return this.watch(watchPath, (event) => {
      if (event.type === 'ADDED' || event.type === 'MODIFIED') {
        this.discover(serviceName).then(services => {
          callback(services);
        });
      } else if (event.type === 'DELETED') {
        callback([]);
      }
    });
  }

  // Kubernetes API helpers
  async getEndpoints(name) {
    const path = `/api/v1/namespaces/${this.namespace}/endpoints/${name}`;
    return this.request('GET', path);
  }

  async getPod(name) {
    const path = `/api/v1/namespaces/${this.namespace}/pods/${name}`;
    try {
      return await this.request('GET', path);
    } catch (error) {
      return null;
    }
  }

  async getService(name) {
    const path = `/api/v1/namespaces/${this.namespace}/services/${name}`;
    return this.request('GET', path);
  }

  async listServices(selector = {}) {
    let path = `/api/v1/namespaces/${this.namespace}/services`;
    const params = [];
    
    if (Object.keys(selector).length > 0) {
      const labelSelector = Object.entries(selector)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
      params.push(`labelSelector=${encodeURIComponent(labelSelector)}`);
    }
    
    if (params.length > 0) {
      path += `?${params.join('&')}`;
    }
    
    const result = await this.request('GET', path);
    return result.items || [];
  }

  async request(method, path, body = null) {
    const url = new URL(path, this.apiServer);
    
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
    
    if (this.ca) {
      options.ca = this.ca;
    } else {
      options.rejectUnauthorized = false; // For development only
    }
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        
        res.on('data', chunk => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              const error = JSON.parse(data);
              reject(new Error(error.message || `HTTP ${res.statusCode}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      });
      
      req.on('error', reject);
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  }

  watch(path, callback) {
    const url = new URL(path, this.apiServer);
    url.searchParams.append('watch', 'true');
    
    const options = {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json'
      }
    };
    
    if (this.ca) {
      options.ca = this.ca;
    } else {
      options.rejectUnauthorized = false;
    }
    
    const req = https.get(url, options, (res) => {
      let buffer = '';
      
      res.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line);
              callback(event);
            } catch (err) {
              console.error('Failed to parse watch event:', err);
            }
          }
        }
      });
      
      res.on('end', () => {
        console.log('Watch connection ended');
        // Reconnect after a delay
        setTimeout(() => this.watch(path, callback), 5000);
      });
    });
    
    req.on('error', (err) => {
      console.error('Watch error:', err);
      // Reconnect after a delay
      setTimeout(() => this.watch(path, callback), 5000);
    });
    
    return req;
  }

  loadKubeconfig(kubeconfigPath) {
    try {
      const kubeconfig = JSON.parse(fs.readFileSync(kubeconfigPath, 'utf8'));
      
      const currentContext = kubeconfig['current-context'];
      const context = kubeconfig.contexts.find(c => c.name === currentContext);
      const cluster = kubeconfig.clusters.find(c => c.name === context.context.cluster);
      const user = kubeconfig.users.find(u => u.name === context.context.user);
      
      this.apiServer = cluster.cluster.server;
      this.ca = Buffer.from(cluster.cluster['certificate-authority-data'], 'base64').toString();
      
      if (user.user.token) {
        this.token = user.user.token;
      } else if (user.user['client-certificate-data'] && user.user['client-key-data']) {
        // TODO: Support client certificate authentication
        throw new Error('Client certificate authentication not yet supported');
      }
    } catch (error) {
      console.error('Failed to load kubeconfig:', error);
      throw error;
    }
  }
}