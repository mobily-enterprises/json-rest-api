# Creating Custom Storage Plugins for JSON REST API

This guide explains how to create your own storage plugin for the JSON REST API library. Whether you want to use in-memory storage, connect to a remote API, or integrate with a NoSQL database, this guide will show you how to implement the required interface.

## Table of Contents

1. [Introduction](#introduction)
2. [The Storage Contract](#the-storage-contract)
3. [JSON:API Response Format](#jsonapi-response-format)
4. [Complete Example: In-Memory Storage Plugin](#complete-example-in-memory-storage-plugin)
5. [Complete Example: Remote API Storage Plugin](#complete-example-remote-api-storage-plugin)
6. [Advanced Topics](#advanced-topics)
7. [Testing Your Storage Plugin](#testing-your-storage-plugin)
8. [Common Pitfalls & Best Practices](#common-pitfalls--best-practices)

## Introduction

Storage plugins are the bridge between the JSON REST API library and your data source. The REST API plugin handles all the HTTP routing, validation, permissions, and JSON:API formatting, while your storage plugin is responsible for actually storing and retrieving data.

### Why Create a Custom Storage Plugin?

- **In-Memory Storage**: For testing, prototyping, or caching
- **Remote APIs**: Proxy requests to another REST API or microservice
- **NoSQL Databases**: Connect to MongoDB, DynamoDB, or other document stores
- **Custom Logic**: Implement complex business rules or data transformations
- **Hybrid Storage**: Combine multiple data sources

### How It Works

The REST API plugin defines a contract of 8 helper methods that your storage plugin must implement. When a request comes in:

1. The REST API plugin handles the HTTP request
2. It validates the input and checks permissions
3. It calls your storage helper method with a context object
4. Your helper returns data in JSON:API format
5. The REST API plugin enriches the response and sends it back

## The Storage Contract

Your storage plugin must implement these 8 helper methods by assigning them to the `helpers` object:

### 1. `dataExists`
Check if a resource exists.

```javascript
helpers.dataExists = async ({ scopeName, context }) => {
  // Parameters:
  // - scopeName: string - The resource type (e.g., 'articles')
  // - context.id: string|number - The resource ID to check
  // - context.schemaInfo.tableName: string - Storage identifier
  // - context.schemaInfo.idProperty: string - Primary key field name
  // - context.db: any - Database connection (if using transactions)
  
  // Returns: boolean - true if exists, false otherwise
};
```

### 2. `dataGet`
Retrieve a single resource with full JSON:API features.

```javascript
helpers.dataGet = async ({ scopeName, context, runHooks }) => {
  // Parameters:
  // - scopeName: string - The resource type
  // - context.id: string|number - The resource ID
  // - context.queryParams.include: string[] - Related resources to include
  // - context.queryParams.fields: object - Sparse fieldsets
  // - context.schemaInfo: object - Schema information
  
  // Returns: JSON:API document with single resource
  // {
  //   data: { type, id, attributes, relationships },
  //   included: [...] // if includes requested
  // }
};
```

### 3. `dataGetMinimal`
Retrieve minimal resource data (used for permission checks).

```javascript
helpers.dataGetMinimal = async ({ scopeName, context }) => {
  // Parameters: Same as dataGet but ignores queryParams
  
  // Returns: JSON:API resource object or null
  // {
  //   type: 'articles',
  //   id: '123',
  //   attributes: { ... },
  //   relationships: { ... } // only belongsTo relationships
  // }
};
```

### 4. `dataQuery`
Query multiple resources with filtering, sorting, and pagination.

```javascript
helpers.dataQuery = async ({ scopeName, context, runHooks }) => {
  // Parameters:
  // - context.queryParams.filters: object - Filter conditions
  // - context.queryParams.sort: string[] - Sort fields (prefix - for DESC)
  // - context.queryParams.page: object - Pagination (size, number/after/before)
  // - context.queryParams.include: string[] - Related resources
  // - context.queryParams.fields: object - Sparse fieldsets
  
  // Returns: JSON:API document with resource array
  // {
  //   data: [...],
  //   included: [...],
  //   meta: { ... }, // pagination info
  //   links: { ... } // pagination links
  // }
};
```

### 5. `dataPost`
Create a new resource.

```javascript
helpers.dataPost = async ({ scopeName, context }) => {
  // Parameters:
  // - context.inputRecord: JSON:API document with new resource
  // - context.schemaInfo: object - Schema information
  
  // Returns: string|number - The ID of created resource
};
```

### 6. `dataPut`
Replace an entire resource (or create with specific ID).

```javascript
helpers.dataPut = async ({ scopeName, context }) => {
  // Parameters:
  // - context.id: string|number - Resource ID
  // - context.inputRecord: JSON:API document with full resource
  // - context.isCreate: boolean - true if creating, false if updating
  
  // Returns: void (throws error if not found when updating)
};
```

### 7. `dataPatch`
Partially update a resource.

```javascript
helpers.dataPatch = async ({ scopeName, context }) => {
  // Parameters:
  // - context.id: string|number - Resource ID
  // - context.inputRecord: JSON:API document with partial updates
  
  // Returns: void (throws error if not found)
};
```

### 8. `dataDelete`
Delete a resource.

```javascript
helpers.dataDelete = async ({ scopeName, context }) => {
  // Parameters:
  // - context.id: string|number - Resource ID
  
  // Returns: { success: true } (throws error if not found)
};
```

## JSON:API Response Format

Your storage plugin must return data in proper JSON:API format. Here are the key structures:

### Single Resource Format

```javascript
{
  data: {
    type: 'articles',
    id: '123',
    attributes: {
      title: 'My Article',
      content: 'Article content...',
      publishedAt: '2024-01-15T10:00:00Z'
    },
    relationships: {
      author: {
        data: { type: 'users', id: '456' }
      },
      tags: {
        data: [
          { type: 'tags', id: '1' },
          { type: 'tags', id: '2' }
        ]
      }
    }
  }
}
```

### Collection Format

```javascript
{
  data: [
    { type: 'articles', id: '1', attributes: {...}, relationships: {...} },
    { type: 'articles', id: '2', attributes: {...}, relationships: {...} }
  ],
  meta: {
    page: 1,
    pageSize: 20,
    pageCount: 5,
    total: 100
  },
  links: {
    first: '/articles?page[number]=1&page[size]=20',
    last: '/articles?page[number]=5&page[size]=20',
    next: '/articles?page[number]=2&page[size]=20'
  }
}
```

### With Included Resources

```javascript
{
  data: { type: 'articles', id: '123', ... },
  included: [
    {
      type: 'users',
      id: '456',
      attributes: {
        name: 'John Doe',
        email: 'john@example.com'
      }
    },
    {
      type: 'tags',
      id: '1',
      attributes: {
        name: 'Technology'
      }
    }
  ]
}
```

## Complete Example: In-Memory Storage Plugin

Here's a fully functional in-memory storage plugin:

```javascript
export const InMemoryStoragePlugin = {
  name: 'in-memory-storage',
  dependencies: ['rest-api'],

  install({ helpers, scopes, log }) {
    // In-memory data store
    const dataStore = new Map();
    
    // Helper to get collection for a scope
    const getCollection = (scopeName) => {
      if (!dataStore.has(scopeName)) {
        dataStore.set(scopeName, new Map());
      }
      return dataStore.get(scopeName);
    };
    
    // Helper to generate IDs
    let nextId = 1;
    const generateId = () => String(nextId++);
    
    // 1. CHECK EXISTS
    helpers.dataExists = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      return collection.has(String(context.id));
    };
    
    // 2. GET SINGLE RESOURCE
    helpers.dataGet = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const record = collection.get(String(context.id));
      
      if (!record) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      // Build JSON:API response
      const data = {
        type: scopeName,
        id: String(context.id),
        attributes: { ...record.attributes },
        relationships: {}
      };
      
      // Add relationships
      const scope = scopes[scopeName];
      const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
      
      for (const [relName, relDef] of Object.entries(schemaRelationships)) {
        if (relDef.type === 'belongsTo' && record.attributes[relDef.foreignKey]) {
          data.relationships[relName] = {
            data: {
              type: relDef.resource,
              id: String(record.attributes[relDef.foreignKey])
            }
          };
        } else if (relDef.type === 'hasMany' && record.relationships?.[relName]) {
          data.relationships[relName] = {
            data: record.relationships[relName].map(id => ({
              type: relDef.resource,
              id: String(id)
            }))
          };
        }
      }
      
      // Handle includes
      const included = [];
      if (context.queryParams.include?.length > 0) {
        for (const includePath of context.queryParams.include) {
          const relName = includePath.split('.')[0];
          const relationship = data.relationships[relName];
          
          if (relationship?.data) {
            const relData = Array.isArray(relationship.data) 
              ? relationship.data 
              : [relationship.data];
              
            for (const rel of relData) {
              const relCollection = getCollection(rel.type);
              const relRecord = relCollection.get(rel.id);
              if (relRecord) {
                included.push({
                  type: rel.type,
                  id: rel.id,
                  attributes: { ...relRecord.attributes }
                });
              }
            }
          }
        }
      }
      
      // Apply sparse fieldsets
      if (context.queryParams.fields?.[scopeName]) {
        const fields = context.queryParams.fields[scopeName].split(',');
        data.attributes = Object.fromEntries(
          Object.entries(data.attributes).filter(([key]) => fields.includes(key))
        );
      }
      
      return {
        data,
        ...(included.length > 0 && { included })
      };
    };
    
    // 3. GET MINIMAL
    helpers.dataGetMinimal = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const record = collection.get(String(context.id));
      
      if (!record) return null;
      
      const data = {
        type: scopeName,
        id: String(context.id),
        attributes: { ...record.attributes },
        relationships: {}
      };
      
      // Only include belongsTo relationships for minimal
      const scope = scopes[scopeName];
      const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
      
      for (const [relName, relDef] of Object.entries(schemaRelationships)) {
        if (relDef.type === 'belongsTo' && record.attributes[relDef.foreignKey]) {
          data.relationships[relName] = {
            data: {
              type: relDef.resource,
              id: String(record.attributes[relDef.foreignKey])
            }
          };
        }
      }
      
      return data;
    };
    
    // 4. QUERY RESOURCES
    helpers.dataQuery = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      let records = Array.from(collection.values());
      
      // Apply filters
      if (context.queryParams.filters) {
        records = records.filter(record => {
          return Object.entries(context.queryParams.filters).every(([field, value]) => {
            // Support nested field filtering (e.g., author.name)
            if (field.includes('.')) {
              // For simplicity, skip nested filters in this example
              return true;
            }
            return record.attributes[field] === value;
          });
        });
      }
      
      // Apply sorting
      if (context.queryParams.sort?.length > 0) {
        records.sort((a, b) => {
          for (const sortField of context.queryParams.sort) {
            const desc = sortField.startsWith('-');
            const field = desc ? sortField.substring(1) : sortField;
            
            const aVal = a.attributes[field];
            const bVal = b.attributes[field];
            
            if (aVal < bVal) return desc ? 1 : -1;
            if (aVal > bVal) return desc ? -1 : 1;
          }
          return 0;
        });
      }
      
      // Calculate pagination
      const page = context.queryParams.page || {};
      const pageSize = Math.min(page.size || 20, 100);
      const pageNumber = page.number || 1;
      const total = records.length;
      const pageCount = Math.ceil(total / pageSize);
      
      // Apply pagination
      const start = (pageNumber - 1) * pageSize;
      const paginatedRecords = records.slice(start, start + pageSize);
      
      // Build response
      const data = paginatedRecords.map((record, index) => ({
        type: scopeName,
        id: record.id,
        attributes: { ...record.attributes },
        relationships: {}
      }));
      
      // Add relationships to each record
      const scope = scopes[scopeName];
      const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
      
      data.forEach((item, index) => {
        const record = paginatedRecords[index];
        for (const [relName, relDef] of Object.entries(schemaRelationships)) {
          if (relDef.type === 'belongsTo' && record.attributes[relDef.foreignKey]) {
            item.relationships[relName] = {
              data: {
                type: relDef.resource,
                id: String(record.attributes[relDef.foreignKey])
              }
            };
          } else if (relDef.type === 'hasMany' && record.relationships?.[relName]) {
            item.relationships[relName] = {
              data: record.relationships[relName].map(id => ({
                type: relDef.resource,
                id: String(id)
              }))
            };
          }
        }
      });
      
      // Handle includes
      const included = [];
      if (context.queryParams.include?.length > 0) {
        const includedIds = new Set();
        
        for (const item of data) {
          for (const includePath of context.queryParams.include) {
            const relName = includePath.split('.')[0];
            const relationship = item.relationships[relName];
            
            if (relationship?.data) {
              const relData = Array.isArray(relationship.data) 
                ? relationship.data 
                : [relationship.data];
                
              for (const rel of relData) {
                const key = `${rel.type}:${rel.id}`;
                if (!includedIds.has(key)) {
                  includedIds.add(key);
                  const relCollection = getCollection(rel.type);
                  const relRecord = relCollection.get(rel.id);
                  if (relRecord) {
                    included.push({
                      type: rel.type,
                      id: rel.id,
                      attributes: { ...relRecord.attributes }
                    });
                  }
                }
              }
            }
          }
        }
      }
      
      // Build pagination links
      const baseUrl = `/${scopeName}`;
      const queryString = new URLSearchParams();
      if (page.size) queryString.set('page[size]', pageSize);
      
      const links = {
        first: `${baseUrl}?${queryString}&page[number]=1`,
        last: `${baseUrl}?${queryString}&page[number]=${pageCount}`,
      };
      
      if (pageNumber > 1) {
        links.prev = `${baseUrl}?${queryString}&page[number]=${pageNumber - 1}`;
      }
      if (pageNumber < pageCount) {
        links.next = `${baseUrl}?${queryString}&page[number]=${pageNumber + 1}`;
      }
      
      return {
        data,
        ...(included.length > 0 && { included }),
        meta: {
          page: pageNumber,
          pageSize,
          pageCount,
          total
        },
        links
      };
    };
    
    // 5. CREATE RESOURCE
    helpers.dataPost = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = generateId();
      
      const record = {
        id,
        attributes: { ...context.inputRecord.data.attributes },
        relationships: {}
      };
      
      // Extract belongsTo foreign keys from relationships
      if (context.inputRecord.data.relationships) {
        const scope = scopes[scopeName];
        const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
        
        for (const [relName, relData] of Object.entries(context.inputRecord.data.relationships)) {
          const relDef = schemaRelationships[relName];
          if (relDef?.type === 'belongsTo' && relData.data) {
            record.attributes[relDef.foreignKey] = relData.data.id;
          } else if (relDef?.type === 'hasMany' && relData.data) {
            record.relationships[relName] = relData.data.map(item => item.id);
          }
        }
      }
      
      collection.set(id, record);
      return id;
    };
    
    // 6. REPLACE RESOURCE
    helpers.dataPut = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = String(context.id);
      
      if (!context.isCreate && !collection.has(id)) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      const record = {
        id,
        attributes: { ...context.inputRecord.data.attributes },
        relationships: {}
      };
      
      // Extract belongsTo foreign keys
      if (context.inputRecord.data.relationships) {
        const scope = scopes[scopeName];
        const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
        
        for (const [relName, relData] of Object.entries(context.inputRecord.data.relationships)) {
          const relDef = schemaRelationships[relName];
          if (relDef?.type === 'belongsTo' && relData.data) {
            record.attributes[relDef.foreignKey] = relData.data.id;
          } else if (relDef?.type === 'hasMany' && relData.data) {
            record.relationships[relName] = relData.data.map(item => item.id);
          }
        }
      }
      
      collection.set(id, record);
    };
    
    // 7. UPDATE RESOURCE
    helpers.dataPatch = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = String(context.id);
      const existing = collection.get(id);
      
      if (!existing) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      // Merge attributes
      if (context.inputRecord.data.attributes) {
        Object.assign(existing.attributes, context.inputRecord.data.attributes);
      }
      
      // Update relationships
      if (context.inputRecord.data.relationships) {
        const scope = scopes[scopeName];
        const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
        
        for (const [relName, relData] of Object.entries(context.inputRecord.data.relationships)) {
          const relDef = schemaRelationships[relName];
          if (relDef?.type === 'belongsTo') {
            if (relData.data === null) {
              delete existing.attributes[relDef.foreignKey];
            } else if (relData.data) {
              existing.attributes[relDef.foreignKey] = relData.data.id;
            }
          } else if (relDef?.type === 'hasMany' && relData.data) {
            existing.relationships[relName] = relData.data.map(item => item.id);
          }
        }
      }
    };
    
    // 8. DELETE RESOURCE
    helpers.dataDelete = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = String(context.id);
      
      if (!collection.has(id)) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      collection.delete(id);
      return { success: true };
    };
    
    log.info('InMemoryStoragePlugin installed - data stored in memory');
  }
};
```

## Complete Example: Remote API Storage Plugin

Here's a storage plugin that proxies requests to a remote API:

```javascript
export const RemoteApiStoragePlugin = {
  name: 'remote-api-storage',
  dependencies: ['rest-api'],

  install({ helpers, vars, pluginOptions, log }) {
    const baseUrl = pluginOptions.baseUrl || 'https://api.example.com';
    const headers = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      // Add authentication if needed
      ...(pluginOptions.token && { 'Authorization': `Bearer ${pluginOptions.token}` }),
      ...(pluginOptions.headers || {})
    };
    
    // Helper to make fetch requests
    const fetchApi = async (path, options = {}) => {
      const url = `${baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...options.headers
        }
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ errors: [{ title: 'Request failed' }] }));
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError(
          error.errors?.[0]?.title || 'Remote API error',
          {
            subtype: response.status === 404 ? 'not_found' : 'remote_error',
            statusCode: response.status,
            errors: error.errors
          }
        );
      }
      
      return response.json();
    };
    
    // 1. CHECK EXISTS
    helpers.dataExists = async ({ scopeName, context }) => {
      try {
        await fetchApi(`/${scopeName}/${context.id}`, { method: 'HEAD' });
        return true;
      } catch (error) {
        if (error.statusCode === 404) return false;
        throw error;
      }
    };
    
    // 2. GET SINGLE RESOURCE
    helpers.dataGet = async ({ scopeName, context }) => {
      const queryParams = new URLSearchParams();
      
      // Add include parameter
      if (context.queryParams.include?.length > 0) {
        queryParams.set('include', context.queryParams.include.join(','));
      }
      
      // Add sparse fieldsets
      if (context.queryParams.fields) {
        for (const [type, fields] of Object.entries(context.queryParams.fields)) {
          queryParams.set(`fields[${type}]`, fields);
        }
      }
      
      const query = queryParams.toString();
      const path = `/${scopeName}/${context.id}${query ? `?${query}` : ''}`;
      
      return await fetchApi(path);
    };
    
    // 3. GET MINIMAL
    helpers.dataGetMinimal = async ({ scopeName, context }) => {
      const response = await fetchApi(`/${scopeName}/${context.id}`);
      return response.data;
    };
    
    // 4. QUERY RESOURCES
    helpers.dataQuery = async ({ scopeName, context }) => {
      const queryParams = new URLSearchParams();
      
      // Add filters
      if (context.queryParams.filters) {
        for (const [field, value] of Object.entries(context.queryParams.filters)) {
          queryParams.set(`filter[${field}]`, value);
        }
      }
      
      // Add sorting
      if (context.queryParams.sort?.length > 0) {
        queryParams.set('sort', context.queryParams.sort.join(','));
      }
      
      // Add pagination
      if (context.queryParams.page) {
        for (const [key, value] of Object.entries(context.queryParams.page)) {
          queryParams.set(`page[${key}]`, value);
        }
      }
      
      // Add includes
      if (context.queryParams.include?.length > 0) {
        queryParams.set('include', context.queryParams.include.join(','));
      }
      
      // Add sparse fieldsets
      if (context.queryParams.fields) {
        for (const [type, fields] of Object.entries(context.queryParams.fields)) {
          queryParams.set(`fields[${type}]`, fields);
        }
      }
      
      const query = queryParams.toString();
      const path = `/${scopeName}${query ? `?${query}` : ''}`;
      
      const response = await fetchApi(path);
      
      // Ensure proper structure
      return {
        data: response.data || [],
        included: response.included,
        meta: response.meta,
        links: response.links
      };
    };
    
    // 5. CREATE RESOURCE
    helpers.dataPost = async ({ scopeName, context }) => {
      const response = await fetchApi(`/${scopeName}`, {
        method: 'POST',
        body: JSON.stringify(context.inputRecord)
      });
      
      return response.data.id;
    };
    
    // 6. REPLACE RESOURCE
    helpers.dataPut = async ({ scopeName, context }) => {
      await fetchApi(`/${scopeName}/${context.id}`, {
        method: 'PUT',
        body: JSON.stringify(context.inputRecord)
      });
    };
    
    // 7. UPDATE RESOURCE
    helpers.dataPatch = async ({ scopeName, context }) => {
      await fetchApi(`/${scopeName}/${context.id}`, {
        method: 'PATCH',
        body: JSON.stringify(context.inputRecord)
      });
    };
    
    // 8. DELETE RESOURCE
    helpers.dataDelete = async ({ scopeName, context }) => {
      await fetchApi(`/${scopeName}/${context.id}`, {
        method: 'DELETE'
      });
      
      return { success: true };
    };
    
    log.info(`RemoteApiStoragePlugin installed - proxying to ${baseUrl}`);
  }
};
```

## Advanced Topics

### Transaction Support

If your storage supports transactions, the `context.db` parameter will automatically contain the transaction when one is active:

```javascript
helpers.dataPost = async ({ scopeName, context }) => {
  // context.db is automatically the transaction if one is active,
  // or the base connection if not in a transaction
  const db = context.db || defaultConnection;
  
  // For storage that supports transactions:
  if (context.transaction) {
    // We're in a transaction - ensure all operations use it
    await db.insert(scopeName, record);
  } else {
    // No transaction - use regular connection
    await db.insert(scopeName, record);
  }
};
```

### Sparse Fieldsets

When `context.queryParams.fields` is provided, only return the requested fields:

```javascript
// Example: fields[articles]=title,summary
// Can be a string or array depending on how it was parsed
const requestedFields = context.queryParams.fields[scopeName];
if (requestedFields) {
  const fields = Array.isArray(requestedFields) 
    ? requestedFields 
    : requestedFields.split(',');
    
  // Filter attributes to only include requested fields
  data.attributes = Object.fromEntries(
    Object.entries(data.attributes).filter(([key]) => fields.includes(key))
  );
  
  // Handle nested field requests like fields[articles]=title,author.name
  // The REST API plugin will handle nested field filtering for included resources
}
```

### Computed Fields and Dependencies

The REST API plugin handles computed fields, but you may need to ensure dependency fields are included:

```javascript
// context.computedDependencies tells you which fields are needed for computations
// Always include these fields even if not explicitly requested
```

### Search and Filter Implementation

For complex filtering, you'll need to parse the search schema:

```javascript
// context.schemaInfo.searchSchema defines what can be filtered
// context.queryParams.filters contains the actual filter values
```

### Error Handling

Always use the proper error classes:

```javascript
import { RestApiResourceError, RestApiValidationError } from '../../lib/rest-api-errors.js';

// For not found errors
throw new RestApiResourceError('Resource not found', {
  subtype: 'not_found',
  resourceType: scopeName,
  resourceId: id
});

// For validation errors
throw new RestApiValidationError('Invalid filter value', {
  fields: ['filters.status'],
  violations: [{
    field: 'filters.status',
    rule: 'invalid_value',
    message: 'Status must be one of: draft, published'
  }]
});
```

## Testing Your Storage Plugin

### Using the Test Suite

The JSON REST API test suite can be adapted for your storage plugin:

```javascript
import { createBasicApi } from './tests/fixtures/api-configs.js';
import { YourStoragePlugin } from './your-storage-plugin.js';

describe('Your Storage Plugin', () => {
  let api;
  
  before(async () => {
    // Create API with your storage instead of Knex
    api = await createApi({
      plugins: [
        [RestApiPlugin, { /* options */ }],
        [YourStoragePlugin, { /* options */ }],
        // ... other plugins
      ]
    });
  });
  
  it('should create and retrieve a resource', async () => {
    const result = await api.resources.articles.post({
      inputRecord: {
        data: {
          type: 'articles',
          attributes: {
            title: 'Test Article'
          }
        }
      }
    });
    
    const article = await api.resources.articles.get({ id: result.id });
    expect(article.data.attributes.title).to.equal('Test Article');
  });
});
```

### Storage-Specific Tests

Test edge cases specific to your storage:

```javascript
describe('Edge Cases', () => {
  it('should handle concurrent writes', async () => {
    // Test your storage's concurrency handling
  });
  
  it('should handle large datasets', async () => {
    // Test pagination with many records
  });
  
  it('should handle network failures gracefully', async () => {
    // For remote storage, test connection issues
  });
});
```

## Common Pitfalls & Best Practices

### 1. ID Type Conversion

JSON:API requires IDs to be strings, but your storage might use numbers:

```javascript
// Always convert IDs to strings in responses
data.id = String(record.id);

// Accept both strings and numbers in inputs
const id = String(context.id);
```

### 2. Relationship Format

Relationships must follow the JSON:API format exactly:

```javascript
// Correct - single relationship
relationships: {
  author: {
    data: { type: 'users', id: '123' }
  }
}

// Correct - to-many relationship
relationships: {
  tags: {
    data: [
      { type: 'tags', id: '1' },
      { type: 'tags', id: '2' }
    ]
  }
}

// Correct - empty relationship
relationships: {
  author: {
    data: null
  }
}
```

### 3. Error Response Format

Errors should include proper subtypes:

```javascript
// Use these standard subtypes
'not_found' - Resource doesn't exist
'validation_error' - Input validation failed
'permission_denied' - Insufficient permissions
'conflict' - Resource conflict (e.g., duplicate)
```

### 4. Pagination Meta

Always include pagination metadata for queries:

```javascript
meta: {
  page: 1,        // Current page
  pageSize: 20,   // Items per page
  pageCount: 5,   // Total pages
  total: 100      // Total items
}
```

### 5. Include Deduplication

When returning included resources, avoid duplicates:

```javascript
const includedMap = new Map();
// Use type:id as key to ensure uniqueness
includedMap.set(`${type}:${id}`, resource);
const included = Array.from(includedMap.values());
```

### 6. Performance Considerations

- Cache frequently accessed data
- Implement efficient filtering at the storage level
- Use bulk operations where possible
- Consider implementing cursor-based pagination for large datasets

### 7. Schema Information

Use the schema information provided in context:

```javascript
// Available in context.schemaInfo:
- tableName: Storage identifier for the resource
- idProperty: Primary key field name (might not be 'id')
- schema: Full schema definition
- schemaRelationships: Relationship definitions
- searchSchema: Filterable fields and their rules
```

## Conclusion

Creating a custom storage plugin gives you complete control over how data is stored and retrieved while leveraging all the features of the JSON REST API library. The key is to properly implement the 8 required helpers and ensure all responses follow the JSON:API specification.

Remember:
- Start with the in-memory example and adapt it to your needs
- Always return proper JSON:API formatted responses
- Use the provided error classes for consistency
- Test thoroughly with the existing test suite
- Refer to the Knex plugin source code for complex implementations

Happy coding!