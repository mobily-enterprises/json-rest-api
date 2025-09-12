/**
 * GenericApiIncludes
 * 
 * Handles JSON:API includes for Generic API resources.
 * Uses json-rest-api's existing include functionality where possible.
 */

export class GenericApiIncludes {
  constructor(api, config, storage, log) {
    this.api = api;
    this.config = config;
    this.storage = storage;
    this.log = log;
    this.includeCache = new Map();
    this.queryPlanCache = new Map();
  }
  
  /**
   * Process includes for Generic API records
   * Note: Most of the heavy lifting is done by json-rest-api's include system
   * This class mainly handles Generic API specific transformations
   */
  async processIncludes(records, includeParam, context) {
    if (!includeParam || records.length === 0) {
      return [];
    }
    
    const startTime = Date.now();
    
    // Parse include parameter
    const includeList = this.parseIncludeParam(includeParam);
    
    // Get table metadata
    const tableId = context.tableId;
    const relationships = context.relationships || [];
    
    // Build include strategy based on relationships
    const includeStrategy = await this.buildIncludeStrategy(
      records,
      includeList,
      tableId,
      relationships,
      context
    );
    
    // Execute includes using json-rest-api resources
    const included = await this.executeIncludes(includeStrategy, context);
    
    // Record metrics
    const executionTime = Date.now() - startTime;
    this.log.debug(`Processed includes in ${executionTime}ms`);
    
    return included;
  }
  
  /**
   * Parse include parameter into list
   */
  parseIncludeParam(includeParam) {
    if (typeof includeParam === 'string') {
      return includeParam.split(',').map(i => i.trim());
    }
    if (Array.isArray(includeParam)) {
      return includeParam;
    }
    return [];
  }
  
  /**
   * Build include strategy based on relationships
   */
  async buildIncludeStrategy(records, includeList, tableId, relationships, context) {
    const strategy = {
      includes: [],
      depth: 0
    };
    
    for (const includeName of includeList) {
      // Handle nested includes (e.g., "author.posts.comments")
      const parts = includeName.split('.');
      let currentRelationships = relationships;
      let currentTableId = tableId;
      let currentPath = [];
      
      for (const part of parts) {
        currentPath.push(part);
        
        // Find relationship definition
        const rel = currentRelationships.find(r => r.relationship_name === part);
        if (!rel) {
          this.log.warn(`Relationship '${part}' not found in path '${includeName}'`);
          break;
        }
        
        // Add to strategy
        strategy.includes.push({
          path: currentPath.join('.'),
          relationship: rel,
          sourceTableId: currentTableId,
          targetTableId: rel.target_table_id,
          type: rel.relationship_type,
          foreignKey: rel.foreign_key_field,
          otherKey: rel.other_key_field,
          junction: rel.junction_table
        });
        
        // Update for next level
        currentTableId = rel.target_table_id;
        
        // Get relationships for target table for nested includes
        if (parts.length > currentPath.length) {
          const targetRelationships = await this.getTableRelationships(currentTableId);
          currentRelationships = targetRelationships;
        }
      }
      
      strategy.depth = Math.max(strategy.depth, parts.length);
    }
    
    // Check max depth
    if (strategy.depth > this.config.maxIncludeDepth) {
      this.log.warn(`Include depth ${strategy.depth} exceeds max ${this.config.maxIncludeDepth}`);
      strategy.includes = strategy.includes.filter(
        i => i.path.split('.').length <= this.config.maxIncludeDepth
      );
    }
    
    return strategy;
  }
  
  /**
   * Execute includes based on strategy
   */
  async executeIncludes(strategy, context) {
    const included = [];
    const processedIds = new Set();
    
    for (const include of strategy.includes) {
      // Get target table info
      const targetTable = await this.api.resources.genApiTables.get({
        id: include.targetTableId
      });
      
      if (!targetTable?.data) continue;
      
      const targetResourceName = targetTable.data.attributes.api_name || 
                                targetTable.data.attributes.table_name;
      
      // Build query based on relationship type
      let query;
      
      switch (include.type) {
        case 'belongsTo':
          // Get parent records
          query = await this.buildBelongsToQuery(include, context);
          break;
          
        case 'hasMany':
          // Get child records
          query = await this.buildHasManyQuery(include, context);
          break;
          
        case 'hasOne':
          // Get single child record
          query = await this.buildHasOneQuery(include, context);
          break;
          
        case 'manyToMany':
          // Get related records through junction
          query = await this.buildManyToManyQuery(include, context);
          break;
          
        default:
          this.log.warn(`Unknown relationship type: ${include.type}`);
          continue;
      }
      
      if (!query) continue;
      
      // Execute query using json-rest-api resource
      try {
        const result = await this.api.resources[targetResourceName]?.query(query);
        
        if (result?.data) {
          // Add to included, avoiding duplicates
          for (const record of result.data) {
            const key = `${record.type}:${record.id}`;
            if (!processedIds.has(key)) {
              included.push(record);
              processedIds.add(key);
            }
          }
        }
      } catch (error) {
        this.log.error(`Failed to load include '${include.path}':`, error);
      }
    }
    
    return included;
  }
  
  /**
   * Build query for belongsTo relationship
   */
  async buildBelongsToQuery(include, context) {
    // Get foreign key values from records
    const foreignKeyValues = new Set();
    
    if (context.result?.data) {
      const records = Array.isArray(context.result.data) 
        ? context.result.data 
        : [context.result.data];
      
      for (const record of records) {
        const fkValue = record.attributes?.[include.foreignKey];
        if (fkValue) {
          foreignKeyValues.add(fkValue);
        }
      }
    }
    
    if (foreignKeyValues.size === 0) return null;
    
    return {
      filters: {
        id: { $in: Array.from(foreignKeyValues) }
      },
      limit: foreignKeyValues.size
    };
  }
  
  /**
   * Build query for hasMany relationship
   */
  async buildHasManyQuery(include, context) {
    // Get parent IDs
    const parentIds = new Set();
    
    if (context.result?.data) {
      const records = Array.isArray(context.result.data) 
        ? context.result.data 
        : [context.result.data];
      
      for (const record of records) {
        parentIds.add(record.id);
      }
    }
    
    if (parentIds.size === 0) return null;
    
    return {
      filters: {
        [include.foreignKey]: { $in: Array.from(parentIds) }
      },
      limit: this.config.queryMaxLimit
    };
  }
  
  /**
   * Build query for hasOne relationship
   */
  async buildHasOneQuery(include, context) {
    // Similar to hasMany but expecting single result per parent
    return this.buildHasManyQuery(include, context);
  }
  
  /**
   * Build query for manyToMany relationship
   */
  async buildManyToManyQuery(include, context) {
    // This requires querying the junction table first
    // For now, we'll use a simplified approach
    // In a full implementation, this would query the junction table
    // and then fetch the related records
    
    const parentIds = new Set();
    
    if (context.result?.data) {
      const records = Array.isArray(context.result.data) 
        ? context.result.data 
        : [context.result.data];
      
      for (const record of records) {
        parentIds.add(record.id);
      }
    }
    
    if (parentIds.size === 0) return null;
    
    // Query junction table to get related IDs
    // This is a simplified implementation
    // A full implementation would properly handle the junction table
    
    return {
      filters: {},
      limit: this.config.queryMaxLimit
    };
  }
  
  /**
   * Get relationships for a table
   */
  async getTableRelationships(tableId) {
    // Check cache
    const cacheKey = `relationships:${tableId}`;
    if (this.includeCache.has(cacheKey)) {
      return this.includeCache.get(cacheKey);
    }
    
    // Query relationships using json-rest-api
    const result = await this.api.resources.genApiRelationships.query({
      filters: { source_table_id: tableId }
    });
    
    const relationships = result.data.map(r => ({
      ...r.attributes,
      id: r.id
    }));
    
    // Cache for future use
    this.includeCache.set(cacheKey, relationships);
    
    // Clear cache after timeout
    setTimeout(() => {
      this.includeCache.delete(cacheKey);
    }, this.config.cacheTimeout);
    
    return relationships;
  }
  
  /**
   * Optimize include queries
   */
  async optimizeIncludeQueries(strategy, records) {
    // Group includes by target table to batch queries
    const queryGroups = new Map();
    
    for (const include of strategy.includes) {
      const key = `${include.targetTableId}:${include.type}`;
      if (!queryGroups.has(key)) {
        queryGroups.set(key, []);
      }
      queryGroups.get(key).push(include);
    }
    
    // Build optimized query plan
    const queryPlan = {
      batches: [],
      estimatedTime: 0
    };
    
    for (const [key, includes] of queryGroups) {
      queryPlan.batches.push({
        key,
        includes,
        parallel: includes.length > 1 && this.config.includeStrategy === 'parallel'
      });
    }
    
    return queryPlan;
  }
  
  /**
   * Clear include cache
   */
  clearCache() {
    this.includeCache.clear();
    this.queryPlanCache.clear();
    this.log.debug('Cleared include caches');
  }
  
  /**
   * Get include metrics
   */
  getMetrics() {
    return {
      cacheSize: this.includeCache.size,
      queryPlanCacheSize: this.queryPlanCache.size
    };
  }
}

export default GenericApiIncludes;