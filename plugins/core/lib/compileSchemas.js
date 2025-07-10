import CreateSchema from 'json-rest-schema';
import { ensureSearchFieldsAreIndexed, generateSearchSchemaFromSchema } from './schemaHelpers.js';

/**
 * Compiles and enriches schemas for a given scope.
 * This function must be called at the beginning of each REST method to ensure
 * schemas are processed and cached before use.
 * 
 * The compilation process:
 * 1. Clones the raw schema to avoid mutations
 * 2. Adds default type: 'id' to belongsTo fields
 * 3. Runs schema:enrich hooks for custom enrichment
 * 4. Creates schema objects using json-rest-schema
 * 5. Generates and enriches searchSchema if needed
 * 6. Caches all compiled schemas for the scope
 * 
 * @param {Object} scope - The scope object containing vars, runHooks, scopeOptions, etc.
 * @returns {Promise<void>} Resolves when schemas are compiled
 * 
 * @example
 * // At the beginning of a REST method:
 * import { compileSchemas } from './lib/compileSchemas.js';
 * 
 * addScopeMethod('query', async (scope, params) => {
 *   await compileSchemas(scope);
 *   const schemaInfo = await scope.getSchemaInfo();
 *   // ... rest of the method
 * });
 */
export async function compileSchemas(scope) {
  if (scope.vars.schemaProcessed) {
    return; // Already compiled
  }
  
  // Get raw schema
  const rawSchema = scope.scopeOptions.schema || {};
  
  // Deep clone schema while preserving functions
  const enrichedSchema = {};
  for (const [fieldName, fieldDef] of Object.entries(rawSchema)) {
    enrichedSchema[fieldName] = { ...fieldDef };
  }
  
  // Default enrichment: Add type to belongsTo fields
  for (const [fieldName, fieldDef] of Object.entries(enrichedSchema)) {
    if (fieldDef.belongsTo && !fieldDef.type) {
      fieldDef.type = 'id';
    }
  }
  
  // Hook: schema:enrich
  const schemaContext = {
    schema: enrichedSchema,    // Mutable
    originalSchema: rawSchema,  // Read-only
    scopeName: scope.scopeName
  };
  await scope.runHooks('schema:enrich', schemaContext);
  
  // Create schema object
  const schemaObject = CreateSchema(schemaContext.schema);
  
  // Generate searchSchema
  let rawSearchSchema = scope.scopeOptions.searchSchema ||
  generateSearchSchemaFromSchema(schemaContext.schema);
  
  if (rawSearchSchema) {
    // Ensure all search fields are indexed
    ensureSearchFieldsAreIndexed(rawSearchSchema);
    
    // Hook: searchSchema:enrich
    const searchSchemaContext = {
      searchSchema: rawSearchSchema,    // Mutable
      schema: schemaContext.schema,     // Read-only enriched schema
      scopeName: scope.scopeName
    };
    await scope.runHooks('searchSchema:enrich', searchSchemaContext);
    
    // Create searchSchema object
    var searchSchemaObject = CreateSchema(searchSchemaContext.searchSchema);
  } else {
    var searchSchemaObject = null;
  }
  
  // Cache everything
  scope.vars.schema = {
    schema: schemaObject,
    searchSchema: searchSchemaObject,
    relationships: scope.scopeOptions.relationships || {}
  };
  
  scope.vars.schemaProcessed = true;
}