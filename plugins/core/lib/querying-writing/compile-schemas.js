import { createSchema } from 'json-rest-schema';
import { ensureSearchFieldsAreIndexed, generateSearchSchemaFromSchema, sortFieldsByDependencies } from './schema-helpers.js';

/**
 * Compiles and enriches schemas for a resource scope
 * 
 * @param {Object} scope - Scope containing raw schema options
 * @param {Object} deps - Dependencies with context and hooks
 * @returns {Promise<void>} Resolves when compilation complete
 * 
 * @example
 * // Input: Raw schema with computed field
 * const rawFields = {
 *   title: { type: 'string', required: true },
 *   content: { type: 'string' },
 *   author_id: { belongsTo: 'users', as: 'author' },  // Missing type
 *   word_count: { 
 *     type: 'number', 
 *     computed: true,
 *     compute: (record) => record.content.split(' ').length
 *   }
 * };
 * 
 * await compileSchemas(scope, deps);
 * 
 * // Output in scope.vars.schemaInfo:
 * // {
 * //   schema: Schema {},           // json-rest-schema instance
 * //   schemaStructure: {
 * //     title: { type: 'string', required: true },
 * //     content: { type: 'string' },
 * //     author_id: { type: 'id', belongsTo: 'users', as: 'author' }  // Type added!
 * //     // Note: word_count removed (it's computed)
 * //   },
 * //   computed: {
 * //     word_count: { type: 'number', computed: true, compute: [Function] }
 * //   }
 * // }
 * 
 * @example
 * // Input: Schema with search fields
 * const rawFields = {
 *   title: { type: 'string', search: true },    // Searchable
 *   status: { type: 'string' },                 // Not searchable
 *   author_id: { belongsTo: 'users', as: 'author' }
 * };
 * 
 * // Output: Auto-generated searchSchema
 * // searchSchemaObject contains:
 * // {
 * //   title: { 
 * //     type: 'string', 
 * //     indexed: true,        // Added for DB optimization
 * //     filterOperator: '='   // Default operator
 * //   }
 * // }
 * 
 * @example
 * // Input: Pivot table auto-detection
 * const pivotSchema = {
 *   article_id: { belongsTo: 'articles', as: 'article' },
 *   tag_id: { belongsTo: 'tags', as: 'tag' },
 *   display_order: { type: 'number' }
 * };
 * 
 * // Output: Both foreign keys become searchable
 * // schemaStructure will have:
 * // {
 * //   article_id: { type: 'id', belongsTo: 'articles', as: 'article', search: true },
 * //   tag_id: { type: 'id', belongsTo: 'tags', as: 'tag', search: true },
 * //   display_order: { type: 'number' }
 * // }
 * // This enables efficient many-to-many filtering!
 * 
 * @example  
 * // Input: Schema with dependent getters
 * const schema = {
 *   first_name: { type: 'string' },
 *   last_name: { type: 'string' },
 *   full_name: {
 *     type: 'string',
 *     getter: (record) => `${record.first_name} ${record.last_name}`,
 *     runGetterAfter: ['first_name', 'last_name']  // Dependencies
 *   },
 *   email: {
 *     type: 'string',
 *     setter: (value) => value.toLowerCase().trim()
 *   }
 * };
 * 
 * // Output includes dependency-sorted fields:
 * // {
 * //   fieldGetters: { full_name: { getter: [Function], runGetterAfter: [...] } },
 * //   sortedGetterFields: ['full_name'],    // Topologically sorted
 * //   fieldSetters: { email: { setter: [Function], runSetterAfter: [] } },
 * //   sortedSetterFields: ['email']
 * // }
 * 
 * @description
 * Used by:
 * - Every REST method calls this before any operations
 * - Compilation happens once per scope (cached)
 * 
 * Purpose:
 * - Separates computed fields from database fields
 * - Adds missing types to belongsTo relationships
 * - Auto-detects pivot tables for many-to-many
 * - Generates search schemas from field markers
 * - Validates getter/setter dependencies
 * - Provides hooks for schema enrichment
 * - Caches everything for performance
 * 
 * Data flow:
 * 1. Extracts computed fields to separate object
 * 2. Adds type:'id' to belongsTo fields
 * 3. Detects pivot tables (2+ foreign keys, 40%+ of fields)
 * 4. Runs schema:enrich hook for plugins
 * 5. Creates json-rest-schema validation instance
 * 6. Generates searchSchema from search:true fields
 * 7. Runs searchSchema:enrich hook
 * 8. Extracts and topologically sorts getters/setters
 * 9. Caches all results in scope.vars.schemaInfo
 */
export async function compileSchemas(scope, deps) {
  // Extract scopeName from context
  const { context, runHooks } = deps;
  const scopeName = context.scopeName;

  // Get raw schema
  const rawFields = scope.scopeOptions?.schema || {};
  
  // Extract computed fields from schema and build enriched schema
  const computedFields = {};
  const enrichedFields = {};
  
  for (const [fieldName, fieldDef] of Object.entries(rawFields)) {
    if (fieldDef.computed === true) {
      // Extract computed field - copy entire definition
      computedFields[fieldName] = { ...fieldDef };
      
      // Validate computed field
      if (!fieldDef.type) {
        throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' must have a type`);
      }
      
      if (fieldDef.compute && typeof fieldDef.compute !== 'function') {
        throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' has invalid compute function`);
      }
      
      // Don't include computed fields in the validation schema
    } else {
      enrichedFields[fieldName] = { ...fieldDef };
    }
  }
  
  // Default enrichment: Add type to belongsTo fields
  for (const [fieldName, fieldDef] of Object.entries(enrichedFields)) {
    if (fieldDef.belongsTo && !fieldDef.type) {
      fieldDef.type = 'id';
    }
  }
  
  // ADD LOGIC TO MAKE FIELDS SEARCHABLE HERE
  // Auto-detect pivot tables and make their foreign key fields searchable
  // This is critical for many-to-many relationship operations which need to filter pivot records
  const fields = Object.entries(enrichedFields);
  const belongsToFields = fields.filter(([_, def]) => def.belongsTo);
  
  // If 2+ belongsTo fields and they make up 40%+ of non-id fields, likely a pivot table
  const nonIdFields = fields.filter(([name, _]) => name !== 'id');
  const isProbablyPivot = belongsToFields.length >= 2 && 
    (nonIdFields.length === 0 || belongsToFields.length / nonIdFields.length >= 0.4);
  
  if (isProbablyPivot) {
    // Make all belongsTo fields searchable for pivot operations
    for (const [fieldName, fieldDef] of belongsToFields) {
      if (!fieldDef.search) {
        fieldDef.search = true;
      }
    }
  }


  // Hook: schema:enrich
  const schemaContext = {
    fields: enrichedFields,    // Mutable
    originalFields: rawFields,  // Read-only
    scopeName
  };
  await runHooks('schema:enrich', schemaContext);
  
  // Create schema object
  const schemaObject = createSchema(schemaContext.fields);
  
  // Generate searchSchema by merging explicit searchSchema with fields marked search:true.
  // This allows two ways to define searchable fields: either mark fields with search:true
  // in the main schema, or provide an explicit searchSchema with more control over filtering.
  // The explicit searchSchema takes precedence when there are conflicts - it can override
  // fields marked with search:true. Fields with search:true that are NOT in the explicit
  // searchSchema will be added automatically.
  // Example: title: {search: true} auto-generates a searchable field with sensible defaults,
  // while searchSchema can specify filterOperator: 'contains' or complex join configurations.
  let rawSearchFields = generateSearchSchemaFromSchema(
    schemaContext.fields,
    scope.scopeOptions.searchSchema
  );
  
  if (rawSearchFields) {
    // Mark all search fields as indexed for database optimization.
    // This ensures that any field used for filtering will have a database index created,
    // dramatically improving query performance. Without indexes, filtering large tables
    // would require full table scans. The storage plugin uses these hints to create indexes.
    // Example: A status field marked for search gets indexed: true, enabling efficient
    // WHERE status = 'published' queries that can use index lookups instead of scanning all rows.
    ensureSearchFieldsAreIndexed(rawSearchFields);
    
    // Hook: searchSchema:enrich
    const searchSchemaContext = {
      fields: schemaContext.fields,       // Mutable
      originalFields: rawSearchFields,    // Read-only enriched schema
      scopeName
    };
    await runHooks('searchSchema:enrich', searchSchemaContext);
    
    // Create searchSchema object
    var searchSchemaObject = createSchema(rawSearchFields);
  } else {
    var searchSchemaObject = createSchema({});
  }

  // Build schemaRelationships including polymorphic fields from schema
  const schemaRelationships = { ...(scope.scopeOptions.relationships || {}) };
  
  // Validate belongsTo fields
  for (const [fieldName, fieldDef] of Object.entries(schemaContext.fields)) {
    // Validate that belongsTo fields have 'as' property
    if (fieldDef.belongsTo && !fieldDef.as) {
      throw new Error(
        `Field '${fieldName}' in resource '${scopeName}' has belongsTo: '${fieldDef.belongsTo}' but is missing the required 'as' property. ` +
        `The 'as' property defines the relationship name used in JSON:API payloads. ` +
        `Example: ${fieldName}: { type: 'number', belongsTo: '${fieldDef.belongsTo}', as: '${fieldName.replace(/_id$/, '')}' }`
      );
    }
  }

  // Extract and validate getter definitions
  const fieldGetters = {};
  const getterFields = [];
  
  for (const [fieldName, fieldDef] of Object.entries(schemaContext.fields)) {
    if (fieldDef.getter && typeof fieldDef.getter === 'function') {
      fieldGetters[fieldName] = {
        getter: fieldDef.getter,
        runGetterAfter: fieldDef.runGetterAfter || [],
        fieldDef: fieldDef
      };
      getterFields.push(fieldName);
      
      // Validate dependencies exist
      if (fieldDef.runGetterAfter && Array.isArray(fieldDef.runGetterAfter)) {
        for (const dep of fieldDef.runGetterAfter) {
          if (!schemaContext.fields[dep]) {
            throw new Error(
              `Field '${fieldName}' in resource '${scopeName}' has getter dependency '${dep}' that does not exist in schema`
            );
          }
        }
      }
    }
  }
  
  // Sort getters by dependencies
  let sortedGetterFields = [];
  if (Object.keys(fieldGetters).length > 0) {
    try {
      sortedGetterFields = sortFieldsByDependencies(fieldGetters, 'runGetterAfter');
    } catch (error) {
      throw new Error(`Invalid getter dependencies in ${scopeName}: ${error.message}`);
    }
  }

  // Extract and validate setter definitions
  const fieldSetters = {};
  const setterFields = [];
  
  for (const [fieldName, fieldDef] of Object.entries(schemaContext.fields)) {
    if (fieldDef.setter && typeof fieldDef.setter === 'function') {
      fieldSetters[fieldName] = {
        setter: fieldDef.setter,
        runSetterAfter: fieldDef.runSetterAfter || [],
        fieldDef: fieldDef
      };
      setterFields.push(fieldName);
      
      // Validate dependencies exist
      if (fieldDef.runSetterAfter && Array.isArray(fieldDef.runSetterAfter)) {
        for (const dep of fieldDef.runSetterAfter) {
          if (!schemaContext.fields[dep]) {
            throw new Error(
              `Field '${fieldName}' in resource '${scopeName}' has setter dependency '${dep}' that does not exist in schema`
            );
          }
        }
      }
    }
  }
  
  // Sort setters by dependencies
  let sortedSetterFields = [];
  if (Object.keys(fieldSetters).length > 0) {
    try {
      sortedSetterFields = sortFieldsByDependencies(fieldSetters, 'runSetterAfter');
    } catch (error) {
      throw new Error(`Invalid setter dependencies in ${scopeName}: ${error.message}`);
    }
  }

  // Cache everything
  scope.vars.schemaInfo = {

    schemaInstance: schemaObject,
    searchSchemaInstance: searchSchemaObject,

    // schema: schemaObject,
    schemaStructure: schemaObject.structure,
    searchSchemaStructure: searchSchemaObject.structure,
       
    computed: computedFields,
    schemaRelationships: schemaRelationships,
    tableName: scope.scopeOptions.tableName || scopeName,
    idProperty: scope.scopeOptions.idProperty || scope.vars.idProperty,
    fieldGetters: fieldGetters,
    sortedGetterFields: sortedGetterFields,
    fieldSetters: fieldSetters,
    sortedSetterFields: sortedSetterFields
  };  
}