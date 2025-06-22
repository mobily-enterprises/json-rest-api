export const VersioningPlugin = {
  install(api, options = {}) {
    const {
      type = 'header', // 'header', 'path', 'query', 'accept'
      header = 'x-api-version',
      queryParam = 'version',
      defaultVersion = '1',
      versions = {},
      deprecationWarnings = true,
      strict = false,
      versionExtractor = null
    } = options;

    const versionManager = new VersionManager({
      type,
      header,
      queryParam,
      defaultVersion,
      versions,
      deprecationWarnings,
      strict,
      versionExtractor
    });

    // Store version configuration
    api.versioning = versionManager;

    // Hook into HTTP request processing
    api.hook('beforeHTTP', (context) => {
      const version = versionManager.extractVersion(context.request);
      context.apiVersion = version;

      // Add version to response headers
      if (context.response) {
        context.response.setHeader('x-api-version', version);
        
        // Add deprecation warning if needed
        if (versionManager.isDeprecated(version)) {
          const deprecation = versionManager.getDeprecationInfo(version);
          context.response.setHeader('x-api-deprecated', 'true');
          context.response.setHeader('x-api-deprecation-date', deprecation.date);
          context.response.setHeader('x-api-sunset-date', deprecation.sunset);
          
          if (deprecation.successor) {
            context.response.setHeader('x-api-successor-version', deprecation.successor);
          }
        }
      }
    }, { priority: 1 }); // Run early

    // Hook into resource resolution
    api.hook('beforeResourceResolve', (context) => {
      const version = context.apiVersion || defaultVersion;
      const resourceName = context.options.type;

      // Check for versioned resource
      const versionedName = versionManager.getVersionedResourceName(resourceName, version);
      if (versionedName && api.resources[versionedName]) {
        context.options.type = versionedName;
        context.versionedResource = true;
      }
    });

    // Hook into schema resolution
    api.hook('beforeSchemaResolve', (context) => {
      const version = context.apiVersion || defaultVersion;
      const schema = context.schema;

      // Apply version-specific schema transformations
      const versionedSchema = versionManager.transformSchema(schema, version);
      if (versionedSchema !== schema) {
        context.schema = versionedSchema;
      }
    });

    // Version-aware error handling
    api.hook('beforeError', (context) => {
      if (context.error && context.apiVersion) {
        context.error.apiVersion = context.apiVersion;
        
        // Add version info to error response
        if (context.error.status === 404 && strict) {
          const available = versionManager.getAvailableVersions();
          context.error.availableVersions = available;
          context.error.message = `Resource not available in version ${context.apiVersion}. Available versions: ${available.join(', ')}`;
        }
      }
    });

    // Add version discovery endpoint
    api.hook('afterHTTPInit', () => {
      if (api.app) {
        // Version discovery endpoint
        api.app.get('/api/versions', (req, res) => {
          res.json(versionManager.getVersionInfo());
        });

        // Version-specific OpenAPI/Swagger
        api.app.get('/api/versions/:version/openapi', (req, res) => {
          const version = req.params.version;
          
          if (!versionManager.isValidVersion(version)) {
            return res.status(404).json({
              error: 'Version not found',
              availableVersions: versionManager.getAvailableVersions()
            });
          }

          // Generate version-specific OpenAPI
          const openapi = api.generateOpenAPI ? api.generateOpenAPI(version) : null;
          if (openapi) {
            res.json(openapi);
          } else {
            res.status(501).json({ error: 'OpenAPI generation not available' });
          }
        });
      }
    });

    // Public API extensions
    api.addVersionedResource = (name, versionConfigs) => {
      for (const [version, config] of Object.entries(versionConfigs)) {
        const versionedName = `${name}_v${version.replace('.', '_')}`;
        
        // Add the versioned resource
        api.addResource(versionedName, config.schema || config);
        
        // Register with version manager
        versionManager.registerResource(name, version, versionedName);
        
        // Handle migrations if specified
        if (config.migrateFrom) {
          versionManager.addMigration(name, config.migrateFrom, version, config.migration);
        }
      }
    };

    api.deprecateVersion = (version, options) => {
      versionManager.deprecateVersion(version, options);
    };

    api.addVersionTransform = (fromVersion, toVersion, transformer) => {
      versionManager.addTransform(fromVersion, toVersion, transformer);
    };
  }
};

class VersionManager {
  constructor(options) {
    this.options = options;
    this.versions = new Map();
    this.resources = new Map(); // resource -> version -> versionedName
    this.deprecations = new Map();
    this.transforms = new Map();
    this.migrations = new Map();

    // Initialize configured versions
    for (const [version, config] of Object.entries(options.versions)) {
      this.versions.set(version, config);
    }
  }

  extractVersion(request) {
    // Use custom extractor if provided
    if (this.options.versionExtractor) {
      return this.options.versionExtractor(request) || this.options.defaultVersion;
    }

    let version;

    switch (this.options.type) {
      case 'header':
        version = request.headers[this.options.header];
        break;

      case 'query':
        version = request.query?.[this.options.queryParam];
        break;

      case 'path':
        // Extract from path like /v1/users or /api/v2/posts
        const pathMatch = request.path?.match(/\/v(\d+(?:\.\d+)?)\//);
        version = pathMatch ? pathMatch[1] : null;
        break;

      case 'accept':
        // Extract from Accept header like application/vnd.api.v2+json
        const acceptHeader = request.headers.accept || '';
        const acceptMatch = acceptHeader.match(/application\/vnd\.[\w-]+\.v(\d+(?:\.\d+)?)\+json/);
        version = acceptMatch ? acceptMatch[1] : null;
        break;
    }

    return version || this.options.defaultVersion;
  }

  isValidVersion(version) {
    return this.versions.has(version) || version === this.options.defaultVersion;
  }

  isDeprecated(version) {
    return this.deprecations.has(version);
  }

  getDeprecationInfo(version) {
    return this.deprecations.get(version);
  }

  deprecateVersion(version, options = {}) {
    const {
      date = new Date().toISOString(),
      sunset = null,
      message = `Version ${version} is deprecated`,
      successor = null
    } = options;

    this.deprecations.set(version, {
      date,
      sunset,
      message,
      successor
    });
  }

  getAvailableVersions() {
    const versions = [this.options.defaultVersion];
    for (const version of this.versions.keys()) {
      if (!versions.includes(version)) {
        versions.push(version);
      }
    }
    return versions.sort();
  }

  getVersionedResourceName(resourceName, version) {
    const resourceVersions = this.resources.get(resourceName);
    if (!resourceVersions) return null;

    return resourceVersions.get(version);
  }

  registerResource(name, version, versionedName) {
    if (!this.resources.has(name)) {
      this.resources.set(name, new Map());
    }
    this.resources.get(name).set(version, versionedName);
  }

  transformSchema(schema, version) {
    if (!schema || !version) return schema;

    // Check if schema has version-specific modifications
    if (schema._versions && schema._versions[version]) {
      // Apply version-specific overrides
      return {
        ...schema,
        ...schema._versions[version],
        _versions: undefined // Remove version metadata from runtime schema
      };
    }

    // Check for field-level versioning
    if (schema.fields) {
      let modified = false;
      const versionedFields = {};

      for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        if (fieldDef._versions) {
          // Field has version-specific configuration
          const versionConfig = fieldDef._versions[version];
          
          if (versionConfig === null) {
            // Field doesn't exist in this version
            modified = true;
            continue;
          } else if (versionConfig) {
            // Field has version-specific overrides
            versionedFields[fieldName] = {
              ...fieldDef,
              ...versionConfig,
              _versions: undefined
            };
            modified = true;
            continue;
          }
        }

        // Keep field as-is
        versionedFields[fieldName] = fieldDef;
      }

      if (modified) {
        return {
          ...schema,
          fields: versionedFields
        };
      }
    }

    return schema;
  }

  addTransform(fromVersion, toVersion, transformer) {
    const key = `${fromVersion}->${toVersion}`;
    this.transforms.set(key, transformer);
  }

  getTransform(fromVersion, toVersion) {
    const key = `${fromVersion}->${toVersion}`;
    return this.transforms.get(key);
  }

  addMigration(resource, fromVersion, toVersion, migration) {
    const key = `${resource}:${fromVersion}->${toVersion}`;
    this.migrations.set(key, migration);
  }

  getMigration(resource, fromVersion, toVersion) {
    const key = `${resource}:${fromVersion}->${toVersion}`;
    return this.migrations.get(key);
  }

  transformRequest(request, fromVersion, toVersion) {
    const transform = this.getTransform(fromVersion, toVersion);
    if (transform) {
      return transform(request, 'request');
    }
    return request;
  }

  transformResponse(response, fromVersion, toVersion) {
    const transform = this.getTransform(toVersion, fromVersion);
    if (transform) {
      return transform(response, 'response');
    }
    return response;
  }

  getVersionInfo() {
    const info = {
      current: this.options.defaultVersion,
      available: this.getAvailableVersions(),
      deprecated: [],
      experimental: [],
      stable: []
    };

    for (const [version, config] of this.versions.entries()) {
      if (this.isDeprecated(version)) {
        info.deprecated.push({
          version,
          deprecation: this.getDeprecationInfo(version)
        });
      } else if (config.experimental) {
        info.experimental.push(version);
      } else {
        info.stable.push(version);
      }
    }

    // Add feature matrix
    info.features = {};
    for (const [resource, versions] of this.resources.entries()) {
      info.features[resource] = {
        availableIn: Array.from(versions.keys()).sort()
      };
    }

    return info;
  }
}