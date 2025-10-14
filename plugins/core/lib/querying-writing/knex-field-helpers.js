/**
 * Checks if a field exists only in code, not in the database
 *
 * @param {string} fieldName - The field name to check
 * @param {Object} schemaInfo - Schema info with computed fields and structure
 * @returns {boolean} True if field is computed or virtual
 *
 * @example
 * // Input: Check computed field
 * const schemaInfo = {
 *   computed: { profit_margin: { (definition) } },
 *   schemaStructure: { price: { type: 'number' } }
 * };
 * isNonDatabaseField('profit_margin', schemaInfo);
 * // Output: true (it's computed, not stored)
 *
 * @example
 * // Input: Check virtual field
 * const schemaInfo = {
 *   computed: {},
 *   schemaStructure: {
 *     temp_password: { type: 'string', virtual: true }
 *   }
 * };
 * isNonDatabaseField('temp_password', schemaInfo);
 * // Output: true (it's virtual, not stored)
 *
 * @description
 * Used by:
 * - buildFieldSelection to exclude from SELECT queries
 * - dataPost/dataPatch to skip non-database fields
 * - enrichAttributes to identify computed fields
 *
 * Purpose:
 * - Prevents SQL errors by excluding non-existent columns
 * - Identifies fields that need computation or special handling
 * - Supports virtual fields for temporary/input-only data
 */
export const isNonDatabaseField = (fieldName, schemaInfo) => {
  const { computed = {}, schemaStructure = {} } = schemaInfo
  if (fieldName in computed) return true
  const fieldDef = schemaStructure[fieldName]
  return fieldDef && fieldDef.virtual === true
}

/**
 * Builds the field selection list for database queries with sparse fieldset support
 *
 * @param {Object} scope - Resource scope with schema information
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.context - Request context with queryParams and schemaInfo
 * @returns {Promise<Object>} Field selection information
 *
 * @example
 * // Input: Basic sparse fieldset request
 * const deps = {
 *   context: {
 *     scopeName: 'articles',
 *     queryParams: { fields: { articles: 'title,body' } },
 *     schemaInfo: { idProperty: 'id', ...  }
 *   }
 * };
 * const result = await buildFieldSelection(scope, deps);
 *
 * // Output: Includes requested fields plus required fields
 * // {
 * //   fieldsToSelect: ['id', 'title', 'body', 'author_id', 'category_id'],
 * //   requestedFields: ['title', 'body'],
 * //   computedDependencies: [],
 * //   idProperty: 'id'
 * // }
 * // Note: Foreign keys (author_id, category_id) always included for relationships
 *
 * @example
 * // Input: Computed field with hidden dependencies
 * const schemaInfo = {
 *   computed: {
 *     profit_margin: {
 *       compute: (record) => (record.price - record.cost) / record.price,
 *       dependencies: ['price', 'cost']
 *     }
 *   },
 *   schemaStructure: {
 *     name: { type: 'string' },
 *     price: { type: 'number' },
 *     cost: { type: 'number', normallyHidden: true }
 *   }
 * };
 * const deps = {
 *   context: {
 *     queryParams: { fields: { products: 'name,profit_margin' } }
 *   }
 * };
 *
 * // Output: Fetches hidden dependency for computation
 * // {
 * //   fieldsToSelect: ['id', 'name', 'price', 'cost'],
 * //   requestedFields: ['name', 'profit_margin'],
 * //   computedDependencies: ['cost'], // Will be removed after computation
 * //   idProperty: 'id'
 * // }
 *
 * @example
 * // Input: No sparse fieldsets (returns all visible fields)
 * const deps = {
 *   context: {
 *     queryParams: {}, // No fields parameter
 *     schemaInfo: { ... }
 *   }
 * };
 *
 * // Output: All non-hidden, non-virtual fields
 * // {
 * //   fieldsToSelect: ['id', 'title', 'body', 'published_at', 'author_id'],
 * //   requestedFields: null,
 * //   computedDependencies: [],
 * //   idProperty: 'id'
 * // }
 *
 * @description
 * Used by:
 * - dataGet to build SELECT query
 * - dataQuery to build SELECT query
 * - buildQuerySelection as the main field resolver
 *
 * Purpose:
 * - Implements JSON:API sparse fieldsets specification
 * - Ensures relationships work by including foreign keys
 * - Handles computed field dependencies intelligently
 * - Respects field visibility rules (hidden/normallyHidden)
 * - Supports custom ID column names
 *
 * Data flow:
 * 1. Always includes ID (with aliasing if needed)
 * 2. Parses requested fields from query string
 * 3. Validates requested fields exist in schema
 * 4. Adds dependencies for computed fields
 * 5. Includes all foreign keys for relationships
 * 6. Returns complete field list for SQL SELECT
 */
export const buildFieldSelection = async (scope, deps) => {
  const fieldsToSelect = new Set()
  const computedDependencies = new Set()

  // Extract values from scope
  const {
    vars: {
      schemaInfo: { schemaInstance, computed: computedFields = {}, schemaStructure }
    }
  } = scope

  // Extract values from deps
  const { context } = deps
  const scopeName = context.scopeName
  const requestedFields = context.queryParams?.fields?.[scopeName]
  const idProperty = context.schemaInfo.idProperty

  // Always include the ID field - required for JSON:API
  // Handle aliasing if idProperty is not 'id'
  if (idProperty !== 'id') {
    fieldsToSelect.add(`${idProperty} as id`)
  } else {
    fieldsToSelect.add('id')
  }

  // Handle both Schema objects and plain objects
  if (!schemaStructure) {
    schemaStructure = schemaInstance?.structure || schemaInstance || {}
  }

  // Get computed fields and virtual fields from schema
  const computedFieldNames = new Set(Object.keys(computedFields))

  // Find fields marked as virtual in the schema
  const virtualFieldNames = new Set()
  Object.entries(schemaStructure).forEach(([fieldName, fieldDef]) => {
    if (fieldDef.virtual === true) {
      virtualFieldNames.add(fieldName)
    }
  })

  const nonDatabaseFields = new Set([...computedFieldNames, ...virtualFieldNames])

  // Parse requested fields
  const requested = requestedFields
    ? (
        typeof requestedFields === 'string'
          ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
          : requestedFields
      )
    : null

  if (requested && requested.length > 0) {
    // Sparse fieldsets requested - only select specified fields
    // Example: ?fields[products]=name,price,profit_margin
    requested.forEach(field => {
      // Skip computed and virtual fields - they don't exist in database
      // Computed fields will be calculated later in enrichAttributes
      // Virtual fields are handled separately (from request input)
      if (nonDatabaseFields.has(field)) return

      const fieldDef = schemaStructure[field]
      if (!fieldDef) throw new Error(`Unknown sparse field '${field}' requested for '${scopeName}'`)

      if (fieldDef.belongsToPolymorphic) {
        return
      }

      // NEVER include hidden fields, even if explicitly requested
      // Example: password_hash with hidden:true is never returned
      if (fieldDef.hidden === true) return

      fieldsToSelect.add(field)
    })

    // Handle computed field dependencies - fetch fields needed for calculations
    // Example: User requests 'profit_margin' which depends on 'price' and 'cost'
    // We need to fetch price and cost from DB even if not explicitly requested
    const requestedComputedFields = requested.filter(f => computedFieldNames.has(f))
    for (const computedField of requestedComputedFields) {
      const fieldDef = computedFields[computedField]
      if (fieldDef.dependencies) {
        for (const dep of fieldDef.dependencies) {
          const depFieldDef = schemaStructure[dep]
          // Only add dependency if it exists and isn't hidden
          if (depFieldDef && depFieldDef.hidden !== true) {
            fieldsToSelect.add(dep)
            // Track dependencies that weren't explicitly requested
            // These will be removed from the final response
            if (!requested.includes(dep)) {
              computedDependencies.add(dep)
            }
          }
        }
      }
    }

    // Still handle normallyHidden fields for backward compatibility
    if (requestedComputedFields.length > 0) {
      Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
        if (fieldDef.normallyHidden === true && fieldDef.hidden !== true) {
          // Only add if not already handled by dependencies
          if (!fieldsToSelect.has(field)) {
            fieldsToSelect.add(field)
            if (!requested.includes(field)) {
              computedDependencies.add(field)
            }
          }
        }
      })
    }
  } else {
    // No sparse fieldsets - return all visible fields
    // This is the default behavior when no ?fields parameter is provided
    Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
      // Skip virtual fields - they don't exist in database
      if (fieldDef.virtual === true) return

      // Skip hidden fields - these are NEVER returned
      // Example: password_hash with hidden:true
      if (fieldDef.hidden === true) return

      // Skip polymorphic placeholder fields - handled via type/id columns
      if (fieldDef.belongsToPolymorphic) return

      // Skip normallyHidden fields - these are hidden by default
      // Example: cost with normallyHidden:true (only returned when explicitly requested)
      if (fieldDef.normallyHidden === true) return

      fieldsToSelect.add(field)
    })

    // When no sparse fieldsets, we compute all computed fields
    // So we need to include their dependencies even if normallyHidden
    // Example: profit_margin depends on 'cost' which is normallyHidden
    // We fetch 'cost' for calculation but don't return it in response
    for (const [fieldName, fieldDef] of Object.entries(computedFields)) {
      if (fieldDef.dependencies) {
        for (const dep of fieldDef.dependencies) {
          const depFieldDef = schemaStructure[dep]
          if (depFieldDef && depFieldDef.hidden !== true) {
            fieldsToSelect.add(dep)
            // Track normallyHidden dependencies for later removal
            // These are fetched for computation but not returned
            if (depFieldDef.normallyHidden === true) {
              computedDependencies.add(dep)
            }
          }
        }
      }
    }
  }

  // Always include foreign keys for relationships (unless hidden)
  Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
    if (fieldDef.belongsTo && fieldDef.hidden !== true) {
      fieldsToSelect.add(field)
    }
  })

  // Always include polymorphic type and id fields from relationships
  try {
    const relationships = scope.vars.schemaInfo.schemaRelationships
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        if (relDef.typeField) fieldsToSelect.add(relDef.typeField)
        if (relDef.idField) fieldsToSelect.add(relDef.idField)
      }
    })
  } catch (e) {
    // Scope might not have relationships
  }

  // Return detailed information about field selection
  // This info is used by:
  // 1. SQL query builder to SELECT the right columns
  // 2. enrichAttributes to know which computed fields to calculate
  // 3. enrichAttributes to remove dependencies from final response
  return {
    fieldsToSelect: Array.from(fieldsToSelect),      // Fields to SELECT from database
    requestedFields: requested,                       // Fields explicitly requested by user
    computedDependencies: Array.from(computedDependencies),  // Dependencies to remove from response
    idProperty                                        // Pass idProperty for reference
  }
}

/**
 * Determines which computed fields to calculate based on sparse fieldsets
 *
 * @param {string} scopeName - Resource name (e.g., 'products')
 * @param {Array<string>|string} requestedFields - Requested fields from query
 * @param {Object} computedFields - Computed field definitions from schema
 * @returns {Array<string>} Names of computed fields to calculate
 *
 * @example
 * // Input: No sparse fieldsets (calculate all computed fields)
 * const computed = {
 *   full_name: { compute: (r) => `${r.first} ${r.last}` },
 *   age: { compute: (r) => new Date().getFullYear() - r.birth_year }
 * };
 * getRequestedComputedFields('users', null, computed);
 * // Output: ['full_name', 'age'] (all computed fields)
 *
 * @example
 * // Input: Sparse fieldsets with some computed fields
 * const requestedFields = 'first_name,full_name,email';
 * const computed = {
 *   full_name: { compute: (r) => `${r.first} ${r.last}` },
 *   age: { compute: (r) => new Date().getFullYear() - r.birth_year }
 * };
 * getRequestedComputedFields('users', requestedFields, computed);
 * // Output: ['full_name'] (only requested computed field)
 *
 * @example
 * // Input: Sparse fieldsets with no computed fields
 * const requestedFields = ['first_name', 'email'];
 * const computed = {
 *   full_name: { compute: (r) => `${r.first} ${r.last}` }
 * };
 * getRequestedComputedFields('users', requestedFields, computed);
 * // Output: [] (no computed fields requested)
 *
 * @description
 * Used by:
 * - enrichAttributes to determine which computations to run
 * - Applied after fetching data from database
 *
 * Purpose:
 * - Optimizes performance by only computing requested fields
 * - Supports JSON:API sparse fieldsets for computed fields
 * - Handles both string and array input formats
 *
 * Data flow:
 * 1. Checks if sparse fieldsets are specified
 * 2. If not, returns all computed field names
 * 3. If yes, filters to only requested computed fields
 * 4. Normalizes string input to array format
 */
export const getRequestedComputedFields = (scopeName, requestedFields, computedFields) => {
  if (!computedFields) return []

  const allComputedFields = Object.keys(computedFields)

  if (!requestedFields || requestedFields.length === 0) {
    // No sparse fieldsets - return all computed fields
    return allComputedFields
  }

  // Parse requested fields if it's a string
  const requested = typeof requestedFields === 'string'
    ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
    : requestedFields

  // Return only requested computed fields that exist
  return requested.filter(field => allComputedFields.includes(field))
}
