/**
 * GenericApiLoader
 * 
 * Creates dynamic resources from metadata using json-rest-api's infrastructure.
 * Leverages json-rest-api's existing capabilities instead of reimplementing them.
 */

import { RestApiError } from '../../../../lib/rest-api-errors.js';

export class GenericApiLoader {
  constructor(api, config, log, storage, hooks, includes) {
    this.api = api;
    this.config = config;
    this.log = log;
    this.storage = storage;
    this.hooks = hooks;
    this.includes = includes;
  }
  
  /**
   * Create a dynamic resource from metadata
   */
  async createResource(table, fields, relationships) {
    const resourceName = table.api_name || table.table_name;
    
    this.log.info(`Creating Generic API resource: ${resourceName}`);
    
    // Build schema from fields
    const schema = this.buildSchema(fields);
    
    // Build relationship configuration  
    const relationshipConfig = await this.buildRelationshipConfig(relationships);
    
    // Build computed fields if any
    const computedFields = this.buildComputedFields(fields);
    
    // Create resource configuration that leverages json-rest-api
    const resourceConfig = {
      tableName: `${this.config.tablePrefix}_data`,
      schema: schema,
      relationships: relationshipConfig,
      computed: computedFields,
      
      // Use hooks to integrate with Generic API storage
      hooks: {
        beforeQuery: async (context) => this.handleBeforeQuery(context, table, fields, relationships),
        afterQuery: async (context) => this.handleAfterQuery(context, table, fields),
        beforeCreate: async (context) => this.handleBeforeCreate(context, table, fields),
        afterCreate: async (context) => this.handleAfterCreate(context, table, fields),
        beforeUpdate: async (context) => this.handleBeforeUpdate(context, table, fields),
        afterUpdate: async (context) => this.handleAfterUpdate(context, table, fields),
        beforeDelete: async (context) => this.handleBeforeDelete(context, table, fields),
        afterDelete: async (context) => this.handleAfterDelete(context, table, fields)
      },
      
      // Add custom where clause for table filtering
      defaultWhere: { table_id: table.id }
    };
    
    // Add or update the resource using json-rest-api
    try {
      if (this.api.resources && this.api.resources[resourceName]) {
        // Update existing resource
        Object.assign(this.api.resources[resourceName], resourceConfig);
        this.log.debug(`Updated existing resource: ${resourceName}`);
      } else {
        // Create new resource - json-rest-api handles all the heavy lifting!
        await this.api.addResource(resourceName, resourceConfig);
        this.log.debug(`Created new resource: ${resourceName}`);
      }
      
      // Store table configuration for later use
      this.api.genericApi.tables.set(table.id, table);
      this.api.genericApi.fields.set(table.id, fields);
      this.api.genericApi.relationships.set(table.id, relationships);
      
    } catch (error) {
      this.log.error(`Failed to create resource ${resourceName}:`, error);
      throw error;
    }
  }
  
  /**
   * Hook handlers that integrate with json-rest-api
   */
  async handleBeforeQuery(context, table, fields, relationships) {
    // Execute custom hooks
    const hookResult = await this.hooks.execute(table.api_name, 'beforeQuery', {
      ...context,
      tableId: table.id,
      fields: fields,
      relationships: relationships
    });
    
    if (!hookResult.success) {
      throw new RestApiError('Query aborted by hook', 'HOOK_ABORT');
    }
    
    // Ensure table filtering
    if (!context.filters) context.filters = {};
    context.filters.table_id = table.id;
    
    // Transform filters for hybrid storage
    context.filters = this.storage.transformFiltersForStorage(context.filters, fields);
    
    // If we need EAV values, include them
    const needsEav = fields.some(f => f.storage_type === 'eav');
    if (needsEav && !context.include) {
      context.include = 'values';
    } else if (needsEav && context.include) {
      context.include += ',values';
    }
    
    return context;
  }
  
  async handleAfterQuery(context, table, fields) {
    // Transform EAV data back to normal structure
    if (context.result && context.result.data) {
      context.result.data = await this.storage.transformRecordsFromStorage(
        context.result.data, 
        fields, 
        context.result.included
      );
      
      // Format as proper JSON:API response
      context.result.data = context.result.data.map(record => ({
        type: table.api_name || table.table_name,
        id: String(record.id),
        attributes: this.filterAttributes(record)
      }));
    }
    
    // Handle includes transformation
    if (context.result?.included) {
      // Filter out EAV values from included
      context.result.included = context.result.included.filter(
        item => item.type !== 'genApiDataValues'
      );
    }
    
    // Execute custom hooks
    await this.hooks.execute(table.api_name, 'afterQuery', {
      ...context,
      tableId: table.id
    });
    
    // Record metrics
    if (this.config.enableMetrics && context.responseTime) {
      await this.storage.recordMetric('query', table.id, context.responseTime, false);
    }
    
    return context;
  }
  
  async handleBeforeCreate(context, table, fields) {
    // Extract data from JSON:API format
    const inputData = this.extractInputData(context.inputRecord);
    
    // Validate input
    const validationErrors = await this.validateInput(inputData, fields, 'create');
    if (validationErrors.length > 0) {
      throw new RestApiError('Validation failed', 'VALIDATION_ERROR', validationErrors);
    }
    
    // Execute custom hooks
    const hookResult = await this.hooks.execute(table.api_name, 'beforeCreate', {
      ...context,
      tableId: table.id,
      fields: fields,
      inputData: inputData
    });
    
    if (!hookResult.success) {
      throw new RestApiError('Create aborted by hook', 'HOOK_ABORT');
    }
    
    // Transform input for hybrid storage
    const { mainRecord, eavValues } = await this.storage.prepareDataForStorage(
      table.id, 
      fields, 
      inputData
    );
    
    // Replace input with transformed data
    context.inputRecord = {
      data: {
        type: 'genApiData',
        attributes: mainRecord
      }
    };
    
    // Store EAV values for after hook
    context._eavValues = eavValues;
    context._originalInput = inputData;
    
    return context;
  }
  
  async handleAfterCreate(context, table, fields) {
    // Store EAV values if any
    if (context._eavValues && context._eavValues.length > 0) {
      const recordId = context.result.data.id;
      
      for (const eavValue of context._eavValues) {
        await this.api.resources.genApiDataValues.post({
          inputRecord: {
            data: {
              type: 'genApiDataValues',
              attributes: {
                ...eavValue,
                data_id: recordId
              }
            }
          }
        }, context);
      }
    }
    
    // Transform result back to normal structure
    if (context.result && context.result.data) {
      const transformed = await this.storage.transformRecordsFromStorage(
        [context.result.data],
        fields,
        []
      );
      
      // If we stored EAV values, fetch them to include in response
      if (context._eavValues && context._eavValues.length > 0) {
        const eavResult = await this.api.resources.genApiDataValues.query({
          filters: { data_id: context.result.data.id }
        });
        
        const finalTransformed = await this.storage.transformRecordsFromStorage(
          [context.result.data],
          fields,
          eavResult.data
        );
        
        context.result.data = {
          type: table.api_name || table.table_name,
          id: String(finalTransformed[0].id),
          attributes: this.filterAttributes(finalTransformed[0])
        };
      } else {
        context.result.data = {
          type: table.api_name || table.table_name,
          id: String(transformed[0].id),
          attributes: this.filterAttributes(transformed[0])
        };
      }
    }
    
    // Execute custom hooks
    await this.hooks.execute(table.api_name, 'afterCreate', {
      ...context,
      tableId: table.id
    });
    
    // Audit log
    if (this.config.enableAudit) {
      await this.auditLog(table.id, context.result.data.id, 'create', null, context._originalInput, context);
    }
    
    return context;
  }
  
  async handleBeforeUpdate(context, table, fields) {
    // Extract data from JSON:API format
    const inputData = this.extractInputData(context.inputRecord);
    
    // Validate input
    const validationErrors = await this.validateInput(inputData, fields, 'update');
    if (validationErrors.length > 0) {
      throw new RestApiError('Validation failed', 'VALIDATION_ERROR', validationErrors);
    }
    
    // Execute custom hooks
    const hookResult = await this.hooks.execute(table.api_name, 'beforeUpdate', {
      ...context,
      tableId: table.id,
      fields: fields,
      inputData: inputData
    });
    
    if (!hookResult.success) {
      throw new RestApiError('Update aborted by hook', 'HOOK_ABORT');
    }
    
    // Transform input for hybrid storage
    const { mainRecord, eavValues } = await this.storage.prepareDataForStorage(
      table.id, 
      fields, 
      inputData
    );
    
    // Replace input with transformed data
    context.inputRecord = {
      data: {
        type: 'genApiData',
        id: String(context.id),
        attributes: mainRecord
      }
    };
    
    // Store EAV values for after hook
    context._eavValues = eavValues;
    context._originalInput = inputData;
    
    return context;
  }
  
  async handleAfterUpdate(context, table, fields) {
    // Update EAV values if any
    if (context._eavValues && context._eavValues.length > 0) {
      const recordId = context.id;
      
      // Get existing EAV values
      const existingValues = await this.api.resources.genApiDataValues.query({
        filters: { data_id: recordId }
      });
      
      for (const eavValue of context._eavValues) {
        const existing = existingValues.data.find(
          v => v.attributes.field_id === eavValue.field_id
        );
        
        if (existing) {
          // Update existing value
          await this.api.resources.genApiDataValues.patch({
            id: existing.id,
            inputRecord: {
              data: {
                type: 'genApiDataValues',
                id: existing.id,
                attributes: eavValue
              }
            }
          }, context);
        } else {
          // Create new value
          await this.api.resources.genApiDataValues.post({
            inputRecord: {
              data: {
                type: 'genApiDataValues',
                attributes: {
                  ...eavValue,
                  data_id: recordId
                }
              }
            }
          }, context);
        }
      }
    }
    
    // Transform result back to normal structure
    if (context.result && context.result.data) {
      const eavResult = await this.api.resources.genApiDataValues.query({
        filters: { data_id: context.id }
      });
      
      const transformed = await this.storage.transformRecordsFromStorage(
        [context.result.data],
        fields,
        eavResult.data
      );
      
      context.result.data = {
        type: table.api_name || table.table_name,
        id: String(transformed[0].id),
        attributes: this.filterAttributes(transformed[0])
      };
    }
    
    // Execute custom hooks
    await this.hooks.execute(table.api_name, 'afterUpdate', {
      ...context,
      tableId: table.id
    });
    
    // Audit log
    if (this.config.enableAudit) {
      await this.auditLog(table.id, context.id, 'update', context.previousRecord, context._originalInput, context);
    }
    
    return context;
  }
  
  async handleBeforeDelete(context, table, fields) {
    // Execute custom hooks
    const hookResult = await this.hooks.execute(table.api_name, 'beforeDelete', {
      ...context,
      tableId: table.id,
      fields: fields
    });
    
    if (!hookResult.success) {
      throw new RestApiError('Delete aborted by hook', 'HOOK_ABORT');
    }
    
    // Store record for audit before deletion
    if (this.config.enableAudit) {
      const record = await this.api.resources.genApiData.get({ id: context.id });
      context._deletedRecord = record.data;
    }
    
    return context;
  }
  
  async handleAfterDelete(context, table, fields) {
    // Delete EAV values
    const eavValues = await this.api.resources.genApiDataValues.query({
      filters: { data_id: context.id }
    });
    
    for (const value of eavValues.data) {
      await this.api.resources.genApiDataValues.delete({
        id: value.id
      }, context);
    }
    
    // Execute custom hooks
    await this.hooks.execute(table.api_name, 'afterDelete', {
      ...context,
      tableId: table.id
    });
    
    // Audit log
    if (this.config.enableAudit && context._deletedRecord) {
      await this.auditLog(table.id, context.id, 'delete', context._deletedRecord, null, context);
    }
    
    // Clear caches
    this.storage.invalidateRecordCache(context.id);
    this.storage.invalidateTableCache(table.id);
    
    return context;
  }
  
  /**
   * Build schema from field definitions
   */
  buildSchema(fields) {
    const schema = {};
    
    // Always include id
    schema.id = { type: 'id' };
    
    for (const field of fields) {
      const fieldConfig = {
        type: this.mapDataType(field.data_type),
        required: field.is_required || false,
        hidden: field.is_hidden || false,
        unique: field.is_unique || false,
        search: field.is_searchable !== false,
        sort: field.is_sortable !== false
      };
      
      // Add constraints
      if (field.max_length) fieldConfig.maxLength = field.max_length;
      if (field.min_value !== null && field.min_value !== undefined) {
        fieldConfig.min = Number(field.min_value);
      }
      if (field.max_value !== null && field.max_value !== undefined) {
        fieldConfig.max = Number(field.max_value);
      }
      if (field.default_value !== null && field.default_value !== undefined) {
        fieldConfig.default = this.parseDefaultValue(field.default_value, field.data_type);
      }
      
      // Handle enum values
      if (field.enum_values) {
        try {
          fieldConfig.enum = typeof field.enum_values === 'string' 
            ? JSON.parse(field.enum_values)
            : field.enum_values;
        } catch (e) {
          if (typeof field.enum_values === 'string') {
            fieldConfig.enum = field.enum_values.split(',').map(v => v.trim());
          }
        }
      }
      
      // Add custom validation rules
      if (field.validation_rules) {
        try {
          const rules = typeof field.validation_rules === 'string'
            ? JSON.parse(field.validation_rules)
            : field.validation_rules;
          Object.assign(fieldConfig, rules);
        } catch (e) {
          this.log.warn(`Invalid validation rules for field ${field.field_name}`);
        }
      }
      
      schema[field.field_name] = fieldConfig;
    }
    
    // Add metadata fields
    schema.created_at = { type: 'datetime', hidden: false };
    schema.updated_at = { type: 'datetime', hidden: false };
    
    return schema;
  }
  
  /**
   * Build relationship configuration
   */
  async buildRelationshipConfig(relationships) {
    const config = {};
    
    for (const rel of relationships) {
      // Get target table info using json-rest-api
      const targetTable = await this.api.resources.genApiTables.get({
        id: rel.target_table_id
      });
      
      if (!targetTable?.data) continue;
      
      const targetResourceName = targetTable.data.attributes.api_name || 
                                targetTable.data.attributes.table_name;
      
      const relConfig = {
        type: rel.relationship_type,
        target: targetResourceName,
        as: rel.relationship_name
      };
      
      if (rel.relationship_type === 'belongsTo') {
        relConfig.foreignKey = rel.foreign_key_field || `${rel.relationship_name}_id`;
      } else if (rel.relationship_type === 'hasMany') {
        relConfig.foreignKey = rel.foreign_key_field;
      } else if (rel.relationship_type === 'manyToMany') {
        relConfig.through = rel.junction_table;
        relConfig.foreignKey = rel.foreign_key_field;
        relConfig.otherKey = rel.other_key_field;
      }
      
      // Add cascade options
      if (rel.cascade_delete) relConfig.cascadeDelete = true;
      if (rel.cascade_update) relConfig.cascadeUpdate = true;
      
      // Add additional config
      if (rel.config) {
        try {
          const additionalConfig = typeof rel.config === 'string'
            ? JSON.parse(rel.config)
            : rel.config;
          Object.assign(relConfig, additionalConfig);
        } catch (e) {
          this.log.warn(`Invalid config for relationship ${rel.relationship_name}`);
        }
      }
      
      config[rel.relationship_name] = relConfig;
    }
    
    return config;
  }
  
  /**
   * Build computed fields configuration
   */
  buildComputedFields(fields) {
    const computed = {};
    const computedFields = fields.filter(f => f.is_computed);
    
    for (const field of computedFields) {
      if (field.computed_expression) {
        try {
          // Create getter function from expression
          // Expression should be a function body that returns a value
          computed[field.field_name] = {
            get: new Function('record', 'context', field.computed_expression)
          };
        } catch (e) {
          this.log.warn(`Invalid computed expression for field ${field.field_name}:`, e);
        }
      }
    }
    
    return Object.keys(computed).length > 0 ? computed : undefined;
  }
  
  /**
   * Helper methods
   */
  extractInputData(inputRecord) {
    if (!inputRecord || !inputRecord.data) {
      return {};
    }
    
    return inputRecord.data.attributes || {};
  }
  
  filterAttributes(record) {
    const attributes = { ...record };
    delete attributes.id;
    delete attributes.table_id;
    delete attributes.indexed_string_1;
    delete attributes.indexed_string_2;
    delete attributes.indexed_string_3;
    delete attributes.indexed_number_1;
    delete attributes.indexed_number_2;
    delete attributes.indexed_number_3;
    delete attributes.indexed_date_1;
    delete attributes.indexed_date_2;
    delete attributes.indexed_bool_1;
    delete attributes.indexed_bool_2;
    return attributes;
  }
  
  async validateInput(data, fields, operation) {
    const errors = [];
    
    for (const field of fields) {
      const value = data[field.field_name];
      
      // Check required fields
      if (operation === 'create' && field.is_required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: field.field_name,
          code: 'REQUIRED',
          message: `Field '${field.field_name}' is required`
        });
        continue;
      }
      
      // Skip validation if value not provided on update
      if (operation === 'update' && value === undefined) {
        continue;
      }
      
      // Type validation
      if (value !== undefined && value !== null && value !== '') {
        const typeError = this.validateType(value, field);
        if (typeError) {
          errors.push({
            field: field.field_name,
            code: 'INVALID_TYPE',
            message: typeError
          });
        }
        
        // Length validation
        if (field.max_length && typeof value === 'string' && value.length > field.max_length) {
          errors.push({
            field: field.field_name,
            code: 'MAX_LENGTH',
            message: `Field '${field.field_name}' exceeds maximum length of ${field.max_length}`
          });
        }
        
        // Range validation
        if (field.min_value !== null && field.min_value !== undefined && Number(value) < Number(field.min_value)) {
          errors.push({
            field: field.field_name,
            code: 'MIN_VALUE',
            message: `Field '${field.field_name}' must be at least ${field.min_value}`
          });
        }
        
        if (field.max_value !== null && field.max_value !== undefined && Number(value) > Number(field.max_value)) {
          errors.push({
            field: field.field_name,
            code: 'MAX_VALUE',
            message: `Field '${field.field_name}' must be at most ${field.max_value}`
          });
        }
        
        // Enum validation
        if (field.enum_values) {
          let enumArray;
          try {
            enumArray = typeof field.enum_values === 'string' 
              ? JSON.parse(field.enum_values)
              : field.enum_values;
          } catch (e) {
            enumArray = field.enum_values.split(',').map(v => v.trim());
          }
          
          if (!enumArray.includes(value)) {
            errors.push({
              field: field.field_name,
              code: 'INVALID_ENUM',
              message: `Field '${field.field_name}' must be one of: ${enumArray.join(', ')}`
            });
          }
        }
      }
    }
    
    return errors;
  }
  
  validateType(value, field) {
    switch (field.data_type) {
      case 'string':
      case 'text':
        if (typeof value !== 'string') {
          return `Field '${field.field_name}' must be a string`;
        }
        break;
      case 'number':
      case 'integer':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          return `Field '${field.field_name}' must be a number`;
        }
        if (field.data_type === 'integer' && !Number.isInteger(Number(value))) {
          return `Field '${field.field_name}' must be an integer`;
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          return `Field '${field.field_name}' must be a boolean`;
        }
        break;
      case 'date':
      case 'datetime':
        if (isNaN(Date.parse(value))) {
          return `Field '${field.field_name}' must be a valid date`;
        }
        break;
      case 'json':
      case 'object':
        if (typeof value !== 'object') {
          return `Field '${field.field_name}' must be an object`;
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return `Field '${field.field_name}' must be an array`;
        }
        break;
    }
    
    return null;
  }
  
  mapDataType(dbType) {
    const typeMap = {
      'string': 'string',
      'text': 'string',
      'varchar': 'string',
      'char': 'string',
      'number': 'number',
      'integer': 'number',
      'int': 'number',
      'decimal': 'number',
      'float': 'number',
      'boolean': 'boolean',
      'bool': 'boolean',
      'date': 'date',
      'datetime': 'datetime',
      'timestamp': 'datetime',
      'json': 'object',
      'jsonb': 'object',
      'object': 'object',
      'array': 'array'
    };
    
    return typeMap[dbType?.toLowerCase()] || 'string';
  }
  
  parseDefaultValue(value, dataType) {
    if (value === null || value === undefined || value === '') return null;
    
    switch (dataType) {
      case 'number':
      case 'integer':
      case 'float':
      case 'decimal':
        return Number(value);
      case 'boolean':
      case 'bool':
        return value === 'true' || value === true || value === 1 || value === '1';
      case 'json':
      case 'jsonb':
      case 'object':
      case 'array':
        try {
          return typeof value === 'string' ? JSON.parse(value) : value;
        } catch (e) {
          return value;
        }
      default:
        return value;
    }
  }
  
  async auditLog(tableId, dataId, action, oldValues, newValues, context) {
    if (!this.config.enableAudit) return;
    
    try {
      await this.api.resources.genApiAuditLog?.post({
        inputRecord: {
          data: {
            type: 'genApiAuditLog',
            attributes: {
              table_id: tableId,
              data_id: dataId,
              action: action,
              old_values: oldValues ? JSON.stringify(oldValues) : null,
              new_values: newValues ? JSON.stringify(newValues) : null,
              user_id: context.user?.id,
              ip_address: context.request?.ip,
              created_at: new Date()
            }
          }
        }
      }, context);
    } catch (error) {
      this.log.error('Failed to write audit log:', error);
    }
  }
  
  /**
   * Load all resources from database
   */
  async loadAllResources() {
    // Query all active tables using json-rest-api
    const tablesResult = await this.api.resources.genApiTables.query({
      filters: { is_active: true },
      include: 'fields,sourceRelationships'
    });
    
    if (!tablesResult?.data?.length) {
      this.log.info('No Generic API tables to load');
      return;
    }
    
    // Create resources for each table
    for (const tableData of tablesResult.data) {
      const table = { ...tableData.attributes, id: tableData.id };
      
      // Extract fields and relationships from includes
      const fields = [];
      const relationships = [];
      
      if (tablesResult.included) {
        tablesResult.included
          .filter(item => item.type === 'genApiFields' && item.attributes.table_id === table.id)
          .forEach(field => {
            fields.push({ ...field.attributes, id: field.id });
          });
        
        tablesResult.included
          .filter(item => item.type === 'genApiRelationships' && item.attributes.source_table_id === table.id)
          .forEach(rel => {
            relationships.push({ ...rel.attributes, id: rel.id });
          });
      }
      
      await this.createResource(table, fields, relationships);
    }
    
    this.log.info(`Loaded ${tablesResult.data.length} Generic API resources`);
  }
  
  /**
   * Refresh a specific resource
   */
  async refreshResource(tableId) {
    // Get table data using json-rest-api
    const tableResult = await this.api.resources.genApiTables.get({
      id: tableId,
      include: 'fields,sourceRelationships'
    });
    
    if (!tableResult?.data) {
      throw new RestApiError(`Table not found: ${tableId}`, 'NOT_FOUND');
    }
    
    const table = { ...tableResult.data.attributes, id: tableResult.data.id };
    const fields = [];
    const relationships = [];
    
    if (tableResult.included) {
      tableResult.included
        .filter(item => item.type === 'genApiFields')
        .forEach(field => {
          fields.push({ ...field.attributes, id: field.id });
        });
      
      tableResult.included
        .filter(item => item.type === 'genApiRelationships')
        .forEach(rel => {
          relationships.push({ ...rel.attributes, id: rel.id });
        });
    }
    
    await this.createResource(table, fields, relationships);
    
    this.log.info(`Refreshed resource: ${table.api_name || table.table_name}`);
  }
}

export default GenericApiLoader;