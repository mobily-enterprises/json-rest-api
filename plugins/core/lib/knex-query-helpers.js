/**
 * Knex Query Filter Hooks
 * 
 * This module contains three separate hooks for filtering queries:
 * 1. polymorphicFiltersHook - Handles polymorphic relationship filters
 * 2. crossTableFiltersHook - Handles filters requiring JOINs
 * 3. basicFiltersHook - Handles basic filters on the main table
 * 
 * These hooks are designed to run in this specific order to ensure
 * proper field qualification when JOINs are present.
 */

/**
 * Hook 1: Polymorphic Filters Hook
 * 
 * Purpose: Process filters that target polymorphic relationships.
 * Must run first to add conditional JOINs for polymorphic types.
 */
export const polymorphicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchema = hookParams.context?.knexQuery?.searchSchema;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchema) {
    return;
  }

  // Step 1: Identify polymorphic searches
  const polymorphicSearches = new Map();
  const polymorphicJoins = new Map();

  for (const [filterKey, filterValue] of Object.entries(filters)) {
    const fieldDef = searchSchema.structure[filterKey];

    if (fieldDef?.polymorphicField && fieldDef?.targetFields && filterValue !== undefined) {
      log.trace('[POLYMORPHIC-SEARCH] Found polymorphic search:', { 
        filterKey, 
        polymorphicField: fieldDef.polymorphicField 
      });
      
      polymorphicSearches.set(filterKey, {
        fieldDef,
        filterValue,
        polymorphicField: fieldDef.polymorphicField
      });
    }
  }

  if (polymorphicSearches.size === 0) {
    return;
  }

  // Step 2: Build polymorphic JOINs
  log.trace('[POLYMORPHIC-SEARCH] Building JOINs for polymorphic searches');
  
  for (const [filterKey, searchInfo] of polymorphicSearches) {
    const { fieldDef, polymorphicField } = searchInfo;
    
    // Get the relationship definition
    const relationships = (await scopes[scopeName].getSchemaInfo()).relationships;
    const polyRel = relationships[polymorphicField];
    
    if (!polyRel?.belongsToPolymorphic) {
      throw new Error(
        `Polymorphic field '${polymorphicField}' not found in relationships for scope '${scopeName}'`
      );
    }
    
    const { typeField, idField } = polyRel.belongsToPolymorphic;
    
    // Build JOINs for each target type
    for (const [targetType, targetFieldPath] of Object.entries(fieldDef.targetFields)) {
      const baseAlias = `${tableName}_${polymorphicField}_${targetType}`;
      
      // Skip if we already added this JOIN
      if (!polymorphicJoins.has(baseAlias)) {
        const targetSchema = (await scopes[targetType].getSchemaInfo()).schema;
        const targetTable = targetSchema?.tableName || targetType;
        
        log.trace('[POLYMORPHIC-SEARCH] Adding conditional JOIN:', { 
          targetType, 
          alias: baseAlias 
        });
        
        // Conditional JOIN - only matches when type is correct
        query.leftJoin(`${targetTable} as ${baseAlias}`, function() {
          this.on(`${tableName}.${typeField}`, db.raw('?', [targetType]))
              .andOn(`${tableName}.${idField}`, `${baseAlias}.id`);
        });
        
        polymorphicJoins.set(baseAlias, {
          targetType,
          targetTable,
          targetFieldPath
        });
        
        // Handle cross-table paths
        if (targetFieldPath.includes('.')) {
          log.trace('[POLYMORPHIC-SEARCH] Building cross-table JOINs for path:', targetFieldPath);
          
          const pathParts = targetFieldPath.split('.');
          let currentAlias = baseAlias;
          let currentScope = targetType;
          
          // Build JOIN for each segment except the last
          for (let i = 0; i < pathParts.length - 1; i++) {
            const relationshipName = pathParts[i];
            
            // Find the foreign key for this relationship
            const currentSchema = (await scopes[currentScope].getSchemaInfo()).schema;
            let foreignKeyField = null;
            let nextScope = null;
            
            // Search schema for matching belongsTo
            for (const [fieldName, fieldDef] of Object.entries(currentSchema.structure)) {
              if (fieldDef.as === relationshipName && fieldDef.belongsTo) {
                foreignKeyField = fieldName;
                nextScope = fieldDef.belongsTo;
                break;
              }
            }
            
            if (!foreignKeyField) {
              // Check relationships for hasOne
              const currentRelationships = (await scopes[currentScope].getSchemaInfo()).relationships;
              const rel = currentRelationships?.[relationshipName];
              if (rel?.hasOne) {
                // Handle hasOne - more complex
                throw new Error(
                  `Cross-table polymorphic search through hasOne relationships not yet supported`
                );
              }
              
              throw new Error(
                `Cannot resolve relationship '${relationshipName}' in path '${targetFieldPath}' for scope '${currentScope}'`
              );
            }
            
            // Build next JOIN
            const nextAlias = `${currentAlias}_${relationshipName}`;
            const nextSchema = (await scopes[nextScope].getSchemaInfo()).schema;
            const nextTable = nextSchema?.tableName || nextScope;
            
            log.trace('[POLYMORPHIC-SEARCH] Adding cross-table JOIN:', { 
              from: currentAlias, 
              to: nextAlias,
              table: nextTable 
            });
            
            query.leftJoin(`${nextTable} as ${nextAlias}`, 
              `${currentAlias}.${foreignKeyField}`, 
              `${nextAlias}.id`
            );
            
            currentAlias = nextAlias;
            currentScope = nextScope;
          }
        }
      }
    }
  }

  // Pre-fetch relationships for WHERE clause processing
  const polymorphicRelationships = new Map();
  const relationships = (await scopes[scopeName].getSchemaInfo()).relationships;
  for (const [filterKey, searchInfo] of polymorphicSearches) {
    const { polymorphicField } = searchInfo;
    const polyRel = relationships[polymorphicField];
    if (polyRel?.belongsToPolymorphic) {
      polymorphicRelationships.set(filterKey, polyRel);
    }
  }

  // Mark that we have JOINs for other hooks
  hookParams.context.knexQuery.hasJoins = true;

  // Step 3: Apply WHERE conditions
  query.where(function() {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      if (!polymorphicSearches.has(filterKey)) continue;

      const searchInfo = polymorphicSearches.get(filterKey);
      const polyRel = polymorphicRelationships.get(filterKey);
      if (!polyRel) continue;

      const { typeField } = polyRel.belongsToPolymorphic;

      // Build OR conditions for each possible type
      this.where(function() {
        for (const [targetType, targetFieldPath] of Object.entries(searchInfo.fieldDef.targetFields)) {
          this.orWhere(function() {
            // First check the type matches
            this.where(`${tableName}.${typeField}`, targetType);

            // Then apply the field filter
            const baseAlias = `${tableName}_${searchInfo.polymorphicField}_${targetType}`;

            if (targetFieldPath.includes('.')) {
              // Complex path
              const pathParts = targetFieldPath.split('.');
              const fieldName = pathParts[pathParts.length - 1];

              let finalAlias = baseAlias;
              for (let i = 0; i < pathParts.length - 1; i++) {
                finalAlias = `${finalAlias}_${pathParts[i]}`;
              }

              const operator = searchInfo.fieldDef.filterUsing || '=';
              if (operator === 'like') {
                this.where(`${finalAlias}.${fieldName}`, 'like', `%${searchInfo.filterValue}%`);
              } else {
                this.where(`${finalAlias}.${fieldName}`, operator, searchInfo.filterValue);
              }
            } else {
              // Direct field
              const operator = searchInfo.fieldDef.filterUsing || '=';
              if (operator === 'like') {
                this.where(`${baseAlias}.${targetFieldPath}`, 'like', `%${searchInfo.filterValue}%`);
              } else {
                this.where(`${baseAlias}.${targetFieldPath}`, operator, searchInfo.filterValue);
              }
            }
          });
        }
      });
    }
  });
};

/**
 * Hook 2: Cross-Table Filters Hook
 * 
 * Purpose: Process filters that require JOINs to access fields in related tables.
 * Must run after polymorphic but before basic to ensure hasJoins flag is set.
 */
export const crossTableFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex, crossTableSearchHelpers } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchema = hookParams.context?.knexQuery?.searchSchema;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchema) {
    return;
  }

  // Step 1: Analyze indexes
  const requiredIndexes = crossTableSearchHelpers.analyzeRequiredIndexes(scopeName, searchSchema);
  if (requiredIndexes.length > 0) {
    log.debug(`Cross-table search requires indexes:`, requiredIndexes);
  }

  // Step 2: Build JOIN maps
  const joinMap = new Map();
  const fieldPathMap = new Map();
  let hasCrossTableFilters = false;

  for (const [filterKey, fieldDef] of Object.entries(searchSchema.structure)) {
    if (filters[filterKey] === undefined) continue;

    // Skip polymorphic filters
    if (fieldDef.polymorphicField) continue;

    // Check actualField for cross-table references
    if (fieldDef.actualField?.includes('.')) {
      hasCrossTableFilters = true;
      log.trace('[JOIN-DETECTION] Cross-table actualField found', { filterKey, actualField: fieldDef.actualField, scopeName });
      const joinInfo = await crossTableSearchHelpers.buildJoinChain(scopeName, fieldDef.actualField);
      if (!joinMap.has(joinInfo.joinAlias)) {
        joinMap.set(joinInfo.joinAlias, joinInfo);
      }
      fieldPathMap.set(fieldDef.actualField, `${joinInfo.joinAlias}.${joinInfo.targetField}`);
    }

    // Check likeOneOf for cross-table references
    if (fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf)) {
      for (const field of fieldDef.likeOneOf) {
        if (field.includes('.')) {
          hasCrossTableFilters = true;
          log.trace('[JOIN-DETECTION] Cross-table likeOneOf field found', { filterKey, field, scopeName });
          const joinInfo = await crossTableSearchHelpers.buildJoinChain(scopeName, field);
          if (!joinMap.has(joinInfo.joinAlias)) {
            joinMap.set(joinInfo.joinAlias, joinInfo);
          }
          fieldPathMap.set(field, `${joinInfo.joinAlias}.${joinInfo.targetField}`);
        }
      }
    }
  }

  if (!hasCrossTableFilters) {
    return;
  }

  // Step 3: Apply JOINs
  const appliedJoins = new Set();

  joinMap.forEach((joinInfo) => {
    if (joinInfo.isMultiLevel && joinInfo.joinChain) {
      joinInfo.joinChain.forEach((join) => {
        const joinKey = `${join.joinAlias}:${join.joinCondition}`;
        if (!appliedJoins.has(joinKey)) {
          const [leftSide, rightSide] = join.joinCondition.split(' = ');
          query.leftJoin(`${join.targetTableName} as ${join.joinAlias}`, function() {
            this.on(leftSide, rightSide);
          });
          appliedJoins.add(joinKey);
        }
      });
    } else {
      const joinKey = `${joinInfo.joinAlias}:${joinInfo.joinCondition}`;
      if (!appliedJoins.has(joinKey)) {
        const [leftSide, rightSide] = joinInfo.joinCondition.split(' = ');
        query.leftJoin(`${joinInfo.targetTableName} as ${joinInfo.joinAlias}`, function() {
          this.on(leftSide, rightSide);
        });
        appliedJoins.add(joinKey);
      }
    }
  });

  // Step 4: Handle DISTINCT
  let hasOneToManyJoins = false;
  joinMap.forEach((joinInfo) => {
    if (joinInfo.isOneToMany) {
      hasOneToManyJoins = true;
    } else if (joinInfo.isMultiLevel && joinInfo.joinChain) {
      joinInfo.joinChain.forEach(join => {
        if (join.isOneToMany) hasOneToManyJoins = true;
      });
    }
  });

  if (hasOneToManyJoins) {
    log.trace('[DISTINCT] Adding DISTINCT to query due to one-to-many JOINs');
    query.distinct();
  }

  // Store state for basic filters hook
  hookParams.context.knexQuery.hasJoins = true;

  // Step 5: Apply WHERE conditions for cross-table filters
  query.where(function() {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      const fieldDef = searchSchema.structure[filterKey];
      if (!fieldDef) continue;

      // Skip non-cross-table and polymorphic filters
      if (fieldDef.polymorphicField) continue;
      if (!fieldDef.actualField?.includes('.') &&
          !fieldDef.likeOneOf?.some(f => f.includes('.'))) {
        continue;
      }

      // Process cross-table filters
      switch (true) {
        case fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf):
          this.where(function() {
            fieldDef.likeOneOf.forEach((field, index) => {
              const dbField = fieldPathMap.get(field) ||
                             (!field.includes('.') && joinMap.size > 0 ? `${tableName}.${field}` : field);
              const condition = `%${filterValue}%`;

              if (index === 0) {
                this.where(dbField, 'like', condition);
              } else {
                this.orWhere(dbField, 'like', condition);
              }
            });
          });
          break;

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          fieldDef.applyFilter.call(this, this, filterValue);
          break;

        default:
          let dbField = fieldDef.actualField || filterKey;
          if (dbField.includes('.')) {
            dbField = fieldPathMap.get(dbField) || dbField;
          }

          const operator = fieldDef.filterUsing || '=';

          switch (operator) {
            case 'like':
              this.where(dbField, 'like', `%${filterValue}%`);
              break;
            case 'in':
              if (Array.isArray(filterValue)) {
                this.whereIn(dbField, filterValue);
              } else {
                this.where(dbField, operator, filterValue);
              }
              break;
            case 'between':
              if (Array.isArray(filterValue) && filterValue.length === 2) {
                this.whereBetween(dbField, filterValue);
              } else {
                this.where(dbField, operator, filterValue);
              }
              break;
            default:
              this.where(dbField, operator, filterValue);
              break;
          }
          break;
      }
    }
  });
};

/**
 * Hook 3: Basic Filters Hook
 * 
 * Purpose: Process filters that apply directly to fields on the main table.
 * Must run last to check hasJoins flag and qualify fields appropriately.
 */
export const basicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchema = hookParams.context?.knexQuery?.searchSchema;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchema) {
    return;
  }

  // Check if we have any JOINs applied (to know if we need to qualify fields)
  // Instead of relying on hasJoins flag, always qualify fields for safety
  const qualifyField = (field) => {
    return `${tableName}.${field}`;
  };

  // Main WHERE group
  query.where(function() {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      const fieldDef = searchSchema.structure[filterKey];
      if (!fieldDef) continue;

      // Skip if this is a cross-table filter
      if (fieldDef.actualField?.includes('.') ||
          fieldDef.likeOneOf?.some(f => f.includes('.')) ||
          fieldDef.polymorphicField) {
        continue;
      }

      // Process basic filters
      switch (true) {
        case fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf):
          // Multi-field OR search
          this.where(function() {
            fieldDef.likeOneOf.forEach((field, index) => {
              // Always qualify field names
              const dbField = qualifyField(field);
              const condition = `%${filterValue}%`;

              if (index === 0) {
                this.where(dbField, 'like', condition);
              } else {
                this.orWhere(dbField, 'like', condition);
              }
            });
          });
          break;

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          // Custom filter
          fieldDef.applyFilter.call(this, this, filterValue);
          break;

        default:
          // Standard filtering
          const actualField = fieldDef.actualField || filterKey;
          // Always qualify field names
          const dbField = qualifyField(actualField);

          const operator = fieldDef.filterUsing || '=';

          switch (operator) {
            case 'like':
              this.where(dbField, 'like', `%${filterValue}%`);
              break;
            case 'in':
              if (Array.isArray(filterValue)) {
                this.whereIn(dbField, filterValue);
              } else {
                this.where(dbField, operator, filterValue);
              }
              break;
            case 'between':
              if (Array.isArray(filterValue) && filterValue.length === 2) {
                this.whereBetween(dbField, filterValue);
              } else {
                this.where(dbField, operator, filterValue);
              }
              break;
            default:
              this.where(dbField, operator, filterValue);
              break;
          }
          break;
      }
    }
  });
};