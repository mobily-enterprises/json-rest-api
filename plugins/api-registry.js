import semver from 'semver';

/**
 * API Registry Plugin - Automatic version management
 */
export const ApiRegistryPlugin = {
  install(api, options = {}) {
    // Initialize the global registry if it doesn't exist
    if (!globalThis.__jsonRestApiRegistry) {
      globalThis.__jsonRestApiRegistry = new ApiRegistry();
    }
    
    const registry = globalThis.__jsonRestApiRegistry;
    
    // Register this API instance
    const apiName = options.name || api.options.name;
    const apiVersion = options.version || api.options.version;
    
    if (!apiName || !apiVersion) {
      throw new Error('API name and version are required for registration');
    }
    
    api.apiName = apiName;
    api.apiVersion = apiVersion;
    
    // Register in global registry
    registry.register(apiName, apiVersion, api);
    
    // Add version resolution to the API
    api.apis = new Proxy({}, {
      get(target, prop) {
        const requestedVersion = api.apiVersion;
        return registry.getCompatibleApi(prop, requestedVersion);
      }
    });
    
    // Override HTTP routes to handle version negotiation
    if (api.router) {
      const originalMount = api.mount;
      api.mount = function(app, basePath = '/api') {
        // Mount versioned routes
        const versionPath = `${basePath}/${apiVersion}`;
        originalMount.call(api, app, versionPath);
        
        // Also mount on base path with version negotiation
        app.use(`${basePath}/:apiName/*`, (req, res, next) => {
          const requestedVersion = 
            req.headers['api-version'] || 
            req.headers['x-api-version'] || 
            req.query.v ||
            'latest';
          
          const compatibleApi = registry.getCompatibleApi(
            req.params.apiName, 
            requestedVersion
          );
          
          if (!compatibleApi) {
            return res.status(400).json({
              errors: [{
                status: '400',
                title: 'Version Not Found',
                detail: `No compatible version found for ${req.params.apiName} ${requestedVersion}`
              }]
            });
          }
          
          // Forward to the compatible API
          req.url = req.url.replace(`/${req.params.apiName}`, '');
          compatibleApi.router(req, res, next);
        });
        
        return api;
      };
    }
  }
};

/**
 * Global API Registry
 */
class ApiRegistry {
  constructor() {
    this.apis = new Map(); // name -> version -> api
  }
  
  register(name, version, api) {
    if (!this.apis.has(name)) {
      this.apis.set(name, new Map());
    }
    
    const versions = this.apis.get(name);
    versions.set(version, api);
    
    // Sort versions for efficient lookup
    const sortedVersions = Array.from(versions.entries())
      .sort(([a], [b]) => semver.compare(b, a));
    
    this.apis.set(name, new Map(sortedVersions));
  }
  
  getCompatibleApi(name, versionSpec) {
    const versions = this.apis.get(name);
    if (!versions) return null;
    
    // Special case: latest
    if (versionSpec === 'latest') {
      return versions.values().next().value;
    }
    
    // Exact match
    if (versions.has(versionSpec)) {
      return versions.get(versionSpec);
    }
    
    // Find compatible version
    for (const [version, api] of versions) {
      if (semver.satisfies(version, versionSpec)) {
        return api;
      }
    }
    
    // Fallback: find any version >= requested
    if (!versionSpec.includes('>') && !versionSpec.includes('<') && !versionSpec.includes('^') && !versionSpec.includes('~')) {
      for (const [version, api] of versions) {
        if (semver.gte(version, versionSpec)) {
          return api;
        }
      }
    }
    
    return null;
  }
  
  getAllVersions(name) {
    const versions = this.apis.get(name);
    return versions ? Array.from(versions.keys()) : [];
  }
}

// Export the registry for direct access if needed
export const apiRegistry = globalThis.__jsonRestApiRegistry || new ApiRegistry();