/**
 * Versioning plugin for API versioning and resource version management
 */
export const VersioningPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      // API versioning
      apiVersion: '1.0.0',
      versionHeader: 'api-version',
      versionParam: 'v',
      
      // Resource versioning
      versionField: 'version',
      lastModifiedField: 'lastModified',
      modifiedByField: 'modifiedBy',
      trackHistory: false,
      historyTable: null,
      
      ...options
    };

    // Store versioning options
    api.versioningOptions = defaultOptions;

    // API Version Management
    if (defaultOptions.apiVersion) {
      // Add version info to all responses
      api.hook('beforeSend', async (context) => {
        if (!context.meta) context.meta = {};
        context.meta.apiVersion = defaultOptions.apiVersion;
      });

      // Version negotiation for HTTP
      if (api.router) {
        api.router.use((req, res, next) => {
          // Check version header
          const headerVersion = req.headers[defaultOptions.versionHeader];
          // Check version query param
          const paramVersion = req.query[defaultOptions.versionParam];
          
          const requestedVersion = headerVersion || paramVersion;
          
          if (requestedVersion && requestedVersion !== defaultOptions.apiVersion) {
            // Handle version mismatch
            if (defaultOptions.strict) {
              return res.status(400).json({
                errors: [{
                  status: '400',
                  title: 'Version Mismatch',
                  detail: `API version ${requestedVersion} not supported. Current version is ${defaultOptions.apiVersion}`
                }]
              });
            }
          }
          
          // Add version to response headers
          res.set('API-Version', defaultOptions.apiVersion);
          next();
        });
      }
    }

    // Resource Version Management
    if (defaultOptions.versionField) {
      // Initialize version on insert
      api.hook('beforeInsert', async (context) => {
        const { data, options } = context;
        if (options.versioning === false || (options.versioning && options.versioning.enabled === false)) return;

        // Set initial version
        if (data[defaultOptions.versionField] === undefined) {
          data[defaultOptions.versionField] = 1;
        }

        // Set modified timestamp
        if (defaultOptions.lastModifiedField) {
          data[defaultOptions.lastModifiedField] = new Date().toISOString();
        }

        // Set modified by
        if (defaultOptions.modifiedByField && options.userId) {
          data[defaultOptions.modifiedByField] = options.userId;
        }
      });

      // Increment version on update
      api.hook('beforeUpdate', async (context) => {
        const { data, options, id } = context;
        if (options.versioning === false || (options.versioning && options.versioning.enabled === false)) return;

        // Check for optimistic locking
        if (defaultOptions.optimisticLocking && data[defaultOptions.versionField]) {
          const currentVersion = data[defaultOptions.versionField];
          delete data[defaultOptions.versionField]; // Remove from update data

          // Get current record
          const impl = api.implementers.get('get');
          const current = await impl({ id, options });
          
          if (current && current[defaultOptions.versionField] !== currentVersion) {
            const error = new Error('Version conflict - record has been modified');
            error.status = 409;
            error.code = 'VERSION_CONFLICT';
            throw error;
          }
        }

        // Save current version for history
        if (defaultOptions.trackHistory) {
          const impl = api.implementers.get('get');
          context.previousVersion = await impl({ id, options });
        }

        // Increment version
        if (!options.skipVersioning) {
          const impl = api.implementers.get('get');
          const current = await impl({ id, options });
          
          if (current) {
            data[defaultOptions.versionField] = (current[defaultOptions.versionField] || 0) + 1;
          }
        }

        // Update modified timestamp
        if (defaultOptions.lastModifiedField) {
          data[defaultOptions.lastModifiedField] = new Date().toISOString();
        }

        // Update modified by
        if (defaultOptions.modifiedByField && options.userId) {
          data[defaultOptions.modifiedByField] = options.userId;
        }
      });

      // Save version history after update
      api.hook('afterUpdate', async (context) => {
        if (!defaultOptions.trackHistory || !context.previousVersion) return;
        
        await saveVersionHistory(api, context, defaultOptions);
      });
    }

    // Version comparison helpers
    api.compareVersions = (v1, v2) => {
      if (typeof v1 === 'number' && typeof v2 === 'number') {
        return v1 - v2;
      }
      
      // Semantic version comparison
      const parseVersion = (v) => {
        const parts = String(v).split('.').map(Number);
        return {
          major: parts[0] || 0,
          minor: parts[1] || 0,
          patch: parts[2] || 0
        };
      };
      
      const ver1 = parseVersion(v1);
      const ver2 = parseVersion(v2);
      
      if (ver1.major !== ver2.major) return ver1.major - ver2.major;
      if (ver1.minor !== ver2.minor) return ver1.minor - ver2.minor;
      return ver1.patch - ver2.patch;
    };

    // Get version history
    api.getVersionHistory = async (type, id, options = {}) => {
      if (!defaultOptions.trackHistory) {
        throw new Error('Version history tracking is not enabled');
      }

      const historyTable = defaultOptions.historyTable || `${type}_history`;
      
      // This would need to be implemented based on the storage plugin
      const result = await api.query({
        filter: { 
          resourceId: id,
          resourceType: type 
        },
        sort: `-${defaultOptions.versionField}`
      }, {
        type: historyTable,
        ...options
      });

      return result;
    };

    // Restore a specific version
    api.restoreVersion = async (type, id, version, options = {}) => {
      if (!defaultOptions.trackHistory) {
        throw new Error('Version history tracking is not enabled');
      }

      // Get the historical version
      const history = await api.getVersionHistory(type, id, options);
      const versionData = history.data.find(h => 
        h.attributes[defaultOptions.versionField] === version
      );

      if (!versionData) {
        throw new Error(`Version ${version} not found`);
      }

      // Restore the version
      const { resourceId, resourceType, ...data } = versionData.attributes;
      delete data.id; // Remove history record ID

      return api.update(id, data, {
        type,
        ...options,
        skipVersioning: false // Ensure new version is created
      });
    };

    // Version diffing
    api.diffVersions = async (type, id, version1, version2, options = {}) => {
      const history = await api.getVersionHistory(type, id, options);
      
      const v1Data = history.data.find(h => 
        h.attributes[defaultOptions.versionField] === version1
      );
      const v2Data = history.data.find(h => 
        h.attributes[defaultOptions.versionField] === version2
      );

      if (!v1Data || !v2Data) {
        throw new Error('One or both versions not found');
      }

      // Simple diff implementation
      const diff = {
        version1,
        version2,
        changes: []
      };

      const v1Attrs = v1Data.attributes;
      const v2Attrs = v2Data.attributes;

      // Find changed fields
      const allKeys = new Set([...Object.keys(v1Attrs), ...Object.keys(v2Attrs)]);
      
      for (const key of allKeys) {
        if (v1Attrs[key] !== v2Attrs[key]) {
          diff.changes.push({
            field: key,
            oldValue: v1Attrs[key],
            newValue: v2Attrs[key]
          });
        }
      }

      return diff;
    };
  }
};

/**
 * Save version history
 */
async function saveVersionHistory(api, context, options) {
  const { previousVersion, result, options: contextOptions } = context;
  const historyTable = options.historyTable || `${contextOptions.type}_history`;
  
  // Create history record
  const historyData = {
    ...previousVersion,
    resourceId: previousVersion[api.options.idProperty],
    resourceType: contextOptions.type,
    savedAt: new Date().toISOString()
  };
  
  // Remove the original ID to avoid conflicts
  delete historyData[api.options.idProperty];
  
  // Save to history table
  try {
    await api.insert(historyData, {
      type: historyTable,
      versioning: false // Don't version the history records
    });
  } catch (error) {
    console.error('Failed to save version history:', error);
    // Don't fail the main operation if history fails
  }
}