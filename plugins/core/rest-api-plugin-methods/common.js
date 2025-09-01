import { 
  RestApiValidationError, 
  RestApiPayloadError 
} from '../../../lib/rest-api-errors.js';
import { transformSimplifiedToJsonApi } from '../lib/querying-writing/simplified-helpers.js';
import { createEnhancedLogger } from '../../../lib/enhanced-logger.js';

/**
 * Gets an enhanced logger instance with full error details and stack traces
 * @param {Object} log - The base logger instance
 * @returns {Object} Enhanced logger instance
 */
export const getEnhancedLogger = (log) => {
  return createEnhancedLogger(log, { 
    logFullErrors: true, 
    includeStack: true 
  });
};

/**
 * Cascades configuration values through multiple sources with fallback to default
 * @param {string} settingName - The setting name to look for
 * @param {Array} sources - Array of objects to search through
 * @param {*} defaultValue - Default value if not found
 * @returns {*} The first defined value found or the default
 */
export const cascadeConfig = (settingName, sources, defaultValue) =>
  sources.find(source => source?.[settingName] !== undefined)?.[settingName] ?? defaultValue;

/**
 * Normalizes return record settings to valid values
 * @param {string|boolean} value - The value to normalize
 * @returns {string} Normalized value: 'no', 'minimal', or 'full'
 */
export function normalizeReturnValue(value) {
  if (['no', 'minimal', 'full'].includes(value)) return value;
  return 'no'; // default
}

/**
 * Sets up common request context for REST API methods
 * Handles simplified mode, transaction setup, and initial validation
 * 
 * @param {Object} params - The method parameters
 * @param {Object} context - The request context
 * @param {Object} vars - Plugin variables
 * @param {Object} scopes - All available scopes
 * @param {Object} scopeOptions - Scope-specific options
 * @param {string} scopeName - The name of the current scope
 * @param {Object} api - The API instance
 * @param {Object} helpers - Helper functions
 * @returns {Object} An object containing schema-related shortcuts
 */
export async function setupCommonRequest({ params, context, vars, scopes, scopeOptions, scopeName, api, helpers }) {
  // Determine which simplified setting to use based on transport
  const isTransport = params.isTransport === true;
  
  // Use vars which automatically cascade from scope to global
  const defaultSimplified = isTransport ? vars.simplifiedTransport : vars.simplifiedApi;
  
  // Get simplified setting - from params only (per-call override) or use default
  context.simplified = params.simplified !== undefined ? params.simplified : defaultSimplified;
  
  // Special case: if no inputRecord provided, force simplified mode
  if (!params.inputRecord && context.simplified === false) {
    context.simplified = true;
  }

  // Params is totally bypassed in simplified mode
  if (context.simplified) {
    if (params.inputRecord) {
      context.inputRecord = params.inputRecord;
      context.params = params;
    } else {
      context.inputRecord = params;
      // Preserve returnFullRecord if specified in params
      context.params = params.returnFullRecord ? { returnFullRecord: params.returnFullRecord } : {};
    }
  } else {
    context.inputRecord = params.inputRecord;
    context.params = params;
  }

  // Assign common context properties
  context.schemaInfo = scopes[scopeName].vars.schemaInfo;
  
  // Use vars which automatically cascade from scope to global
  const defaultReturnFullRecord = isTransport ? vars.returnRecordTransport : vars.returnRecordApi;
  
  // Get return record setting - from params only (per-call override) or use default
  const returnFullRecordRaw = context.params.returnFullRecord !== undefined 
    ? context.params.returnFullRecord 
    : defaultReturnFullRecord;
  
  // Normalize return record setting to always be an object with method keys
  if (typeof returnFullRecordRaw === 'object' && returnFullRecordRaw !== null) {
    // It's already an object, normalize the values
    context.returnRecordSetting = {
      post: normalizeReturnValue(returnFullRecordRaw.post),
      put: normalizeReturnValue(returnFullRecordRaw.put),
      patch: normalizeReturnValue(returnFullRecordRaw.patch)
    };
  } else {
    // It's a single value (string or boolean), apply to all methods
    const normalized = normalizeReturnValue(returnFullRecordRaw);
    context.returnRecordSetting = {
      post: normalized,
      put: normalized,
      patch: normalized
    };
  }
  
  // Helper function to normalize return values (same as above)
  function normalizeReturnValue(value) {
    if (['no', 'minimal', 'full'].includes(value)) return value;
    return 'no'; // default
  }

  // These only make sense as parameter per query, not in vars etc.
  context.queryParams = params.queryParams || {};
  context.queryParams.fields = cascadeConfig('fields', [context.queryParams], {});
  context.queryParams.include = cascadeConfig('include', [context.queryParams], []);

  context.scopeName = scopeName;

  // Transaction handling
  context.transaction = params.transaction || 
    (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
  context.shouldCommit = !params.transaction && !!context.transaction;
  context.db = context.transaction || api.knex.instance;

  // These are just shortcuts used in this function and will be returned
  const schema = context.schemaInfo.schemaInstance;
  const schemaStructure = context.schemaInfo.schemaInstance.structure;
  const schemaRelationships = context.schemaInfo.schemaRelationships;

  // Transform input if in simplified mode
  if (context.simplified) {
    context.inputRecord = transformSimplifiedToJsonApi(
      { inputRecord: context.inputRecord },
      { context: { scopeName, schemaStructure, schemaRelationships } }
    );
  } else {
    // Strict mode: validate no belongsTo fields in attributes
    if (context.inputRecord?.data?.attributes) {
      for (const [key, fieldDef] of Object.entries(schemaStructure)) {
        if (fieldDef.belongsTo && key in context.inputRecord.data.attributes) {
          throw new RestApiValidationError(
            `Field '${key}' is a foreign key and must be set via relationships, not attributes`,
            { fields: [`data.attributes.${key}`] }
          );
        }
      }
    }
  }

  if (context.inputRecord.data.type !== scopeName) {
    throw new RestApiValidationError(
      `Resource type mismatch. Expected '${scopeName}' but got '${context.inputRecord.data.type}'`,
      { 
        fields: ['data.type'], 
        violations: [{ 
          field: 'data.type', 
          rule: 'resource_type_match', 
          message: `Resource type must be '${scopeName}'` 
        }] 
      }
    );
  }

  // Remove included validation since JSON:API doesn't support it
  if (context.inputRecord.included) {
    throw new RestApiPayloadError(
      context.method + ' requests cannot include an "included" array. JSON:API does not support creating multiple resources in a single request.',
      { path: 'included', expected: 'undefined', received: 'array' }
    );
  }

  // If both URL path ID and request body ID are provided, they must match
  // Convert both to strings for comparison since databases may return numeric IDs
  if (context.id && context.inputRecord.data.id && String(context.id) !== String(context.inputRecord.data.id)) {
    throw new RestApiValidationError(
      `ID mismatch. URL path ID '${context.id}' does not match request body ID '${context.inputRecord.data.id}'`,
      { 
        fields: ['data.id'], 
        violations: [{ 
          field: 'data.id', 
          rule: 'id_consistency', 
          message: `Request body ID must match URL path ID when both are provided` 
        }] 
      }
    );
  }

  // Return key schema-related objects for direct use in the main methods
  return { schema, schemaStructure, schemaRelationships };
}

/**
 * Handles error cleanup and logging for write methods (POST, PUT, PATCH)
 * 
 * @param {Error} error - The error that was caught
 * @param {Object} context - The request context
 * @param {string} method - The HTTP method name (POST, PUT, PATCH)
 * @param {string} scopeName - The name of the resource scope
 * @param {Object} log - The logger instance
 * @param {Function} runHooks - Function to run hooks
 * @throws {Error} Re-throws the original error after cleanup
 */
export const handleWriteMethodError = async (error, context, method, scopeName, log, runHooks) => {
  // Rollback transaction if we created it
  if (context.shouldCommit) {
    await context.transaction.rollback();
    await runHooks('afterRollback');
  }
  
  // Create enhanced logger for error logging
  const enhancedLog = getEnhancedLogger(log);
  
  // Log the full error details
  enhancedLog.logError(`Error in ${method} method`, error, {
    scopeName,
    method: method.toLowerCase(),
    inputRecord: context.inputRecord
  });
  
  throw error;
}

/**
 * Validates that a pivot resource exists for many-to-many relationships
 * 
 * @param {Object} scopes - All available scopes/resources
 * @param {Object} relDef - The relationship definition
 * @param {string} relName - The relationship name
 * @throws {RestApiValidationError} If the pivot resource doesn't exist
 */
export const validatePivotResource = (scopes, relDef, relName) => {
  if (!scopes[relDef.through]) {
    throw new RestApiValidationError(
      `Pivot resource '${relDef.through}' not found for relationship '${relName}'`,
      { 
        fields: [`relationships.${relName}`],
        violations: [{
          field: `relationships.${relName}`,
          rule: 'missing_pivot_resource',
          message: `Pivot resource '${relDef.through}' must be defined`
        }]
      }
    );
  }
}

/**
 * Gets the appropriate hook suffix based on HTTP method
 * 
 * @param {string} method - The HTTP method (e.g., 'post', 'get')
 * @returns {string} The capitalized method name for hook naming
 */
export const getMethodHookSuffix = (method) => {
  return method.charAt(0).toUpperCase() + method.slice(1);
}

/**
 * Validates resource attributes before write operations
 * 
 * @param {Object} params - Validation parameters
 * @param {Object} params.context - The request context
 * @param {Object} params.schema - The resource schema
 * @param {Object} params.belongsToUpdates - BelongsTo relationship updates
 * @param {Function} params.runHooks - Function to run hooks
 * @param {boolean} params.isPartialValidation - Whether this is partial validation (for PATCH)
 * @throws {RestApiValidationError} If validation fails
 */
export const validateResourceAttributesBeforeWrite = async ({ 
  context, 
  schema, 
  belongsToUpdates, 
  runHooks, 
  isPartialValidation = false
}) => {
  // Dynamically get the method suffix
  const methodSpecificHookSuffix = getMethodHookSuffix(context.method);

  await runHooks('beforeSchemaValidate');
  await runHooks(`beforeSchemaValidate${methodSpecificHookSuffix}`);

  // Store original input attributes before validation adds defaults (primarily for POST)
  // Only if it's not already set and the current method is POST
  if (!context.originalInputAttributes && context.method === 'post') {
      context.originalInputAttributes = { ...(context.inputRecord.data.attributes || {}) };
  }
  
  // Merge belongsTo updates with attributes for validation
  const attributesToValidate = {
      ...context.inputRecord.data.attributes,
      ...belongsToUpdates
  };
  
  // Extract computed fields before validation (they should be rejected)
  const computedFields = {};
  const schemaStructure = context.schemaInfo.schemaStructure || {};
  Object.entries(attributesToValidate).forEach(([key, value]) => {
    const fieldDef = schemaStructure[key];
    // Computed fields should be stripped from input
    if (fieldDef && fieldDef.computed === true && value !== undefined) {
      computedFields[key] = value;
    }
  });
  
  // Warn if computed fields were sent in the input
  if (Object.keys(computedFields).length > 0) {
    const fieldNames = Object.keys(computedFields).join(', ');
    console.warn(`Computed fields [${fieldNames}] were sent in input for resource '${context.scopeName}' but will be ignored as they are output-only`);
  }
  
  // Filter out ONLY computed fields from validation
  // Virtual fields MUST go through validation
  const attributesForValidation = Object.entries(attributesToValidate)
    .filter(([key, _]) => {
      const fieldDef = schemaStructure[key];
      return !fieldDef || fieldDef.computed !== true;
    })
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});

  const validationOptions = isPartialValidation ? { onlyObjectValues: true } : {};

  const { validatedObject, errors } = await schema.validate(attributesForValidation, validationOptions);

  if (Object.keys(errors).length > 0) {
    // --- START OF MODIFICATION ---
    const schemaStructure = context.schemaInfo.schemaInstance.structure; // Get the schema structure for lookup

    const violations = Object.entries(errors).map(([field, error]) => {
    let fieldPath = `data.attributes.${field}`; // Default path for attributes

    // Check if this field is a foreign key that has an 'as' alias
    const fieldDef = schemaStructure[field];
    if (fieldDef && fieldDef.belongsTo && fieldDef.as) {
      // If it's a belongsTo field with an alias, rewrite the path to the relationship alias
      fieldPath = `data.relationships.${fieldDef.as}.data.id`;
    }
    // For many-to-many relationships, the original `transformSimplifiedToJsonApi`
    // already puts them under `relationships.relName.data`, so `field` here
    // would already be the relationship name, not a foreign key.
    // However, if a validation error somehow slips through for a pivot table field
    // that doesn't have an 'as' alias but is a foreign key, you might need
    // more sophisticated mapping. For now, this covers belongsTo.

    return {
      field: fieldPath,
      rule: error.code || 'invalid_value',
      message: error.message
    };
      });
      // --- END OF MODIFICATION ---

      throw new RestApiValidationError(
          'Schema validation failed for resource attributes',
          { 
              fields: violations.map(v => v.field), // Use the potentially rewritten fields
              violations
          }
      );
  }
  
  // Update attributes with validated values
  // Virtual fields have now been validated and cast properly
  context.inputRecord.data.attributes = validatedObject;

  await runHooks(`afterSchemaValidate${methodSpecificHookSuffix}`);
  await runHooks('afterSchemaValidate');
}

/**
 * Validates that the user has access to all resources referenced in relationships
 * 
 * @param {object} context - The context object containing authentication info
 * @param {object} inputRecord - The input record containing relationships to validate
 * @param {object} helpers - Data helpers including dataGetMinimal
 * @param {function} runHooks - Function to run hooks
 * @param {object} api - API instance to access resources
 * @throws {Error} If user doesn't have access to any related resource
 */
export const validateRelationshipAccess = async (context, inputRecord, helpers, runHooks, api) => {
  if (!inputRecord?.data?.relationships) return;
  
  for (const [relName, relData] of Object.entries(inputRecord.data.relationships)) {
    if (!relData?.data) continue;
    
    // Handle both single and array relationships
    const relatedItems = Array.isArray(relData.data) ? relData.data : [relData.data];
    
    for (const item of relatedItems) {
      // Get the scope for the related resource
      const relatedScope = api.resources[item.type];
      if (!relatedScope) {
        throw new Error(`Unknown resource type: ${item.type}`);
      }
      
      // Create context for dataGetMinimal
      const getContext = {
        ...context,
        id: item.id,
        schemaInfo: relatedScope.vars.schemaInfo,
        scopeName: item.type,
        method: 'get', // We're checking read permission
        isUpdate: false
      };

  
      // Get the minimal record
      const record = await helpers.dataGetMinimal({ 
        scopeName: item.type, 
        context: getContext,
        runHooks 
      });
      
      if (!record) {
        throw new Error(`Cannot create relationship to non-existent ${item.type} with id ${item.id}`);
      }
      
      // Check permissions using the related scope's checkPermissions
      await relatedScope.checkPermissions({
        method: 'get',
        auth: context.auth,
        id: item.id,
        minimalRecord: record,
        transaction: context.transaction
      });
    }
  }
}

/**
 * Applies field setters to transform attribute values before storage
 * Setters are applied in dependency order to handle interdependent fields
 * 
 * @param {object} attributes - The validated attributes to transform
 * @param {object} schemaInfo - Schema information including fieldSetters
 * @param {object} context - The request context
 * @param {object} api - The API instance
 * @param {object} helpers - Helper functions
 * @returns {object} Transformed attributes ready for storage
 */
export const applyFieldSetters = async (attributes, schemaInfo, context, api, helpers) => {
  const fieldSetters = schemaInfo.fieldSetters || {};
  const sortedSetterFields = schemaInfo.sortedSetterFields || [];
  
  // No setters to apply
  if (sortedSetterFields.length === 0) {
    return attributes;
  }
  
  let transformedAttributes = { ...attributes };
  
  for (const fieldName of sortedSetterFields) {
    // Only process fields that exist in the attributes
    if (fieldName in transformedAttributes) {
      const setterInfo = fieldSetters[fieldName];
      try {
        const setterContext = {
          attributes: transformedAttributes, // Current state with previous setters applied
          fieldName,
          originalValue: attributes[fieldName],
          originalAttributes: attributes,
          scopeName: context.scopeName,
          method: context.method,
          api,
          helpers,
          auth: context.auth
        };
        transformedAttributes[fieldName] = await setterInfo.setter(
          transformedAttributes[fieldName],
          setterContext
        );
      } catch (error) {
        console.warn(`Setter for field '${fieldName}' failed:`, error);
        // Keep original value if setter fails
      }
    }
  }
  
  return transformedAttributes;
}

export async function handleRecordReturnAfterWrite({
    context,
    scopeName,
    api,
    scopes,
    schemaStructure,
    schemaRelationships,
    scopeOptions,
    vars,
    runHooks,
    helpers,
    log
}) {
    // Create enhanced logger for warnings
    const enhancedLog = getEnhancedLogger(log);
    const methodSpecificHookSuffix = getMethodHookSuffix(context.method);
    
    // Step 1: Set up record state for hooks
    // Handle originalMinimalRecord and minimalRecord based on method type
    if (context.method === 'DELETE') {
        // For DELETE, keep the deleted record reference
        if (context.minimalRecord) {
            context.originalMinimalRecord = context.minimalRecord;
        }
    } else {
        // For POST, PUT, PATCH - save the original state if it exists
        if (context.minimalRecord) {
            context.originalMinimalRecord = context.minimalRecord;
        }
        
        // Fetch the current state of the record after the write operation
        try {
            const currentRecord = await helpers.dataGetMinimal({
                scopeName,
                context,
                runHooks
            });
            context.minimalRecord = currentRecord;
        } catch (error) {
            enhancedLog.warn(`Could not fetch minimal record after ${context.method} operation`, { error, id: context.id });
        }
    }

    // Step 2: Determine what to return based on configuration
    const returnMode = context.returnRecordSetting[context.method];
    
    // Case 1: Return nothing (204 No Content)
    if (returnMode === 'no') {
        context.responseRecord = undefined;
        await runHooks('finish');
        await runHooks(`finish${methodSpecificHookSuffix}`);
        return undefined;
    }
    
    // Case 2: Return minimal record (just type and id)
    if (returnMode === 'minimal') {
        if (context.simplified) {
            context.responseRecord = { 
                id: String(context.id), 
                type: scopeName 
            };
        } else {
            context.responseRecord = {
                data: {
                    type: scopeName,
                    id: String(context.id)
                }
            };
        }
        await runHooks('finish');
        await runHooks(`finish${methodSpecificHookSuffix}`);
        return context.responseRecord;
    }
    
    // Case 3: Return full record
    if (returnMode === 'full') {
        // Fetch the complete record using the GET method
        const fullRecord = await api.resources[scopeName].get({
            id: context.id,
            queryParams: context.queryParams,
            transaction: context.transaction,
            simplified: context.simplified
        }, {...context });
        
        context.responseRecord = fullRecord || undefined;
        
        // Run finish hooks
        await runHooks('finish');
        await runHooks(`finish${methodSpecificHookSuffix}`);
        
        // No transformation needed - GET already returns the correct format
        // based on context.simplified
        return context.responseRecord;
    }
    
    // This should never be reached, but just in case
    throw new Error(`Invalid returnMode: ${returnMode}`);
}

export const findRelationshipDefinition = (schemaInfo, relationshipName) => {
  // First check schemaRelationships (for relationships defined in relationships object)
  const relDef = schemaInfo.schemaRelationships?.[relationshipName];
  if (relDef) {
    return relDef;
  }
  
  // Then check schema fields for belongsTo relationships with matching 'as' property
  for (const [fieldName, fieldDef] of Object.entries(schemaInfo.schemaStructure || {})) {
    if (fieldDef.as === relationshipName && fieldDef.belongsTo) {
      return fieldDef;
    }
  }
  
  return null;
};

