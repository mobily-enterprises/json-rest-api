/**
 * OpenAPI 3.0 format generator for discovery
 */

import { extractPermittedSchema, buildEndpoints } from '../core.js';
import { 
  fieldToOpenAPISchema, 
  buildQueryParameters, 
  buildErrorResponseSchema,
  generateExample 
} from '../utils.js';

/**
 * Generate OpenAPI 3.0 specification
 * @param {Api} api - The API instance
 * @param {Object} user - The current user
 * @param {Object} options - Discovery options
 * @returns {Object} OpenAPI specification
 */
export async function generateOpenAPI(api, user, options = {}) {
  const { resources, meta } = await extractPermittedSchema(api, user);
  
  const basePath = options.basePath || '/api';
  
  // Build OpenAPI specification
  const spec = {
    openapi: '3.0.3',
    info: {
      title: options.info?.title || meta.apiName,
      version: options.info?.version || meta.apiVersion,
      description: options.info?.description,
      contact: options.info?.contact,
      license: options.info?.license
    },
    servers: options.servers || [
      {
        url: basePath,
        description: 'API server'
      }
    ],
    paths: {},
    components: {
      schemas: {},
      parameters: {},
      responses: {
        ErrorResponse: {
          description: 'Error response',
          content: {
            'application/vnd.api+json': {
              schema: buildErrorResponseSchema()
            }
          }
        }
      }
    }
  };
  
  // Add security schemes if configured
  if (options.security) {
    spec.components.securitySchemes = {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    };
    spec.security = options.security;
  }
  
  // Process each resource
  for (const [resourceType, resourceInfo] of Object.entries(resources)) {
    // Build schemas for this resource
    const schemas = buildResourceSchemas(resourceType, resourceInfo, api.options.idProperty || 'id');
    
    // Add schemas to components
    Object.assign(spec.components.schemas, schemas);
    
    // Build paths for this resource
    const paths = buildResourcePaths(
      basePath, 
      resourceType, 
      resourceInfo, 
      schemas,
      api.options.idProperty || 'id'
    );
    
    // Add paths to spec
    Object.assign(spec.paths, paths);
  }
  
  return spec;
}

/**
 * Build OpenAPI schemas for a resource
 */
function buildResourceSchemas(resourceType, resourceInfo, idProperty) {
  const schemas = {};
  const resourceName = capitalizeFirst(resourceType);
  
  // Resource attributes schema (for create/update)
  const attributesProperties = {};
  const requiredFields = [];
  
  for (const [fieldName, fieldDef] of Object.entries(resourceInfo.fields)) {
    // Skip ID field in attributes
    if (fieldName === idProperty) continue;
    
    // Skip virtual to-many relationships
    if (resourceInfo.relationships?.[fieldName]?.type === 'to-many') continue;
    
    attributesProperties[fieldName] = fieldToOpenAPISchema(
      fieldDef, 
      resourceInfo.relationships,
      fieldName
    );
    
    if (fieldDef.required) {
      requiredFields.push(fieldName);
    }
  }
  
  schemas[`${resourceName}Attributes`] = {
    type: 'object',
    properties: attributesProperties,
    required: requiredFields.length > 0 ? requiredFields : undefined
  };
  
  // Resource schema (full resource with id, type, attributes)
  schemas[`${resourceName}Resource`] = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string', enum: [resourceType] },
      attributes: { $ref: `#/components/schemas/${resourceName}Attributes` }
    },
    required: ['id', 'type', 'attributes']
  };
  
  // Add relationships if any
  if (resourceInfo.relationships && Object.keys(resourceInfo.relationships).length > 0) {
    const relationshipsSchema = { type: 'object', properties: {} };
    
    for (const [relName, relInfo] of Object.entries(resourceInfo.relationships)) {
      if (relInfo.canInclude) {
        if (relInfo.type === 'to-one') {
          relationshipsSchema.properties[relName] = {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  id: { type: 'string' }
                }
              }
            }
          };
        } else if (relInfo.type === 'to-many') {
          relationshipsSchema.properties[relName] = {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    id: { type: 'string' }
                  }
                }
              }
            }
          };
        }
      }
    }
    
    if (Object.keys(relationshipsSchema.properties).length > 0) {
      schemas[`${resourceName}Resource`].properties.relationships = relationshipsSchema;
    }
  }
  
  // Create request schema
  schemas[`${resourceName}CreateRequest`] = {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [resourceType] },
          attributes: { $ref: `#/components/schemas/${resourceName}Attributes` }
        },
        required: ['type', 'attributes']
      }
    },
    required: ['data']
  };
  
  // Update request schema (same as create but with optional fields)
  const updateAttributes = JSON.parse(JSON.stringify(attributesProperties));
  schemas[`${resourceName}UpdateRequest`] = {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [resourceType] },
          id: { type: 'string' },
          attributes: {
            type: 'object',
            properties: updateAttributes
          }
        },
        required: ['type', 'attributes']
      }
    },
    required: ['data']
  };
  
  // Single resource response
  schemas[`${resourceName}Response`] = {
    type: 'object',
    properties: {
      data: { $ref: `#/components/schemas/${resourceName}Resource` },
      included: {
        type: 'array',
        items: { type: 'object' }
      }
    }
  };
  
  // Collection response
  schemas[`${resourceName}CollectionResponse`] = {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: `#/components/schemas/${resourceName}Resource` }
      },
      meta: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          pageSize: { type: 'integer' },
          pageNumber: { type: 'integer' },
          totalPages: { type: 'integer' }
        }
      },
      links: {
        type: 'object',
        properties: {
          self: { type: 'string' },
          first: { type: 'string' },
          last: { type: 'string' },
          prev: { type: 'string' },
          next: { type: 'string' }
        }
      },
      included: {
        type: 'array',
        items: { type: 'object' }
      }
    }
  };
  
  return schemas;
}

/**
 * Build OpenAPI paths for a resource
 */
function buildResourcePaths(basePath, resourceType, resourceInfo, schemas, idProperty) {
  const paths = {};
  const resourceName = capitalizeFirst(resourceType);
  const endpoints = buildEndpoints(basePath, resourceType, resourceInfo.relationships);
  
  // Collection endpoint
  paths[`/${resourceType}`] = {
    get: {
      tags: [resourceType],
      summary: `List ${resourceType}`,
      operationId: `list${resourceName}`,
      parameters: buildQueryParameters(
        resourceInfo.searchableFields, 
        resourceInfo.relationships
      ),
      responses: {
        '200': {
          description: `${resourceName} collection`,
          content: {
            'application/vnd.api+json': {
              schema: { $ref: `#/components/schemas/${resourceName}CollectionResponse` }
            }
          }
        },
        '400': { $ref: '#/components/responses/ErrorResponse' }
      }
    }
  };
  
  // Add POST if create operation is available
  if (resourceInfo.operations?.create) {
    paths[`/${resourceType}`].post = {
      tags: [resourceType],
      summary: `Create ${resourceType}`,
      operationId: `create${resourceName}`,
      requestBody: {
        required: true,
        content: {
          'application/vnd.api+json': {
            schema: { $ref: `#/components/schemas/${resourceName}CreateRequest` },
            example: buildCreateExample(resourceType, resourceInfo)
          }
        }
      },
      responses: {
        '201': {
          description: `${resourceName} created`,
          content: {
            'application/vnd.api+json': {
              schema: { $ref: `#/components/schemas/${resourceName}Response` }
            }
          }
        },
        '400': { $ref: '#/components/responses/ErrorResponse' },
        '422': { $ref: '#/components/responses/ErrorResponse' }
      }
    };
  }
  
  // Single resource endpoint
  paths[`/${resourceType}/{id}`] = {
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' }
      }
    ]
  };
  
  // GET single resource
  if (resourceInfo.operations?.get) {
    paths[`/${resourceType}/{id}`].get = {
      tags: [resourceType],
      summary: `Get ${resourceType} by ID`,
      operationId: `get${resourceName}`,
      parameters: [
        {
          name: 'include',
          in: 'query',
          description: 'Include related resources',
          schema: { type: 'string' }
        }
      ],
      responses: {
        '200': {
          description: `${resourceName} found`,
          content: {
            'application/vnd.api+json': {
              schema: { $ref: `#/components/schemas/${resourceName}Response` }
            }
          }
        },
        '404': { $ref: '#/components/responses/ErrorResponse' }
      }
    };
  }
  
  // PATCH update
  if (resourceInfo.operations?.update) {
    paths[`/${resourceType}/{id}`].patch = {
      tags: [resourceType],
      summary: `Update ${resourceType}`,
      operationId: `update${resourceName}`,
      requestBody: {
        required: true,
        content: {
          'application/vnd.api+json': {
            schema: { $ref: `#/components/schemas/${resourceName}UpdateRequest` }
          }
        }
      },
      responses: {
        '200': {
          description: `${resourceName} updated`,
          content: {
            'application/vnd.api+json': {
              schema: { $ref: `#/components/schemas/${resourceName}Response` }
            }
          }
        },
        '400': { $ref: '#/components/responses/ErrorResponse' },
        '404': { $ref: '#/components/responses/ErrorResponse' },
        '422': { $ref: '#/components/responses/ErrorResponse' }
      }
    };
  }
  
  // DELETE
  if (resourceInfo.operations?.delete) {
    paths[`/${resourceType}/{id}`].delete = {
      tags: [resourceType],
      summary: `Delete ${resourceType}`,
      operationId: `delete${resourceName}`,
      responses: {
        '204': { description: `${resourceName} deleted` },
        '404': { $ref: '#/components/responses/ErrorResponse' }
      }
    };
  }
  
  // Bulk operations
  if (resourceInfo.operations?.bulk) {
    paths[`/${resourceType}/bulk`] = {};
    
    if (resourceInfo.operations.bulk.create) {
      paths[`/${resourceType}/bulk`].post = {
        tags: [resourceType],
        summary: `Bulk create ${resourceType}`,
        operationId: `bulkCreate${resourceName}`,
        requestBody: {
          required: true,
          content: {
            'application/vnd.api+json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: { $ref: `#/components/schemas/${resourceName}Attributes` }
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Resources created',
            content: {
              'application/vnd.api+json': {
                schema: { $ref: `#/components/schemas/${resourceName}CollectionResponse` }
              }
            }
          },
          '400': { $ref: '#/components/responses/ErrorResponse' }
        }
      };
    }
    
    if (resourceInfo.operations.bulk.update) {
      paths[`/${resourceType}/bulk`].patch = {
        tags: [resourceType],
        summary: `Bulk update ${resourceType}`,
        operationId: `bulkUpdate${resourceName}`,
        requestBody: {
          required: true,
          content: {
            'application/vnd.api+json': {
              schema: {
                type: 'object',
                properties: {
                  filter: { type: 'object' },
                  data: {
                    oneOf: [
                      { $ref: `#/components/schemas/${resourceName}Attributes` },
                      {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            attributes: { $ref: `#/components/schemas/${resourceName}Attributes` }
                          }
                        }
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Resources updated',
            content: {
              'application/vnd.api+json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'object' },
                    meta: {
                      type: 'object',
                      properties: {
                        updated: { type: 'integer' }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ErrorResponse' }
        }
      };
    }
    
    if (resourceInfo.operations.bulk.delete) {
      paths[`/${resourceType}/bulk`].delete = {
        tags: [resourceType],
        summary: `Bulk delete ${resourceType}`,
        operationId: `bulkDelete${resourceName}`,
        requestBody: {
          required: true,
          content: {
            'application/vnd.api+json': {
              schema: {
                type: 'object',
                properties: {
                  filter: { type: 'object' },
                  data: {
                    type: 'object',
                    properties: {
                      ids: {
                        type: 'array',
                        items: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Resources deleted',
            content: {
              'application/vnd.api+json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'object' },
                    meta: {
                      type: 'object',
                      properties: {
                        deleted: { type: 'integer' }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/ErrorResponse' }
        }
      };
    }
  }
  
  // Add relationship endpoints
  if (resourceInfo.relationships) {
    for (const [fieldName, relInfo] of Object.entries(resourceInfo.relationships)) {
      if (relInfo.endpoints && relInfo.canInclude) {
        // Relationship self endpoint
        const relPath = `/${resourceType}/{id}/relationships/${fieldName}`;
        paths[relPath] = {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          get: {
            tags: [resourceType],
            summary: `Get ${fieldName} relationship`,
            operationId: `get${resourceName}${capitalizeFirst(fieldName)}Relationship`,
            responses: {
              '200': {
                description: 'Relationship data',
                content: {
                  'application/vnd.api+json': {
                    schema: {
                      type: 'object',
                      properties: {
                        data: relInfo.type === 'to-one' 
                          ? { type: 'object' }
                          : { type: 'array', items: { type: 'object' } },
                        links: { type: 'object' }
                      }
                    }
                  }
                }
              },
              '404': { $ref: '#/components/responses/ErrorResponse' }
            }
          }
        };
        
        // Related resource endpoint
        const relatedPath = `/${resourceType}/{id}/${fieldName}`;
        paths[relatedPath] = {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          get: {
            tags: [resourceType],
            summary: `Get ${fieldName} related resource`,
            operationId: `get${resourceName}${capitalizeFirst(fieldName)}`,
            responses: {
              '200': {
                description: 'Related resource',
                content: {
                  'application/vnd.api+json': {
                    schema: { type: 'object' }
                  }
                }
              },
              '404': { $ref: '#/components/responses/ErrorResponse' }
            }
          }
        };
      }
    }
  }
  
  return paths;
}

/**
 * Build example for create request
 */
function buildCreateExample(resourceType, resourceInfo) {
  const attributes = {};
  
  for (const [fieldName, fieldDef] of Object.entries(resourceInfo.fields)) {
    // Skip virtual to-many relationships
    if (resourceInfo.relationships?.[fieldName]?.type === 'to-many') continue;
    
    attributes[fieldName] = generateExample(fieldDef, fieldName);
  }
  
  return {
    data: {
      type: resourceType,
      attributes
    }
  };
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}