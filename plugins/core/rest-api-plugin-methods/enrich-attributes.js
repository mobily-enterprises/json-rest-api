import { filterHiddenFields } from '../lib/querying-writing/field-utils.js'

/**
 * enrichAttributes
 * Runs the enrichAttributes hook for a specific scope to allow plugins to modify attributes
 * before they are returned to the client. This is a scope method so each resource type
 * can have its own attribute enrichment logic.
 *
 *
 */
export default async function enrichAttributesMethod ({ context, params, runHooks, scopeName, scopes, api, helpers }) {
  // Extract parameters passed to enrichAttributes
  // - attributes: The raw attributes from database
  // - parentContext: The context from the calling method (has queryParams, transaction, etc.)
  // - requestedComputedFields: Which computed fields to calculate (from sparse fieldsets)
  // - isMainResource: Whether this is the main resource or an included one
  // - computedDependencies: Fields fetched only for computation (to be removed)
  // Extract parameters passed to enrichAttributes
  // - attributes: The raw attributes from database
  // - parentContext: The context from the calling method (has queryParams, transaction, etc.)
  // - requestedComputedFields: Which computed fields to calculate (from sparse fieldsets)
  // - isMainResource: Whether this is the main resource or an included one
  // - computedDependencies: Fields fetched only for computation (to be removed)
  const { attributes, parentContext, requestedComputedFields, isMainResource, computedDependencies } = params || {}

  // Return empty object if no attributes provided
  if (!attributes) {
    return {}
  }

  // Get schema, computed field definitions
  const schemaStructure = scopes[scopeName]?.vars?.schemaInfo?.schemaStructure || {}
  const computedFields = scopes[scopeName]?.vars?.schemaInfo?.computed || {}
  const fieldGetters = scopes[scopeName]?.vars?.schemaInfo?.fieldGetters || {}
  const sortedGetterFields = scopes[scopeName]?.vars?.schemaInfo?.sortedGetterFields || []

  // Make a copy of attributes for transformation
  const transformedAttributes = { ...attributes }

  // STEP 1: Apply field getters in dependency order (before filtering)
  // This ensures getters see all fields including hidden ones
  for (const fieldName of sortedGetterFields) {
    // Only process if field exists in attributes
    if (fieldName in transformedAttributes) {
      const getterInfo = fieldGetters[fieldName]
      try {
        const getterContext = {
          attributes: transformedAttributes, // Current state with previous getters applied
          fieldName,
          originalValue: attributes[fieldName], // Original untransformed value
          originalAttributes: attributes, // All original attributes
          record: transformedAttributes, // Alias for compatibility
          parentContext,
          scopeName,
          api,
          helpers,
          isMainResource: isMainResource !== false
        }

        // Apply getter (can be async)
        transformedAttributes[fieldName] = await getterInfo.getter(
          transformedAttributes[fieldName],
          getterContext
        )
      } catch (error) {
        console.error(`Error in getter for field '${fieldName}' in ${scopeName}:`, error)
        // Keep current value on error (don't break the whole request)
      }
    }
  }

  // Filter hidden fields from attributes based on visibility rules
  // This removes hidden:true fields and normallyHidden:true fields (unless requested)
  const requestedFields = parentContext?.queryParams?.fields?.[scopeName]
  const filteredAttributes = filterHiddenFields(transformedAttributes, { structure: schemaStructure }, requestedFields)

  // Handle virtual fields - they need to be added from parent context if available
  // Virtual fields come from input and need to be preserved in responses
  if (parentContext && parentContext.inputRecord?.data?.attributes) {
    const inputAttrs = parentContext.inputRecord.data.attributes
    Object.entries(schemaStructure).forEach(([fieldName, fieldDef]) => {
      if (fieldDef.virtual === true && fieldName in inputAttrs && inputAttrs[fieldName] !== undefined && inputAttrs[fieldName] !== null) {
        // Add virtual field to filtered attributes if not already there
        if (!(fieldName in filteredAttributes)) {
          filteredAttributes[fieldName] = inputAttrs[fieldName]
        }
      }
    })
  }

  // Now handle sparse fieldsets for virtual fields
  if (requestedFields && requestedFields.length > 0) {
    const requestedFieldsList = typeof requestedFields === 'string'
      ? requestedFields.split(',').map(f => f.trim())
      : requestedFields

    // Remove virtual fields that weren't requested
    Object.entries(schemaStructure).forEach(([fieldName, fieldDef]) => {
      if (fieldDef.virtual === true && fieldName in filteredAttributes) {
        if (!requestedFieldsList.includes(fieldName)) {
          delete filteredAttributes[fieldName]
        }
      }
    })
  }

  // Determine which computed fields to calculate
  // We only compute fields that are requested to optimize performance
  let fieldsToCompute = []
  if (requestedComputedFields) {
    // Explicit list provided (from sparse fieldsets)
    // Example: ?fields[products]=name,profit_margin -> only compute profit_margin
    fieldsToCompute = requestedComputedFields
  } else if (isMainResource || !parentContext?.queryParams?.fields) {
    // No sparse fieldsets or this is the main resource - compute all fields
    // This ensures all computed fields are available when no filtering is applied
    fieldsToCompute = Object.keys(computedFields)
  }

  // Create compute context with all available resources
  // IMPORTANT: We pass the TRANSFORMED attributes (after getters) to compute functions
  // This ensures computed fields see the getter-processed values
  // Example: if price getter converts string to number, profit_margin sees the number
  const computeContext = {
    attributes: transformedAttributes,   // Transformed attributes after getters
    record: { ...transformedAttributes }, // Full record for convenience
    context: parentContext,
    helpers,                             // API helpers for complex operations
    api,                                 // Full API instance
  }

  // Auto-compute fields that have compute functions
  for (const fieldName of fieldsToCompute) {
    const fieldDef = computedFields[fieldName]
    if (fieldDef && fieldDef.compute) {
      try {
        // Call the compute function with full context
        // Example: profit_margin compute gets { attributes: { price: 100, cost: 60 } }
        // and returns: ((100 - 60) / 100 * 100) = "40.00"
        filteredAttributes[fieldName] = await fieldDef.compute(computeContext)
      } catch (error) {
        // Log error but don't fail the request - computed fields shouldn't break API
        console.error(`Error computing field '${fieldName}' for ${scopeName}:`, error)
        filteredAttributes[fieldName] = null
      }
    }
  }

  // Remove fields that were only fetched as dependencies
  // This is the key to the dependency resolution feature:
  // 1. We fetched dependencies from DB (e.g., 'cost' for profit_margin)
  // 2. We used them in compute functions
  // 3. Now we remove them if they weren't explicitly requested
  // Example: User requests profit_margin, we fetch cost, compute, then remove cost
  const finalAttributes = { ...filteredAttributes }
  if (requestedFields && computedDependencies && computedDependencies.length > 0) {
    // Parse requested fields if it's a string
    const requested = typeof requestedFields === 'string'
      ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
      : requestedFields

    for (const dep of computedDependencies) {
      // Only remove if it wasn't explicitly requested
      // Example: 'cost' is removed unless user explicitly asked for it
      if (!requested.includes(dep)) {
        delete finalAttributes[dep]
      }
    }
  }

  if (requestedFields && requestedFields.length > 0) {
    const requestedList = typeof requestedFields === 'string'
      ? requestedFields.split(',').map((field) => field.trim()).filter((field) => field)
      : requestedFields
    const allowed = new Set(requestedList)
    Object.keys(finalAttributes).forEach((key) => {
      if (!allowed.has(key)) {
        delete finalAttributes[key]
      }
    })
  }

  // Create context for enrichAttributes hooks
  Object.assign(context, {
    parentContext,
    attributes: finalAttributes,  // Use the final attributes after dependency removal
    computedFields,
    requestedComputedFields: fieldsToCompute,
    scopeName,
    helpers,
    api
  })

  // Run enrichAttributes hooks for additional/override computations
  await runHooks('enrichAttributes')

  // Return the attributes from context, which hooks may have modified
  return context.attributes
};
