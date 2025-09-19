import assert from 'node:assert/strict';
import { storageMode } from './storage-mode.js';

/**
 * Validates that a response follows JSON:API structure
 */
export function validateJsonApiStructure(response, isCollection = false) {
  assert(response, 'Response should exist');
  
  if (isCollection) {
    assert(Array.isArray(response.data), 'Response data should be an array for collections');
  } else {
    assert(response.data && typeof response.data === 'object', 'Response data should be an object');
    assert(!Array.isArray(response.data), 'Response data should not be an array for single resources');
  }
  
  // Validate each resource object
  const resources = isCollection ? response.data : [response.data];
  resources.forEach(resource => {
    assert(resource.type, 'Resource should have a type');
    assert(resource.id, 'Resource should have an id');
    assert(resource.attributes && typeof resource.attributes === 'object', 'Resource should have attributes object');
    
    if (resource.relationships) {
      assert(typeof resource.relationships === 'object', 'Relationships should be an object');
      Object.values(resource.relationships).forEach(rel => {
        assert(rel.data !== undefined || rel.links !== undefined || rel.meta !== undefined, 
          'Relationship should have data, links, or meta');
      });
    }
  });
  
  if (response.included) {
    assert(Array.isArray(response.included), 'Included should be an array');
    response.included.forEach(resource => {
      assert(resource.type && resource.id, 'Included resources should have type and id');
    });
  }
}

/**
 * Creates a resource identifier for JSON:API relationships
 */
export function resourceIdentifier(type, id) {
  return { type, id: String(id) };
}

/**
 * Cleans all records from the given tables
 */
export async function cleanTables(knex, tableNames) {
  if (storageMode.isAnyApi()) {
    const resources = tableNames
      .map((table) => storageMode.getResourceForTable(table))
      .filter(Boolean);

    if (resources.length > 0) {
      await knex('any_records')
        .where(storageMode.defaultTenant ? { tenant_id: storageMode.defaultTenant } : {})
        .whereIn('resource', resources)
        .delete();

      await knex('any_links')
        .where(storageMode.defaultTenant ? { tenant_id: storageMode.defaultTenant } : {})
        .whereIn('relationship', resources)
        .delete()
        .catch(() => {});
    }

    for (const table of tableNames) {
      const linkInfo = storageMode.getLinkInfo(table);
      if (linkInfo) {
        const relationshipKey = linkInfo.relationshipKey || `${storageMode.defaultTenant}:${linkInfo.ownerResource}:${linkInfo.relationshipName}`;
        await knex('any_links')
          .where({
            tenant_id: storageMode.defaultTenant,
            left_resource: linkInfo.ownerResource,
            relationship: relationshipKey,
          })
          .delete()
          .catch(() => {});
      }
      try {
        await knex(table).delete();
      } catch (error) {
        // Ignore missing tables in anyapi mode
      }
    }
  } else {
    for (const table of tableNames) {
      await knex(table).delete();
    }
  }
}

/**
 * Counts records in a table
 */
export async function countRecords(knex, tableName) {
  if (storageMode.isAnyApi()) {
    const resource = storageMode.getResourceForTable(tableName);
    const linkInfo = storageMode.getLinkInfo(tableName);
    if (linkInfo) {
      const relationshipKey = linkInfo.relationshipKey || `${storageMode.defaultTenant}:${linkInfo.ownerResource}:${linkInfo.relationshipName}`;
      const result = await knex('any_links')
        .where({
          tenant_id: storageMode.defaultTenant,
          left_resource: linkInfo.ownerResource,
          relationship: relationshipKey,
        })
        .count('* as count')
        .first();
      return parseInt(result.count);
    }
    if (resource) {
      const result = await knex('any_records')
        .where({
          tenant_id: storageMode.defaultTenant,
          resource,
        })
        .count('* as count')
        .first();
      return parseInt(result.count);
    }
    try {
      const result = await knex(tableName).count('* as count').first();
      return parseInt(result?.count || 0);
    } catch (error) {
      return 0;
    }
  }

  const result = await knex(tableName).count('* as count').first();
  return parseInt(result.count);
}

/**
 * Helper to create a JSON:API document for POST/PUT/PATCH
 */
export function createJsonApiDocument(type, attributes, relationships = {}) {
  const doc = {
    data: {
      type,
      attributes
    }
  };
  
  if (Object.keys(relationships).length > 0) {
    doc.data.relationships = relationships;
  }
  
  return doc;
}

/**
 * Helper to create a relationship object
 */
export function createRelationship(resourceIdentifier) {
  return {
    data: resourceIdentifier
  };
}

/**
 * Helper to create a to-many relationship object
 */
export function createToManyRelationship(resourceIdentifiers) {
  return {
    data: resourceIdentifiers
  };
}

/**
 * Asserts that a resource has specific attributes
 */
export function assertResourceAttributes(resource, expectedAttributes) {
  Object.entries(expectedAttributes).forEach(([key, value]) => {
    assert.deepEqual(resource.attributes[key], value, 
      `Attribute ${key} should equal ${JSON.stringify(value)}`);
  });
}

/**
 * Asserts that a resource has a specific relationship
 */
export function assertResourceRelationship(resource, relationshipName, expectedIdentifier) {
  assert(resource.relationships, 'Resource should have relationships');
  assert(resource.relationships[relationshipName], `Resource should have ${relationshipName} relationship`);
  assert.deepEqual(
    resource.relationships[relationshipName].data,
    expectedIdentifier,
    `Relationship ${relationshipName} should match expected identifier`
  );
}
