/**
 * @module relationship-includes
 * @description JSON:API relationship inclusion helpers for REST API Knex Plugin
 * 
 * This module provides utilities for loading related resources according to the JSON:API
 * specification. It supports:
 * - Single-level includes (e.g., "author")
 * - Nested includes (e.g., "comments.author")  
 * - Many-to-one relationships (belongsTo with sideLoad: true)
 * - One-to-many relationships (hasMany with sideLoad: true)
 * - Polymorphic relationships (belongsToPolymorphic)
 * - Reverse polymorphic relationships (hasMany with via)
 * - Automatic deduplication of included resources
 * - Efficient batch loading to prevent N+1 queries
 * 
 * @example <caption>Basic single-level include</caption>
 * // GET /articles?include=author
 * // Loads all articles and their authors in 2 queries total
 * 
 * @example <caption>Multiple includes</caption>
 * // GET /articles?include=author,comments
 * // Loads articles, all authors, and all comments in 3 queries total
 * 
 * @example <caption>Nested includes</caption>
 * // GET /articles?include=comments.author
 * // Loads articles, their comments, and comment authors in 3 queries total
 * 
 * @example <caption>Complex nested includes</caption>
 * // GET /articles?include=author,comments.author,comments.article
 * // Handles circular references automatically through deduplication
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this module to:
 * // 1. Implement JSON:API compound documents (main data + included resources)
 * // 2. Prevent N+1 query problems through batch loading strategies
 * // 3. Support arbitrarily deep relationship nesting (e.g., article.author.company.country)
 * // 4. Handle polymorphic relationships that can point to multiple types
 * // 5. Deduplicate included resources automatically (no duplicate authors if multiple articles have same author)
 * // 6. Apply sparse fieldsets to included resources for bandwidth optimization
 * // 7. Maintain referential integrity by only loading existing relationships
 * // 8. Use mutual recursion for elegant handling of complex include trees
 * // 9. Support both forward (belongsTo/hasMany) and reverse (via) relationships
 */

import { getForeignKeyFields, buildFieldSelection } from './knex-field-helpers.js';

/**
 * Creates relationship include helper functions
 * 
 * @param {Object} scopes - The hooked-api scopes object containing all registered scopes
 * @param {Object} log - The logging instance for debug/trace output
 * @param {Object} knex - The Knex instance for database queries
 * @returns {Object} Object containing all relationship include helper functions
 * 
 * @example
 * import { createRelationshipIncludeHelpers } from './lib/relationship-includes.js';
 * 
 * const includeHelpers = createRelationshipIncludeHelpers(scopes, log, knex);
 * 
 * // Parse include parameter
 * const includeTree = includeHelpers.parseIncludeTree('author,comments.author');
 * 
 * // Process includes for a set of records
 * const { included, recordsWithRelationships } = await includeHelpers.buildIncludedResources(
 *   records,
 *   'articles', 
 *   'author,comments.author'
 * );
 */
export const createRelationshipIncludeHelpers = (scopes, log, knex) => {
    
  /**
   * Helper to convert DB record to JSON:API format
   * @private
   */
  const toJsonApi = (scopeName, record, schema, idProperty = 'id') => {
    if (!record) return null;
    
    const { [idProperty]: id, ...allAttributes } = record;
    
    // Filter out foreign keys from attributes if we have schema
    if (schema) {
      const foreignKeys = getForeignKeyFields(schema);
      const attributes = {};
      
      Object.entries(allAttributes).forEach(([key, value]) => {
        if (!foreignKeys.has(key)) {
          attributes[key] = value;
        }
      });
      
      return {
        type: scopeName,
        id: String(id),
        attributes
      };
    }
    
    // Fallback to original behavior if no schema
    return {
      type: scopeName,
      id: String(id),
      attributes: allAttributes
    };
  };
  
  /**
   * Groups records by their polymorphic type for efficient batch loading
   * 
   * Used when loading includes to minimize database queries. Instead of making
   * N queries (one per record), this groups records by type so we can make
   * one query per type.
   * 
   * @param {Array<Object>} records - Records containing polymorphic fields
   * @param {string} typeField - Name of the type field (e.g., 'commentable_type')
   * @param {string} idField - Name of the ID field (e.g., 'commentable_id')
   * @returns {Object<string, Array<number|string>>} Map of type to array of unique IDs
   * 
   * @example <caption>Basic grouping</caption>
   * const comments = [
   *   { id: 1, commentable_type: 'articles', commentable_id: 123 },
   *   { id: 2, commentable_type: 'videos', commentable_id: 456 },
   *   { id: 3, commentable_type: 'articles', commentable_id: 789 },
   *   { id: 4, commentable_type: 'articles', commentable_id: 123 }  // Duplicate
   * ];
   * 
   * const grouped = groupByPolymorphicType(comments, 'commentable_type', 'commentable_id');
   * // Returns: {
   * //   articles: [123, 789],  // Note: duplicates removed
   * //   videos: [456]
   * // }
   * 
   * @example <caption>Handling null values</caption>
   * const comments = [
   *   { id: 1, commentable_type: 'articles', commentable_id: 123 },
   *   { id: 2, commentable_type: null, commentable_id: 456 },        // Ignored
   *   { id: 3, commentable_type: 'videos', commentable_id: null }    // Ignored
   * ];
   * 
   * const grouped = groupByPolymorphicType(comments, 'commentable_type', 'commentable_id');
   * // Returns: { articles: [123] }
   * // Records with null type or ID are excluded
   */
  const groupByPolymorphicType = (records, typeField, idField) => {
    const grouped = {};
    
    records.forEach(record => {
      const type = record[typeField];
      const id = record[idField];
      
      if (type && id) {
        if (!grouped[type]) {
          grouped[type] = new Set();
        }
        grouped[type].add(id);
      }
    });
    
    // Convert Sets to Arrays for SQL IN queries
    Object.keys(grouped).forEach(type => {
      grouped[type] = Array.from(grouped[type]);
    });
    
    return grouped;
  };
  
  /**
   * Parses JSON:API include parameter into a tree structure for efficient processing
   * 
   * @param {string} includeString - Comma-separated include paths (e.g., "author,comments.author")
   * @returns {Object} Tree structure representing the include hierarchy
   * 
   * @example <caption>Simple includes</caption>
   * parseIncludeTree("author,comments")
   * // Returns: { author: {}, comments: {} }
   * 
   * @example <caption>Nested includes</caption>
   * parseIncludeTree("comments.author,comments.article.publisher")
   * // Returns: { comments: { author: {}, article: { publisher: {} } } }
   * 
   * @example <caption>Empty input</caption>
   * parseIncludeTree("")
   * // Returns: {}
   */
  const parseIncludeTree = (includeParam) => {
    log.trace('[INCLUDE] Parsing include parameter:', includeParam);
    
    const tree = {};
    
    // Handle both string and array formats
    let includePaths = [];
    if (typeof includeParam === 'string') {
      if (includeParam.trim() === '') {
        log.trace('[INCLUDE] Empty include string, returning empty tree');
        return tree;
      }
      includePaths = includeParam.split(',').map(p => p.trim()).filter(Boolean);
    } else if (Array.isArray(includeParam)) {
      includePaths = includeParam.filter(p => typeof p === 'string' && p.trim() !== '');
    } else {
      log.trace('[INCLUDE] Invalid include parameter type, returning empty tree');
      return tree;
    }
    
    if (includePaths.length === 0) {
      log.trace('[INCLUDE] No valid include paths, returning empty tree');
      return tree;
    }
    
    // Process each path
    includePaths.forEach(path => {
      const parts = path.split('.');
      let current = tree;
      
      // Build the tree structure
      parts.forEach((part, index) => {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
        log.trace('[INCLUDE] Added to tree:', { path: parts.slice(0, index + 1).join('.') });
      });
    });
    
    log.trace('[INCLUDE] Final include tree:', tree);
    return tree;
  };
  
  /**
   * Processes belongsTo relationships (many-to-one)
   * 
   * @async
   * @private
   * @param {Array} records - The parent records
   * @param {string} fieldName - The foreign key field name
   * @param {Object} fieldDef - The field definition from schema
   * @param {string} includeName - The relationship name (from 'as' property)
   * @param {Object} subIncludes - Nested includes to process recursively
   * @param {Map} included - Map of already included resources (type:id -> resource)
   * @param {Set} processedPaths - Set of already processed paths to prevent infinite loops
   * @param {string} currentPath - Current include path for tracking
   * @returns {Promise<void>}
   */
  const loadBelongsTo = async (records, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields) => {
    log.trace('[INCLUDE] Loading belongsTo relationship:', { fieldName, includeName, recordCount: records.length });
    
    // Collect all unique foreign key values
    const foreignKeys = [...new Set(records.map(r => r[fieldName]).filter(Boolean))];
    
    if (foreignKeys.length === 0) {
      log.trace('[INCLUDE] No foreign keys found, but still adding null relationships');
      // Still need to add null relationships
      records.forEach(record => {
        if (!record._relationships) record._relationships = {};
        record._relationships[includeName] = { data: null };
      });
      return;
    }
    
    log.trace('[INCLUDE] Found foreign keys:', { count: foreignKeys.length });
    
    // Get target scope information
    const targetScope = fieldDef.belongsTo;
    const targetTable = scopes[targetScope].vars.schemaInfo.tableName
    
    // Build field selection for sparse fieldsets
    const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
    const fieldsToSelect = await buildFieldSelection(targetScope, fields?.[targetScope], targetSchema, scopes, scopes[targetScope].vars);
    
    // Single query to load all related records
    log.debug(`[INCLUDE] Loading ${targetScope} records:`, { whereIn: foreignKeys, fields: fieldsToSelect });
    let query = knex(targetTable).whereIn('id', foreignKeys);
    if (fieldsToSelect !== '*') {
      query = query.select(fieldsToSelect);
    }
    const relatedRecords = await query;
    
    log.trace('[INCLUDE] Loaded related records:', { count: relatedRecords.length });
    
    // Create lookup map for efficiency
    const relatedById = {};
    relatedRecords.forEach(record => {
      relatedById[record.id] = record;
      
      // Add to included resources map (keep raw record for relationship processing)
      const key = `${targetScope}:${record.id}`;
      if (!included.has(key)) {
        included.set(key, { raw: record, scope: targetScope });
        log.trace('[INCLUDE] Added to included:', key);
      }
    });
    
    // Add relationship data to parent records
    records.forEach(record => {
      if (!record._relationships) record._relationships = {};
      
      if (record[fieldName] && relatedById[record[fieldName]]) {
        record._relationships[includeName] = {
          data: { type: targetScope, id: String(record[fieldName]) }
        };
      } else if (record[fieldName]) {
        // Foreign key exists but related record not found
        log.debug('[INCLUDE] Related record not found:', { 
          parentId: record.id, 
          foreignKey: record[fieldName],
          targetScope 
        });
        record._relationships[includeName] = { data: null };
      } else {
        // No foreign key value
        record._relationships[includeName] = { data: null };
      }
    });
    
    // Process nested includes recursively
    if (Object.keys(subIncludes).length > 0 && relatedRecords.length > 0) {
      const nextPath = `${currentPath}.${includeName}`;
      log.trace('[INCLUDE] Processing nested includes for belongsTo:', { path: nextPath });
      await processIncludes(relatedRecords, targetScope, subIncludes, included, processedPaths, nextPath, fields);
    }
  };
  
  /**
   * Processes hasMany relationships (one-to-many)
   * 
   * @async
   * @private
   * @param {Array} records - The parent records
   * @param {string} scopeName - The parent scope name
   * @param {string} includeName - The relationship name
   * @param {Object} relDef - The relationship definition
   * @param {Object} subIncludes - Nested includes to process recursively
   * @param {Map} included - Map of already included resources (type:id -> resource)
   * @param {Set} processedPaths - Set of already processed paths to prevent infinite loops
   * @param {string} currentPath - Current include path for tracking
   * @returns {Promise<void>}
   */
  const loadHasMany = async (records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields) => {
    log.trace('[INCLUDE] Loading hasMany relationship:', { 
      scopeName, 
      includeName, 
      recordCount: records.length,
      hasThrough: !!relDef.through 
    });
    
    // Collect all parent IDs
    const mainIds = records.map(r => r.id).filter(Boolean);
    
    if (mainIds.length === 0) {
      log.trace('[INCLUDE] No parent IDs found, skipping hasMany load');
      return;
    }
    
    // Check if this is a many-to-many relationship (has through property)
    if (relDef.through) {
      
      // Handle many-to-many relationship
      const pivotTable = scopes[relDef.through].vars.schemaInfo.tableName 
      const foreignKey = relDef.foreignKey || `${scopeName.slice(0, -1)}_id`;
      const otherKey = relDef.otherKey || `${relDef.hasMany.slice(0, -1)}_id`;
      const targetScope = relDef.hasMany;
      const targetTable = scopes[targetScope].vars.schemaInfo.tableName
      
      log.debug(`[INCLUDE] Loading pivot records from ${pivotTable}:`, { 
        foreignKey,
        whereIn: mainIds 
      });
      
      // Step 1: Query the pivot table
      const pivotRecords = await knex(pivotTable)
        .whereIn(foreignKey, mainIds)
        .orderBy(otherKey);
      
      
      if (pivotRecords.length === 0) {
        // No relationships found, set empty arrays for all records
        records.forEach(record => {
          if (!record._relationships) record._relationships = {};
          record._relationships[includeName] = { data: [] };
        });
        return;
      }
      
      // Step 2: Extract target IDs from pivot records
      const targetIds = [...new Set(pivotRecords.map(p => p[otherKey]).filter(Boolean))];
      
      log.debug(`[INCLUDE] Loading ${targetScope} records:`, { 
        whereIn: targetIds 
      });
      
      // Step 3: Build field selection for sparse fieldsets
      const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
      const fieldsToSelect = fields?.[targetScope] ? 
        await buildFieldSelection(targetScope, fields[targetScope], targetSchema) : 
        '*';
      
      // Step 4: Query the target table
      let query = knex(targetTable).whereIn('id', targetIds);
      if (fieldsToSelect !== '*') {
        query = query.select(fieldsToSelect);
      }
      const targetRecords = await query;
      
      log.trace('[INCLUDE] Loaded target records:', { count: targetRecords.length });
      
      // Step 5: Create lookup map for target records
      const targetById = {};
      targetRecords.forEach(record => {
        targetById[record.id] = record;
        
        // Add to included resources
        const key = `${targetScope}:${record.id}`;
        if (!included.has(key)) {
          included.set(key, { raw: record, scope: targetScope });
          log.trace('[INCLUDE] Added to included:', key);
        }
      });
      
      // Step 6: Group pivot records by parent ID
      const pivotsByParent = {};
      pivotRecords.forEach(pivot => {
        const parentId = pivot[foreignKey];
        if (!pivotsByParent[parentId]) {
          pivotsByParent[parentId] = [];
        }
        // Only add if target record exists
        if (targetById[pivot[otherKey]]) {
          pivotsByParent[parentId].push(pivot[otherKey]);
        }
      });
      
      // Step 7: Add relationship data to parent records
      records.forEach(record => {
        if (!record._relationships) record._relationships = {};
        
        const relatedIds = pivotsByParent[record.id] || [];
        record._relationships[includeName] = {
          data: relatedIds.map(id => ({
            type: targetScope,
            id: String(id)
          }))
        };
        
        log.trace('[INCLUDE] Added many-to-many relationship:', { 
          parentId: record.id, 
          relatedCount: relatedIds.length 
        });
      });
      
      // Step 8: Process nested includes recursively
      if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
        const nextPath = `${currentPath}.${includeName}`;
        log.trace('[INCLUDE] Processing nested includes for many-to-many:', { path: nextPath });
        await processIncludes(targetRecords, targetScope, subIncludes, included, processedPaths, nextPath, fields);
      }
      
      return; // Exit early for many-to-many
    }
    
    // Regular hasMany logic (when no through property)
    const targetScope = relDef.hasMany;
    const targetTable = scopes[targetScope].vars.schemaInfo.tableName
    const foreignKey = relDef.foreignKey || `${scopeName.slice(0, -1)}_id`;
    
    log.trace('[INCLUDE] HasMany details:', { targetScope, targetTable, foreignKey, parentIds: mainIds.length });
    
    // Build field selection for sparse fieldsets
    const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
    const fieldsToSelect = await buildFieldSelection(targetScope, fields?.[targetScope], targetSchema, scopes, scopes[targetScope].vars);
    
    // Single query to load ALL related records
    log.debug(`[INCLUDE] Loading ${targetScope} records for ${scopeName}:`, { whereIn: mainIds, fields: fieldsToSelect });
    let query = knex(targetTable).whereIn(foreignKey, mainIds).orderBy('id'); // Consistent ordering
    if (fieldsToSelect !== '*') {
      query = query.select(fieldsToSelect);
    }
    const relatedRecords = await query;
    
    log.trace('[INCLUDE] Loaded hasMany records:', { count: relatedRecords.length });
    
    // Group related records by foreign key
    const grouped = {};
    relatedRecords.forEach(record => {
      const parentId = record[foreignKey];
      if (!grouped[parentId]) {
        grouped[parentId] = [];
      }
      grouped[parentId].push(record);
      
      // Add to included resources (keep raw record for relationship processing)
      const key = `${targetScope}:${record.id}`;
      if (!included.has(key)) {
        included.set(key, { raw: record, scope: targetScope });
        log.trace('[INCLUDE] Added to included:', key);
      }
    });
    
    // Add relationship data to parent records
    records.forEach(record => {
      if (!record._relationships) record._relationships = {};
      
      const relatedItems = grouped[record.id] || [];
      record._relationships[includeName] = {
        data: relatedItems.map(r => ({
          type: targetScope,
          id: String(r.id)
        }))
      };
      
      log.trace('[INCLUDE] Added hasMany relationship:', { 
        parentId: record.id, 
        relatedCount: relatedItems.length 
      });
    });
    
    // Process nested includes recursively
    if (Object.keys(subIncludes).length > 0 && relatedRecords.length > 0) {
      const nextPath = `${currentPath}.${includeName}`;
      log.trace('[INCLUDE] Processing nested includes for hasMany:', { path: nextPath });
      await processIncludes(relatedRecords, targetScope, subIncludes, included, processedPaths, nextPath, fields);
    }
  };
  
  /**
   * Loads polymorphic belongsTo relationships
   * 
   * @async
   * @private
   * @param {Array} records - The parent records containing polymorphic fields
   * @param {string} relName - The relationship name
   * @param {Object} relDef - The relationship definition with belongsToPolymorphic
   * @param {Object} subIncludes - Nested includes to process recursively
   * @param {Map} included - Map of already included resources
   * @param {Set} processedPaths - Set of already processed paths
   * @param {string} currentPath - Current include path for tracking
   * @param {Object} fields - Sparse fieldsets configuration
   * @returns {Promise<void>}
   */
  const loadPolymorphicBelongsTo = async (
    records, 
    relName,
    relDef,
    subIncludes,
    included,
    processedPaths,
    currentPath,
    fields
  ) => {
    log.trace('[INCLUDE] Loading polymorphic belongsTo:', { 
      relName, 
      recordCount: records.length 
    });
    
    const { typeField, idField, types } = relDef.belongsToPolymorphic;
    
    // Group records by their target type using helper
    const grouped = groupByPolymorphicType(
      records, 
      typeField, 
      idField
    );
    
    log.trace('[INCLUDE] Grouped by type:', { 
      types: Object.keys(grouped),
      counts: Object.entries(grouped).map(([t, ids]) => `${t}: ${ids.length}`)
    });
    
    // Load each type separately
    for (const [targetType, targetIds] of Object.entries(grouped)) {
      // Skip if type not allowed (shouldn't happen with validation, but be safe)
      if (!types.includes(targetType)) {
        log.warn('[INCLUDE] Skipping non-allowed type:', targetType);
        continue;
      }
      
      if (targetIds.length === 0) continue;
      
      // Get target table information
      const targetSchema = scopes[targetType].vars.schemaInfo.schema;
      const targetTable = targetSchema?.tableName || targetType;
      
      // Build field selection for sparse fieldsets
      const fieldsToSelect = fields?.[targetType] ? 
        await buildFieldSelection(targetType, fields[targetType], targetSchema) : 
        '*';
      
      log.debug(`[INCLUDE] Loading ${targetType} records:`, { 
        ids: targetIds,
        fields: fieldsToSelect 
      });
      
      // Query for this type
      let query = knex(targetTable).whereIn('id', targetIds);
      if (fieldsToSelect !== '*') {
        query = query.select(fieldsToSelect);
      }
      
      const targetRecords = await query;
      log.trace('[INCLUDE] Loaded records:', { 
        type: targetType, 
        count: targetRecords.length 
      });
      
      // Build lookup map
      const targetById = {};
      targetRecords.forEach(record => {
        targetById[record.id] = record;
        
        // Add to included resources
        const key = `${targetType}:${record.id}`;
        if (!included.has(key)) {
          included.set(key, { raw: record, scope: targetType });
          log.trace('[INCLUDE] Added to included:', key);
        }
      });
      
      // Add relationships to source records
      records.forEach(record => {
        const recordType = record[typeField];
        const recordId = record[idField];
        
        if (recordType === targetType && recordId) {
          if (!record._relationships) record._relationships = {};
          
          if (targetById[recordId]) {
            record._relationships[relName] = {
              data: { type: targetType, id: String(recordId) }
            };
          } else {
            // Target not found - orphaned reference
            log.warn('[INCLUDE] Polymorphic target not found:', { 
              type: targetType, 
              id: recordId 
            });
            record._relationships[relName] = { data: null };
          }
        }
      });
      
      // Process nested includes for this type
      if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
        const nextPath = `${currentPath}.${relName}[${targetType}]`;
        log.trace('[INCLUDE] Processing nested includes:', { 
          path: nextPath,
          includes: Object.keys(subIncludes) 
        });
        
        await processIncludes(
          targetRecords, 
          targetType, 
          subIncludes, 
          included, 
          processedPaths, 
          nextPath, 
          fields
        );
      }
    }
    
    // Ensure all records have the relationship set (null if not found)
    records.forEach(record => {
      if (!record._relationships?.[relName]) {
        if (!record._relationships) record._relationships = {};
        record._relationships[relName] = { data: null };
      }
    });
  };

  /**
   * Loads reverse polymorphic relationships (hasMany via polymorphic field)
   * 
   * @async
   * @private
   * @param {Array} records - The parent records
   * @param {string} scopeName - The scope name of parent records
   * @param {string} relName - The relationship name
   * @param {Object} relDef - The relationship definition with hasMany and via
   * @param {Object} subIncludes - Nested includes to process recursively
   * @param {Map} included - Map of already included resources
   * @param {Set} processedPaths - Set of already processed paths
   * @param {string} currentPath - Current include path for tracking
   * @param {Object} fields - Sparse fieldsets configuration
   * @returns {Promise<void>}
   */
  const loadReversePolymorphic = async (
    records,
    scopeName,
    relName,
    relDef,
    subIncludes,
    included,
    processedPaths,
    currentPath,
    fields
  ) => {
    log.trace('[INCLUDE] Loading reverse polymorphic:', { 
      scopeName, 
      relName, 
      via: relDef.via 
    });
    
    const mainIds = records.map(r => r.id).filter(Boolean);
    if (mainIds.length === 0) return;
    
    const targetScope = relDef.hasMany;
    const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
    const targetTable = targetSchema?.tableName || targetScope;
    const polymorphicField = relDef.via;
    
    // Build the type and id field names
    const typeField = `${polymorphicField}_type`;
    const idField = `${polymorphicField}_id`;
    
    // Verify these fields exist in target schema
    if (!targetSchema[typeField] || !targetSchema[idField]) {
      throw new Error(
        `Polymorphic fields '${typeField}' and '${idField}' not found in '${targetScope}' schema`
      );
    }
    
    // Build field selection
    const fieldsToSelect = await buildFieldSelection(targetScope, fields?.[targetScope], targetSchema, scopes, scopes[targetScope].vars);
    
    log.debug(`[INCLUDE] Loading reverse polymorphic ${targetScope}:`, {
      whereType: scopeName,
      whereIds: mainIds
    });
    
    // Query with type constraint
    let query = knex(targetTable)
      .where(typeField, scopeName)
      .whereIn(idField, mainIds)
      .orderBy('id');
      
    if (fieldsToSelect !== '*') {
      query = query.select(fieldsToSelect);
    }
    
    const relatedRecords = await query;
    log.trace('[INCLUDE] Loaded reverse polymorphic:', { 
      count: relatedRecords.length 
    });
    
    // Group by the polymorphic ID
    const grouped = {};
    relatedRecords.forEach(record => {
      const parentId = record[idField];
      if (!grouped[parentId]) {
        grouped[parentId] = [];
      }
      grouped[parentId].push(record);
      
      // Add to included
      const key = `${targetScope}:${record.id}`;
      if (!included.has(key)) {
        included.set(key, { raw: record, scope: targetScope });
      }
    });
    
    // Add relationships to parent records
    records.forEach(record => {
      if (!record._relationships) record._relationships = {};
      
      const relatedItems = grouped[record.id] || [];
      record._relationships[relName] = {
        data: relatedItems.map(r => ({
          type: targetScope,
          id: String(r.id)
        }))
      };
      
      log.trace('[INCLUDE] Added reverse relationship:', { 
        parentId: record.id, 
        relatedCount: relatedItems.length 
      });
    });
    
    // Process nested includes
    if (Object.keys(subIncludes).length > 0 && relatedRecords.length > 0) {
      const nextPath = `${currentPath}.${relName}`;
      await processIncludes(
        relatedRecords, 
        targetScope, 
        subIncludes, 
        included, 
        processedPaths, 
        nextPath, 
        fields
      );
    }
  };
  
  /**
   * Recursively processes include tree to load all requested relationships
   * 
   * @async
   * @private
   * @param {Array} records - The records to process relationships for
   * @param {string} scopeName - The scope name of the records
   * @param {Object} includeTree - The include tree structure
   * @param {Map} included - Map of already included resources (type:id -> resource)
   * @param {Set} processedPaths - Set of already processed paths to prevent infinite loops
   * @param {string} currentPath - Current include path for tracking
   * @returns {Promise<void>}
   */
  const processIncludes = async (records, scopeName, includeTree, included, processedPaths, currentPath = '', fields = {}) => {
    debugger
    log.trace('[INCLUDE] Processing includes:', { scopeName, includes: Object.keys(includeTree), currentPath });
    
    // Skip if no records or no includes
    if (!records || records.length === 0 || Object.keys(includeTree).length === 0) {
      log.trace('[INCLUDE] No records or includes to process');
      return;
    }
    
    // Prevent infinite loops
    const pathKey = `${scopeName}:${JSON.stringify(includeTree)}`;
    if (processedPaths.has(pathKey)) {
      log.debug('[INCLUDE] Circular reference detected, skipping:', pathKey);
      return;
    }
    processedPaths.add(pathKey);
    
    // Get scope schema and relationships
    const schemaInfo = scopes[scopeName].vars.schemaInfo;
    const schema = schemaInfo.schema;
    const relationships = schemaInfo.schemaRelationships;
    
    // Process each include
    for (const [includeName, subIncludes] of Object.entries(includeTree)) {
      log.trace('[INCLUDE] Processing include:', { scopeName, includeName });
      
      // First, check if it's a belongsTo relationship in the schema
      let processed = false;
      
      for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
        if (fieldDef.as === includeName && fieldDef.belongsTo && (fieldDef.sideLoadSingle !== false)) {
          log.trace('[INCLUDE] Found belongsTo relationship:', { fieldName, target: fieldDef.belongsTo });
          await loadBelongsTo(records, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields);
          processed = true;
          break;
        }
      }
      
      // If not found in schema, check relationships object for hasMany and polymorphic
      if (!processed && relationships?.[includeName]) {
        const rel = relationships[includeName];
        
        // Check for polymorphic belongsTo
        if (rel.belongsToPolymorphic && (rel.sideLoadSingle !== false)) {
          log.trace('[INCLUDE] Found polymorphic belongsTo:', { 
            includeName, 
            types: rel.belongsToPolymorphic.types 
          });
          
          await loadPolymorphicBelongsTo(
            records, 
            includeName, 
            rel, 
            subIncludes, 
            included, 
            processedPaths, 
            currentPath, 
            fields
          );
          processed = true;
        }
        
        // Check for reverse polymorphic (hasMany with via)
        else if (rel.hasMany && rel.via && (rel.sideLoadMany === true)) {
          log.trace('[INCLUDE] Found reverse polymorphic:', { 
            includeName, 
            via: rel.via 
          });
          
          await loadReversePolymorphic(
            records, 
            scopeName, 
            includeName, 
            rel, 
            subIncludes, 
            included, 
            processedPaths, 
            currentPath, 
            fields
          );
          processed = true;
        }
        
        // Check for regular hasMany
        else if (rel.hasMany && (rel.sideLoadMany === true)) {
          log.trace('[INCLUDE] Found hasMany relationship:', { includeName, target: rel.hasMany });
          await loadHasMany(records, scopeName, includeName, rel, subIncludes, included, processedPaths, currentPath, fields);
          processed = true;
        }
      }
      
      if (!processed) {
        log.warn('[INCLUDE] Relationship not found or not configured for sideLoadSingle/sideLoadMany:', { scopeName, includeName });
      }
    }
  };
  
  /**
   * Main entry point for building included resources
   * 
   * @async
   * @param {Array} records - The main query results
   * @param {string} scopeName - The scope name of the main resources
   * @param {string} includeString - The include parameter value (e.g., "author,comments.author")
   * @returns {Promise<Object>} Object with included array and records with relationships
   * 
   * @example
   * const result = await buildIncludedResources(
   *   articleRecords,
   *   'articles',
   *   'author,comments.author'
   * );
   * 
   * // result.included = [
   * //   { type: 'people', id: '1', attributes: {...} },
   * //   { type: 'comments', id: '1', attributes: {...} },
   * //   ...
   * // ]
   * 
   * // result.recordsWithRelationships = original records with _relationships added
   */
  const buildIncludedResources = async (records, scopeName, includeParam, fields) => {
    log.trace('[INCLUDE] Building included resources:', { scopeName, includeParam, recordCount: records.length });
    
    // Check if includes are empty or records are empty
    if (!includeParam || records.length === 0) {
      log.trace('[INCLUDE] No includes requested or no records');
      return {
        included: [],
        recordsWithRelationships: records
      };
    }
    
    // Handle both string and array formats
    if (Array.isArray(includeParam) && includeParam.length === 0) {
      log.trace('[INCLUDE] Empty include array, no relationships to load');
      return {
        included: [],
        recordsWithRelationships: records
      };
    }
    
    const includeTree = parseIncludeTree(includeParam);
    const included = new Map(); // type:id -> resource
    const processedPaths = new Set(); // Prevent infinite loops
    
    // Process all includes recursively
    await processIncludes(records, scopeName, includeTree, included, processedPaths, '', fields);
    
    // Convert Map to array of JSON:API resources
    const includedArray = [];
    for (const entry of included.values()) {
      const { raw, scope } = entry;
      // Extract relationships that were added during processing
      const { _relationships, ...cleanRecord } = raw;
      // Get schema for foreign key filtering
      const targetSchema = scopes[scope].vars.schemaInfo.schema;
      const jsonApiRecord = toJsonApi(scope, cleanRecord, targetSchema);
      
      // Add relationships if any were loaded
      if (_relationships) {
        jsonApiRecord.relationships = _relationships;
      }
      
      includedArray.push(jsonApiRecord);
    }
    
    log.debug('[INCLUDE] Completed building included resources:', { 
      includedCount: includedArray.length,
      uniqueTypes: [...new Set(includedArray.map(r => r.type))]
    });
    
    return {
      included: includedArray,
      recordsWithRelationships: records
    };
  };
  
  // Return all helper functions
  return {
    parseIncludeTree,
    processIncludes,
    buildIncludedResources
  };
};