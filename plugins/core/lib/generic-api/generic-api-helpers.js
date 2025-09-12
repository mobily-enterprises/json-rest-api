/**
 * GenericApiHelpers
 * 
 * Helper methods for working with Generic API resources dynamically.
 * Provides convenient methods for creating tables, querying data, and managing resources.
 */

export class GenericApiHelpers {
  constructor(api) {
    this.api = api;
  }
  
  /**
   * Create a new Generic API table and its fields programmatically
   */
  async createTable(config) {
    const { name, fields, relationships = [], description = '' } = config;
    
    // Create the table
    const tableResult = await this.api.resources.genApiTables.post({
      inputRecord: {
        data: {
          type: 'genApiTables',
          attributes: {
            table_name: name,
            api_name: config.apiName || name,
            description: description,
            is_active: true,
            storage_mode: config.storageMode || 'hybrid',
            config: config.tableConfig ? JSON.stringify(config.tableConfig) : null,
            created_at: new Date(),
            updated_at: new Date()
          }
        }
      }
    });
    
    const tableId = tableResult.data.id;
    
    // Create fields
    for (const field of fields) {
      await this.createField(tableId, field);
    }
    
    // Create relationships
    for (const rel of relationships) {
      await this.createRelationship(tableId, rel);
    }
    
    // Reload the resource to make it available
    if (this.api.genericApi?.loader) {
      await this.api.genericApi.loader.refreshResource(tableId);
    }
    
    return {
      tableId,
      apiName: config.apiName || name,
      resourceName: config.apiName || name
    };
  }
  
  /**
   * Add a field to an existing table
   */
  async createField(tableId, fieldConfig) {
    const result = await this.api.resources.genApiFields.post({
      inputRecord: {
        data: {
          type: 'genApiFields',
          attributes: {
            table_id: tableId,
            field_name: fieldConfig.name,
            data_type: fieldConfig.type || 'string',
            storage_type: fieldConfig.storageType || (fieldConfig.indexed ? 'indexed' : 'jsonb'),
            is_required: fieldConfig.required || false,
            is_indexed: fieldConfig.indexed || false,
            is_unique: fieldConfig.unique || false,
            is_searchable: fieldConfig.searchable !== false,
            is_sortable: fieldConfig.sortable !== false,
            is_hidden: fieldConfig.hidden || false,
            is_computed: fieldConfig.computed || false,
            computed_expression: fieldConfig.computedExpression,
            default_value: fieldConfig.default !== undefined ? String(fieldConfig.default) : null,
            max_length: fieldConfig.maxLength,
            min_value: fieldConfig.min,
            max_value: fieldConfig.max,
            enum_values: fieldConfig.enum ? JSON.stringify(fieldConfig.enum) : null,
            validation_rules: fieldConfig.validation ? JSON.stringify(fieldConfig.validation) : null,
            index_position: fieldConfig.indexPosition || 1,
            sort_order: fieldConfig.sortOrder || 0,
            created_at: new Date(),
            updated_at: new Date()
          }
        }
      }
    });
    
    return result.data.id;
  }
  
  /**
   * Create a relationship between tables
   */
  async createRelationship(sourceTableId, relConfig) {
    const result = await this.api.resources.genApiRelationships.post({
      inputRecord: {
        data: {
          type: 'genApiRelationships',
          attributes: {
            source_table_id: sourceTableId,
            target_table_id: relConfig.targetTableId,
            relationship_name: relConfig.name,
            relationship_type: relConfig.type || 'belongsTo',
            foreign_key_field: relConfig.foreignKey,
            other_key_field: relConfig.otherKey,
            junction_table: relConfig.through,
            cascade_delete: relConfig.cascadeDelete || false,
            cascade_update: relConfig.cascadeUpdate || false,
            config: relConfig.config ? JSON.stringify(relConfig.config) : null,
            created_at: new Date(),
            updated_at: new Date()
          }
        }
      }
    });
    
    return result.data.id;
  }
  
  /**
   * Helper to quickly query a Generic API resource
   */
  async query(resourceName, options = {}) {
    const resource = this.api.resources[resourceName];
    if (!resource) {
      throw new Error(`Resource '${resourceName}' not found. Make sure it's loaded.`);
    }
    
    return await resource.query(options);
  }
  
  /**
   * Helper to create a record in a Generic API resource
   */
  async create(resourceName, data) {
    const resource = this.api.resources[resourceName];
    if (!resource) {
      throw new Error(`Resource '${resourceName}' not found. Make sure it's loaded.`);
    }
    
    return await resource.post({
      inputRecord: {
        data: {
          type: resourceName,
          attributes: data
        }
      }
    });
  }
  
  /**
   * Helper to update a record in a Generic API resource
   */
  async update(resourceName, id, data) {
    const resource = this.api.resources[resourceName];
    if (!resource) {
      throw new Error(`Resource '${resourceName}' not found. Make sure it's loaded.`);
    }
    
    return await resource.patch({
      id: id,
      inputRecord: {
        data: {
          type: resourceName,
          id: String(id),
          attributes: data
        }
      }
    });
  }
  
  /**
   * Helper to delete a record from a Generic API resource
   */
  async delete(resourceName, id) {
    const resource = this.api.resources[resourceName];
    if (!resource) {
      throw new Error(`Resource '${resourceName}' not found. Make sure it's loaded.`);
    }
    
    return await resource.delete({ id });
  }
  
  /**
   * Get table metadata
   */
  async getTableInfo(tableNameOrId) {
    // Try to find by name first
    let result = await this.api.resources.genApiTables.query({
      filters: { table_name: tableNameOrId },
      include: 'fields,sourceRelationships',
      limit: 1
    });
    
    if (!result.data.length) {
      // Try by API name
      result = await this.api.resources.genApiTables.query({
        filters: { api_name: tableNameOrId },
        include: 'fields,sourceRelationships',
        limit: 1
      });
    }
    
    if (!result.data.length) {
      // Try by ID
      try {
        result = await this.api.resources.genApiTables.get({
          id: tableNameOrId,
          include: 'fields,sourceRelationships'
        });
        return {
          table: result.data,
          fields: this.extractIncluded(result.included, 'genApiFields'),
          relationships: this.extractIncluded(result.included, 'genApiRelationships')
        };
      } catch (e) {
        throw new Error(`Table '${tableNameOrId}' not found`);
      }
    }
    
    return {
      table: result.data[0],
      fields: this.extractIncluded(result.included, 'genApiFields'),
      relationships: this.extractIncluded(result.included, 'genApiRelationships')
    };
  }
  
  /**
   * Helper to extract included data
   */
  extractIncluded(included, type) {
    if (!included) return [];
    return included
      .filter(item => item.type === type)
      .map(item => ({ ...item.attributes, id: item.id }));
  }
  
  /**
   * Bulk import data into a Generic API table
   */
  async bulkImport(resourceName, records) {
    const results = [];
    const errors = [];
    
    for (let i = 0; i < records.length; i++) {
      try {
        const result = await this.create(resourceName, records[i]);
        results.push(result);
      } catch (error) {
        errors.push({
          index: i,
          record: records[i],
          error: error.message
        });
      }
    }
    
    return {
      successful: results.length,
      failed: errors.length,
      results,
      errors
    };
  }
  
  /**
   * Export data from a Generic API table
   */
  async export(resourceName, options = {}) {
    const allRecords = [];
    let page = 1;
    const limit = options.limit || 100;
    
    while (true) {
      const result = await this.query(resourceName, {
        ...options,
        page,
        limit
      });
      
      if (!result.data || result.data.length === 0) break;
      
      allRecords.push(...result.data);
      
      if (result.data.length < limit) break;
      page++;
    }
    
    return allRecords.map(record => record.attributes);
  }
  
  /**
   * Clone a table structure (without data)
   */
  async cloneTableStructure(sourceTableId, newName) {
    // Get source table info
    const sourceInfo = await this.getTableInfo(sourceTableId);
    
    // Create new table with same structure
    return await this.createTable({
      name: newName,
      apiName: newName,
      description: `Clone of ${sourceInfo.table.attributes.table_name}`,
      storageMode: sourceInfo.table.attributes.storage_mode,
      fields: sourceInfo.fields.map(field => ({
        name: field.field_name,
        type: field.data_type,
        storageType: field.storage_type,
        required: field.is_required,
        indexed: field.is_indexed,
        unique: field.is_unique,
        searchable: field.is_searchable,
        sortable: field.is_sortable,
        hidden: field.is_hidden,
        computed: field.is_computed,
        computedExpression: field.computed_expression,
        default: field.default_value,
        maxLength: field.max_length,
        min: field.min_value,
        max: field.max_value,
        enum: field.enum_values ? JSON.parse(field.enum_values) : null,
        validation: field.validation_rules ? JSON.parse(field.validation_rules) : null,
        indexPosition: field.index_position,
        sortOrder: field.sort_order
      })),
      tableConfig: sourceInfo.table.attributes.config ? 
        JSON.parse(sourceInfo.table.attributes.config) : null
    });
  }
  
  /**
   * Check if a resource exists and is loaded
   */
  isResourceLoaded(resourceName) {
    return !!this.api.resources[resourceName];
  }
  
  /**
   * Get all loaded Generic API resources
   */
  getLoadedResources() {
    if (!this.api.genericApi?.tables) return [];
    
    const resources = [];
    for (const [tableId, table] of this.api.genericApi.tables) {
      resources.push({
        tableId,
        tableName: table.table_name,
        apiName: table.api_name,
        resourceName: table.api_name || table.table_name,
        isActive: table.is_active
      });
    }
    
    return resources;
  }
  
  /**
   * Validate data against table schema
   */
  async validateData(tableNameOrId, data) {
    const { fields } = await this.getTableInfo(tableNameOrId);
    const errors = [];
    
    for (const field of fields) {
      const value = data[field.field_name];
      
      // Check required fields
      if (field.is_required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: field.field_name,
          error: 'Field is required'
        });
        continue;
      }
      
      // Skip if no value and not required
      if (value === undefined || value === null) continue;
      
      // Type validation
      const typeError = this.validateType(value, field.data_type);
      if (typeError) {
        errors.push({
          field: field.field_name,
          error: typeError
        });
      }
      
      // Length validation
      if (field.max_length && typeof value === 'string' && value.length > field.max_length) {
        errors.push({
          field: field.field_name,
          error: `Value exceeds maximum length of ${field.max_length}`
        });
      }
      
      // Range validation
      if (field.min_value !== null && field.min_value !== undefined && Number(value) < Number(field.min_value)) {
        errors.push({
          field: field.field_name,
          error: `Value must be at least ${field.min_value}`
        });
      }
      
      if (field.max_value !== null && field.max_value !== undefined && Number(value) > Number(field.max_value)) {
        errors.push({
          field: field.field_name,
          error: `Value must be at most ${field.max_value}`
        });
      }
      
      // Enum validation
      if (field.enum_values) {
        let enumValues;
        try {
          enumValues = JSON.parse(field.enum_values);
        } catch (e) {
          enumValues = field.enum_values.split(',').map(v => v.trim());
        }
        
        if (!enumValues.includes(value)) {
          errors.push({
            field: field.field_name,
            error: `Value must be one of: ${enumValues.join(', ')}`
          });
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  validateType(value, dataType) {
    switch (dataType) {
      case 'string':
      case 'text':
        if (typeof value !== 'string') {
          return 'Value must be a string';
        }
        break;
      case 'number':
      case 'integer':
      case 'float':
      case 'decimal':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          return 'Value must be a number';
        }
        if (dataType === 'integer' && !Number.isInteger(Number(value))) {
          return 'Value must be an integer';
        }
        break;
      case 'boolean':
      case 'bool':
        if (typeof value !== 'boolean') {
          return 'Value must be a boolean';
        }
        break;
      case 'date':
      case 'datetime':
        if (isNaN(Date.parse(value))) {
          return 'Value must be a valid date';
        }
        break;
      case 'json':
      case 'jsonb':
      case 'object':
        if (typeof value !== 'object') {
          return 'Value must be an object';
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return 'Value must be an array';
        }
        break;
    }
    
    return null;
  }
  
  /**
   * Create indexes for optimized performance
   */
  async optimizeTable(tableNameOrId) {
    const { table, fields } = await this.getTableInfo(tableNameOrId);
    
    if (this.api.genericApi?.optimizer) {
      const created = await this.api.genericApi.optimizer.createSuggestedIndexes(
        table.id,
        fields
      );
      
      // Reload resource if indexes were created
      if (created.length > 0 && this.api.genericApi?.loader) {
        await this.api.genericApi.loader.refreshResource(table.id);
      }
      
      return created;
    }
    
    return [];
  }
  
  /**
   * Get performance metrics for a table
   */
  async getTableMetrics(tableNameOrId) {
    const { table } = await this.getTableInfo(tableNameOrId);
    
    if (!this.api.resources.genApiMetrics) {
      return null;
    }
    
    const metrics = await this.api.resources.genApiMetrics.query({
      filters: { table_id: table.id },
      sort: '-created_at',
      limit: 100
    });
    
    // Calculate summary statistics
    const summary = {
      totalOperations: metrics.data.length,
      avgResponseTime: 0,
      cacheHitRate: 0,
      operationCounts: {}
    };
    
    if (metrics.data.length > 0) {
      let totalTime = 0;
      let cacheHits = 0;
      
      for (const metric of metrics.data) {
        totalTime += metric.attributes.response_time || 0;
        if (metric.attributes.cache_hit) cacheHits++;
        
        const op = metric.attributes.operation;
        summary.operationCounts[op] = (summary.operationCounts[op] || 0) + 1;
      }
      
      summary.avgResponseTime = totalTime / metrics.data.length;
      summary.cacheHitRate = (cacheHits / metrics.data.length) * 100;
    }
    
    return summary;
  }
}

export default GenericApiHelpers;