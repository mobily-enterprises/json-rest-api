/**
 * GenericApiStorage
 * 
 * Handles storage operations for Generic API using json-rest-api's own methods.
 * Implements hybrid storage strategy (EAV + JSONB + indexed columns).
 */

export class GenericApiStorage {
  constructor(api, config, optimizer, log) {
    this.api = api;
    this.config = config;
    this.optimizer = optimizer;
    this.log = log;
    this.cache = new Map();
    this.cacheTimers = new Map();
  }
  
  /**
   * Store a record using json-rest-api resources
   */
  async storeRecord(tableId, fields, data, context = {}) {
    const startTime = Date.now();
    
    try {
      // Prepare data for hybrid storage
      const { mainRecord, eavValues } = await this.prepareDataForStorage(tableId, fields, data);
      
      // Create main record using json-rest-api!
      const mainRecordResult = await this.api.resources.genApiData.post({
        inputRecord: {
          data: {
            type: 'genApiData',
            attributes: mainRecord
          }
        }
      }, context);
      
      const recordId = mainRecordResult.data.id;
      
      // Store EAV values if any
      if (eavValues.length > 0) {
        for (const eavValue of eavValues) {
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
      
      // Cache the record if caching is enabled
      if (this.config.enableCaching) {
        this.cacheRecord(recordId, { ...data, id: recordId });
      }
      
      // Record metrics
      if (this.config.enableMetrics) {
        await this.recordMetric('create', tableId, Date.now() - startTime, false);
      }
      
      return recordId;
      
    } catch (error) {
      this.log.error('Failed to store record:', error);
      throw error;
    }
  }
  
  /**
   * Query records using json-rest-api resources
   */
  async queryRecords(tableId, fields, filters = {}, options = {}) {
    const startTime = Date.now();
    let cacheHit = false;
    
    try {
      // Check cache first
      const cacheKey = this.getCacheKey('query', tableId, filters, options);
      if (this.config.enableCaching && this.cache.has(cacheKey)) {
        cacheHit = true;
        const cached = this.cache.get(cacheKey);
        if (cached.expires > Date.now()) {
          if (this.config.enableMetrics) {
            await this.recordMetric('query', tableId, Date.now() - startTime, true);
          }
          return cached.data;
        }
      }
      
      // Build query using json-rest-api
      const queryOptions = {
        filters: { 
          table_id: tableId,
          ...this.transformFiltersForStorage(filters, fields)
        },
        sort: options.sort,
        limit: options.limit || this.config.queryDefaultLimit,
        offset: options.offset,
        page: options.page
      };
      
      // Include EAV values if needed
      const needsEav = fields.some(f => f.storage_type === 'eav');
      if (needsEav) {
        queryOptions.include = 'values';
      }
      
      // Query using json-rest-api
      const result = await this.api.resources.genApiData.query(queryOptions);
      
      // Transform results back to normal structure
      const records = await this.transformRecordsFromStorage(result.data, fields, result.included);
      
      // Cache the results
      if (this.config.enableCaching) {
        this.cache.set(cacheKey, {
          data: records,
          expires: Date.now() + this.config.cacheTimeout
        });
      }
      
      // Record metrics
      if (this.config.enableMetrics) {
        await this.recordMetric('query', tableId, Date.now() - startTime, cacheHit);
      }
      
      return records;
      
    } catch (error) {
      this.log.error('Failed to query records:', error);
      throw error;
    }
  }
  
  /**
   * Update a record using json-rest-api resources
   */
  async updateRecord(tableId, recordId, fields, data, context = {}) {
    const startTime = Date.now();
    
    try {
      // Prepare data for hybrid storage
      const { mainRecord, eavValues } = await this.prepareDataForStorage(tableId, fields, data);
      
      // Update main record using json-rest-api
      await this.api.resources.genApiData.patch({
        id: recordId,
        inputRecord: {
          data: {
            type: 'genApiData',
            id: String(recordId),
            attributes: mainRecord
          }
        }
      }, context);
      
      // Update EAV values
      if (eavValues.length > 0) {
        // Get existing EAV values
        const existingValues = await this.api.resources.genApiDataValues.query({
          filters: { data_id: recordId }
        });
        
        // Update or create EAV values
        for (const eavValue of eavValues) {
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
      
      // Invalidate cache
      this.invalidateRecordCache(recordId);
      this.invalidateTableCache(tableId);
      
      // Record metrics
      if (this.config.enableMetrics) {
        await this.recordMetric('update', tableId, Date.now() - startTime, false);
      }
      
      return true;
      
    } catch (error) {
      this.log.error('Failed to update record:', error);
      throw error;
    }
  }
  
  /**
   * Delete a record using json-rest-api resources
   */
  async deleteRecord(tableId, recordId, context = {}) {
    const startTime = Date.now();
    
    try {
      // Delete EAV values first
      const eavValues = await this.api.resources.genApiDataValues.query({
        filters: { data_id: recordId }
      });
      
      for (const value of eavValues.data) {
        await this.api.resources.genApiDataValues.delete({
          id: value.id
        }, context);
      }
      
      // Delete main record
      await this.api.resources.genApiData.delete({
        id: recordId
      }, context);
      
      // Invalidate cache
      this.invalidateRecordCache(recordId);
      this.invalidateTableCache(tableId);
      
      // Record metrics
      if (this.config.enableMetrics) {
        await this.recordMetric('delete', tableId, Date.now() - startTime, false);
      }
      
      return true;
      
    } catch (error) {
      this.log.error('Failed to delete record:', error);
      throw error;
    }
  }
  
  /**
   * Prepare data for hybrid storage
   */
  async prepareDataForStorage(tableId, fields, data) {
    const mainRecord = {
      table_id: tableId,
      data: {},
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const eavValues = [];
    let indexedStringCount = 0;
    let indexedNumberCount = 0;
    let indexedDateCount = 0;
    let indexedBoolCount = 0;
    
    for (const field of fields) {
      const value = data[field.field_name];
      if (value === undefined || value === null) continue;
      
      // Determine storage strategy
      const storageType = field.storage_type || 
        await this.optimizer.determineStorageType(field, value);
      
      if (storageType === 'indexed' && field.is_indexed) {
        // Store in indexed column
        switch (field.data_type) {
          case 'string':
          case 'text':
            if (indexedStringCount < 3) {
              mainRecord[`indexed_string_${++indexedStringCount}`] = String(value).substring(0, 255);
            } else {
              mainRecord.data[field.field_name] = value;
            }
            break;
          case 'number':
          case 'integer':
            if (indexedNumberCount < 3) {
              mainRecord[`indexed_number_${++indexedNumberCount}`] = Number(value);
            } else {
              mainRecord.data[field.field_name] = value;
            }
            break;
          case 'date':
          case 'datetime':
            if (indexedDateCount < 2) {
              mainRecord[`indexed_date_${++indexedDateCount}`] = new Date(value);
            } else {
              mainRecord.data[field.field_name] = value;
            }
            break;
          case 'boolean':
            if (indexedBoolCount < 2) {
              mainRecord[`indexed_bool_${++indexedBoolCount}`] = Boolean(value);
            } else {
              mainRecord.data[field.field_name] = value;
            }
            break;
          default:
            mainRecord.data[field.field_name] = value;
        }
      } else if (storageType === 'eav') {
        // Store in EAV table
        const eavValue = {
          field_id: field.id,
          created_at: new Date(),
          updated_at: new Date()
        };
        
        // Store in appropriate value column
        switch (field.data_type) {
          case 'string':
          case 'text':
            eavValue.value_text = String(value);
            break;
          case 'number':
          case 'integer':
          case 'float':
          case 'decimal':
            eavValue.value_number = Number(value);
            break;
          case 'date':
          case 'datetime':
            eavValue.value_date = new Date(value);
            break;
          case 'boolean':
            eavValue.value_boolean = Boolean(value);
            break;
          case 'json':
          case 'object':
          case 'array':
            eavValue.value_json = value;
            break;
          default:
            eavValue.value_text = String(value);
        }
        
        eavValues.push(eavValue);
      } else {
        // Store in JSONB
        mainRecord.data[field.field_name] = value;
      }
    }
    
    return { mainRecord, eavValues };
  }
  
  /**
   * Transform records from storage format back to normal
   */
  async transformRecordsFromStorage(records, fields, included = []) {
    const transformed = [];
    
    for (const record of records) {
      const data = { id: record.id };
      const attrs = record.attributes;
      
      // Extract from JSONB
      if (attrs.data) {
        Object.assign(data, attrs.data);
      }
      
      // Extract from indexed columns
      let stringIndex = 0, numberIndex = 0, dateIndex = 0, boolIndex = 0;
      for (const field of fields) {
        if (field.storage_type === 'indexed' && field.is_indexed) {
          switch (field.data_type) {
            case 'string':
            case 'text':
              if (attrs[`indexed_string_${++stringIndex}`] !== undefined) {
                data[field.field_name] = attrs[`indexed_string_${stringIndex}`];
              }
              break;
            case 'number':
            case 'integer':
              if (attrs[`indexed_number_${++numberIndex}`] !== undefined) {
                data[field.field_name] = attrs[`indexed_number_${numberIndex}`];
              }
              break;
            case 'date':
            case 'datetime':
              if (attrs[`indexed_date_${++dateIndex}`] !== undefined) {
                data[field.field_name] = attrs[`indexed_date_${dateIndex}`];
              }
              break;
            case 'boolean':
              if (attrs[`indexed_bool_${++boolIndex}`] !== undefined) {
                data[field.field_name] = attrs[`indexed_bool_${boolIndex}`];
              }
              break;
          }
        }
      }
      
      // Extract from EAV values if included
      if (included && included.length > 0) {
        const eavValues = included.filter(
          item => item.type === 'genApiDataValues' && 
                  item.attributes.data_id === record.id
        );
        
        for (const eavValue of eavValues) {
          const field = fields.find(f => f.id === eavValue.attributes.field_id);
          if (!field) continue;
          
          // Get value from appropriate column
          let value = null;
          if (eavValue.attributes.value_text !== null) value = eavValue.attributes.value_text;
          else if (eavValue.attributes.value_number !== null) value = eavValue.attributes.value_number;
          else if (eavValue.attributes.value_date !== null) value = eavValue.attributes.value_date;
          else if (eavValue.attributes.value_boolean !== null) value = eavValue.attributes.value_boolean;
          else if (eavValue.attributes.value_json !== null) value = eavValue.attributes.value_json;
          
          if (value !== null) {
            data[field.field_name] = value;
          }
        }
      }
      
      // Add metadata
      data.created_at = attrs.created_at;
      data.updated_at = attrs.updated_at;
      
      transformed.push(data);
    }
    
    return transformed;
  }
  
  /**
   * Transform filters for storage query
   */
  transformFiltersForStorage(filters, fields) {
    const transformed = {};
    
    for (const [key, value] of Object.entries(filters)) {
      const field = fields.find(f => f.field_name === key);
      
      if (!field) {
        transformed[key] = value;
        continue;
      }
      
      // Map to storage location
      if (field.storage_type === 'indexed' && field.is_indexed) {
        // Find which indexed column it's in
        const indexedCol = this.getIndexedColumnForField(field, fields);
        if (indexedCol) {
          transformed[indexedCol] = value;
        } else {
          // Fallback to JSONB query
          transformed[`data->>${key}`] = value;
        }
      } else if (field.storage_type === 'jsonb') {
        // Query JSONB field
        transformed[`data->>${key}`] = value;
      } else {
        // EAV storage - requires join, handle separately
        // For now, we'll skip EAV filtering in the main query
        // and filter in memory after retrieval
        this.log.debug(`Field ${key} uses EAV storage, filtering will be done in memory`);
      }
    }
    
    return transformed;
  }
  
  /**
   * Get indexed column name for a field
   */
  getIndexedColumnForField(field, allFields) {
    const indexedFields = allFields
      .filter(f => f.storage_type === 'indexed' && f.is_indexed)
      .sort((a, b) => (a.index_position || 0) - (b.index_position || 0));
    
    let stringCount = 0, numberCount = 0, dateCount = 0, boolCount = 0;
    
    for (const f of indexedFields) {
      if (f.field_name === field.field_name) {
        switch (f.data_type) {
          case 'string':
          case 'text':
            return `indexed_string_${stringCount + 1}`;
          case 'number':
          case 'integer':
            return `indexed_number_${numberCount + 1}`;
          case 'date':
          case 'datetime':
            return `indexed_date_${dateCount + 1}`;
          case 'boolean':
            return `indexed_bool_${boolCount + 1}`;
        }
      }
      
      // Count previous fields of same type
      switch (f.data_type) {
        case 'string':
        case 'text':
          stringCount++;
          break;
        case 'number':
        case 'integer':
          numberCount++;
          break;
        case 'date':
        case 'datetime':
          dateCount++;
          break;
        case 'boolean':
          boolCount++;
          break;
      }
    }
    
    return null;
  }
  
  /**
   * Cache management
   */
  cacheRecord(recordId, data) {
    const key = `record:${recordId}`;
    this.cache.set(key, {
      data,
      expires: Date.now() + this.config.cacheTimeout
    });
    
    // Set timer to clean up expired cache
    if (this.cacheTimers.has(key)) {
      clearTimeout(this.cacheTimers.get(key));
    }
    this.cacheTimers.set(key, setTimeout(() => {
      this.cache.delete(key);
      this.cacheTimers.delete(key);
    }, this.config.cacheTimeout));
  }
  
  invalidateRecordCache(recordId) {
    const key = `record:${recordId}`;
    this.cache.delete(key);
    if (this.cacheTimers.has(key)) {
      clearTimeout(this.cacheTimers.get(key));
      this.cacheTimers.delete(key);
    }
  }
  
  invalidateTableCache(tableId) {
    // Invalidate all query caches for this table
    for (const [key] of this.cache) {
      if (key.startsWith(`query:${tableId}:`)) {
        this.cache.delete(key);
      }
    }
  }
  
  getCacheKey(operation, tableId, ...params) {
    return `${operation}:${tableId}:${JSON.stringify(params)}`;
  }
  
  /**
   * Record metrics using json-rest-api
   */
  async recordMetric(operation, tableId, responseTime, cacheHit) {
    if (!this.config.enableMetrics) return;
    
    try {
      await this.api.resources.genApiMetrics?.post({
        inputRecord: {
          data: {
            type: 'genApiMetrics',
            attributes: {
              table_id: tableId,
              operation,
              response_time: responseTime,
              cache_hit: cacheHit,
              created_at: new Date()
            }
          }
        }
      });
    } catch (error) {
      this.log.debug('Failed to record metric:', error);
    }
  }
  
  /**
   * Get storage metrics
   */
  getMetrics() {
    const cacheSize = this.cache.size;
    let cacheHits = 0;
    let cacheMisses = 0;
    
    // Count cache hits/misses from cache entries
    for (const [key, value] of this.cache) {
      if (key.startsWith('query:')) {
        if (value.expires > Date.now()) {
          cacheHits++;
        } else {
          cacheMisses++;
        }
      }
    }
    
    return {
      cacheSize,
      cacheHits,
      cacheMisses,
      cacheHitRate: cacheHits / (cacheHits + cacheMisses) || 0
    };
  }
}

export default GenericApiStorage;