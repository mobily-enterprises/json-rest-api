/**
 * Provides utilities for loading related resources according to JSON:API specification
 * 
 * @description
 * This module implements the JSON:API include functionality, enabling compound documents
 * that contain both primary data and related resources. It handles all relationship types
 * and supports arbitrary nesting depths while preventing N+1 query problems.
 * 
 * @example
 * // Input: Simple include request
 * // GET /articles?include=author
 * // Records before:
 * [
 *   { id: 1, title: 'Article 1', author_id: 10 },
 *   { id: 2, title: 'Article 2', author_id: 11 }
 * ]
 * 
 * // Result: 2 queries total (articles + authors)
 * // Records after (with RELATIONSHIPS_KEY):
 * [
 *   { 
 *     id: 1, 
 *     title: 'Article 1', 
 *     author_id: 10,
 *     __$jsonrestapi_rel$__: {
 *       author: { data: { type: 'users', id: '10' } }
 *     }
 *   }
 * ]
 * // Included resources:
 * [
 *   { type: 'users', id: '10', attributes: { name: 'John' } },
 *   { type: 'users', id: '11', attributes: { name: 'Jane' } }
 * ]
 * 
 * @example
 * // Input: Nested includes
 * // GET /articles?include=comments.author
 * // Articles → Comments → Authors (3 queries total)
 * 
 * // Result: Comments loaded with their authors
 * // Included array contains both comments AND their authors
 * // No duplicate authors even if multiple comments by same person
 * 
 * @example  
 * // Input: Polymorphic includes
 * // GET /activities?include=trackable
 * // Where trackable can be 'posts', 'photos', or 'videos'
 * 
 * // Groups by type and loads each type separately:
 * // Query 1: SELECT * FROM posts WHERE id IN (1, 3, 5)
 * // Query 2: SELECT * FROM photos WHERE id IN (2, 4)
 * // Query 3: SELECT * FROM videos WHERE id IN (6)
 * 
 * Used by:
 * - rest-api-knex-plugin calls buildIncludedResources in dataGet and dataQuery
 * - Called after primary records are fetched but before response assembly
 * - Results go into the 'included' section of JSON:API response
 * 
 * Purpose:
 * - Implements JSON:API compound documents with primary data and included resources
 * - Prevents N+1 queries through batch loading (1 query per resource type)
 * - Supports deep nesting like article.author.company.country.continent
 * - Deduplicates resources automatically (each resource appears once)
 * - Handles circular references through processedPaths tracking
 * - Applies sparse fieldsets to reduce payload size
 * 
 * Data flow:
 * 1. Parse include parameter into tree structure (author,comments.author)
 * 2. For each relationship, determine type (belongsTo, hasMany, polymorphic)
 * 3. Batch load all related records of same type in single query
 * 4. Recursively process nested includes
 * 5. Store all included resources in deduplication Map
 * 6. Return array of unique included resources
 */

import { buildFieldSelection } from '../querying-writing/knex-field-helpers.js';
import { getForeignKeyFields } from '../querying-writing/field-utils.js';
import { toJsonApiRecord } from './knex-json-api-transformers-querying.js';
import { buildWindowedIncludeQuery, applyStandardIncludeConfig, buildOrderByClause } from './knex-window-queries.js';
import { RELATIONSHIPS_KEY, RELATIONSHIP_METADATA_KEY, ROW_NUMBER_KEY, COMPUTED_DEPENDENCIES_KEY, DEFAULT_QUERY_LIMIT } from '../querying-writing/knex-constants.js';
import { RestApiResourceError } from '../../../../lib/rest-api-errors.js';

/**
 * Groups records by their polymorphic type for efficient batch loading
 * 
 * @param {Array<Object>} records - Records containing polymorphic fields
 * @param {string} typeField - Name of the type field (e.g., 'commentable_type')
 * @param {string} idField - Name of the ID field (e.g., 'commentable_id')
 * @returns {Object<string, Array<number|string>>} Map of type to array of unique IDs
 * 
 * @example
 * // Input: Comments with polymorphic commentable relationship
 * const records = [
 *   { id: 1, commentable_type: 'articles', commentable_id: 10 },
 *   { id: 2, commentable_type: 'videos', commentable_id: 20 },
 *   { id: 3, commentable_type: 'articles', commentable_id: 11 },
 *   { id: 4, commentable_type: 'articles', commentable_id: 10 }  // Duplicate
 * ];
 * 
 * const grouped = groupByPolymorphicType(records, 'commentable_type', 'commentable_id');
 * 
 * // Output: IDs grouped by type, duplicates removed
 * // {
 * //   articles: [10, 11],  // Only unique IDs
 * //   videos: [20]
 * // }
 * 
 * @example
 * // Input: Some records have null relationships
 * const records = [
 *   { id: 1, item_type: 'products', item_id: 1 },
 *   { id: 2, item_type: null, item_id: null },      // Ignored
 *   { id: 3, item_type: 'products', item_id: null }, // Ignored
 *   { id: 4, item_type: 'categories', item_id: 5 }
 * ];
 * 
 * const grouped = groupByPolymorphicType(records, 'item_type', 'item_id');
 * 
 * // Output: Only records with both type AND id
 * // {
 * //   products: [1],
 * //   categories: [5]
 * // }
 * 
 * @description
 * Used by:
 * - loadPolymorphicBelongsTo uses this to group records before batch loading
 * - Enables efficient loading with one query per type instead of per record
 * 
 * Purpose:
 * - Minimizes database queries when loading polymorphic relationships
 * - Instead of N queries (one per record), makes T queries (one per type)
 * - Automatically deduplicates IDs within each type
 * - Safely handles null/undefined values by filtering them out
 * 
 * Data flow:
 * 1. Receives array of records with polymorphic fields
 * 2. Groups records by their type field value
 * 3. Collects unique IDs for each type
 * 4. Returns map used for batch WHERE IN queries
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
 * @param {string|Array<string>} includeParam - The include parameter value
 * @returns {Object} Nested object representing the include tree
 * 
 * @example
 * // Input: Simple comma-separated includes
 * const tree = parseIncludeTree('author,comments');
 * 
 * // Output: Flat structure
 * // {
 * //   author: {},
 * //   comments: {}
 * // }
 * 
 * @example
 * // Input: Nested includes with dot notation
 * const tree = parseIncludeTree('comments.author,comments.replies');
 * 
 * // Output: Nested structure
 * // {
 * //   comments: {
 * //     author: {},
 * //     replies: {}
 * //   }
 * // }
 * 
 * @example
 * // Input: Complex mixed-depth includes
 * const tree = parseIncludeTree('author,comments.author,comments.replies.author,tags');
 * 
 * // Output: Multi-level nesting
 * // {
 * //   author: {},
 * //   comments: {
 * //     author: {},
 * //     replies: {
 * //       author: {}
 * //     }
 * //   },
 * //   tags: {}
 * // }
 * 
 * @description
 * Used by:
 * - buildIncludedResources parses the include parameter before processing
 * - processIncludes traverses this tree structure recursively
 * 
 * Purpose:
 * - Converts flat string format into hierarchical structure for processing
 * - Enables recursive traversal of relationship includes
 * - Handles both string and pre-split array inputs
 * - Empty values are filtered out automatically
 * 
 * Data flow:
 * 1. Split comma-separated string into individual paths
 * 2. For each path, split by dots to get nesting levels
 * 3. Build nested object structure following the path
 * 4. Return tree for recursive processing
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
  try {
    // Get schema information
    const schemaInfo = scopes[scopeName]?.vars?.schemaInfo;
    if (!schemaInfo) return;

    const schema = schemaInfo.schemaInstance.structure || schemaInfo.schemaInstance;
    const relationships = schemaInfo.schemaRelationships || {};

    // Process each record
    records.forEach(record => {
      record[RELATIONSHIP_METADATA_KEY] = {};

      // Process belongsTo relationships from schema
      for (const [fieldName, fieldDef] of Object.entries(schema)) {
        if (fieldDef.belongsTo && fieldDef.as) {
          const foreignKeyValue = record[fieldName];
          if (foreignKeyValue != null) {
            record[RELATIONSHIP_METADATA_KEY][fieldDef.as] = {
              data: {
                type: fieldDef.belongsTo,
                id: String(foreignKeyValue)
              }
            };
          } else {
            record[RELATIONSHIP_METADATA_KEY][fieldDef.as] = { data: null };
          }
        }
      }

      // Process hasMany and manyToMany relationships
      for (const [relName, relDef] of Object.entries(relationships)) {
        if (relDef.hasMany || relDef.manyToMany) {
          // Add empty relationship data - will be populated if explicitly included
          record[RELATIONSHIP_METADATA_KEY][relName] = { data: [] };
        } else if (relDef.belongsToPolymorphic) {
          // Process polymorphic relationships defined in relationships section
          const { typeField, idField } = relDef.belongsToPolymorphic;
          const type = record[typeField];
          const id = record[idField];
          
          if (type && id) {
            record[RELATIONSHIP_METADATA_KEY][relName] = {
              data: { type, id: String(id) }
            };
          } else {
            record[RELATIONSHIP_METADATA_KEY][relName] = { data: null };
          }
        }
      }
    });
  } catch (error) {
    // Log error with context and re-throw
    const errorContext = {
      scopeName,
      recordCount: records?.length || 0,
      error: error.message
    };
    console.error('[loadRelationshipMetadata] Error loading relationship metadata:', errorContext);
    throw new Error(`Failed to load relationship metadata for scope '${scopeName}': ${error.message}`);
  }
};

/**
 * Loads belongsTo relationships (many-to-one)
 * 
 * This function loads the "parent" side of a relationship. For example, if comments
 * belong to articles, this loads the articles for a set of comments.
 * 
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - Records to load relationships for
 *   - fieldName: string - The foreign key field name (e.g., 'author_id')
 *   - fieldDef: Object - The field definition from the schema
 *   - includeName: string - The relationship name (e.g., 'author')
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 *   - idProperty: string - The ID property name
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadBelongsTo = async (scope, deps) => {
  const { records, scopeName, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields, idProperty } = scope;
  const { scopes, log, knex, capabilities } = deps.context;
  try {
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
        if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
        const relationshipObject = { data: null };
        
        // Add links if urlPrefix is configured
        const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
        if (scopeName) {
          relationshipObject.links = {
            self: `${urlPrefix}/${scopeName}/${record[idProperty]}/relationships/${includeName}`,
            related: `${urlPrefix}/${scopeName}/${record[idProperty]}/${includeName}`
          };
        }
        
        record[RELATIONSHIPS_KEY][includeName] = relationshipObject;
      });
      return;
    }
    
    // Get target table info
    const targetTableName = scopes[targetScope].vars.schemaInfo.tableName
    const targetIdProperty = scopes[targetScope].vars.schemaInfo.idProperty 
    const targetSchema = scopes[targetScope].vars.schemaInfo.schemaInstance;
    
    // Build field selection for sparse fieldsets
    const targetScopeObject = scopes[targetScope];
    const fieldSelectionInfo = fields?.[targetScope] ? 
      await buildFieldSelection(targetScopeObject, {
        context: {
          scopeName: targetScope,
          queryParams: { fields: { [targetScope]: fields[targetScope] } },
          schemaInfo: targetScopeObject.vars.schemaInfo
        }
      }) : 
      null;
    
    // Load the target records
    let query = knex(targetTableName).whereIn(targetIdProperty, uniqueIds);
    if (fieldSelectionInfo) {
      query = query.select(fieldSelectionInfo.fieldsToSelect);
    } else if (targetIdProperty !== 'id') {
      // If no field selection but custom idProperty, we need to alias it
      query = query.select('*', `${targetIdProperty} as id`);
    }
    const targetRecords = await query;
    
    // Load relationship metadata for all target records
    await loadRelationshipMetadata(scopes, targetRecords, targetScope);
    
    // Create lookup map
    const targetById = {};
    targetRecords.forEach(record => {
      targetById[record.id || record[targetIdProperty]] = record;
    });
    
    // Set relationships on original records
    const targetRecordsToProcess = [];
    
    records.forEach(record => {
      if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
      
      const targetId = record[fieldName];
      const targetRecord = targetById[targetId];
      
      if (targetRecord) {
        // Convert to JSON:API format
        const jsonApiRecord = toJsonApiRecord(
          scopes[targetScope],
          targetRecord,
          targetScope
        );

        // Add relationships from metadata
        if (targetRecord[RELATIONSHIP_METADATA_KEY]) {
          jsonApiRecord.relationships = targetRecord[RELATIONSHIP_METADATA_KEY];
          // Clean up the temporary property
          delete targetRecord[RELATIONSHIP_METADATA_KEY];
        }
        
        // Attach computed dependencies info if sparse fieldsets were used
        if (fieldSelectionInfo?.computedDependencies) {
          jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies;
        }

        const relationshipObject = { data: { type: targetScope, id: String(targetId) } };
        
        // Add links if urlPrefix is configured
        const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
        if (scopeName) {
          relationshipObject.links = {
            self: `${urlPrefix}/${scopeName}/${record[idProperty]}/relationships/${includeName}`,
            related: `${urlPrefix}/${scopeName}/${record[idProperty]}/${includeName}`
          };
        }
        
        record[RELATIONSHIPS_KEY][includeName] = relationshipObject;
        
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
        const relationshipObject = { data: null };
        
        // Add links if urlPrefix is configured
        const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
        if (scopeName) {
          relationshipObject.links = {
            self: `${urlPrefix}/${scopeName}/${record[idProperty]}/relationships/${includeName}`,
            related: `${urlPrefix}/${scopeName}/${record[idProperty]}/${includeName}`
          };
        }
        
        record[RELATIONSHIPS_KEY][includeName] = relationshipObject;
      }
    });
    
    // Process nested includes if any
    if (targetRecordsToProcess.length > 0) {
      const nextPath = `${currentPath}.${includeName}`;
      if (!processedPaths.has(nextPath)) {
        await processIncludes(
          { records: targetRecordsToProcess, scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields, idProperty: targetIdProperty },
          { context: { scopes, log, knex, capabilities } }
        );
      }
    }
  } catch (error) {
    // Log error with detailed context
    log.error('[INCLUDE] Error loading belongsTo relationship:', {
      fieldName,
      includeName,
      targetScope: fieldDef.belongsTo,
      recordCount: records?.length || 0,
      error: error.message,
      stack: error.stack
    });
    
    // Re-throw with enhanced error message
    const enhancedError = new Error(
      `Failed to load belongsTo relationship '${includeName}' for field '${fieldName}': ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.context = { fieldName, includeName, targetScope: fieldDef.belongsTo };
    throw enhancedError;
  }
};

/**
 * Loads hasMany relationships (one-to-many or many-to-many)
 * 
 * This function loads the "child" side of a relationship. For example, if articles
 * have many comments, this loads all comments for a set of articles. It also handles
 * many-to-many relationships through a pivot table.
 * 
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - Parent records to load relationships for
 *   - scopeName: string - The parent scope name
 *   - includeName: string - The relationship name to include
 *   - relDef: Object - The relationship definition
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadHasMany = async (scope, deps) => {
  const { records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields } = scope;
  const { scopes, log, knex, capabilities } = deps.context;
  try {
    log.trace('[INCLUDE] Loading hasMany/manyToMany relationship:', { 
      scopeName, 
      includeName, 
      recordCount: records.length,
      relDef,
      isManyToMany: !!relDef.manyToMany,
      hasMany: relDef.hasMany
    });
  
  // Collect all parent IDs
  const mainIds = records.map(r => r.id).filter(Boolean);
  
  if (mainIds.length === 0) {
    log.trace('[INCLUDE] No parent IDs found, skipping hasMany load');
    return;
  }
  
  
  // Check if this is a many-to-many relationship
  log.debug('[INCLUDE] Checking for manyToMany:', { 
    hasManyToMany: !!relDef.manyToMany,
    hasMany: relDef.hasMany,
    relDefKeys: Object.keys(relDef || {}),
    relDef: JSON.stringify(relDef)
  });
  
  if (relDef.manyToMany) {
    log.debug('[INCLUDE] Processing as manyToMany relationship');
    
    // Handle many-to-many relationship
    const manyToManyConfig = relDef.manyToMany;
    
    const pivotTable = scopes[manyToManyConfig.through].vars.schemaInfo.tableName 
    const foreignKey = manyToManyConfig.foreignKey;
    const otherKey = manyToManyConfig.otherKey;
    
    if (!foreignKey || !otherKey) {
      throw new Error(`Missing foreignKey or otherKey in many-to-many relationship '${relName}' for scope '${scopeName}'`);
    }
    
    // For manyToMany, the target scope is the relationship name itself
    const targetScope = includeName;
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
        if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
        const relationshipObject = { data: [] };
        
        // Add links if urlPrefix is configured
        const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
        if (scopeName) {
          relationshipObject.links = {
            self: `${urlPrefix}/${scopeName}/${record.id}/relationships/${includeName}`,
            related: `${urlPrefix}/${scopeName}/${record.id}/${includeName}`
          };
        }
        
        record[RELATIONSHIPS_KEY][includeName] = relationshipObject;
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
    const targetSchema = scopes[targetScope].vars.schemaInfo.schemaInstance;
    const targetScopeObject = scopes[targetScope];
    const targetIdProperty = targetScopeObject.vars.schemaInfo.idProperty;
    const fieldSelectionInfo = fields?.[targetScope] ? 
      await buildFieldSelection(targetScopeObject, {
        context: {
          scopeName: targetScope,
          queryParams: { fields: { [targetScope]: fields[targetScope] } },
          schemaInfo: targetScopeObject.vars.schemaInfo
        }
      }) : 
      null;
    
    // Step 4: For many-to-many with limits, we need a different approach
    let targetRecords;

    if (relDef.include?.strategy === 'window') {
      // For many-to-many with window functions, we need to limit per parent
      // This requires joining back through the pivot table
      
      // Get target scope vars for defaults
      const targetVars = scopes[targetScope].vars || {};
      
      // Calculate effective limit with defaults
      const effectiveLimit = relDef.include?.limit ?? targetVars.queryDefaultLimit ?? DEFAULT_QUERY_LIMIT;
      
      // Validate against max
      if (targetVars.queryMaxLimit && effectiveLimit > targetVars.queryMaxLimit) {
        throw new RestApiResourceError({
          title: 'Include Limit Exceeds Maximum',
          detail: `Requested include limit (${effectiveLimit}) exceeds queryMaxLimit (${targetVars.queryMaxLimit})`,
          status: 400
        });
      }
      
      const targetIdProperty = scopes[targetScope]?.vars?.schemaInfo?.idProperty || 'id';
      const windowQuery = knex
        .select(`${targetTable}.*`);
      
      // Add id alias if needed
      if (targetIdProperty !== 'id') {
        windowQuery.select(`${targetTable}.${targetIdProperty} as id`);
      }
      
      windowQuery.select(
          knex.raw(
            'ROW_NUMBER() OVER (PARTITION BY pivot.?? ORDER BY ' + 
            buildOrderByClause(relDef.include?.orderBy || [targetIdProperty], targetTable) + 
            ') as ' + ROW_NUMBER_KEY,
            [foreignKey]
          )
        )
        .from(targetTable)
        .join(`${pivotTable} as pivot`, `${targetTable}.${targetIdProperty}`, 'pivot.' + otherKey)
        .whereIn(`pivot.${foreignKey}`, mainIds);
        
      
      // Wrap to filter by row number
      const limitedQuery = knex
        .select('*')
        .from(windowQuery.as('_windowed'))
        .where(ROW_NUMBER_KEY, '<=', effectiveLimit);
      
      targetRecords = await limitedQuery;
      
      // Remove row number column and restore proper pivot grouping
      targetRecords.forEach(record => delete record[ROW_NUMBER_KEY]);
      
    } else {
      // Standard query without per-parent limits
      const targetIdProperty = scopes[targetScope]?.vars?.schemaInfo?.idProperty || 'id';
      let query = knex(targetTable).whereIn(targetIdProperty, targetIds);
      
      if (fieldSelectionInfo) {
        query = query.select(fieldSelectionInfo.fieldsToSelect);
      } else if (targetIdProperty !== 'id') {
        // If no field selection but custom idProperty, we need to alias it
        query = query.select('*', `${targetIdProperty} as id`);
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
      if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
      
      const childIds = pivotsByParent[record.id] || [];
      
      const relData = childIds
        .map(childId => targetById[childId])
        .filter(Boolean)
        .map(childRecord => {
          // Add to included
          const resourceKey = `${targetScope}:${childRecord.id}`;
          if (!included.has(resourceKey)) {
            const jsonApiRecord = toJsonApiRecord(
            scopes[targetScope],
            childRecord,
            targetScope
          );
            
            
            // Add relationships from metadata
            if (childRecord[RELATIONSHIP_METADATA_KEY]) {
              jsonApiRecord.relationships = childRecord[RELATIONSHIP_METADATA_KEY];
              // Clean up the temporary property
              delete childRecord[RELATIONSHIP_METADATA_KEY];
            }
            
            // Attach computed dependencies info if sparse fieldsets were used
            if (fieldSelectionInfo?.computedDependencies) {
              jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies;
            }
            
            included.set(resourceKey, jsonApiRecord);
          }
          return { type: targetScope, id: String(childRecord.id) };
        });
      
      const relationshipObject = { data: relData };
      
      // Add links if urlPrefix is configured
      const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
      if (scopeName) {
        relationshipObject.links = {
          self: `${urlPrefix}/${scopeName}/${record.id}/relationships/${includeName}`,
          related: `${urlPrefix}/${scopeName}/${record.id}/${includeName}`
        };
      }
      
      record[RELATIONSHIPS_KEY][includeName] = relationshipObject;
      
      // Update the record in the included Map if it exists
      const recordKey = `${scopeName}:${record.id}`;
      if (included.has(recordKey)) {
        const existingRecord = included.get(recordKey);
        if (!existingRecord.relationships) {
          existingRecord.relationships = {};
        }
        existingRecord.relationships[includeName] = relationshipObject;
      }
    });
    
    // Step 8: Process nested includes if any
    if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
      const nextPath = `${currentPath}.${includeName}`;
      if (!processedPaths.has(nextPath)) {
        await processIncludes(
          { records: targetRecords, scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields, idProperty: targetIdProperty },
          { context: { scopes, log, knex, capabilities } }
        );
      }
    }
    
  } else {
    // Handle regular one-to-many relationship
    log.debug('[INCLUDE] Processing as regular hasMany (NOT manyToMany):', {
      hasMany: relDef.hasMany,
      manyToMany: relDef.manyToMany,
      relDefKeys: Object.keys(relDef || {})
    });
    const targetScope = relDef.hasMany;
    const targetTable = scopes[targetScope].vars.schemaInfo.tableName;
    const foreignKey = relDef.foreignKey;
    
    if (!foreignKey) {
      throw new Error(`Missing foreignKey in hasMany relationship '${relName}' for scope '${scopeName}'`);
    }
    
    log.debug(`[INCLUDE] Loading ${targetScope} records with foreign key ${foreignKey}:`, { 
      whereIn: mainIds,
      includeConfig: relDef.include
    });
    
    // Build field selection for sparse fieldsets
    const targetSchema = scopes[targetScope].vars.schemaInfo.schemaInstance;
    const targetScopeObject = scopes[targetScope];
    const targetIdProperty = targetScopeObject.vars.schemaInfo.idProperty;
    const fieldSelectionInfo = fields?.[targetScope] ? 
      await buildFieldSelection(targetScopeObject, {
        context: {
          scopeName: targetScope,
          queryParams: { fields: { [targetScope]: fields[targetScope] } },
          schemaInfo: targetScopeObject.vars.schemaInfo
        }
      }) : 
      null;
    
    let query;
    let usingWindowFunction = false;
    
    // Check if we should use window functions
    if (relDef.include?.strategy === 'window') {
      try {
        // Try to build window function query
        query = buildWindowedIncludeQuery(
          knex,
          targetTable,
          foreignKey,
          mainIds,
          fieldSelectionInfo ? fieldSelectionInfo.fieldsToSelect : null,
          relDef.include || {},
          capabilities,
          targetScopeObject.vars  // Pass target scope vars
        );
        usingWindowFunction = true;
        log.debug('[INCLUDE] Using window function strategy with limits');
      } catch (error) {
        // If window functions not supported, this will throw a clear error
        if (error.details?.requiredFeature === 'window_functions') {
          throw error; // Re-throw the descriptive error
        }
        // For other errors, fall back to standard query
        log.warn('[INCLUDE] Window function query failed, falling back to standard query:', { 
          error: error.message, 
          stack: error.stack 
        });
        usingWindowFunction = false;
      }
    }
    
    // Build standard query if not using window functions
    if (!usingWindowFunction) {
      query = knex(targetTable).whereIn(foreignKey, mainIds);
      
      if (fieldSelectionInfo) {
        query = query.select(fieldSelectionInfo.fieldsToSelect);
      }
      
      // Apply standard config with defaults
      const targetVars = scopes[targetScope].vars;
      query = applyStandardIncludeConfig(
        query,
        relDef.include || {},
        targetVars,
        log
      );
    }
    
    // Execute query
    const targetRecords = await query;
    
    // If using window functions, remove the row number column
    if (usingWindowFunction) {
      targetRecords.forEach(record => delete record[ROW_NUMBER_KEY]);
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
      if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
      
      const children = childrenByParent[record.id] || [];
      const relData = children.map(childRecord => {
        // Add to included
        const resourceKey = `${targetScope}:${childRecord.id}`;
        if (!included.has(resourceKey)) {
          const jsonApiRecord = toJsonApiRecord(
            scopes[targetScope],
            childRecord,
            targetScope
          );
          
          // Add relationships from metadata
          if (childRecord[RELATIONSHIP_METADATA_KEY]) {
            jsonApiRecord.relationships = childRecord[RELATIONSHIP_METADATA_KEY];
            // Clean up the temporary property
            delete childRecord[RELATIONSHIP_METADATA_KEY];
          }
          
          // Attach computed dependencies info if sparse fieldsets were used
          if (fieldSelectionInfo?.computedDependencies) {
            jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies;
          }
          
          included.set(resourceKey, jsonApiRecord);
        }
        return { type: targetScope, id: String(childRecord.id) };
      });
      
      const relationshipObject = { data: relData };
      
      // Add links if urlPrefix is configured
      const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
      if (scopeName) {
        relationshipObject.links = {
          self: `${urlPrefix}/${scopeName}/${record.id}/relationships/${includeName}`,
          related: `${urlPrefix}/${scopeName}/${record.id}/${includeName}`
        };
      }
      
      record[RELATIONSHIPS_KEY][includeName] = relationshipObject;
      
      // Update the record in the included Map if it exists
      const recordKey = `${scopeName}:${record.id}`;
      if (included.has(recordKey)) {
        const existingRecord = included.get(recordKey);
        if (!existingRecord.relationships) {
          existingRecord.relationships = {};
        }
        existingRecord.relationships[includeName] = relationshipObject;
      }
    });
    
    // Process nested includes
    if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
      const nextPath = `${currentPath}.${includeName}`;
      if (!processedPaths.has(nextPath)) {
        await processIncludes(
          { records: targetRecords, scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields, idProperty: targetIdProperty },
          { context: { scopes, log, knex, capabilities } }
        );
      }
    }
  }
  } catch (error) {
    // Log error with detailed context
    log.error('[INCLUDE] Error loading hasMany relationship:', {
      scopeName,
      includeName,
      hasThrough: !!relDef.through,
      recordCount: records?.length || 0,
      error: error.message,
      stack: error.stack
    });
    
    // Re-throw with enhanced error message
    const enhancedError = new Error(
      `Failed to load hasMany relationship '${includeName}' for scope '${scopeName}': ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.context = { scopeName, includeName, hasThrough: !!relDef.through };
    throw enhancedError;
  }
};

/**
 * Loads polymorphic belongsTo relationships
 * 
 * Handles relationships where a record can belong to different types of parent records.
 * For example, comments that can belong to either articles or videos.
 * 
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - Records with polymorphic relationships
 *   - relName: string - The relationship name
 *   - relDef: Object - The relationship definition with belongsToPolymorphic
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadPolymorphicBelongsTo = async (scope, deps) => {
  const { records, scopeName, relName, relDef, subIncludes, included, processedPaths, currentPath, fields } = scope;
  const { scopes, log, knex, capabilities } = deps.context;
  try {
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
    const targetSchemaInfo = scopes[targetType].vars.schemaInfo;
    const targetTable = targetSchemaInfo?.tableName || targetType;
    
    // Build field selection for sparse fieldsets
    const targetScopeObject = scopes[targetType];
    // const targetIdProperty = targetScopeObject.vars.schemaInfo.idProperty;
    const fieldSelectionInfo = fields?.[targetType] ? 
      await buildFieldSelection(targetScopeObject, {
        context: {
          scopeName: targetType,
          queryParams: { fields: { [targetType]: fields[targetType] } },
          schemaInfo: targetScopeObject.vars.schemaInfo
        }
      }) : 
      null;
    
    log.debug(`[INCLUDE] Loading ${targetType} records:`, { 
      ids: targetIds,
      fields: fieldSelectionInfo ? fieldSelectionInfo.fieldsToSelect : '*' 
    });
    
    // Query for this type
    const targetIdProperty = scopes[targetType]?.vars?.schemaInfo?.idProperty || 'id';
    let query = knex(targetTable).whereIn(targetIdProperty, targetIds);
    if (fieldSelectionInfo) {
      query = query.select(fieldSelectionInfo.fieldsToSelect);
    } else if (targetIdProperty !== 'id') {
      // If no field selection but custom idProperty, we need to alias it
      query = query.select('*', `${targetIdProperty} as id`);
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
        
        if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
        
        if (targetRecord) {
          // Add to included
          const resourceKey = `${targetType}:${targetId}`;
          if (!included.has(resourceKey)) {
            const jsonApiRecord = toJsonApiRecord(
              scopes[targetType],
              targetRecord,
              targetType
            );
            
            // Add relationships from metadata
            if (targetRecord[RELATIONSHIP_METADATA_KEY]) {
              jsonApiRecord.relationships = targetRecord[RELATIONSHIP_METADATA_KEY];
              // Clean up the temporary property
              delete targetRecord[RELATIONSHIP_METADATA_KEY];
            }
            
            // Attach computed dependencies info if sparse fieldsets were used
            if (fieldSelectionInfo?.computedDependencies) {
              jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies;
            }
            
            included.set(resourceKey, jsonApiRecord);
          }
          
          const relationshipObject = {
            data: { type: targetType, id: String(targetId) }
          };
          
          // Add links if urlPrefix is configured
          const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
          if (scopeName) {
            relationshipObject.links = {
              self: `${urlPrefix}/${scopeName}/${record.id}/relationships/${relName}`,
              related: `${urlPrefix}/${scopeName}/${record.id}/${relName}`
            };
          }
          
          record[RELATIONSHIPS_KEY][relName] = relationshipObject;
        } else {
          const relationshipObject = { data: null };
          
          // Add links if urlPrefix is configured
          const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
          if (scopeName) {
            relationshipObject.links = {
              self: `${urlPrefix}/${scopeName}/${record.id}/relationships/${relName}`,
              related: `${urlPrefix}/${scopeName}/${record.id}/${relName}`
            };
          }
          
          record[RELATIONSHIPS_KEY][relName] = relationshipObject;
        }
      }
    });
    
    // Process nested includes for this type
    if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
      const nextPath = `${currentPath}.${relName}`;
      if (!processedPaths.has(nextPath)) {
        await processIncludes(
          { records: targetRecords, scopeName: targetType, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields, idProperty: targetIdProperty },
          { context: { scopes, log, knex, capabilities } }
        );
      }
    }
  }
  
  // Set null for records without relationships
  records.forEach(record => {
    if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
    if (!record[RELATIONSHIPS_KEY][relName]) {
      const relationshipObject = { data: null };
      
      // Add links if urlPrefix is configured
      const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
      if (scopeName) {
        relationshipObject.links = {
          self: `${urlPrefix}/${scopeName}/${record.id}/relationships/${relName}`,
          related: `${urlPrefix}/${scopeName}/${record.id}/${relName}`
        };
      }
      
      record[RELATIONSHIPS_KEY][relName] = relationshipObject;
    }
  });
  } catch (error) {
    // Log error with detailed context
    log.error('[INCLUDE] Error loading polymorphic belongsTo relationship:', {
      relName,
      recordCount: records?.length || 0,
      types: relDef?.belongsToPolymorphic?.types,
      error: error.message,
      stack: error.stack
    });
    
    // Re-throw with enhanced error message
    const enhancedError = new Error(
      `Failed to load polymorphic belongsTo relationship '${relName}': ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.context = { relName, types: relDef?.belongsToPolymorphic?.types };
    throw enhancedError;
  }
};

/**
 * Loads reverse polymorphic relationships (via)
 * 
 * Handles loading "child" records that have a polymorphic relationship back to the parent.
 * For example, loading all comments (which can belong to articles or videos) for a specific article.
 * 
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - Parent records
 *   - scopeName: string - The parent scope name
 *   - includeName: string - The relationship name
 *   - relDef: Object - The relationship definition with 'via' property
 *   - subIncludes: Object - Nested includes to process recursively
 *   - included: Map - Map of already included resources
 *   - processedPaths: Set - Set of already processed paths
 *   - currentPath: string - Current include path for tracking
 *   - fields: Object - Sparse fieldsets configuration
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const loadReversePolymorphic = async (scope, deps) => {
  const { records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields } = scope;
  const { scopes, log, knex, capabilities } = deps.context;
  try {
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
  const targetSchema = scopes[targetScope].vars.schemaInfo.schemaInstance;
  const targetScopeObject = scopes[targetScope];
  const targetIdProperty = targetScopeObject.vars.schemaInfo.idProperty;
  const fieldSelectionInfo = fields?.[targetScope] ? 
    await buildFieldSelection(
      { scopeName: targetScope, queryParams: { fields: { [targetScope]: fields[targetScope] } }, schemaInfo: targetScopeObject.vars.schemaInfo },
      { context: { scopes, log, knex } }
    ) : 
    null;
  
  // Query for records pointing back to our scope
  let query = knex(targetTable)
    .where(typeField, scopeName)
    .whereIn(idField, parentIds);
    
  if (fieldSelectionInfo) {
    query = query.select(fieldSelectionInfo.fieldsToSelect);
  } else if (targetIdProperty !== 'id') {
    // If no field selection but custom idProperty, we need to alias it
    query = query.select('*', `${targetIdProperty} as id`);
  }
  
  // Apply include configuration (limits, ordering, etc.)
  const targetVars = scopes[targetScope].vars;
  query = applyStandardIncludeConfig(
    query,
    relDef.include || {},
    targetVars,
    log
  );
  
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
    if (!record[RELATIONSHIPS_KEY]) record[RELATIONSHIPS_KEY] = {};
    
    const children = childrenByParent[record.id] || [];
    const relData = children.map(childRecord => {
      // Add to included
      const resourceKey = `${targetScope}:${childRecord.id}`;
      if (!included.has(resourceKey)) {
        const jsonApiRecord = toJsonApiRecord(
          scopes[targetScope],
          childRecord,
          targetScope
        );
        
        // Add relationships from metadata
        if (childRecord[RELATIONSHIP_METADATA_KEY]) {
          jsonApiRecord.relationships = childRecord[RELATIONSHIP_METADATA_KEY];
          // Clean up the temporary property
          delete childRecord[RELATIONSHIP_METADATA_KEY];
        }
        
        // Attach computed dependencies info if sparse fieldsets were used
        if (fieldSelectionInfo?.computedDependencies) {
          jsonApiRecord[COMPUTED_DEPENDENCIES_KEY] = fieldSelectionInfo.computedDependencies;
        }
        
        included.set(resourceKey, jsonApiRecord);
      }
      return { type: targetScope, id: String(childRecord.id) };
    });
    
    const relationshipObject = { data: relData };
    
    // Add links if urlPrefix is configured
    const urlPrefix = scopes[scopeName]?.vars?.returnBasePath || scopes[scopeName]?.vars?.mountPath || '';
    if (scopeName) {
      relationshipObject.links = {
        self: `${urlPrefix}/${scopeName}/${record.id}/relationships/${includeName}`,
        related: `${urlPrefix}/${scopeName}/${record.id}/${includeName}`
      };
    }
    
    record[RELATIONSHIPS_KEY][includeName] = relationshipObject;
  });
  
  // Process nested includes
  if (Object.keys(subIncludes).length > 0 && targetRecords.length > 0) {
    const nextPath = `${currentPath}.${includeName}`;
    if (!processedPaths.has(nextPath)) {
      await processIncludes(
        { records: targetRecords, scopeName: targetScope, includeTree: subIncludes, included, processedPaths, currentPath: nextPath, fields, idProperty: targetIdProperty },
        { context: { scopes, log, knex } }
      );
    }
  }
  } catch (error) {
    // Log error with detailed context
    log.error('[INCLUDE] Error loading reverse polymorphic relationship:', {
      scopeName,
      includeName,
      via: relDef?.via,
      targetScope: relDef?.hasMany,
      recordCount: records?.length || 0,
      error: error.message,
      stack: error.stack
    });
    
    // Re-throw with enhanced error message
    const enhancedError = new Error(
      `Failed to load reverse polymorphic relationship '${includeName}' via '${relDef?.via}' for scope '${scopeName}': ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.context = { scopeName, includeName, via: relDef?.via, targetScope: relDef?.hasMany };
    throw enhancedError;
  }
};

/**
 * Processes includes for a set of records
 * 
 * This is the main recursive function that processes the include tree. It examines
 * the schema to determine relationship types and calls the appropriate loader function.
 * 
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - Records to process includes for
 *   - scopeName: string - The scope name of the records
 *   - includeTree: Object - Parsed include tree from parseIncludeTree
 *   - included: Map - Map storing all included resources
 *   - processedPaths: Set - Set tracking processed paths to prevent cycles
 *   - currentPath: string - Current path in the include tree (default '')
 *   - fields: Object - Sparse fieldsets configuration (default {})
 *   - idProperty: string - The ID property name
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<void>}
 */
export const processIncludes = async (scope, deps) => {
  const { records, scopeName, includeTree, included, processedPaths, currentPath = '', fields = {}, idProperty } = scope;
  const { scopes, log, knex, capabilities } = deps.context;
  try {
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
    
    const { schemaInstance: schemaInstance, schemaRelationships } = schemaInfo;
    
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
      
      try {
        // Look for belongsTo relationships in schema fields
        for (const [fieldName, fieldDef] of Object.entries(schemaInstance.structure || {})) {
          if (fieldDef.as === includeName && fieldDef.belongsTo) {
            await loadBelongsTo(
              { records, scopeName, fieldName, fieldDef, includeName, subIncludes, included, processedPaths, currentPath, fields, idProperty },
              { context: { scopes, log, knex, capabilities } }
            );
            handled = true;
            break;
          }
        }
        
        // Check relationships
        if (!handled && schemaRelationships) {
          const relDef = schemaRelationships[includeName];
          
          if (relDef) {
            if (relDef.hasMany || relDef.manyToMany) {
              // Check if it's a reverse polymorphic (via)
              if (relDef.via) {
                await loadReversePolymorphic(
                  { records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields },
                  { context: { scopes, log, knex, capabilities } }
                );
              } else {
                log.debug('[INCLUDE] About to call loadHasMany:', {
                  scopeName,
                  includeName,
                  relDefKeys: Object.keys(relDef || {}),
                  hasManyToMany: !!relDef.manyToMany,
                  hasMany: relDef.hasMany
                });
                await loadHasMany(
                  { records, scopeName, includeName, relDef, subIncludes, included, processedPaths, currentPath, fields },
                  { context: { scopes, log, knex, capabilities } }
                );
              }
              handled = true;
            } else if (relDef.belongsToPolymorphic) {
              await loadPolymorphicBelongsTo(
                { records, scopeName, relName: includeName, relDef, subIncludes, included, processedPaths, currentPath, fields },
                { context: { scopes, log, knex, capabilities } }
              );
              handled = true;
            }
          }
        }
      } catch (includeError) {
        // Log specific include error and continue with other includes
        log.error('[INCLUDE] Error processing include:', {
          scopeName,
          includeName,
          fullPath,
          error: includeError.message
        });
        // Re-throw to maintain existing behavior
        throw includeError;
      }
      
      if (!handled) {
        log.warn('[INCLUDE] Unknown relationship:', { 
          scopeName, 
          includeName,
          availableFields: Object.keys(schemaInstance.structure || {}).filter(k => schemaInstance.structure[k].as),
          availableRelationships: Object.keys(schemaRelationships || {})
        });
      }
    }
  } catch (error) {
    // Log error with full context
    log.error('[INCLUDE] Error in processIncludes:', {
      scopeName,
      currentPath,
      includeTree: Object.keys(includeTree || {}),
      recordCount: records?.length || 0,
      error: error.message,
      stack: error.stack
    });
    throw error; // Re-throw to maintain existing error propagation
  }
};

/**
 * Main entry point for building included resources
 * 
 * Takes a set of records and an include parameter, loads all requested relationships,
 * and returns both the included resources and the records with relationship data attached.
 * 
 * @param {Object} scope - The hooked-api scope object containing:
 *   - records: Array<Object> - The main records to process
 *   - scopeName: string - The scope name of the main resources
 *   - includeParam: string - The include parameter value (e.g., "author,comments.author")
 *   - fields: Object - Sparse fieldsets configuration
 *   - idProperty: string - The ID property name
 * @param {Object} deps - Dependencies object containing:
 *   - context.scopes: Object - The hooked-api scopes object
 *   - context.log: Object - Logger instance
 *   - context.knex: Object - Knex instance
 * @returns {Promise<Object>} Object with included array and records with relationships
 * 
 * @example
 * const result = await buildIncludedResources(
 *   {
 *     records: articleRecords,
 *     scopeName: 'articles',
 *     includeParam: 'author,comments.author',
 *     fields: { articles: 'title,body', people: 'name' },
 *     idProperty: 'id'
 *   },
 *   { context: { scopes, log, knex } }
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
export const buildIncludedResources = async (scope, deps) => {
  const { records, scopeName, includeParam, fields, idProperty } = scope;
  const { scopes, log, knex, capabilities } = deps.context;
  try {
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
    await processIncludes(
      { records, scopeName, includeTree, included, processedPaths, currentPath: '', fields, idProperty },
      { context: { scopes, log, knex, capabilities } }
    );
    
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
  } catch (error) {
    // Log comprehensive error information
    log.error('[INCLUDE] Failed to build included resources:', {
      scopeName,
      includeParam,
      recordCount: records?.length || 0,
      error: error.message,
      stack: error.stack
    });
    
    // Re-throw with additional context
    const enhancedError = new Error(`Failed to build included resources for scope '${scopeName}': ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.context = {
      scopeName,
      includeParam,
      recordCount: records?.length || 0
    };
    throw enhancedError;
  }
};

/**
 * Loads relationship identifiers for all hasMany relationships without fetching full related records.
 * 
 * ## Purpose
 * This function ensures that all hasMany relationships (one-to-many, many-to-many, and polymorphic) 
 * always return resource identifiers in the JSON:API response, even when the related resources 
 * are not included via the ?include parameter.
 * 
 * ## Why this is needed
 * 1. **JSON:API Consistency**: The JSON:API spec allows servers to include relationship identifiers
 *    without including the full related resources. This provides a consistent API surface where
 *    clients always know what relationships exist and their IDs.
 * 
 * 2. **Simplified Mode Support**: In simplified mode, relationship IDs are transformed into 
 *    minimal objects (e.g., `reviews: [{id: '1'}, {id: '2'}, {id: '3'}]`). Without this function, 
 *    these objects only appear when using ?include, creating an inconsistent API where fields appear/disappear.
 * 
 * 3. **Performance Balance**: Loading just IDs is much cheaper than loading full records. This gives
 *    clients the ability to know what relationships exist without the cost of fetching all data.
 * 
 * ## What it does
 * - Runs ONE query per relationship type (not per record) to fetch all related IDs
 * - Populates the relationship data with resource identifiers: `{ type: 'resource', id: '123' }`
 * - Handles all relationship types: one-to-many, many-to-many, and polymorphic
 * - Works for both JSON:API and simplified modes (transformation happens elsewhere)
 * 
 * ## When it runs
 * This runs after the main records are fetched but before includes are processed.
 * If includes ARE specified, they will overwrite these IDs with full data.
 * 
 * @param {Array<Object>} records - The parent records to load relationships for
 * @param {string} scopeName - The parent scope name (e.g., 'authors')
 * @param {Object} scopes - All available scopes with their schemas
 * @param {Object} knex - Knex instance for database queries
 * @returns {Promise<void>} Modifies records in place by adding relationship data
 */
export const loadRelationshipIdentifiers = async (records, scopeName, scopes, knex) => {
  if (!records.length) return;
  
  const schemaInfo = scopes[scopeName]?.vars?.schemaInfo;
  if (!schemaInfo) return;
  
  const relationships = schemaInfo.schemaRelationships || {};
  const recordIds = records.map(r => r.id);
  
  
  // Process each hasMany relationship
  for (const [relName, relDef] of Object.entries(relationships)) {
    let idsMap = {};
    
    if (relDef.hasMany && !relDef.through && !relDef.via) {
      // Regular one-to-many
      // Example: publisher hasMany authors
      const foreignKey = relDef.foreignKey;
    
    if (!foreignKey) {
      throw new Error(`Missing foreignKey in hasMany relationship '${relName}' for scope '${scopeName}'`);
    }
      const targetScope = scopes[relDef.hasMany];
      const targetTable = targetScope?.vars?.schemaInfo?.tableName || relDef.hasMany;
      const targetIdProperty = targetScope?.vars?.schemaInfo?.idProperty || 'id';
      
      const results = await knex(targetTable)
        .whereIn(foreignKey, recordIds)
        .select(targetIdProperty !== 'id' ? `${targetIdProperty} as id` : 'id', foreignKey);
      
      results.forEach(row => {
        const parentId = String(row[foreignKey]);
        if (!idsMap[parentId]) idsMap[parentId] = [];
        idsMap[parentId].push(String(row.id));
      });
      
    } else if (relDef.manyToMany) {
      // Many-to-many relationship
      // Example: { manyToMany: { through: 'article_tags', foreignKey: 'article_id', otherKey: 'tag_id' } }
      const { through, foreignKey, otherKey } = relDef.manyToMany;
      const fk = foreignKey;
      const ok = otherKey;
      
      if (!fk || !ok) {
        throw new Error(`Missing foreignKey or otherKey in manyToMany relationship '${relName}' for scope '${scopeName}'`);
      }
      
      // Get the actual table name from the pivot scope
      const pivotScope = scopes[through];
      const pivotTable = pivotScope?.vars?.schemaInfo?.tableName || through;
      
      const results = await knex(pivotTable)
        .whereIn(fk, recordIds)
        .select(fk, ok);
      
      results.forEach(row => {
        const parentId = String(row[fk]);
        const childId = String(row[ok]);
        if (!idsMap[parentId]) idsMap[parentId] = [];
        idsMap[parentId].push(childId);
      });
      
    } else if (relDef.hasMany && relDef.via) {
      // Polymorphic reverse (via)
      // Example: publishers hasMany reviews via reviewable (where reviews.reviewable_type = 'publishers')
      const targetScope = relDef.hasMany;
      const targetRelationships = scopes[targetScope]?.vars?.schemaInfo?.schemaRelationships;
      const viaRel = targetRelationships?.[relDef.via];
      
      if (viaRel?.belongsToPolymorphic) {
        const { typeField, idField } = viaRel.belongsToPolymorphic;
        
        // Get the actual table name
        const targetTable = scopes[targetScope]?.vars?.schemaInfo?.tableName || targetScope;
        const targetIdProperty = scopes[targetScope]?.vars?.schemaInfo?.idProperty || 'id';
        
        const results = await knex(targetTable)
          .where(typeField, scopeName)
          .whereIn(idField, recordIds)
          .select(targetIdProperty !== 'id' ? `${targetIdProperty} as id` : 'id', idField);
        
        results.forEach(row => {
          const parentId = String(row[idField]);
          if (!idsMap[parentId]) idsMap[parentId] = [];
          idsMap[parentId].push(String(row.id));
        });
      }
    }
    
    // Apply the collected IDs to all records
    if (Object.keys(idsMap).length > 0 || relDef.hasMany || relDef.manyToMany) {
      records.forEach(record => {
        if (!record[RELATIONSHIPS_KEY]) {
          record[RELATIONSHIPS_KEY] = {};
        }
        
        const ids = idsMap[String(record.id)] || [];
        // For manyToMany, the target type is the relationship name itself
        // For hasMany (without through), the target type is specified in the hasMany property
        const targetType = relDef.hasMany || (relDef.manyToMany ? relName : null);
        
        record[RELATIONSHIPS_KEY][relName] = {
          data: ids.map(id => ({ 
            type: targetType, 
            id 
          }))
        };
      });
    }
  }
};