/**
 * Generic API Plugin
 * 
 * Creates dynamic APIs from database metadata using json-rest-api's own infrastructure.
 * The plugin uses json-rest-api resources to manage its own metadata tables.
 */

import { GenericApiLoader } from './lib/generic-api/generic-api-loader.js';
import { GenericApiStorage } from './lib/generic-api/generic-api-storage.js';
import { GenericApiOptimizer } from './lib/generic-api/generic-api-optimizer.js';
import { GenericApiHooks } from './lib/generic-api/generic-api-hooks.js';
import { GenericApiIncludes } from './lib/generic-api/generic-api-includes.js';
import { RestApiError } from '../../lib/rest-api-errors.js';

export const GenericApiPlugin = {
  name: 'generic-api',
  dependencies: ['rest-api', 'rest-api-knex'],
  
  async install({ api, addHook, runHooks, vars, scopes, log, helpers, pluginOptions = {} }) {
    
    const knex = api.knex?.instance;
    if (!knex) {
      throw new Error('Generic API Plugin requires knex to be available. Please ensure rest-api-knex plugin is installed.');
    }
    
    // Plugin configuration with defaults
    const config = {
      tablePrefix: pluginOptions.tablePrefix || 'gen_api',
      apiPrefix: pluginOptions.apiPrefix || '/genApi',
      storageMode: pluginOptions.storageMode || 'hybrid', // 'eav', 'jsonb', or 'hybrid'
      maxIncludeDepth: pluginOptions.maxIncludeDepth || 5,
      batchSize: pluginOptions.batchSize || 100,
      cacheTimeout: pluginOptions.cacheTimeout || 300000,
      enableHooks: pluginOptions.enableHooks !== false,
      enableCaching: pluginOptions.enableCaching !== false,
      enableAudit: pluginOptions.enableAudit || false,
      enableMetrics: pluginOptions.enableMetrics || false,
      autoReload: pluginOptions.autoReload !== false,
      reloadInterval: pluginOptions.reloadInterval || 60000,
      queryDefaultLimit: pluginOptions.queryDefaultLimit || 100,
      queryMaxLimit: pluginOptions.queryMaxLimit || 1000,
      ...pluginOptions
    };
    
    // Store config in vars for access throughout
    vars.genericApiConfig = config;
    
    // Step 1: Create metadata resources using json-rest-api itself!
    // These are the tables that store the API definitions
    
    // Tables resource
    await api.addResource('genApiTables', {
      tableName: `${config.tablePrefix}_tables`,
      schema: {
        id: { type: 'id' },
        table_name: { type: 'string', required: true, unique: true, maxLength: 100 },
        api_name: { type: 'string', required: true, unique: true, maxLength: 100 },
        description: { type: 'string', maxLength: 500 },
        is_active: { type: 'boolean', default: true },
        storage_mode: { 
          type: 'string', 
          enum: ['eav', 'jsonb', 'hybrid'], 
          default: 'hybrid' 
        },
        config: { type: 'object' },
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' }
      },
      relationships: {
        fields: { 
          type: 'hasMany', 
          target: 'genApiFields', 
          foreignKey: 'table_id' 
        },
        sourceRelationships: { 
          type: 'hasMany', 
          target: 'genApiRelationships', 
          foreignKey: 'source_table_id',
          as: 'sourceRelationships'
        },
        targetRelationships: { 
          type: 'hasMany', 
          target: 'genApiRelationships', 
          foreignKey: 'target_table_id',
          as: 'targetRelationships'
        },
        data: {
          type: 'hasMany',
          target: 'genApiData',
          foreignKey: 'table_id'
        }
      }
    });
    
    // Fields resource
    await api.addResource('genApiFields', {
      tableName: `${config.tablePrefix}_fields`,
      schema: {
        id: { type: 'id' },
        table_id: { type: 'number', required: true },
        field_name: { type: 'string', required: true, maxLength: 100 },
        data_type: { type: 'string', required: true, maxLength: 50 },
        storage_type: { 
          type: 'string', 
          enum: ['eav', 'jsonb', 'indexed'], 
          default: 'eav' 
        },
        is_required: { type: 'boolean', default: false },
        is_hidden: { type: 'boolean', default: false },
        is_unique: { type: 'boolean', default: false },
        is_indexed: { type: 'boolean', default: false },
        is_searchable: { type: 'boolean', default: true },
        is_sortable: { type: 'boolean', default: true },
        is_computed: { type: 'boolean', default: false },
        computed_expression: { type: 'string' },
        index_position: { type: 'number' },
        max_length: { type: 'number' },
        min_value: { type: 'number' },
        max_value: { type: 'number' },
        default_value: { type: 'string' },
        enum_values: { type: 'string' },
        validation_rules: { type: 'string' },
        sort_order: { type: 'number', default: 0 },
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' }
      },
      relationships: {
        table: {
          type: 'belongsTo',
          target: 'genApiTables',
          foreignKey: 'table_id'
        },
        values: {
          type: 'hasMany',
          target: 'genApiDataValues',
          foreignKey: 'field_id'
        }
      }
    });
    
    // Relationships resource
    await api.addResource('genApiRelationships', {
      tableName: `${config.tablePrefix}_relationships`,
      schema: {
        id: { type: 'id' },
        source_table_id: { type: 'number', required: true },
        target_table_id: { type: 'number', required: true },
        relationship_name: { type: 'string', required: true, maxLength: 100 },
        relationship_type: { 
          type: 'string', 
          required: true, 
          enum: ['belongsTo', 'hasMany', 'manyToMany', 'hasOne']
        },
        foreign_key_field: { type: 'string', maxLength: 100 },
        other_key_field: { type: 'string', maxLength: 100 },
        junction_table: { type: 'string', maxLength: 100 },
        cascade_delete: { type: 'boolean', default: false },
        cascade_update: { type: 'boolean', default: false },
        config: { type: 'string' },
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' }
      },
      relationships: {
        sourceTable: {
          type: 'belongsTo',
          target: 'genApiTables',
          foreignKey: 'source_table_id'
        },
        targetTable: {
          type: 'belongsTo',
          target: 'genApiTables',
          foreignKey: 'target_table_id'
        }
      }
    });
    
    // Data resource (main storage with hybrid approach)
    await api.addResource('genApiData', {
      tableName: `${config.tablePrefix}_data`,
      schema: {
        id: { type: 'id' },
        table_id: { type: 'number', required: true },
        data: { type: 'object' }, // JSONB storage
        // Indexed columns for common data types
        indexed_string_1: { type: 'string', maxLength: 255 },
        indexed_string_2: { type: 'string', maxLength: 255 },
        indexed_string_3: { type: 'string', maxLength: 255 },
        indexed_number_1: { type: 'number' },
        indexed_number_2: { type: 'number' },
        indexed_number_3: { type: 'number' },
        indexed_date_1: { type: 'datetime' },
        indexed_date_2: { type: 'datetime' },
        indexed_bool_1: { type: 'boolean' },
        indexed_bool_2: { type: 'boolean' },
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' },
        created_by: { type: 'number' },
        updated_by: { type: 'number' }
      },
      relationships: {
        table: {
          type: 'belongsTo',
          target: 'genApiTables',
          foreignKey: 'table_id'
        },
        values: {
          type: 'hasMany',
          target: 'genApiDataValues',
          foreignKey: 'data_id'
        }
      }
    });
    
    // Data values resource (EAV storage)
    await api.addResource('genApiDataValues', {
      tableName: `${config.tablePrefix}_data_values`,
      schema: {
        id: { type: 'id' },
        data_id: { type: 'number', required: true },
        field_id: { type: 'number', required: true },
        value_text: { type: 'string' },
        value_number: { type: 'number' },
        value_date: { type: 'datetime' },
        value_json: { type: 'object' },
        value_boolean: { type: 'boolean' },
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' }
      },
      relationships: {
        data: {
          type: 'belongsTo',
          target: 'genApiData',
          foreignKey: 'data_id'
        },
        field: {
          type: 'belongsTo',
          target: 'genApiFields',
          foreignKey: 'field_id'
        }
      }
    });
    
    // Audit log resource (if enabled)
    if (config.enableAudit) {
      await api.addResource('genApiAuditLog', {
        tableName: `${config.tablePrefix}_audit_log`,
        schema: {
          id: { type: 'id' },
          table_id: { type: 'number', required: true },
          data_id: { type: 'number' },
          action: { type: 'string', required: true, maxLength: 20 },
          old_values: { type: 'object' },
          new_values: { type: 'object' },
          user_id: { type: 'number' },
          ip_address: { type: 'string', maxLength: 45 },
          created_at: { type: 'datetime' }
        },
        relationships: {
          table: {
            type: 'belongsTo',
            target: 'genApiTables',
            foreignKey: 'table_id'
          }
        }
      });
    }
    
    // Query metrics resource (if enabled)
    if (config.enableMetrics) {
      await api.addResource('genApiMetrics', {
        tableName: `${config.tablePrefix}_metrics`,
        schema: {
          id: { type: 'id' },
          table_id: { type: 'number' },
          operation: { type: 'string', maxLength: 20 },
          response_time: { type: 'number' },
          cache_hit: { type: 'boolean', default: false },
          result_count: { type: 'number' },
          created_at: { type: 'datetime' }
        },
        relationships: {
          table: {
            type: 'belongsTo',
            target: 'genApiTables',
            foreignKey: 'table_id'
          }
        }
      });
    }
    
    // Step 2: Create database tables for all metadata resources
    log.info('Creating Generic API metadata tables...');
    
    try {
      // Create tables using json-rest-api's built-in method
      await api.resources.genApiTables.createKnexTable();
      await api.resources.genApiFields.createKnexTable();
      await api.resources.genApiRelationships.createKnexTable();
      await api.resources.genApiData.createKnexTable();
      await api.resources.genApiDataValues.createKnexTable();
      
      if (config.enableAudit) {
        await api.resources.genApiAuditLog.createKnexTable();
      }
      
      if (config.enableMetrics) {
        await api.resources.genApiMetrics.createKnexTable();
      }
      
      // Create indexes for better performance
      await knex.schema.table(`${config.tablePrefix}_data`, table => {
        table.index(['table_id', 'created_at']);
        table.index(['table_id', 'indexed_string_1']);
        table.index(['table_id', 'indexed_number_1']);
        table.index(['table_id', 'indexed_date_1']);
      }).catch(() => {}); // Ignore if indexes already exist
      
      await knex.schema.table(`${config.tablePrefix}_data_values`, table => {
        table.index(['data_id', 'field_id']);
      }).catch(() => {});
      
      log.info('Generic API metadata tables created successfully');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
      log.debug('Generic API tables already exist');
    }
    
    // Step 3: Initialize components
    const hooks = new GenericApiHooks(config, log);
    const optimizer = new GenericApiOptimizer(knex, config, log);
    const storage = new GenericApiStorage(api, config, optimizer, log);
    const includes = new GenericApiIncludes(api, config, storage, log);
    const loader = new GenericApiLoader(api, config, log, storage, hooks, includes);
    
    // Store instances for access
    api.genericApi = {
      config,
      optimizer,
      storage,
      hooks,
      includes,
      loader,
      tables: new Map(),
      fields: new Map(),
      relationships: new Map()
    };
    
    // Step 4: Load existing dynamic resources
    async function loadDynamicResources() {
      try {
        const startTime = Date.now();
        
        // Query all active tables using json-rest-api
        const tablesResult = await api.resources.genApiTables.query({
          filters: { is_active: true },
          include: 'fields,sourceRelationships'
        });
        
        if (!tablesResult?.data?.length) {
          log.debug('No Generic API tables to load');
          return;
        }
        
        // Process each table
        for (const tableData of tablesResult.data) {
          const table = { ...tableData.attributes, id: tableData.id };
          
          // Extract fields and relationships from includes
          const fields = [];
          const relationships = [];
          
          if (tablesResult.included) {
            // Get fields for this table
            tablesResult.included
              .filter(item => item.type === 'genApiFields' && item.attributes.table_id === table.id)
              .forEach(field => {
                fields.push({ ...field.attributes, id: field.id });
              });
            
            // Get relationships for this table
            tablesResult.included
              .filter(item => item.type === 'genApiRelationships' && item.attributes.source_table_id === table.id)
              .forEach(rel => {
                relationships.push({ ...rel.attributes, id: rel.id });
              });
          }
          
          // Create the dynamic resource
          await loader.createResource(table, fields, relationships);
        }
        
        const loadTime = Date.now() - startTime;
        log.info(`Loaded ${tablesResult.data.length} Generic API resources in ${loadTime}ms`);
        
      } catch (error) {
        log.error('Failed to load dynamic resources:', error);
      }
    }
    
    // Load resources after initialization
    await loadDynamicResources();
    
    // Set up auto-reload if enabled
    if (config.autoReload) {
      setInterval(async () => {
        log.debug('Auto-reloading Generic API resources...');
        await loadDynamicResources();
      }, config.reloadInterval);
    }
    
    // Add API helper methods
    api.createGenericApiTable = async (tableConfig) => {
      const { table, fields = [], relationships = [] } = tableConfig;
      
      // Create table record using json-rest-api
      const tableResult = await api.resources.genApiTables.post({
        inputRecord: {
          data: {
            type: 'genApiTables',
            attributes: table
          }
        }
      });
      
      const tableId = tableResult.data.id;
      
      // Create field records
      for (const field of fields) {
        await api.resources.genApiFields.post({
          inputRecord: {
            data: {
              type: 'genApiFields',
              attributes: { ...field, table_id: tableId }
            }
          }
        });
      }
      
      // Create relationship records
      for (const rel of relationships) {
        await api.resources.genApiRelationships.post({
          inputRecord: {
            data: {
              type: 'genApiRelationships',
              attributes: { ...rel, source_table_id: tableId }
            }
          }
        });
      }
      
      // Load the new resource immediately
      const fieldsData = await api.resources.genApiFields.query({
        filters: { table_id: tableId }
      });
      
      const relsData = await api.resources.genApiRelationships.query({
        filters: { source_table_id: tableId }
      });
      
      await loader.createResource(
        { ...table, id: tableId },
        fieldsData.data.map(f => ({ ...f.attributes, id: f.id })),
        relsData.data.map(r => ({ ...r.attributes, id: r.id }))
      );
      
      return { tableId, resourceName: table.api_name || table.table_name };
    };
    
    log.info('Generic API Plugin installed successfully');
  }
};

export default GenericApiPlugin;