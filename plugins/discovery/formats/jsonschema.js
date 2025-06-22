/**
 * JSON Schema format generator for discovery
 */

import { extractPermittedSchema } from '../core.js';
import { fieldToJsonSchema } from '../utils.js';

/**
 * Generate JSON Schema for all resources
 * @param {Api} api - The API instance
 * @param {Object} user - The current user
 * @param {Object} options - Discovery options
 * @returns {Object} JSON Schema definitions
 */
export async function generateJsonSchema(api, user, options = {}) {
  const { resources, meta } = await extractPermittedSchema(api, user);
  
  const baseUrl = options.baseUrl || `https://api.example.com/schemas`;
  
  // Root schema that references all resources
  const rootSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${baseUrl}/root`,
    title: meta.apiName,
    description: `JSON Schema definitions for ${meta.apiName} API`,
    type: 'object',
    definitions: {},
    properties: {}
  };
  
  // Process each resource
  for (const [resourceType, resourceInfo] of Object.entries(resources)) {
    const resourceSchema = buildResourceSchema(
      resourceType, 
      resourceInfo, 
      baseUrl,
      api.options.idProperty || 'id'
    );
    
    // Add to definitions
    rootSchema.definitions[resourceType] = resourceSchema;
    
    // Add reference in properties
    rootSchema.properties[resourceType] = {
      $ref: `#/definitions/${resourceType}`
    };
  }
  
  return rootSchema;
}

/**
 * Generate individual resource schemas
 * @param {Api} api - The API instance
 * @param {Object} user - The current user
 * @param {string} resourceType - Specific resource type
 * @param {Object} options - Discovery options
 * @returns {Object} Resource JSON Schema
 */
export async function generateResourceJsonSchema(api, user, resourceType, options = {}) {
  const { resources } = await extractPermittedSchema(api, user);
  
  if (!resources[resourceType]) {
    return null;
  }
  
  const baseUrl = options.baseUrl || `https://api.example.com/schemas`;
  
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${baseUrl}/${resourceType}`,
    ...buildResourceSchema(
      resourceType, 
      resources[resourceType], 
      baseUrl,
      api.options.idProperty || 'id'
    )
  };
}

/**
 * Build JSON Schema for a resource
 */
function buildResourceSchema(resourceType, resourceInfo, baseUrl, idProperty) {
  const properties = {};
  const required = [];
  
  // Always include ID
  properties[idProperty] = {
    type: 'string',
    description: 'Unique identifier'
  };
  
  // Process fields
  for (const [fieldName, fieldDef] of Object.entries(resourceInfo.fields)) {
    // Skip virtual to-many relationships in the main schema
    if (resourceInfo.relationships?.[fieldName]?.type === 'to-many') {
      continue;
    }
    
    properties[fieldName] = fieldToJsonSchema(fieldDef, fieldName);
    
    // Add relationship references
    if (resourceInfo.relationships?.[fieldName]) {
      const relInfo = resourceInfo.relationships[fieldName];
      if (relInfo.type === 'to-one') {
        // Reference to related resource
        properties[fieldName]['x-relationship'] = {
          resource: relInfo.resource,
          type: 'to-one'
        };
      }
    }
    
    if (fieldDef.required) {
      required.push(fieldName);
    }
  }
  
  const schema = {
    title: capitalizeFirst(resourceType),
    type: 'object',
    properties,
    additionalProperties: false
  };
  
  if (required.length > 0) {
    schema.required = required;
  }
  
  // Add relationship definitions as sub-schemas
  if (resourceInfo.relationships && Object.keys(resourceInfo.relationships).length > 0) {
    schema.relationships = {};
    
    for (const [fieldName, relInfo] of Object.entries(resourceInfo.relationships)) {
      if (relInfo.type === 'to-many' && relInfo.canInclude) {
        schema.relationships[fieldName] = {
          type: 'array',
          items: {
            type: 'string',
            description: `ID reference to ${relInfo.resource}`
          },
          'x-relationship': {
            resource: relInfo.resource,
            type: 'to-many',
            foreignKey: relInfo.foreignKey
          }
        };
      }
    }
    
    // Only add relationships property if we actually have any
    if (Object.keys(schema.relationships).length === 0) {
      delete schema.relationships;
    }
  }
  
  return schema;
}

/**
 * Generate JSON Schema for bulk operations
 */
export function generateBulkSchemas(resourceType, resourceInfo, baseUrl) {
  const schemas = {};
  const resourceName = capitalizeFirst(resourceType);
  
  // Bulk create schema
  schemas[`${resourceName}BulkCreate`] = {
    $id: `${baseUrl}/${resourceType}/bulk-create`,
    title: `Bulk Create ${resourceName}`,
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: {
          $ref: `${baseUrl}/${resourceType}#/properties`
        }
      }
    },
    required: ['data']
  };
  
  // Bulk update schema - by filter
  schemas[`${resourceName}BulkUpdateByFilter`] = {
    $id: `${baseUrl}/${resourceType}/bulk-update-filter`,
    title: `Bulk Update ${resourceName} by Filter`,
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        description: 'Filter criteria'
      },
      data: {
        type: 'object',
        description: 'Fields to update'
      }
    },
    required: ['filter', 'data']
  };
  
  // Bulk update schema - by IDs
  schemas[`${resourceName}BulkUpdateByIds`] = {
    $id: `${baseUrl}/${resourceType}/bulk-update-ids`,
    title: `Bulk Update ${resourceName} by IDs`,
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            attributes: {
              type: 'object'
            }
          },
          required: ['id', 'attributes']
        }
      }
    },
    required: ['data']
  };
  
  // Bulk delete schema
  schemas[`${resourceName}BulkDelete`] = {
    $id: `${baseUrl}/${resourceType}/bulk-delete`,
    title: `Bulk Delete ${resourceName}`,
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        description: 'Filter criteria'
      },
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
  };
  
  return schemas;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}