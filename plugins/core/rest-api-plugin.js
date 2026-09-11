import { validateRelationships } from './lib/querying-writing/scope-validations.js'
import { transactionMethod, withAvailableContext, withWriteOutcome } from '../../lib/error-context.js'

// Import hook functions
import compileResourceSchemas from './rest-api-plugin-hooks/compile-resource-schemas.js'
import { validateIncludeConfigurations } from './rest-api-plugin-hooks/validate-include-configurations.js'
import turnScopeInitIntoVars from './rest-api-plugin-hooks/turn-scope-init-into-vars.js'
import registerScopeRoutes from './rest-api-plugin-hooks/register-scope-routes.js'
import registerRelationshipRoutes from './rest-api-plugin-hooks/register-relationship-routes.js'

// Import method functions
import queryMethod from './rest-api-plugin-methods/query.js'
import getMethod from './rest-api-plugin-methods/get.js'
import postMethod from './rest-api-plugin-methods/post.js'
import putMethod from './rest-api-plugin-methods/put.js'
import patchMethod from './rest-api-plugin-methods/patch.js'
import deleteMethod from './rest-api-plugin-methods/delete.js'
import enrichAttributesMethod from './rest-api-plugin-methods/enrich-attributes.js'
import checkPermissionsMethod from './rest-api-plugin-methods/check-permissions.js'
import applyQueryFiltersMethod from './rest-api-plugin-methods/apply-query-filters.js'
import addRouteMethod from './rest-api-plugin-methods/add-route.js'
import releaseMethod from './rest-api-plugin-methods/release.js'
import { defaultDataHelpers } from './lib/querying-writing/default-data-helpers.js'
import { DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT, DEFAULT_INCLUDE_DEPTH_LIMIT } from './lib/querying-writing/knex-constants.js'
import { rejectRemovedOptions, resolveFormat, resolveReturning } from './lib/querying-writing/response-options.js'

import getRelatedMethod from './rest-api-plugin-methods/get-related.js'
import postRelationshipMethod from './rest-api-plugin-methods/post-relationship.js'
import getRelationshipMethod from './rest-api-plugin-methods/get-relationship.js'
import patchRelationshipMethod from './rest-api-plugin-methods/patch-relationship.js'
import deleteRelationshipMethod from './rest-api-plugin-methods/delete-relationship.js'
import { defaultNormalizeResourceId } from './lib/querying-writing/resource-id-normalization.js'
import { buildResourceUrl } from './lib/querying/url-helpers.js'

export const RestApiPlugin = {
  name: 'rest-api',

  install ({ helpers, addResourceMethod, addApiMethod, vars, addHook, pluginOptions, api }) {
    // **************
    // Initial setup
    // **************

    // Initialize the rest namespace for REST API functionality
    api.rest = {}

    // **********
    // Variables
    // **********

    // Initialize default vars for the plugin from pluginOptions
    const restApiOptions = pluginOptions || {}
    rejectRemovedOptions(restApiOptions)

    // These will be used as default fallbacks by resource vars if
    // they are not set in the scope options
    vars.queryDefaultLimit = restApiOptions.queryDefaultLimit || DEFAULT_QUERY_LIMIT
    vars.queryMaxLimit = restApiOptions.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
    vars.includeDepthLimit = restApiOptions.includeDepthLimit || DEFAULT_INCLUDE_DEPTH_LIMIT
    vars.enablePaginationCounts = restApiOptions.enablePaginationCounts ?? true

    vars.format = resolveFormat(restApiOptions.format)
    vars.returning = resolveReturning(restApiOptions.returning)

    vars.idProperty = restApiOptions.idProperty || 'id'
    vars.normalizeId = typeof restApiOptions.normalizeId === 'function'
      ? restApiOptions.normalizeId
      : defaultNormalizeResourceId

    // Schema cache vars
    vars.schemaProcessed = false
    vars.schema = null

    // ******************************
    // Scope (resources) added hooks
    // ******************************

    addHook('resource:added', 'validateRelationships', {}, validateRelationships)
    addHook('resource:added', 'compileResourceSchemas', {}, compileResourceSchemas)
    addHook('schema:compiled', 'validateIncludeConfigurations', {}, validateIncludeConfigurations)
    addHook('resource:added', 'turnScopeInitIntoVars', {}, turnScopeInitIntoVars)

    // *********
    // Methods
    // *********

    addApiMethod('addRoute', addRouteMethod)

    addApiMethod('release', releaseMethod)
    addApiMethod('transaction', withWriteOutcome(transactionMethod))

    // Main REST methods
    addResourceMethod('query', withAvailableContext(queryMethod))
    addResourceMethod('get', withAvailableContext(getMethod))
    addResourceMethod('post', withWriteOutcome(postMethod))
    addResourceMethod('put', withWriteOutcome(putMethod))
    addResourceMethod('patch', withWriteOutcome(patchMethod))
    addResourceMethod('delete', withWriteOutcome(deleteMethod))

    // Relationship methods
    addResourceMethod('getRelationship', withAvailableContext(getRelationshipMethod))
    addResourceMethod('getRelated', withAvailableContext(getRelatedMethod))
    addResourceMethod('postRelationship', withWriteOutcome(postRelationshipMethod))
    addResourceMethod('patchRelationship', withWriteOutcome(patchRelationshipMethod))
    addResourceMethod('deleteRelationship', withWriteOutcome(deleteRelationshipMethod))

    addHook('resource:added', 'registerRelationshipRoutes', {}, registerRelationshipRoutes)
    addHook('resource:added', 'registerScopeRoutes', {}, registerScopeRoutes)

    // Non-URL methods
    addResourceMethod('enrichAttributes', enrichAttributesMethod)
    addResourceMethod('checkPermissions', checkPermissionsMethod)
    addResourceMethod('applyQueryFilters', applyQueryFiltersMethod)

    // *********
    // Helpers
    // *********

    // Initialize default data helpers that throw errors until a storage plugin is installed
    // These placeholders show storage plugin developers what methods to implement
    // Example: helpers.dataGet, helpers.dataPost, etc. will throw "No storage implementation" errors
    Object.assign(helpers, defaultDataHelpers)

    // Add default getLocation helper for generating resource URLs
    // This can be overridden by storage plugins if needed
    helpers.getLocation = ({ scopeName, id }) => buildResourceUrl(null, null, scopeName, id)
  }
}
