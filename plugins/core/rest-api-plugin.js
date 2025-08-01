import { validateRelationships } from './lib/querying-writing/scope-validations.js';

// Import hook functions
import compileResourceSchemas from './rest-api-plugin-hooks/compile-resource-schemas.js';
import validateIncludeConfigurations from './rest-api-plugin-hooks/validate-include-configurations.js';
import turnScopeInitIntoVars from './rest-api-plugin-hooks/turn-scope-init-into-vars.js';
import registerScopeRoutes from './rest-api-plugin-hooks/register-scope-routes.js';
import registerRelationshipRoutes from './rest-api-plugin-hooks/register-relationship-routes.js';

// Import method functions
import queryMethod from './rest-api-plugin-methods/query.js';
import getMethod from './rest-api-plugin-methods/get.js';
import postMethod from './rest-api-plugin-methods/post.js';
import putMethod from './rest-api-plugin-methods/put.js';
import patchMethod from './rest-api-plugin-methods/patch.js';
import deleteMethod from './rest-api-plugin-methods/delete.js';
import enrichAttributesMethod from './rest-api-plugin-methods/enrich-attributes.js';
import checkPermissionsMethod from './rest-api-plugin-methods/check-permissions.js';
import addRouteMethod from './rest-api-plugin-methods/add-route.js';
import { defaultDataHelpers } from './lib/querying-writing/default-data-helpers.js';
import { DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT, DEFAULT_INCLUDE_DEPTH_LIMIT } from './lib/querying-writing/knex-constants.js';

import getRelatedMethod from './rest-api-plugin-methods/get-related.js';
import postRelationshipMethod from './rest-api-plugin-methods/post-relationship.js';
import getRelationshipMethod from './rest-api-plugin-methods/get-relationship.js';
import patchRelationshipMethod from './rest-api-plugin-methods/patch-relationship.js';
import deleteRelationshipMethod from './rest-api-plugin-methods/delete-relationship.js';


export const RestApiPlugin = {
  name: 'rest-api',

  install({ helpers, addScopeMethod, addApiMethod, vars, addHook, runHooks, apiOptions, pluginOptions, api, setScopeAlias, scopes, log, on }) {

    // **************
    // Initial setup
    // **************

    // Initialize the rest namespace for REST API functionality
    api.rest = {};

    // Set up REST-friendly aliases
    setScopeAlias('resources', 'addResource');

    // **********
    // Variables
    // **********

    // Initialize default vars for the plugin from pluginOptions
    const restApiOptions = pluginOptions || {};

    // These will be used as default fallbacks by the vars proxy if
    // they are not set in the scope options
    vars.queryDefaultLimit = restApiOptions.queryDefaultLimit || DEFAULT_QUERY_LIMIT
    vars.queryMaxLimit = restApiOptions.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
    vars.includeDepthLimit = restApiOptions.includeDepthLimit || DEFAULT_INCLUDE_DEPTH_LIMIT
    vars.publicBaseUrl = restApiOptions.publicBaseUrl || ''
    vars.enablePaginationCounts = restApiOptions.enablePaginationCounts || true

    // New simplified settings
    vars.simplifiedTransport = restApiOptions.simplifiedTransport !== undefined 
      ? restApiOptions.simplifiedTransport 
      : false; // Default false for JSON:API compliance over the wire
    
    vars.simplifiedApi = restApiOptions.simplifiedApi !== undefined 
      ? restApiOptions.simplifiedApi 
      : true; // Default true for better DX in programmatic API
    
    vars.idProperty = restApiOptions.idProperty || 'id'

    // Return full record configuration for API and Transport
    // Support values: 'no', 'minimal', 'full'
    const normalizeReturnValue = (value, defaultValue) => {
      if (['no', 'minimal', 'full'].includes(value)) return value;
      return defaultValue;
    };

    const optionConfigs = [
      {
        propName: 'returnRecordApi',
        defaultValue: 'full',
      },
      {
        propName: 'returnRecordTransport',
        defaultValue: 'no',
      },
    ];

    for (const config of optionConfigs) {
      const optionValue = restApiOptions[config.propName];
      let processedValue;

      if (typeof optionValue === 'object' && optionValue !== null) {
        processedValue = {
          post: normalizeReturnValue(optionValue.post, config.defaultValue),
          put: normalizeReturnValue(optionValue.put, config.defaultValue),
          patch: normalizeReturnValue(optionValue.patch, config.defaultValue),
        };
      } else if (optionValue !== undefined) {
        const normalized = normalizeReturnValue(optionValue, config.defaultValue);
        processedValue = { post: normalized, put: normalized, patch: normalized };
      } else {
        processedValue = { post: config.defaultValue, put: config.defaultValue, patch: config.defaultValue };
      }
      vars[config.propName] = processedValue;
    }

    log.debug('returnRecordApi configuration:', vars.returnRecordApi);
    log.debug('returnRecordTransport configuration:', vars.returnRecordTransport);

    // Schema cache vars
    vars.schemaProcessed = false;
    vars.schema = null;

    // ******************************
    // Scope (resources) added hooks
    // ******************************

    addHook('scope:added', 'validateRelationships', {}, validateRelationships);    
    addHook('scope:added', 'compileResourceSchemas', {}, compileResourceSchemas);
    addHook('scope:added', 'validateIncludeConfigurations', {}, validateIncludeConfigurations);
    addHook('scope:added', 'turnScopeInitIntoVars', {}, turnScopeInitIntoVars)
    
    // *********
    // Methods
    // *********

    addApiMethod('addRoute', addRouteMethod);

    // Main REST methods
    addScopeMethod('query', queryMethod);
    addScopeMethod('get', getMethod);
    addScopeMethod('post', postMethod);
    addScopeMethod('put', putMethod);
    addScopeMethod('patch', patchMethod);
    addScopeMethod('delete', deleteMethod);
  
    // Relationship methods
    addScopeMethod('getRelationship', getRelationshipMethod);
    addScopeMethod('getRelated', getRelatedMethod);
    addScopeMethod('postRelationship', postRelationshipMethod)
    addScopeMethod('patchRelationship', patchRelationshipMethod);
    addScopeMethod('deleteRelationship', deleteRelationshipMethod );

    addHook('scope:added', 'registerRelationshipRoutes', {}, registerRelationshipRoutes);
    addHook('scope:added', 'registerScopeRoutes', {}, registerScopeRoutes);
    
    // Non-URL methods
    addScopeMethod('enrichAttributes', enrichAttributesMethod);
    addScopeMethod('checkPermissions', checkPermissionsMethod);      
    
    // *********
    // Helpers
    // *********

    // Initialize default data helpers that throw errors until a storage plugin is installed
    // These placeholders show storage plugin developers what methods to implement
    // Example: helpers.dataGet, helpers.dataPost, etc. will throw "No storage implementation" errors
    Object.assign(helpers, defaultDataHelpers);

    // Add default getLocation helper for generating resource URLs
    // This can be overridden by storage plugins if needed
    helpers.getLocation = ({ scopeName, id }) => `/${scopeName}/${id}`
    
    // Helper to get the URL prefix for generating links
    helpers.getUrlPrefix = ({ scope }) => scope?.vars?.publicBaseUrl || vars.publicBaseUrl || vars.transport?.mountPath || ''
  }
};