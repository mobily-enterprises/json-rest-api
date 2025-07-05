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
 */

/**
 * Creates relationship include helper functions with injected dependencies
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
   * Helper to get table name for a scope
   * @private
   */
  const getTableName = async (scopeName) => {
    const schema = await scopes[scopeName].getSchema();
    return schema?.tableName || scopeName;
  };
  
  /**
   * Helper to convert DB record to JSON:API format
   * @private
   */
  const toJsonApi = (scopeName, record, idProperty = 'id') => {
    if (!record) return null;
    
    const { [idProperty]: id, ...attributes } = record;
    
    return {
      type: scopeName,
      id: String(id),
      attributes
    };
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
  const loadBelongsTo = async (records, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath) => {
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
    const targetTable = await getTableName(targetScope);
    
    // Single query to load all related records
    log.debug(`[INCLUDE] Loading ${targetScope} records:`, { whereIn: foreignKeys });
    const relatedRecords = await knex(targetTable).whereIn('id', foreignKeys);
    
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
      await processIncludes(relatedRecords, targetScope, subIncludes, included, processedPaths, nextPath);
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
  const loadHasMany = async (records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath) => {
    log.trace('[INCLUDE] Loading hasMany relationship:', { scopeName, includeName, recordCount: records.length });
    
    // Collect all parent IDs
    const mainIds = records.map(r => r.id).filter(Boolean);
    
    if (mainIds.length === 0) {
      log.trace('[INCLUDE] No parent IDs found, skipping hasMany load');
      return;
    }
    
    // Get target scope and foreign key information
    const targetScope = relDef.hasMany;
    const targetTable = await getTableName(targetScope);
    const foreignKey = relDef.foreignKey || `${scopeName.slice(0, -1)}_id`;
    
    log.trace('[INCLUDE] HasMany details:', { targetScope, targetTable, foreignKey, parentIds: mainIds.length });
    
    // Single query to load ALL related records
    log.debug(`[INCLUDE] Loading ${targetScope} records for ${scopeName}:`, { whereIn: mainIds });
    const relatedRecords = await knex(targetTable)
      .whereIn(foreignKey, mainIds)
      .orderBy('id'); // Consistent ordering
    
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
      await processIncludes(relatedRecords, targetScope, subIncludes, included, processedPaths, nextPath);
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
  const processIncludes = async (records, scopeName, includeTree, included, processedPaths, currentPath = '') => {
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
    const schema = await scopes[scopeName].getSchema();
    const relationships = await scopes[scopeName].getRelationships();
    
    // Process each include
    for (const [includeName, subIncludes] of Object.entries(includeTree)) {
      log.trace('[INCLUDE] Processing include:', { scopeName, includeName });
      
      // First, check if it's a belongsTo relationship in the schema
      let processed = false;
      
      for (const [fieldName, fieldDef] of Object.entries(schema)) {
        if (fieldDef.as === includeName && fieldDef.belongsTo && fieldDef.sideLoad) {
          log.trace('[INCLUDE] Found belongsTo relationship:', { fieldName, target: fieldDef.belongsTo });
          await loadBelongsTo(records, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath);
          processed = true;
          break;
        }
      }
      
      // If not found in schema, check relationships object for hasMany
      if (!processed && relationships?.[includeName]) {
        const rel = relationships[includeName];
        if (rel.hasMany && rel.sideLoad) {
          log.trace('[INCLUDE] Found hasMany relationship:', { includeName, target: rel.hasMany });
          await loadHasMany(records, scopeName, includeName, rel, subIncludes, included, processedPaths, currentPath);
          processed = true;
        }
      }
      
      if (!processed) {
        log.warn('[INCLUDE] Relationship not found or not configured for sideLoad:', { scopeName, includeName });
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
  const buildIncludedResources = async (records, scopeName, includeParam) => {
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
    await processIncludes(records, scopeName, includeTree, included, processedPaths);
    
    // Convert Map to array of JSON:API resources
    const includedArray = Array.from(included.values()).map(entry => {
      const { raw, scope } = entry;
      // Extract relationships that were added during processing
      const { _relationships, ...cleanRecord } = raw;
      const jsonApiRecord = toJsonApi(scope, cleanRecord);
      
      // Add relationships if any were loaded
      if (_relationships) {
        jsonApiRecord.relationships = _relationships;
      }
      
      return jsonApiRecord;
    });
    
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