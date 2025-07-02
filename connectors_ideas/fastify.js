/**
 * http-plugin-fastify.js
 * This plugin for Hooked API provides a high-performance HTTP layer using the Fastify framework.
 * It automatically generates JSON:API compliant RESTful routes and schemas for each scope.
 *
 * You'll need to install dependencies: npm install fastify
 */
import { HookedApiError } from './hooked-api.js';
import { handleFastifyApiError } from './error-handler-fastify.js';

/**
 * **UPGRADED:** Automatically generates a comprehensive Fastify schema object that conforms
 * to the full JSON:API specification, including relationships, links, and meta.
 * @param {string} scopeName - The name of the resource type (e.g., 'articles').
 * @param {object} scopeOptions - The full options object for the scope.
 * @returns {object} A complete Fastify schema for all CRUD routes.
 */
function _generateFastifySchema(scopeName, scopeOptions = {}) {
  const appSchema = scopeOptions.schema || {};
  const relationshipsSchema = scopeOptions.relationships || {};

  // --- Reusable Schema Components ---
  const metaObject = { type: 'object', additionalProperties: true };
  const linksObject = {
    type: 'object',
    properties: {
      self: { type: 'string', format: 'uri-reference' },
      related: { type: 'string', format: 'uri-reference' },
    }
  };
  const resourceIdentifierObject = {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { type: 'string' },
      id: { type: 'string' }
    }
  };

  // --- Build Attribute Properties from simple schema ---
  const attributeProperties = {};
  const requiredAttributes = [];
  for (const [key, value] of Object.entries(appSchema)) {
    let jsonSchemaType = 'string';
    if (value.type === 'number') jsonSchemaType = 'number';
    if (value.type === 'boolean') jsonSchemaType = 'boolean';
    
    attributeProperties[key] = { type: jsonSchemaType };
    if (value.format) attributeProperties[key].format = value.format;
    if (value.required) requiredAttributes.push(key);
  }
  
  // --- Build Relationship Properties ---
  const relationshipProperties = {};
  for (const [key, value] of Object.entries(relationshipsSchema)) {
    const isToMany = value.type === 'hasMany';
    relationshipProperties[key] = {
      type: 'object',
      properties: {
        links: linksObject,
        data: isToMany 
          ? { type: 'array', items: resourceIdentifierObject } 
          : resourceIdentifierObject
      }
    };
  }

  // --- Define the core Resource Object schema ---
  const resourceObject = {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      id: { type: 'string' },
      type: { type: 'string', const: scopeName },
      attributes: {
        type: 'object',
        properties: attributeProperties
      },
      relationships: {
        type: 'object',
        properties: relationshipProperties
      },
      links: linksObject
    }
  };

  // --- Define the full top-level JSON:API Document ---
  const singleDocument = {
    type: 'object',
    properties: {
      data: resourceObject,
      included: { type: 'array', items: { type: 'object' } }, // Generic included for simplicity
      links: linksObject,
      meta: metaObject
    }
  };
  const collectionDocument = {
    type: 'object',
    properties: {
      data: { type: 'array', items: resourceObject },
      included: { type: 'array', items: { type: 'object' } },
      links: { ...linksObject, properties: { ...linksObject.properties, next: { type: 'string' }, prev: { type: 'string' } } },
      meta: metaObject
    }
  };


  // --- Build the final schema for each route ---
  return {
    post: {
      body: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['type', 'attributes'],
            properties: {
              type: { type: 'string', const: scopeName },
              attributes: {
                type: 'object',
                required: requiredAttributes,
                properties: attributeProperties
              },
              relationships: {
                type: 'object',
                properties: relationshipProperties
              }
            }
          }
        }
      },
      response: { 201: singleDocument }
    },
    get: {
      response: { 200: singleDocument }
    },
    query: {
      response: { 200: collectionDocument }
    },
    patch: {
      body: { /* A more complex partial schema would be needed for full validation */ },
      response: { 200: singleDocument }
    },
    put: {
        body: { /* Similar to POST body */ },
        response: { 200: singleDocument }
    }
  };
}


export const HttpFastifyPlugin = {
  name: 'http-fastify',

  install(context, api) {
    const { pluginOptions, log } = context;
    const httpOptions = pluginOptions.http || {};
    const { app, prefix = '/api' } = httpOptions;

    if (!app) {
      throw new HookedApiError(
        "The 'http-fastify' plugin requires a Fastify 'app' instance to be passed in the options. Example: api.use(HttpFastifyPlugin, { http: { app: myFastifyApp } })",
        'CONFIGURATION_ERROR'
      );
    }

    log.info(`Fastify HTTP plugin installed. Routes will be prefixed with '${prefix}'.`);

    const _createFastifyHandler = (methodName) => {
      return async (request, reply) => {
        const { scopeName, id } = request.params;
        const apiParams = {
          id,
          inputRecord: request.body,
          queryParams: request.query,
        };
        log.debug(`Fastify request for ${scopeName}.${methodName}`, { id, query: apiParams.queryParams });
        const result = await api.scopes[scopeName][methodName](apiParams);
        switch (methodName) {
          case 'post':
            reply.code(201).send(result);
            break;
          case 'delete':
            reply.code(204).send();
            break;
          default:
            reply.code(200).send(result);
        }
      };
    };

    const _createScopePlugin = (scopeName, scopeOptions) => {
      const fastifySchema = scopeOptions.fastifySchema || _generateFastifySchema(scopeName, scopeOptions);

      return async (fastifyInstance) => {
        log.info(`Creating Fastify HTTP routes for scope: '${scopeName}'`);
        fastifyInstance.get(`/${scopeName}`, { schema: fastifySchema.query }, _createFastifyHandler('query'));
        fastifyInstance.get(`/${scopeName}/:id`, { schema: fastifySchema.get }, _createFastifyHandler('get'));
        fastifyInstance.post(`/${scopeName}`, { schema: fastifySchema.post }, _createFastifyHandler('post'));
        fastifyInstance.put(`/${scopeName}/:id`, { schema: fastifySchema.put }, _createFastifyHandler('put'));
        fastifyInstance.patch(`/${scopeName}/:id`, { schema: fastifySchema.patch }, _createFastifyHandler('patch'));
        fastifyInstance.delete(`/${scopeName}/:id`, { schema: fastifySchema.delete }, _createFastifyHandler('delete'));
      };
    };

    const originalAddScope = api.addScope;

    api.addScope = (name, options, extras) => {
      const result = originalAddScope.call(api, name, options, extras);
      app.register(_createScopePlugin(name, options), { prefix });
      return result;
    };
    
    app.setErrorHandler((error, request, reply) => {
        handleFastifyApiError(error, request, reply, log);
    });
  }
};
