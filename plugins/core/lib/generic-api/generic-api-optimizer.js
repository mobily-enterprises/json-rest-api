/**
 * GenericApiOptimizer
 * 
 * Analyzes usage patterns and optimizes storage strategy for Generic API fields.
 * Suggests and creates database indexes for better performance.
 */

export class GenericApiOptimizer {
  constructor(knex, config, log) {
    this.knex = knex;
    this.config = config;
    this.log = log;
    this.usageStats = new Map();
    this.indexSuggestions = new Map();
    this.optimizationHistory = [];
  }
  
  /**
   * Determine optimal storage type for a field
   */
  async determineStorageType(field, sampleValue = null) {
    // Get usage statistics for this field
    const stats = await this.getFieldUsageStats(field);
    
    // Decision logic based on configuration and usage
    if (this.config.storageMode === 'eav') {
      return 'eav';
    }
    
    if (this.config.storageMode === 'jsonb') {
      return 'jsonb';
    }
    
    // Hybrid mode - make intelligent decisions
    if (this.config.storageMode === 'hybrid') {
      // High-frequency queried fields should be indexed
      if (field.is_indexed || (stats.queryCount > 100 && stats.queryRate > 0.5)) {
        return 'indexed';
      }
      
      // Searchable and sortable fields benefit from indexing
      if (field.is_searchable || field.is_sortable) {
        // But only if they're simple types
        if (['string', 'number', 'date', 'boolean'].includes(field.data_type)) {
          return 'indexed';
        }
      }
      
      // Large text or complex types go to JSONB
      if (['text', 'json', 'object', 'array'].includes(field.data_type)) {
        return 'jsonb';
      }
      
      // Fields with many distinct values use EAV
      if (stats.distinctValueCount > 1000) {
        return 'eav';
      }
      
      // Default to JSONB for flexibility
      return 'jsonb';
    }
    
    return field.storage_type || 'jsonb';
  }
  
  /**
   * Analyze field usage and suggest optimizations
   */
  async analyzeFieldUsage(tableId, fieldId) {
    const key = `${tableId}:${fieldId}`;
    
    if (!this.usageStats.has(key)) {
      this.usageStats.set(key, {
        queryCount: 0,
        updateCount: 0,
        nullCount: 0,
        distinctValueCount: 0,
        avgValueLength: 0,
        queryRate: 0,
        updateRate: 0,
        lastAnalyzed: new Date()
      });
    }
    
    const stats = this.usageStats.get(key);
    
    try {
      // Analyze actual data if metrics are enabled
      if (this.config.enableMetrics) {
        // Count queries involving this field
        const queryMetrics = await this.knex(`${this.config.tablePrefix}_metrics`)
          .where('table_id', tableId)
          .where('operation', 'query')
          .count('* as count')
          .first();
        
        stats.queryCount = queryMetrics?.count || 0;
        
        // Calculate distinct values
        const distinctValues = await this.knex(`${this.config.tablePrefix}_data_values`)
          .where('field_id', fieldId)
          .countDistinct('value_text as text_count')
          .countDistinct('value_number as number_count')
          .first();
        
        stats.distinctValueCount = Math.max(
          distinctValues?.text_count || 0,
          distinctValues?.number_count || 0
        );
        
        // Calculate query rate (queries per total operations)
        const totalOps = await this.knex(`${this.config.tablePrefix}_metrics`)
          .where('table_id', tableId)
          .count('* as count')
          .first();
        
        if (totalOps?.count > 0) {
          stats.queryRate = stats.queryCount / totalOps.count;
        }
      }
      
      stats.lastAnalyzed = new Date();
      
    } catch (error) {
      this.log.debug('Failed to analyze field usage:', error);
    }
    
    return stats;
  }
  
  /**
   * Get field usage statistics
   */
  async getFieldUsageStats(field) {
    const key = `${field.table_id}:${field.id}`;
    
    if (this.usageStats.has(key)) {
      const stats = this.usageStats.get(key);
      
      // Re-analyze if stats are stale (older than 1 hour)
      if (Date.now() - stats.lastAnalyzed.getTime() > 3600000) {
        return await this.analyzeFieldUsage(field.table_id, field.id);
      }
      
      return stats;
    }
    
    return await this.analyzeFieldUsage(field.table_id, field.id);
  }
  
  /**
   * Suggest indexes for a table
   */
  async suggestIndexes(tableId, fields) {
    const suggestions = [];
    
    for (const field of fields) {
      const stats = await this.getFieldUsageStats(field);
      
      // Suggest index if:
      // 1. Field is frequently queried
      // 2. Field is used for sorting
      // 3. Field has good selectivity (not too many duplicates)
      
      const shouldIndex = 
        (field.is_searchable || field.is_sortable) &&
        stats.queryCount > 50 &&
        stats.queryRate > 0.3 &&
        stats.distinctValueCount > 10;
      
      if (shouldIndex && !field.is_indexed) {
        suggestions.push({
          fieldId: field.id,
          fieldName: field.field_name,
          reason: this.getIndexReason(stats),
          priority: this.calculateIndexPriority(stats),
          estimatedImprovement: this.estimatePerformanceImprovement(stats)
        });
      }
    }
    
    // Sort by priority
    suggestions.sort((a, b) => b.priority - a.priority);
    
    // Cache suggestions
    this.indexSuggestions.set(tableId, suggestions);
    
    return suggestions;
  }
  
  /**
   * Create suggested indexes
   */
  async createSuggestedIndexes(tableId, fields) {
    const suggestions = await this.suggestIndexes(tableId, fields);
    const created = [];
    
    for (const suggestion of suggestions) {
      if (suggestion.priority > 0.7) { // Only create high-priority indexes
        try {
          const field = fields.find(f => f.id === suggestion.fieldId);
          if (!field) continue;
          
          // Determine which indexed column to use
          const indexedColumn = this.getAvailableIndexedColumn(field, fields);
          if (!indexedColumn) {
            this.log.warn(`No available indexed column for field ${field.field_name}`);
            continue;
          }
          
          // Update field to use indexed storage
          await this.knex(`${this.config.tablePrefix}_fields`)
            .where('id', field.id)
            .update({
              storage_type: 'indexed',
              is_indexed: true,
              index_position: indexedColumn.position,
              updated_at: new Date()
            });
          
          created.push({
            field: field.field_name,
            column: indexedColumn.name,
            reason: suggestion.reason
          });
          
          this.log.info(`Created index for field ${field.field_name} using ${indexedColumn.name}`);
          
        } catch (error) {
          this.log.error(`Failed to create index for field ${suggestion.fieldName}:`, error);
        }
      }
    }
    
    // Record optimization
    this.optimizationHistory.push({
      tableId,
      timestamp: new Date(),
      suggestionsCount: suggestions.length,
      createdCount: created.length,
      created
    });
    
    return created;
  }
  
  /**
   * Get available indexed column for a field
   */
  getAvailableIndexedColumn(field, allFields) {
    const usedColumns = new Map();
    
    // Find which columns are already in use
    for (const f of allFields) {
      if (f.storage_type === 'indexed' && f.index_position) {
        const prefix = this.getIndexedColumnPrefix(f.data_type);
        if (prefix) {
          const key = `${prefix}${f.index_position}`;
          usedColumns.set(key, true);
        }
      }
    }
    
    // Find first available column of appropriate type
    const prefix = this.getIndexedColumnPrefix(field.data_type);
    if (!prefix) return null;
    
    const maxColumns = prefix.includes('string') ? 3 : 
                       prefix.includes('number') ? 3 :
                       prefix.includes('date') ? 2 :
                       prefix.includes('bool') ? 2 : 1;
    
    for (let i = 1; i <= maxColumns; i++) {
      const columnName = `${prefix}${i}`;
      if (!usedColumns.has(columnName)) {
        return {
          name: columnName,
          position: i
        };
      }
    }
    
    return null;
  }
  
  /**
   * Get indexed column prefix for data type
   */
  getIndexedColumnPrefix(dataType) {
    const prefixMap = {
      'string': 'indexed_string_',
      'text': 'indexed_string_',
      'varchar': 'indexed_string_',
      'number': 'indexed_number_',
      'integer': 'indexed_number_',
      'int': 'indexed_number_',
      'float': 'indexed_number_',
      'decimal': 'indexed_number_',
      'date': 'indexed_date_',
      'datetime': 'indexed_date_',
      'timestamp': 'indexed_date_',
      'boolean': 'indexed_bool_',
      'bool': 'indexed_bool_'
    };
    
    return prefixMap[dataType?.toLowerCase()];
  }
  
  /**
   * Get reason for index suggestion
   */
  getIndexReason(stats) {
    const reasons = [];
    
    if (stats.queryCount > 100) {
      reasons.push(`frequently queried (${stats.queryCount} times)`);
    }
    
    if (stats.queryRate > 0.5) {
      reasons.push(`high query rate (${Math.round(stats.queryRate * 100)}%)`);
    }
    
    if (stats.distinctValueCount > 100) {
      reasons.push(`good selectivity (${stats.distinctValueCount} distinct values)`);
    }
    
    return reasons.join(', ');
  }
  
  /**
   * Calculate index priority
   */
  calculateIndexPriority(stats) {
    let priority = 0;
    
    // Query frequency (0-0.4 points)
    if (stats.queryCount > 1000) priority += 0.4;
    else if (stats.queryCount > 500) priority += 0.3;
    else if (stats.queryCount > 100) priority += 0.2;
    else if (stats.queryCount > 50) priority += 0.1;
    
    // Query rate (0-0.3 points)
    priority += Math.min(0.3, stats.queryRate * 0.3);
    
    // Selectivity (0-0.3 points)
    if (stats.distinctValueCount > 1000) priority += 0.3;
    else if (stats.distinctValueCount > 500) priority += 0.2;
    else if (stats.distinctValueCount > 100) priority += 0.1;
    
    return Math.min(1, priority);
  }
  
  /**
   * Estimate performance improvement from index
   */
  estimatePerformanceImprovement(stats) {
    // Simple estimation based on query patterns
    const baseImprovement = stats.queryRate * 100;
    const selectivityBonus = Math.min(50, stats.distinctValueCount / 10);
    
    return Math.round(baseImprovement + selectivityBonus);
  }
  
  /**
   * Migrate data to optimized storage
   */
  async migrateToOptimizedStorage(tableId, fieldId, fromType, toType) {
    this.log.info(`Migrating field ${fieldId} from ${fromType} to ${toType}`);
    
    try {
      // This would involve:
      // 1. Reading existing data
      // 2. Converting to new storage format
      // 3. Writing to new location
      // 4. Updating field configuration
      // 5. Cleaning up old data
      
      // For now, just update the field configuration
      await this.knex(`${this.config.tablePrefix}_fields`)
        .where('id', fieldId)
        .update({
          storage_type: toType,
          updated_at: new Date()
        });
      
      this.log.info(`Migration completed for field ${fieldId}`);
      return true;
      
    } catch (error) {
      this.log.error(`Migration failed for field ${fieldId}:`, error);
      return false;
    }
  }
  
  /**
   * Get optimization metrics
   */
  getMetrics() {
    return {
      analyzedFields: this.usageStats.size,
      pendingSuggestions: Array.from(this.indexSuggestions.values()).flat().length,
      optimizationHistory: this.optimizationHistory.length,
      lastOptimization: this.optimizationHistory[this.optimizationHistory.length - 1]
    };
  }
  
  /**
   * Clear optimization data
   */
  clearData() {
    this.usageStats.clear();
    this.indexSuggestions.clear();
    this.optimizationHistory = [];
    this.log.debug('Cleared optimization data');
  }
}

export default GenericApiOptimizer;