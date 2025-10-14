/**
 * URL Helper Functions
 *
 * Centralized functions for URL generation to avoid code duplication
 * and support flexible URL prefix override capabilities.
 */

/**
 * Get the complete URL prefix, handling all calculation and override logic
 *
 * Priority order:
 * 1. context.urlPrefixOverride - Explicit override (from hooks or middleware)
 * 2. context.urlPrefix - Pre-calculated URL prefix
 * 3. Calculate from request if provided
 * 4. scope.vars.transport?.mountPath - Fallback to mount path
 * 5. '' - Empty string as final fallback
 *
 * @param {Object} context - Request context (may have urlPrefixOverride or urlPrefix)
 * @param {Object} scope - Scope/resource object with transport vars
 * @param {Object} req - Optional Express request object for auto-calculation
 * @returns {string} The final URL prefix to use
 *
 * @example
 * // With full context
 * const urlPrefix = getUrlPrefix(context, scope);
 *
 * @example
 * // With request object for auto-calculation
 * const urlPrefix = getUrlPrefix({}, api, req);
 */
export function getUrlPrefix (context, scope, req = null) {
  // Priority 1: Explicit override
  if (context?.urlPrefixOverride) {
    return context.urlPrefixOverride
  }

  // Priority 2: Pre-calculated urlPrefix
  if (context?.urlPrefix) {
    return context.urlPrefix
  }

  // Priority 3: Calculate from request if provided
  if (req) {
    const protocol = req.get?.('x-forwarded-proto') || req.protocol || 'http'
    const host = req.get?.('x-forwarded-host') || req.get?.('host')
    const mountPath = scope?.vars?.transport?.mountPath || ''

    if (host) {
      return `${protocol}://${host}${mountPath}`
    }
  }

  // Priority 4: Fallback to mount path
  return scope?.vars?.transport?.mountPath || ''
}

/**
 * Build a complete resource URL
 *
 * @param {Object} context - Request context
 * @param {Object} scope - Scope containing transport vars
 * @param {string} scopeName - Resource type name
 * @param {string} id - Resource ID
 * @returns {string} Complete resource URL
 *
 * @example
 * const url = buildResourceUrl(context, scope, 'books', '123');
 * // Returns: "https://api.example.com/api/books/123"
 */
export function buildResourceUrl (context, scope, scopeName, id) {
  const urlPrefix = getUrlPrefix(context, scope)
  return `${urlPrefix}/${scopeName}/${id}`
}

/**
 * Build a relationship URL
 *
 * @param {Object} context - Request context
 * @param {Object} scope - Scope containing transport vars
 * @param {string} scopeName - Resource type name
 * @param {string} id - Resource ID
 * @param {string} relationshipName - Name of the relationship
 * @param {boolean} isRelationshipEndpoint - If true, builds /relationships/ URL
 * @returns {string} Complete relationship URL
 *
 * @example
 * // For relationship linkage endpoint
 * buildRelationshipUrl(context, scope, 'books', '1', 'author', true);
 * // Returns: "https://api.example.com/api/books/1/relationships/author"
 *
 * // For related resource endpoint
 * buildRelationshipUrl(context, scope, 'books', '1', 'author', false);
 * // Returns: "https://api.example.com/api/books/1/author"
 */
export function buildRelationshipUrl (context, scope, scopeName, id, relationshipName, isRelationshipEndpoint = false) {
  const urlPrefix = getUrlPrefix(context, scope)
  if (isRelationshipEndpoint) {
    return `${urlPrefix}/${scopeName}/${id}/relationships/${relationshipName}`
  }
  return `${urlPrefix}/${scopeName}/${id}/${relationshipName}`
}

/**
 * Build a collection URL with optional query string
 *
 * @param {Object} context - Request context
 * @param {Object} scope - Scope containing transport vars
 * @param {string} scopeName - Resource type name
 * @param {string} queryString - Optional query string (with leading ?)
 * @returns {string} Complete collection URL
 *
 * @example
 * buildCollectionUrl(context, scope, 'books', '?page[size]=10');
 * // Returns: "https://api.example.com/api/books?page[size]=10"
 */
export function buildCollectionUrl (context, scope, scopeName, queryString = '') {
  const urlPrefix = getUrlPrefix(context, scope)
  return `${urlPrefix}/${scopeName}${queryString}`
}
