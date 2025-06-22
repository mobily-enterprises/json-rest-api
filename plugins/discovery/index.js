/**
 * Discovery Plugin for json-rest-api
 * Provides OpenAPI and JSON Schema discovery endpoints
 */

import { generateOpenAPI } from './formats/openapi.js';
import { generateJsonSchema, generateResourceJsonSchema } from './formats/jsonschema.js';
import yaml from 'js-yaml';

export const DiscoveryPlugin = {
  install(api, options = {}) {
    // Default options
    const pluginOptions = {
      basePath: '/api',
      formats: ['openapi', 'jsonschema'],
      includeExamples: true,
      ...options
    };
    
    // Store the install function for manual installation if needed
    api._installDiscoveryRoutes = () => {
      if (api.router && !api._discoveryRoutesInstalled) {
        installRoutes(api, pluginOptions);
        api._discoveryRoutesInstalled = true;
      }
    };
    
    // Try to install immediately if router exists
    api._installDiscoveryRoutes();
    
    // Add discovery methods to API instance
    api.discovery = {
      openapi: (user = null, formatOptions = {}) => 
        generateOpenAPI(api, user, { ...pluginOptions, ...formatOptions }),
      
      jsonschema: (user = null, formatOptions = {}) => 
        generateJsonSchema(api, user, { ...pluginOptions, ...formatOptions }),
      
      resourceSchema: (resourceType, user = null, formatOptions = {}) =>
        generateResourceJsonSchema(api, user, resourceType, { ...pluginOptions, ...formatOptions })
    };
  }
};

/**
 * Install discovery routes
 */
function installRoutes(api, options) {
  const router = api.router;
  const basePath = options.basePath || '/api';
  
  // IMPORTANT: Discovery routes must be added BEFORE the generic /:type routes
  // We need to use a more specific path or register them earlier
  
  // Helper to get user from request
  const getUserFromRequest = (req) => {
    // Use the same method as HTTPPlugin if available
    if (options.getUserFromRequest) {
      return options.getUserFromRequest(req);
    }
    return req.user || null;
  };
  
  // OpenAPI endpoint (JSON)
  if (options.formats.includes('openapi')) {
    router.get(`/discovery/openapi`, async (req, res) => {
      try {
        const user = getUserFromRequest(req);
        const spec = await generateOpenAPI(api, user, {
          ...options,
          servers: options.servers || [{
            url: `${req.protocol}://${req.get('host')}${basePath}`,
            description: 'Current server'
          }]
        });
        
        res.json(spec);
      } catch (error) {
        res.status(500).json({
          errors: [{
            status: '500',
            title: 'Internal Server Error',
            detail: 'Failed to generate OpenAPI specification'
          }]
        });
      }
    });
    
    // OpenAPI endpoint (YAML)
    router.get(`/discovery/openapi.yaml`, async (req, res) => {
      try {
        const user = getUserFromRequest(req);
        const spec = await generateOpenAPI(api, user, {
          ...options,
          servers: options.servers || [{
            url: `${req.protocol}://${req.get('host')}${basePath}`,
            description: 'Current server'
          }]
        });
        
        const yamlStr = yaml.dump(spec, {
          indent: 2,
          lineWidth: 120,
          noRefs: true
        });
        
        res.type('text/yaml').send(yamlStr);
      } catch (error) {
        res.status(500).json({
          errors: [{
            status: '500',
            title: 'Internal Server Error',
            detail: 'Failed to generate OpenAPI specification'
          }]
        });
      }
    });
  }
  
  // JSON Schema endpoint
  if (options.formats.includes('jsonschema')) {
    // All schemas
    router.get(`/discovery/jsonschema`, async (req, res) => {
      try {
        const user = getUserFromRequest(req);
        const schema = await generateJsonSchema(api, user, options);
        
        res.json(schema);
      } catch (error) {
        res.status(500).json({
          errors: [{
            status: '500',
            title: 'Internal Server Error',
            detail: 'Failed to generate JSON Schema'
          }]
        });
      }
    });
    
    // Individual resource schema
    router.get(`/discovery/jsonschema/:resource`, async (req, res) => {
      try {
        const user = getUserFromRequest(req);
        const resourceType = req.params.resource;
        
        const schema = await generateResourceJsonSchema(api, user, resourceType, options);
        
        if (!schema) {
          res.status(404).json({
            errors: [{
              status: '404',
              title: 'Not Found',
              detail: `Resource type '${resourceType}' not found or not accessible`
            }]
          });
          return;
        }
        
        res.json(schema);
      } catch (error) {
        res.status(500).json({
          errors: [{
            status: '500',
            title: 'Internal Server Error',
            detail: 'Failed to generate JSON Schema'
          }]
        });
      }
    });
  }
  
  // Main discovery endpoint that lists available formats
  router.get(`/discovery`, async (req, res) => {
    const user = getUserFromRequest(req);
    const baseUrl = `${req.protocol}://${req.get('host')}${basePath}`;
    
    const response = {
      jsonapi: { version: '1.0' },
      meta: {
        name: api.options.name || 'API',
        version: api.options.version || '1.0.0',
        formats: {}
      },
      links: {
        self: `${baseUrl}/discovery`
      }
    };
    
    // Add available format links
    if (options.formats.includes('openapi')) {
      response.meta.formats.openapi = {
        json: `${baseUrl}/discovery/openapi`,
        yaml: `${baseUrl}/discovery/openapi.yaml`
      };
    }
    
    if (options.formats.includes('jsonschema')) {
      response.meta.formats.jsonschema = {
        all: `${baseUrl}/discovery/jsonschema`,
        byResource: `${baseUrl}/discovery/jsonschema/{resource}`
      };
    }
    
    res.json(response);
  });
  
  // Add Swagger UI endpoint if configured
  if (options.swaggerUI) {
    router.get(`/docs`, (req, res) => {
      const swaggerUIHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${api.options.name || 'API'} - Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${req.protocol}://${req.get('host')}${basePath}/discovery/openapi",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        tryItOutEnabled: ${options.swaggerUI.tryItOut !== false}
      });
    }
  </script>
</body>
</html>`;
      
      res.type('text/html').send(swaggerUIHtml);
    });
  }
}

// Export individual format generators for direct use
export { generateOpenAPI } from './formats/openapi.js';
export { generateJsonSchema, generateResourceJsonSchema } from './formats/jsonschema.js';