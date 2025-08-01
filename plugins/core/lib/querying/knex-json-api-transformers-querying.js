import { getForeignKeyFields as getForeignKeyFieldsFromUtils } from '../querying-writing/field-utils.js';
import { RELATIONSHIPS_KEY, RELATIONSHIP_METADATA_KEY, ROW_NUMBER_KEY, COMPUTED_DEPENDENCIES_KEY, getSchemaStructure } from '../querying-writing/knex-constants.js';

/**
 * Transforms a flat database record into JSON:API resource format
 * 
 * @private
 * @param {Object} scope - Scope containing schema and configuration
 * @param {Object} record - Database record to transform
 * @param {Object} deps - Dependencies including context with scopeName and polymorphicFields
 * @returns {Object|null} JSON:API resource object or null if no record
 * 
 * @example
 * // Input: Database record with foreign keys and internal fields
 * const record = { 
 *   id: 1, 
 *   title: 'Hello World', 
 *   content: 'Article content',
 *   author_id: 2,           // Foreign key
 *   category_id: 5,         // Foreign key
 *   __$jsonrestapi_rn$__: 1 // Internal field
 * };
 * 
 * const jsonApiResource = toJsonApi(scope, record, deps);
 * 
 * // Output: Clean JSON:API resource
 * // {
 * //   type: 'articles',
 * //   id: '1',
 * //   attributes: {
 * //     title: 'Hello World',
 * //     content: 'Article content'
 * //     // Note: author_id, category_id, and internal fields are removed
 * //   }
 * // }
 * 
 * @example
 * // Input: Polymorphic record
 * const record = {
 *   id: 10,
 *   text: 'Great article!',
 *   commentable_type: 'articles',  // Polymorphic type field
 *   commentable_id: 1               // Polymorphic id field
 * };
 * // deps.context.polymorphicFields = Set(['commentable_type', 'commentable_id'])
 * 
 * const jsonApiResource = toJsonApi(scope, record, deps);
 * 
 * // Output: Polymorphic fields filtered out
 * // {
 * //   type: 'comments',
 * //   id: '10',
 * //   attributes: {
 * //     text: 'Great article!'
 * //   }
 * // }
 * 
 * @description
 * Used by:
 * - toJsonApiRecord calls this as the core transformation logic
 * - buildJsonApiResponse uses this indirectly through toJsonApiRecord
 * 
 * Purpose:
 * - Separates database structure from API structure
 * - Filters out foreign keys that become relationships in JSON:API
 * - Removes internal fields used for query optimization
 * - Ensures clean attribute objects without implementation details
 * 
 * Data flow:
 * - Called after database query returns flat records
 * - Transforms each record individually
 * - Output feeds into relationship building and response assembly
 */
const toJsonApi = (scope, record, deps) => {
  if (!record) return null;
  
  const { 
    vars: { 
      schemaInfo: { schema }
    }
  } = scope;
  
  const { context } = deps;
  const scopeName = context.scopeName;
  const idProperty = context.schemaInfo?.idProperty || 'id';
  const polymorphicFields = context.polymorphicFields || new Set();
  
  const { id, ...allAttributes } = record;
  
  const foreignKeys = schema ? getForeignKeyFieldsFromUtils(schema) : new Set();
  
  const internalFields = new Set([
    RELATIONSHIPS_KEY,
    RELATIONSHIP_METADATA_KEY,
    ROW_NUMBER_KEY,
    COMPUTED_DEPENDENCIES_KEY
  ]);
  
  const attributes = {};
  Object.entries(allAttributes).forEach(([key, value]) => {
    if (!foreignKeys.has(key) && !polymorphicFields.has(key) && !internalFields.has(key) && key !== idProperty) {
      attributes[key] = value;
    }
  });
  
  return {
    type: scopeName,
    id: String(id),
    attributes
  };
};

/**
 * Converts a database record to JSON:API format with proper field filtering
 * 
 * @param {Object} scope - Scope containing schema and relationship definitions
 * @param {Object} record - Raw database record
 * @param {string} scopeName - Resource type name
 * @returns {Object} JSON:API formatted resource
 * 
 * @example
 * // Input: Database record with various field types
 * const record = { 
 *   id: 1, 
 *   title: 'My Article', 
 *   author_id: 2,      // belongsTo relationship
 *   category_id: 3,    // belongsTo relationship
 *   views: 150,
 *   published: true
 * };
 * 
 * const jsonApi = toJsonApiRecord(scope, record, 'articles');
 * 
 * // Output: Foreign keys filtered out
 * // {
 * //   type: 'articles',
 * //   id: '1',
 * //   attributes: {
 * //     title: 'My Article',
 * //     views: 150,
 * //     published: true
 * //   }
 * // }
 * 
 * @example
 * // Input: Record with polymorphic relationship
 * const record = {
 *   id: 5,
 *   body: 'Nice post!',
 *   author_id: 10,
 *   commentable_type: 'posts',    // Polymorphic
 *   commentable_id: 3              // Polymorphic
 * };
 * // Schema has polymorphic relationship defined
 * 
 * const jsonApi = toJsonApiRecord(scope, record, 'comments');
 * 
 * // Output: Both foreign keys and polymorphic fields filtered
 * // {
 * //   type: 'comments',
 * //   id: '5',
 * //   attributes: {
 * //     body: 'Nice post!'
 * //   }
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataGet method for single resource responses
 * - rest-api-knex-plugin's dataQuery method for collection responses
 * - processIncludes when transforming included resources
 * - buildJsonApiResponse as the primary transformation function
 * 
 * Purpose:
 * - Provides consistent JSON:API transformation across all query operations
 * - Automatically identifies and filters foreign keys based on schema
 * - Handles polymorphic relationship fields (type/id pairs)
 * - Ensures IDs are always strings as required by JSON:API spec
 * 
 * Data flow:
 * 1. Database query returns flat records with all fields
 * 2. toJsonApiRecord identifies foreign keys from schema
 * 3. Filters out foreign keys and internal fields from attributes
 * 4. Returns clean JSON:API resource ready for relationship processing
 * 5. buildJsonApiResponse adds relationships and links to complete the response
 */
export const toJsonApiRecord = (scope, record, scopeName) => {
  const { 
    vars: { 
      schemaInfo: { schema, schemaRelationships: relationships, idProperty }
    }
  } = scope;
  
  const polymorphicFields = new Set();
  try {
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        const typeFieldName = relDef.belongsToPolymorphic.typeField || `${relName}_type`;
        const idFieldName = relDef.belongsToPolymorphic.idField || `${relName}_id`;
        polymorphicFields.add(typeFieldName);
        polymorphicFields.add(idFieldName);
      }
    });
  } catch (e) {
  }
  
  const deps = {
    context: {
      scopeName,
      schemaInfo: { idProperty },
      polymorphicFields
    }
  };
  
  return toJsonApi(scope, record, deps);
};

/**
 * Builds complete JSON:API response with data, relationships, links, and optional includes
 * 
 * @async
 * @param {Object} scope - Scope containing schema and configuration
 * @param {Array<Object>} records - Primary records to include in response
 * @param {Array<Object>} included - Resources to include in 'included' array
 * @param {boolean} isSingle - Whether this is a single resource response
 * @param {string} scopeName - Resource type name
 * @param {Object} context - Request context with pagination metadata
 * @returns {Promise<Object>} Complete JSON:API response document
 * 
 * @example
 * // Input: Single article with author include
 * const records = [{
 *   id: 1,
 *   title: 'Article Title',
 *   content: 'Article content',
 *   author_id: 2,
 *   category_id: 3
 * }];
 * 
 * const included = [{
 *   type: 'authors',
 *   id: '2',
 *   attributes: { name: 'John Doe', email: 'john@example.com' }
 * }];
 * 
 * const response = await buildJsonApiResponse(scope, records, included, true, 'articles', context);
 * 
 * // Output: Complete JSON:API document
 * // {
 * //   data: {
 * //     type: 'articles',
 * //     id: '1',
 * //     attributes: {
 * //       title: 'Article Title',
 * //       content: 'Article content'
 * //     },
 * //     relationships: {
 * //       author: {
 * //         data: { type: 'authors', id: '2' },
 * //         links: {
 * //           self: '/articles/1/relationships/author',
 * //           related: '/articles/1/author'
 * //         }
 * //       },
 * //       category: {
 * //         data: { type: 'categories', id: '3' },
 * //         links: {
 * //           self: '/articles/1/relationships/category',
 * //           related: '/articles/1/category'
 * //         }
 * //       }
 * //     },
 * //     links: {
 * //       self: '/articles/1'
 * //     }
 * //   },
 * //   included: [{
 * //     type: 'authors',
 * //     id: '2',
 * //     attributes: { name: 'John Doe', email: 'john@example.com' },
 * //     links: { self: '/authors/2' }
 * //   }],
 * //   links: {
 * //     self: '/articles/1'
 * //   }
 * // }
 * 
 * @example
 * // Input: Collection with pagination
 * const records = [
 *   { id: 1, title: 'Article 1', author_id: 10 },
 *   { id: 2, title: 'Article 2', author_id: 10 },
 *   { id: 3, title: 'Article 3', author_id: 11 }
 * ];
 * 
 * context.returnMeta = {
 *   paginationMeta: { page: 2, pageSize: 3, pageCount: 10, total: 30 },
 *   paginationLinks: {
 *     self: '/articles?page[number]=2&page[size]=3',
 *     first: '/articles?page[number]=1&page[size]=3',
 *     prev: '/articles?page[number]=1&page[size]=3',
 *     next: '/articles?page[number]=3&page[size]=3',
 *     last: '/articles?page[number]=10&page[size]=3'
 *   }
 * };
 * 
 * const response = await buildJsonApiResponse(scope, records, [], false, 'articles', context);
 * 
 * // Output: Collection with pagination metadata
 * // {
 * //   data: [
 * //     { type: 'articles', id: '1', attributes: { title: 'Article 1' }, ... },
 * //     { type: 'articles', id: '2', attributes: { title: 'Article 2' }, ... },
 * //     { type: 'articles', id: '3', attributes: { title: 'Article 3' }, ... }
 * //   ],
 * //   meta: {
 * //     pagination: { page: 2, pageSize: 3, pageCount: 10, total: 30 }
 * //   },
 * //   links: {
 * //     self: '/articles?page[number]=2&page[size]=3',
 * //     first: '/articles?page[number]=1&page[size]=3',
 * //     prev: '/articles?page[number]=1&page[size]=3',
 * //     next: '/articles?page[number]=3&page[size]=3',
 * //     last: '/articles?page[number]=10&page[size]=3'
 * //   }
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataGet method for single resource responses
 * - rest-api-knex-plugin's dataQuery method for collection responses
 * - Called at the end of the query pipeline to assemble the final response
 * 
 * Purpose:
 * - Assembles all parts of a JSON:API response in the correct structure
 * - Adds relationship objects with proper links for each foreign key
 * - Handles both regular belongsTo and polymorphic relationships
 * - Adds self links to all resources as required by JSON:API
 * - Includes pagination metadata and links when applicable
 * 
 * Data flow:
 * 1. Query operations fetch primary records and optional includes
 * 2. Records are transformed to JSON:API format via toJsonApiRecord
 * 3. buildJsonApiResponse adds relationship objects for all foreign keys
 * 4. Adds proper links (self, related) for navigating the API
 * 5. Assembles included resources with their own links
 * 6. Adds pagination metadata and links if provided
 * 7. Returns complete JSON:API document ready for HTTP response
 */
export const buildJsonApiResponse = async (scope, records, included = [], isSingle = false, scopeName, context) => {
  const { 
    vars: { 
      schemaInfo: { schema, schemaRelationships: relationships, idProperty }
    }
  } = scope;
  
  const idField = idProperty || 'id';
  
  const schemaStructure = getSchemaStructure(schema);
  
  const processedRecords = records.map(record => {
    const { [RELATIONSHIPS_KEY]: _relationships, ...cleanRecord } = record;
    const jsonApiRecord = toJsonApiRecord(scope, cleanRecord, scopeName);
    
    if (_relationships) {
      jsonApiRecord.relationships = _relationships;
    }
    
    for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
      if (fieldDef.belongsTo && fieldDef.as && fieldName in cleanRecord) {
        jsonApiRecord.relationships = jsonApiRecord.relationships || {};
        if (!jsonApiRecord.relationships[fieldDef.as]) {
          if (cleanRecord[fieldName] !== null && cleanRecord[fieldName] !== undefined) {
            const relationshipObject = {
              data: {
                type: fieldDef.belongsTo,
                id: String(cleanRecord[fieldName])
              }
            };
            
            const urlPrefix = scope.vars.publicBaseUrl || scope.vars.transport?.mountPath || '';
            relationshipObject.links = {
              self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${fieldDef.as}`,
              related: `${urlPrefix}/${scopeName}/${record[idField]}/${fieldDef.as}`
            };
            
            jsonApiRecord.relationships[fieldDef.as] = relationshipObject;
          } else {
            const relationshipObject = {
              data: null
            };
            
            const urlPrefix = scope.vars.publicBaseUrl || scope.vars.transport?.mountPath || '';
            relationshipObject.links = {
              self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${fieldDef.as}`,
              related: `${urlPrefix}/${scopeName}/${record[idField]}/${fieldDef.as}`
            };
            
            jsonApiRecord.relationships[fieldDef.as] = relationshipObject;
          }
        }
      }
    }
    
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        const typeValue = cleanRecord[relDef.belongsToPolymorphic.typeField];
        const idValue = cleanRecord[relDef.belongsToPolymorphic.idField];
        
        if (typeValue && idValue) {
          jsonApiRecord.relationships = jsonApiRecord.relationships || {};
          const relationshipObject = {
            data: {
              type: typeValue,
              id: String(idValue)
            }
          };
          
          const urlPrefix = scope.vars.publicBaseUrl || scope.vars.transport?.mountPath || '';
          relationshipObject.links = {
            self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${relName}`,
            related: `${urlPrefix}/${scopeName}/${record[idField]}/${relName}`
          };
          
          jsonApiRecord.relationships[relName] = relationshipObject;
        } else if (typeValue === null || idValue === null) {
          jsonApiRecord.relationships = jsonApiRecord.relationships || {};
          const relationshipObject = {
            data: null
          };
          
          const urlPrefix = scope.vars.publicBaseUrl || scope.vars.transport?.mountPath || '';
          relationshipObject.links = {
            self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${relName}`,
            related: `${urlPrefix}/${scopeName}/${record[idField]}/${relName}`
          };
          
          jsonApiRecord.relationships[relName] = relationshipObject;
        }
      }
    });
    
    return jsonApiRecord;
  });
  
  const urlPrefix = scope.vars.publicBaseUrl || scope.vars.transport?.mountPath || '';
  const normalizedData = isSingle ? processedRecords[0] : processedRecords;
  
  if (normalizedData) {
    if (Array.isArray(normalizedData)) {
      normalizedData.forEach(item => {
        if (!item.links) item.links = {};
        item.links.self = `${urlPrefix}/${scopeName}/${item.id}`;
      });
    } else {
      if (!normalizedData.links) normalizedData.links = {};
      normalizedData.links.self = `${urlPrefix}/${scopeName}/${normalizedData.id}`;
    }
  }

  const response = {
    data: normalizedData
  };

  if (included.length > 0) {
    included.forEach(item => {
      if (!item.links) item.links = {};
      item.links.self = `${urlPrefix}/${item.type}/${item.id}`;
    });
    
    response.included = included;
  }

  if (context?.returnMeta?.paginationMeta) {
    response.meta = {
      pagination: context.returnMeta.paginationMeta
    };
  }
  
  if (context?.returnMeta?.paginationLinks) {
    response.links = context.returnMeta.paginationLinks;
  } else {
    response.links = {
      self: isSingle 
        ? `${urlPrefix}/${scopeName}/${normalizedData.id}`
        : `${urlPrefix}/${scopeName}${context?.returnMeta?.queryString || ''}`
    };
  }

  return response;
};