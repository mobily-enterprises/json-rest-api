/**
 * OpenAPI (Swagger) documentation plugin
 */
export const OpenAPIPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'REST API with JSON:API specification',
      servers: [{ url: 'http://localhost:3000/api' }],
      contact: {},
      license: {},
      ...options
    };

    // Generate OpenAPI specification
    api.generateOpenAPISpec = () => {
      const spec = {
        openapi: '3.0.0',
        info: {
          title: defaultOptions.title,
          version: defaultOptions.version,
          description: defaultOptions.description,
          contact: defaultOptions.contact,
          license: defaultOptions.license
        },
        servers: defaultOptions.servers,
        paths: {},
        components: {
          schemas: {},
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT'
            },
            apiKey: {
              type: 'apiKey',
              in: 'header',
              name: 'X-API-Key'
            }
          },
          parameters: {
            idParam: {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Resource identifier'
            },
            typeParam: {
              name: 'type',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Resource type'
            }
          },
          responses: {
            NotFound: {
              description: 'Resource not found',
              content: {
                'application/vnd.api+json': {
                  schema: { $ref: '#/components/schemas/Error' }
                }
              }
            },
            ValidationError: {
              description: 'Validation failed',
              content: {
                'application/vnd.api+json': {
                  schema: { $ref: '#/components/schemas/Error' }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      };

      // Add error schema
      spec.components.schemas.Error = {
        type: 'object',
        properties: {
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                title: { type: 'string' },
                detail: { type: 'string' },
                source: {
                  type: 'object',
                  properties: {
                    pointer: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      };

      // Generate schemas from registered schemas
      for (const [type, schema] of api.schemas) {
        const jsonSchema = schemaToJsonSchema(schema);
        
        // Resource schema
        spec.components.schemas[`${type}Resource`] = {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: [type] },
            attributes: jsonSchema
          },
          required: ['type', 'attributes']
        };

        // Collection schema
        spec.components.schemas[`${type}Collection`] = {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: `#/components/schemas/${type}Resource` }
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
            }
          }
        };

        // Single resource response
        spec.components.schemas[`${type}Response`] = {
          type: 'object',
          properties: {
            data: { $ref: `#/components/schemas/${type}Resource` }
          }
        };

        // Generate paths
        spec.paths[`/${type}`] = {
          get: {
            tags: [type],
            summary: `List ${type}`,
            operationId: `list${capitalize(type)}`,
            parameters: [
              {
                name: 'filter',
                in: 'query',
                style: 'deepObject',
                explode: true,
                schema: { type: 'object' },
                description: 'Filter resources'
              },
              {
                name: 'sort',
                in: 'query',
                schema: { type: 'string' },
                description: 'Sort resources (use - for descending)'
              },
              {
                name: 'page[size]',
                in: 'query',
                schema: { type: 'integer', default: 10 },
                description: 'Page size'
              },
              {
                name: 'page[number]',
                in: 'query',
                schema: { type: 'integer', default: 1 },
                description: 'Page number'
              }
            ],
            responses: {
              200: {
                description: 'Success',
                content: {
                  'application/vnd.api+json': {
                    schema: { $ref: `#/components/schemas/${type}Collection` }
                  }
                }
              }
            }
          },
          post: {
            tags: [type],
            summary: `Create ${type}`,
            operationId: `create${capitalize(type)}`,
            requestBody: {
              required: true,
              content: {
                'application/vnd.api+json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: [type] },
                          attributes: jsonSchema
                        }
                      }
                    }
                  }
                }
              }
            },
            responses: {
              201: {
                description: 'Created',
                content: {
                  'application/vnd.api+json': {
                    schema: { $ref: `#/components/schemas/${type}Response` }
                  }
                }
              },
              422: { $ref: '#/components/responses/ValidationError' }
            }
          }
        };

        spec.paths[`/${type}/{id}`] = {
          parameters: [{ $ref: '#/components/parameters/idParam' }],
          get: {
            tags: [type],
            summary: `Get ${type}`,
            operationId: `get${capitalize(type)}`,
            responses: {
              200: {
                description: 'Success',
                content: {
                  'application/vnd.api+json': {
                    schema: { $ref: `#/components/schemas/${type}Response` }
                  }
                }
              },
              404: { $ref: '#/components/responses/NotFound' }
            }
          },
          patch: {
            tags: [type],
            summary: `Update ${type}`,
            operationId: `update${capitalize(type)}`,
            requestBody: {
              required: true,
              content: {
                'application/vnd.api+json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          type: { type: 'string', enum: [type] },
                          attributes: jsonSchema
                        }
                      }
                    }
                  }
                }
              }
            },
            responses: {
              200: {
                description: 'Success',
                content: {
                  'application/vnd.api+json': {
                    schema: { $ref: `#/components/schemas/${type}Response` }
                  }
                }
              },
              404: { $ref: '#/components/responses/NotFound' },
              422: { $ref: '#/components/responses/ValidationError' }
            }
          },
          delete: {
            tags: [type],
            summary: `Delete ${type}`,
            operationId: `delete${capitalize(type)}`,
            responses: {
              204: { description: 'No Content' },
              404: { $ref: '#/components/responses/NotFound' }
            }
          }
        };
      }

      return spec;
    };

    // Serve OpenAPI spec
    if (api.router) {
      api.router.get('/openapi.json', (req, res) => {
        res.json(api.generateOpenAPISpec());
      });

      // Serve Swagger UI
      api.router.get('/docs', (req, res) => {
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>${defaultOptions.title}</title>
            <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
          </head>
          <body>
            <div id="swagger-ui"></div>
            <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
            <script>
              SwaggerUIBundle({
                url: './openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                  SwaggerUIBundle.presets.apis,
                  SwaggerUIBundle.SwaggerUIStandalonePreset
                ]
              });
            </script>
          </body>
          </html>
        `);
      });
    }
  }
};

// Convert Schema to JSON Schema
function schemaToJsonSchema(schema) {
  const jsonSchema = {
    type: 'object',
    properties: {},
    required: []
  };

  for (const [field, definition] of Object.entries(schema.structure)) {
    const prop = { type: getJsonType(definition.type) };

    // Add constraints
    if (definition.min !== undefined) prop.minimum = definition.min;
    if (definition.max !== undefined) prop.maximum = definition.max;
    if (definition.enum) prop.enum = definition.enum;
    if (definition.pattern) prop.pattern = definition.pattern;
    if (definition.default !== undefined) prop.default = definition.default;
    if (definition.description) prop.description = definition.description;

    // String constraints
    if (definition.type === 'string') {
      if (definition.min) prop.minLength = definition.min;
      if (definition.max) prop.maxLength = definition.max;
    }

    jsonSchema.properties[field] = prop;

    if (definition.required) {
      jsonSchema.required.push(field);
    }
  }

  return jsonSchema;
}

function getJsonType(schemaType) {
  const typeMap = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    id: 'string',
    timestamp: 'integer',
    date: 'string',
    dateTime: 'string',
    array: 'array',
    object: 'object',
    serialize: 'string',
    blob: 'string'
  };
  return typeMap[schemaType] || 'string';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}