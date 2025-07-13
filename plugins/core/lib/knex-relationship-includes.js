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
import { toJsonApi } from './knex-json-api-helpers.js';
import { buildWindowedIncludeQuery, applyStandardIncludeConfig, buildOrderByClause } from './knex-window-queries.js';

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
 * const records = [
 *   { id: 1, commentable_type: 'articles', commentable_id: 10 },
 *   { id: 2, commentable_type: 'videos', commentable_id: 20 },
 *   { id: 3, commentable_type: 'articles', commentable_id: 11 }
 * ];
 * 
 * const grouped = groupByPolymorphicType(records, 'commentable_type', 'commentable_id');
 * // Returns: { articles: [10, 11], videos: [20] }
 * 
 * @example <caption>Handles null values</caption>
 * const records = [
 *   { id: 1, item_type: 'products', item_id: 1 },
 *   { id: 2, item_type: null, item_id: null },
 *   { id: 3, item_type: 'products', item_id: 2 }
 * ];
 * 
 * const grouped = groupByPolymorphicType(records, 'item_type', 'item_id');
 * // Returns: { products: [1, 2] }
 * // Null values are filtered out
 */
export const groupByPolymorphicType = (records, typeField, idField) => {
  const grouped = {};
  
  records.forEach(record => {
    const type = record[typeField];
    const id = record[idField];
    
    // Skip if either type or id is missing
    if (!type || !id) return;
    
    if (!grouped[type]) {
      grouped[type] = [];
    }
    
    // Only add unique IDs
    if (!grouped[type].includes(id)) {
      grouped[type].push(id);
    }
  });
  
  return grouped;
};

/**
 * Parses the include parameter string into a tree structure
 * 
 * Converts comma-separated include strings with dot notation into a nested
 * object structure that makes it easier to process relationships hierarchically.
 * 
 * @param {string} includeParam - The include parameter value (e.g., "author,comments.author,comments.article")
 * @returns {Object} Nested object representing the include tree
 * 
 * @example <caption>Simple includes</caption>
 * parseIncludeTree('author,comments')
 * // Returns: { author: {}, comments: {} }
 * 
 * @example <caption>Nested includes</caption>
 * parseIncludeTree('comments.author,comments.article')
 * // Returns: { comments: { author: {}, article: {} } }
 * 
 * @example <caption>Mixed levels</caption>
 * parseIncludeTree('author,comments.author,publisher.country')
 * // Returns: {
 * //   author: {},
 * //   comments: { author: {} },
 * //   publisher: { country: {} }
 * // }
 */
export const parseIncludeTree = (includeParam) => {
  if (!includeParam) return {};
  
  // Handle array input (already split)
  const includes = Array.isArray(includeParam) 
    ? includeParam 
    : includeParam.split(',').map(s => s.trim()).filter(Boolean);
  
  const tree = {};
  
  includes.forEach(include => {
    const parts = include.split('.');
    let current = tree;
    
    parts.forEach(part => {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    });
  });
  
  return tree;
};

/**
 * Loads relationship metadata for included resources
 * This ensures included resources have complete JSON:API representation
 * 
 * @param {Object} scopes - The hooked-api scopes object
 * @param {Array<Object>} records - Records to add relationships to
 * @param {string} scopeName - The scope/resource type name
 */
const loadRelationshipMetadata = async (scopes, records, scopeName) => {
  // Get schema information
  const schemaInfo = scopes[scopeName]?.vars?.schemaInfo;
  if (!schemaInfo) return;

  const schema = schemaInfo.schema.structure || schemaInfo.schema;
  const relationships = schemaInfo.schemaRelationships || {};

  // Process each record
  records.forEach(record => {
    record._relationshipMetadata = {};

    // Process belongsTo relationships from schema
    for (const [fieldName, fieldDef] of Object.entries(schema)) {
      if (fieldDef.belongsTo && fieldDef.as) {
        const foreignKeyValue = record[fieldName];
        if (foreignKeyValue != null) {
          record._relationshipMetadata[fieldDef.as] = {
            data: {
              type: fieldDef.belongsTo,
              id: String(foreignKeyValue)
            }
          };
        } else {
          record._relationshipMetadata[fieldDef.as] = { data: null };
        }
      }
    }

    // TODO: Handle hasMany relationships if needed
    // This would require queries to get counts or related IDs
  });
};

/**
 * Loads belongsTo relationships (many-to-one)
 * 
 * This function loads the "parent" side of a relationship. For example, if comments
 * belong to articles, this loads the articles for a set of comments.
 * 
 * @param {Object} scopes - The hooked-api scopes object
 * @param {Object} log - Logger instance
 * @param {Object} knex - Knex instance
 * @param {Array<Object>} records - Records to load relationships for
 * @param {string} fieldName - The foreign key field name (e.g., 'author_id')
 * @param {Object} fieldDef - The field definition from the schema
 * @param {string} includeName - The relationship name (e.g., 'author')
 * @param {Object} subIncludes - Nested includes to process recursively
 * @param {Map} included - Map of already included resources
 * @param {Set} processedPaths - Set of already processed paths
 * @param {string} currentPath - Current include path for tracking
 * @param {Object} fields - Sparse fieldsets configuration
 * @returns {Promise<void>}
 */
export const loadBelongsTo = async (scopes, log, knex, records, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields, idProperty) => {
  log.trace('[INCLUDE] Loading belongsTo:', { 
    fieldName, 
    includeName, 
    recordCount: records.length 
  });
  
  // Get the target scope name
  const targetScope = fieldDef.belongsTo;
  if (!scopes[targetScope]) {
    log.warn('[INCLUDE] Target scope not found:', targetScope);
    return;
  }
  
  // Collect all foreign key values
  const foreignKeyValues = records
    .map(r => r[fieldName])
    .filter(val => val != null); // Filter out null/undefined
  
  const uniqueIds = [...new Set(foreignKeyValues)];
  
  log.debug('[INCLUDE] Loading belongsTo records:', { 
    targetScope, 
    uniqueIds 
  });
  
  if (uniqueIds.length === 0) {
    // No relationships to load, set all to null
    records.forEach(record => {
      if (!record._relationships) record._relationships = {};
      record._relationships[includeName] = { data: null };
    });
    return;
  }
  
  // Get target table info
  const targetTableName = scopes[targetScope].vars.schemaInfo.tableName
  const targetIdProperty = scopes[targetScope].vars.schemaInfo.idProperty 
  const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
  
  // Build field selection for sparse fieldsets
  const fieldSelectionInfo = fields?.[targetScope] ? 
    await buildFieldSelection(targetScope, fields[targetScope], targetSchema, scopes, targetIdProperty) : 
    null;
  
  // Load the target records
  let query = knex(targetTableName).whereIn(targetIdProperty, uniqueIds);
  if (fieldSelectionInfo) {
    query = query.select(fieldSelectionInfo.fieldsToSelect);
  }
  const targetRecords = await query;
  
  // Load relationship metadata for all target records
  await loadRelationshipMetadata(scopes, targetRecords, targetScope);
  
  // Create lookup map
  const targetById = {};
  targetRecords.forEach(record => {
    targetById[record[targetIdProperty]] = record;
  });
  
  // Set relationships on original records
  const targetRecordsToProcess = [];
  
  records.forEach(record => {
    if (!record._relationships) record._relationships = {};
    
    const targetId = record[fieldName];
    const targetRecord = targetById[targetId];
    
    if (targetRecord) {
      // Convert to JSON:API format
      const jsonApiRecord = toJsonApi(targetScope, targetRecord, targetSchema, targetIdProperty);

      // Add relationships from metadata
      if (targetRecord._relationshipMetadata) {
        jsonApiRecord.relationships = targetRecord._relationshipMetadata;
        // Clean up the temporary property
        delete targetRecord._relationshipMetadata;
      }

      record._relationships[includeName] = { data: { type: targetScope, id: String(targetId) } };
      
      // Add to included if not already there
      const resourceKey = `${targetScope}:${targetId}`;
      if (!included.has(resourceKey)) {
        included.set(resourceKey, jsonApiRecord); // Now includes relationships!
        
        // Collect for nested processing
        if (Object.keys(subIncludes).length > 0) {
          targetRecordsToProcess.push(targetRecord);
        }
      }
    } else {
      record._relationships[includeName] = { data: null };
    }
  });
  
  // Process nested includes if any
  if (targetRecordsToProcess.length > 0) {
    const nextPath = `${currentPath}.${includeName}`;
    if (!processedPaths.has(nextPath)) {
      await processIncludes(scopes, log, knex, targetRecordsToProcess, targetScope, subIncludes, included, processedPaths, nextPath, fields);
    }
  }
};

/**
 * Loads hasMany relationships (one-to-many or many-to-many)
 * 
 * This function loads the "child" side of a relationship. For example, if articles
 * have many comments, this loads all comments for a set of articles. It also handles
 * many-to-many relationships through a pivot table.
 * 
 * @param {Object} scopes - The hooked-api scopes object
 * @param {Object} log - Logger instance
 * @param {Object} knex - Knex instance
 * @param {Array<Object>} records - Parent records to load relationships for
 * @param {string} scopeName - The parent scope name
 * @param {string} includeName - The relationship name to include
 * @param {Object} relDef - The relationship definition
 * @param {Object} subIncludes - Nested includes to process recursively
 * @param {Map} included - Map of already included resources
 * @param {Set} processedPaths - Set of already processed paths
 * @param {string} currentPath - Current include path for tracking
 * @param {Object} fields - Sparse fieldsets configuration
 * @returns {Promise<void>}
 */
export const loadHasMany = async (scopes, log, knex, records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields) => {
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
  
  // Get database capabilities from API
  const capabilities = knex.capabilities || { windowFunctions: false };
  
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
      whereIn: targetIds,
      includeConfig: relDef.include
    });
    
    // Step 3: Build field selection for sparse fieldsets
    const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
    const targetIdProperty = scopes[targetScope].vars.schemaInfo.idProperty;
    const fieldSelectionInfo = fields?.[targetScope] ? 
      await buildFieldSelection(targetScope, fields[targetScope], targetSchema, scopes, targetIdProperty) : 
      null;
    
    // Step 4: For many-to-many with limits, we need a different approach
    let targetRecords;

    if (relDef.include?.limit && relDef.include?.strategy === 'window') {
      // For many-to-many with window functions, we need to limit per parent
      // This requires joining back through the pivot table
      
      const windowQuery = knex
        .select(`${targetTable}.*`)
        .select(
          knex.raw(
            'ROW_NUMBER() OVER (PARTITION BY pivot.?? ORDER BY ' + 
            buildOrderByClause(relDef.include.orderBy || ['id']) + 
            ') as _rn',
            [foreignKey]
          )
        )
        .from(targetTable)
        .join(`${pivotTable} as pivot`, `${targetTable}.id`, 'pivot.' + otherKey)
        .whereIn(`pivot.${foreignKey}`, mainIds);
      
      // Wrap to filter by row number
      const limitedQuery = knex
        .select('*')
        .from(windowQuery.as('_windowed'))
        .where('_rn', '<=', relDef.include.limit);
      
      targetRecords = await limitedQuery;
      
      // Remove _rn column and restore proper pivot grouping
      targetRecords.forEach(record => delete record._rn);
      
    } else {
      // Standard query without per-parent limits
      let query = knex(targetTable).whereIn('id', targetIds);
      
      if (fieldSelectionInfo) {
        query = query.select(fieldSelectionInfo.fieldsToSelect);
      }
      
      // Apply standard include config (global limits)
      if (relDef.include) {
        const targetVars = scopes[targetScope].vars;
        query = applyStandardIncludeConfig(query, relDef.include, targetVars, log);
      }
      
      targetRecords = await query;
    }
    
    log.trace('[INCLUDE] Loaded target records:', { count: targetRecords.length });
    
    // Step 5: Load relationship metadata for all target records
    await loadRelationshipMetadata(scopes, targetRecords, targetScope);
    
    // Step 6: Create lookup map for target records
    const targetById = {};
    targetRecords.forEach(record => {
      targetById[record.id] = record;
    });
    
    // Step 7: Group pivot records by parent ID
    const pivotsByParent = {};
    pivotRecords.forEach(pivot => {
      const parentId = pivot[foreignKey];
      if (!pivotsByParent[parentId]) {
        pivotsByParent[parentId] = [];
      }
      pivotsByParent[parentId].push(pivot[otherKey]);
    });
    
    // Step 7: Set relationships on parent records
    records.forEach(record => {
      if (!record._relationships) record._relationships = {};
      
      const childIds = pivotsByParent[record.id] || [];
      const relData = childIds
        .map(childId => targetById[childId])
        .filter(Boolean)
        .map(childRecord => {
          // Add to included
          const resourceKey = `${targetScope}:${childRecord.id}`;
          if (!included.has(resourceKey)) {
            const jsonApiRecord = toJsonApi(targetScope, childRecord, targetSchema);
            
            // Add relationships from metadata
            if (childRecord._relationshipMetadata) {
              jsonApiRecord.relationships = childRecord._relationshipMetadata;
              // Clean up the temporary property
              delete childRecord._relationshipMetadata;
            }
            
            included.set(resourceKey, jsonApiRecord);
          }
          return { type: targetScope, id: String(childRecord.id) };
        });
      
      record._relationships[includeName] = { data: relData };
    });
    
    // Step 8: Process nested includes if any
    if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
      const nextPath = `${currentPath}.${includeName}`;
      if (!processedPaths.has(nextPath)) {
        await processIncludes(scopes, log, knex, targetRecords, targetScope, subIncludes, included, processedPaths, nextPath, fields);
      }
    }
    
  } else {
    // Handle regular one-to-many relationship
    const targetScope = relDef.hasMany;
    const targetTable = scopes[targetScope].vars.schemaInfo.tableName;
    const foreignKey = relDef.foreignKey || `${scopeName.slice(0, -1)}_id`;
    
    log.debug(`[INCLUDE] Loading ${targetScope} records with foreign key ${foreignKey}:`, { 
      whereIn: mainIds,
      includeConfig: relDef.include
    });
    
    // Build field selection for sparse fieldsets
    const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
    const targetIdProperty = scopes[targetScope].vars.schemaInfo.idProperty;
    const fieldSelectionInfo = fields?.[targetScope] ? 
      await buildFieldSelection(targetScope, fields[targetScope], targetSchema, scopes, targetIdProperty) : 
      null;
    
    let query;
    let usingWindowFunction = false;
    
    // Check if we should use window functions
    if (relDef.include?.strategy === 'window' && relDef.include?.limit) {
      try {
        // Try to build window function query
        query = buildWindowedIncludeQuery(
          knex,
          targetTable,
          foreignKey,
          mainIds,
          fieldSelectionInfo ? fieldSelectionInfo.fieldsToSelect : null,
          relDef.include,
          capabilities
        );
        usingWindowFunction = true;
        log.debug('[INCLUDE] Using window function strategy for per-parent limits');
      } catch (error) {
        // If window functions not supported, this will throw a clear error
        if (error.details?.requiredFeature === 'window_functions') {
          throw error; // Re-throw the descriptive error
        }
        // For other errors, fall back to standard query
        log.warn('[INCLUDE] Window function query failed, falling back to standard query:', error);
        usingWindowFunction = false;
      }
    }
    
    // Build standard query if not using window functions
    if (!usingWindowFunction) {
      query = knex(targetTable).whereIn(foreignKey, mainIds);
      
      if (fieldSelectionInfo) {
        query = query.select(fieldSelectionInfo.fieldsToSelect);
      }
      
      // Apply include configuration without window functions
      if (relDef.include) {
        const targetVars = scopes[targetScope].vars;
        query = applyStandardIncludeConfig(query, relDef.include, targetVars, log);
      }
    }
    
    // Execute query
    const targetRecords = await query;
    
    // If using window functions, remove the _rn column
    if (usingWindowFunction) {
      targetRecords.forEach(record => delete record._rn);
    }
    
    log.trace('[INCLUDE] Loaded hasMany records:', { 
      count: targetRecords.length,
      usingWindowFunction 
    });
    
    // Load relationship metadata for all target records
    await loadRelationshipMetadata(scopes, targetRecords, targetScope);
    
    // Group by parent ID
    const childrenByParent = {};
    targetRecords.forEach(record => {
      const parentId = record[foreignKey];
      if (!childrenByParent[parentId]) {
        childrenByParent[parentId] = [];
      }
      childrenByParent[parentId].push(record);
    });
    
    // Set relationships on parent records
    records.forEach(record => {
      if (!record._relationships) record._relationships = {};
      
      const children = childrenByParent[record.id] || [];
      const relData = children.map(childRecord => {
        // Add to included
        const resourceKey = `${targetScope}:${childRecord.id}`;
        if (!included.has(resourceKey)) {
          const jsonApiRecord = toJsonApi(targetScope, childRecord, targetSchema);
          
          // Add relationships from metadata
          if (childRecord._relationshipMetadata) {
            jsonApiRecord.relationships = childRecord._relationshipMetadata;
            // Clean up the temporary property
            delete childRecord._relationshipMetadata;
          }
          
          included.set(resourceKey, jsonApiRecord);
        }
        return { type: targetScope, id: String(childRecord.id) };
      });
      
      record._relationships[includeName] = { data: relData };
    });
    
    // Process nested includes
    if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
      const nextPath = `${currentPath}.${includeName}`;
      if (!processedPaths.has(nextPath)) {
        await processIncludes(scopes, log, knex, targetRecords, targetScope, subIncludes, included, processedPaths, nextPath, fields);
      }
    }
  }
};

/**
 * Loads polymorphic belongsTo relationships
 * 
 * Handles relationships where a record can belong to different types of parent records.
 * For example, comments that can belong to either articles or videos.
 * 
 * @param {Object} scopes - The hooked-api scopes object
 * @param {Object} log - Logger instance
 * @param {Object} knex - Knex instance
 * @param {Array<Object>} records - Records with polymorphic relationships
 * @param {string} relName - The relationship name
 * @param {Object} relDef - The relationship definition with belongsToPolymorphic
 * @param {Object} subIncludes - Nested includes to process recursively
 * @param {Map} included - Map of already included resources
 * @param {Set} processedPaths - Set of already processed paths
 * @param {string} currentPath - Current include path for tracking
 * @param {Object} fields - Sparse fieldsets configuration
 * @returns {Promise<void>}
 */
export const loadPolymorphicBelongsTo = async (
  scopes,
  log,
  knex,
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
    const targetIdProperty = scopes[targetType].vars.schemaInfo.idProperty;
    const fieldSelectionInfo = fields?.[targetType] ? 
      await buildFieldSelection(targetType, fields[targetType], targetSchema, scopes, targetIdProperty) : 
      null;
    
    log.debug(`[INCLUDE] Loading ${targetType} records:`, { 
      ids: targetIds,
      fields: fieldSelectionInfo ? fieldSelectionInfo.fieldsToSelect : '*' 
    });
    
    // Query for this type
    let query = knex(targetTable).whereIn('id', targetIds);
    if (fieldSelectionInfo) {
      query = query.select(fieldSelectionInfo.fieldsToSelect);
    }
    const targetRecords = await query;
    
    // Load relationship metadata for all target records
    await loadRelationshipMetadata(scopes, targetRecords, targetType);
    
    // Create lookup map
    const targetById = {};
    targetRecords.forEach(record => {
      targetById[record.id] = record;
    });
    
    // Add to included and set relationships
    records.forEach(record => {
      if (record[typeField] === targetType) {
        const targetId = record[idField];
        const targetRecord = targetById[targetId];
        
        if (!record._relationships) record._relationships = {};
        
        if (targetRecord) {
          // Add to included
          const resourceKey = `${targetType}:${targetId}`;
          if (!included.has(resourceKey)) {
            const jsonApiRecord = toJsonApi(targetType, targetRecord, targetSchema);
            
            // Add relationships from metadata
            if (targetRecord._relationshipMetadata) {
              jsonApiRecord.relationships = targetRecord._relationshipMetadata;
              // Clean up the temporary property
              delete targetRecord._relationshipMetadata;
            }
            
            included.set(resourceKey, jsonApiRecord);
          }
          
          record._relationships[relName] = {
            data: { type: targetType, id: String(targetId) }
          };
        } else {
          record._relationships[relName] = { data: null };
        }
      }
    });
    
    // Process nested includes for this type
    if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
      const nextPath = `${currentPath}.${relName}`;
      if (!processedPaths.has(nextPath)) {
        await processIncludes(scopes, log, knex, targetRecords, targetType, subIncludes, included, processedPaths, nextPath, fields);
      }
    }
  }
  
  // Set null for records without relationships
  records.forEach(record => {
    if (!record._relationships) record._relationships = {};
    if (!record._relationships[relName]) {
      record._relationships[relName] = { data: null };
    }
  });
};

/**
 * Loads reverse polymorphic relationships (via)
 * 
 * Handles loading "child" records that have a polymorphic relationship back to the parent.
 * For example, loading all comments (which can belong to articles or videos) for a specific article.
 * 
 * @param {Object} scopes - The hooked-api scopes object
 * @param {Object} log - Logger instance
 * @param {Object} knex - Knex instance
 * @param {Array<Object>} records - Parent records
 * @param {string} scopeName - The parent scope name
 * @param {string} includeName - The relationship name
 * @param {Object} relDef - The relationship definition with 'via' property
 * @param {Object} subIncludes - Nested includes to process recursively
 * @param {Map} included - Map of already included resources
 * @param {Set} processedPaths - Set of already processed paths
 * @param {string} currentPath - Current include path for tracking
 * @param {Object} fields - Sparse fieldsets configuration
 * @returns {Promise<void>}
 */
export const loadReversePolymorphic = async (
  scopes,
  log,
  knex,
  records,
  scopeName,
  includeName,
  relDef,
  subIncludes,
  included,
  processedPaths,
  currentPath,
  fields
) => {
  log.trace('[INCLUDE] Loading reverse polymorphic (via):', { 
    scopeName,
    includeName, 
    via: relDef.via,
    recordCount: records.length 
  });
  
  const targetScope = relDef.hasMany;
  const viaRelName = relDef.via;
  
  // Get the polymorphic field info from target scope
  const targetRelationships = scopes[targetScope].vars.schemaInfo.schemaRelationships;
  const viaRel = targetRelationships?.[viaRelName];
  
  if (!viaRel?.belongsToPolymorphic) {
    log.warn('[INCLUDE] Via relationship not found or not polymorphic:', {
      targetScope,
      viaRelName
    });
    return;
  }
  
  const { typeField, idField } = viaRel.belongsToPolymorphic;
  const targetTable = scopes[targetScope].vars.schemaInfo.tableName;
  
  // Collect parent IDs
  const parentIds = records.map(r => r.id).filter(Boolean);
  if (parentIds.length === 0) return;
  
  log.debug(`[INCLUDE] Loading ${targetScope} records via ${viaRelName}:`, {
    typeField,
    idField,
    scopeName,
    parentIds
  });
  
  // Build field selection for sparse fieldsets
  const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
  const targetIdProperty = scopes[targetScope].vars.schemaInfo.idProperty;
  const fieldSelectionInfo = fields?.[targetScope] ? 
    await buildFieldSelection(targetScope, fields[targetScope], targetSchema, scopes, targetIdProperty) : 
    null;
  
  // Query for records pointing back to our scope
  let query = knex(targetTable)
    .where(typeField, scopeName)
    .whereIn(idField, parentIds);
    
  if (fieldSelectionInfo) {
    query = query.select(fieldSelectionInfo.fieldsToSelect);
  }
  
  const targetRecords = await query;
  
  log.trace('[INCLUDE] Loaded reverse polymorphic records:', { 
    count: targetRecords.length 
  });
  
  // Load relationship metadata for all target records
  await loadRelationshipMetadata(scopes, targetRecords, targetScope);
  
  // Group by parent ID
  const childrenByParent = {};
  targetRecords.forEach(record => {
    const parentId = record[idField];
    if (!childrenByParent[parentId]) {
      childrenByParent[parentId] = [];
    }
    childrenByParent[parentId].push(record);
  });
  
  // Set relationships on parent records
  records.forEach(record => {
    if (!record._relationships) record._relationships = {};
    
    const children = childrenByParent[record.id] || [];
    const relData = children.map(childRecord => {
      // Add to included
      const resourceKey = `${targetScope}:${childRecord.id}`;
      if (!included.has(resourceKey)) {
        const jsonApiRecord = toJsonApi(targetScope, childRecord, targetSchema);
        
        // Add relationships from metadata
        if (childRecord._relationshipMetadata) {
          jsonApiRecord.relationships = childRecord._relationshipMetadata;
          // Clean up the temporary property
          delete childRecord._relationshipMetadata;
        }
        
        included.set(resourceKey, jsonApiRecord);
      }
      return { type: targetScope, id: String(childRecord.id) };
    });
    
    record._relationships[includeName] = { data: relData };
  });
  
  // Process nested includes
  if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
    const nextPath = `${currentPath}.${includeName}`;
    if (!processedPaths.has(nextPath)) {
      await processIncludes(scopes, log, knex, targetRecords, targetScope, subIncludes, included, processedPaths, nextPath, fields);
    }
  }
};

/**
 * Processes includes for a set of records
 * 
 * This is the main recursive function that processes the include tree. It examines
 * the schema to determine relationship types and calls the appropriate loader function.
 * 
 * @param {Object} scopes - The hooked-api scopes object
 * @param {Object} log - Logger instance
 * @param {Object} knex - Knex instance
 * @param {Array<Object>} records - Records to process includes for
 * @param {string} scopeName - The scope name of the records
 * @param {Object} includeTree - Parsed include tree from parseIncludeTree
 * @param {Map} included - Map storing all included resources
 * @param {Set} processedPaths - Set tracking processed paths to prevent cycles
 * @param {string} [currentPath=''] - Current path in the include tree
 * @param {Object} [fields={}] - Sparse fieldsets configuration
 * @returns {Promise<void>}
 */
export const processIncludes = async (scopes, log, knex, records, scopeName, includeTree, included, processedPaths, currentPath = '', fields = {}, idProperty) => {
  log.trace('[INCLUDE] Processing includes:', { 
    scopeName, 
    includes: Object.keys(includeTree),
    recordCount: records.length,
    currentPath
  });
  
  if (records.length === 0) return;
  
  // Get schema info for this scope
  const schemaInfo = scopes[scopeName]?.vars?.schemaInfo;
  if (!schemaInfo) {
    log.warn('[INCLUDE] No schema info for scope:', scopeName);
    return;
  }
  
  const { schema, schemaRelationships } = schemaInfo;
  
  // Process each include
  for (const [includeName, subIncludes] of Object.entries(includeTree)) {
    const fullPath = currentPath ? `${currentPath}.${includeName}` : includeName;
    
    // Skip if already processed (prevents infinite loops)
    if (processedPaths.has(fullPath)) {
      log.trace('[INCLUDE] Skipping already processed path:', fullPath);
      continue;
    }
    processedPaths.add(fullPath);
    
    // Check if it's a schema field (belongsTo)
    let handled = false;
    
    // Look for belongsTo relationships in schema fields
    for (const [fieldName, fieldDef] of Object.entries(schema.structure || {})) {
      if (fieldDef.as === includeName && fieldDef.belongsTo) {
        await loadBelongsTo(scopes, log, knex, records, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields, idProperty);
        handled = true;
        break;
      }
    }
    
    // Check relationships
    if (!handled && schemaRelationships) {
      const relDef = schemaRelationships[includeName];
      
      if (relDef) {
        if (relDef.hasMany) {
          // Check if it's a reverse polymorphic (via)
          if (relDef.via) {
            await loadReversePolymorphic(scopes, log, knex, records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields);
          } else {
            await loadHasMany(scopes, log, knex, records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields);
          }
          handled = true;
        } else if (relDef.belongsToPolymorphic) {
          await loadPolymorphicBelongsTo(scopes, log, knex, records, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields);
          handled = true;
        }
      }
    }
    
    if (!handled) {
      log.warn('[INCLUDE] Unknown relationship:', { 
        scopeName, 
        includeName,
        availableFields: Object.keys(schema.structure || {}).filter(k => schema.structure[k].as),
        availableRelationships: Object.keys(schemaRelationships || {})
      });
    }
  }
};

/**
 * Main entry point for building included resources
 * 
 * Takes a set of records and an include parameter, loads all requested relationships,
 * and returns both the included resources and the records with relationship data attached.
 * 
 * @param {Object} scopes - The hooked-api scopes object
 * @param {Object} log - Logger instance
 * @param {Object} knex - Knex instance
 * @param {Array<Object>} records - The main records to process
 * @param {string} scopeName - The scope name of the main resources
 * @param {string} includeString - The include parameter value (e.g., "author,comments.author")
 * @param {Object} fields - Sparse fieldsets configuration
 * @returns {Promise<Object>} Object with included array and records with relationships
 * 
 * @example
 * const result = await buildIncludedResources(
 *   scopes,
 *   log,
 *   knex,
 *   articleRecords,
 *   'articles',
 *   'author,comments.author',
 *   { articles: 'title,body', people: 'name' }
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
export const buildIncludedResources = async (scopes, log, knex, records, scopeName, includeParam, fields, idProperty) => {
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
  
  // Parse the include parameter
  const includeTree = parseIncludeTree(includeParam);
  
  log.debug('[INCLUDE] Parsed include tree:', includeTree);
  
  // Use a Map to track included resources by type:id
  const included = new Map();
  const processedPaths = new Set(); // Prevent infinite loops
  
  // Process all includes
  await processIncludes(scopes, log, knex, records, scopeName, includeTree, included, processedPaths, '', fields, idProperty);
  
  // Convert Map to array for JSON:API format
  const includedArray = Array.from(included.values());
  
  log.debug('[INCLUDE] Completed building includes:', {
    includedCount: includedArray.length,
    uniqueTypes: [...new Set(includedArray.map(r => r.type))]
  });
  
  return {
    included: includedArray,
    recordsWithRelationships: records
  };
};