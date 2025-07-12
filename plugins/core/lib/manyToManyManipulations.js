/**
 * @module manyToManyManipulations
 * @description Many-to-many relationship manipulation functions for REST API plugin
 * 
 * This module provides sophisticated handling of many-to-many relationships through
 * pivot tables. It implements intelligent syncing that preserves pivot table metadata
 * while efficiently updating relationships. This is crucial for maintaining data
 * integrity and audit trails in complex relational systems.
 */

import { RestApiResourceError } from '../../../lib/rest-api-errors.js';
import { transformSimplifiedToJsonApi } from './simplifiedHelpers.js';

/**
 * Updates many-to-many relationships intelligently by synchronizing pivot table records
 * while preserving any additional pivot data (like timestamps or extra attributes).
 * 
 * This function implements a "sync" operation that:
 * 1. Fetches all existing pivot records for the resource
 * 2. Compares with the desired state from the input
 * 3. Deletes pivot records that should no longer exist
 * 4. Creates new pivot records for new relationships
 * 5. Preserves existing pivot records (with their extra data) that remain
 * 
 * This approach is superior to delete-all-then-recreate because it:
 * - Preserves pivot table metadata (created_at, updated_at, extra fields)
 * - Minimizes database operations
 * - Maintains referential integrity
 * - Provides better audit trails
 * 
 * @param {Object} api - The API instance with access to resources
 * @param {string|number} resourceId - The ID of the resource being updated
 * @param {Object} relDef - The relationship definition object
 * @param {string} relDef.through - The pivot table/scope name
 * @param {string} relDef.foreignKey - The foreign key field pointing to this resource
 * @param {string} relDef.otherKey - The foreign key field pointing to the related resource
 * @param {boolean} [relDef.validateExists=true] - Whether to validate related resources exist
 * @param {Array} relData - Array of relationship data objects with type and id
 * @param {Object} trx - Database transaction object
 * @throws {RestApiResourceError} If a related resource doesn't exist when validation is enabled
 * 
 * @example
 * // Example 1: Updating article tags (some added, some removed, some kept)
 * const relDef = {
 *   through: 'article_tags',
 *   foreignKey: 'article_id',
 *   otherKey: 'tag_id',
 *   validateExists: true
 * };
 * const relData = [
 *   { type: 'tags', id: '1' },  // Existing - will be kept
 *   { type: 'tags', id: '3' },  // New - will be added
 *   // Tag 2 was in the relationship but not in relData - will be removed
 * ];
 * await updateManyToManyRelationship(api, '100', relDef, relData, trx);
 * // Result in article_tags table:
 * // - Record linking article 100 to tag 1: Preserved with original created_at
 * // - Record linking article 100 to tag 2: Deleted
 * // - Record linking article 100 to tag 3: Created new
 * 
 * @example
 * // Example 2: Clearing all relationships
 * await updateManyToManyRelationship(api, '100', relDef, [], trx);
 * // All pivot records for article 100 will be deleted
 * 
 * @example
 * // Example 3: Pivot table with extra data preservation
 * // Assume article_tags has extra fields like 'display_order' and 'featured'
 * // Existing pivot record: { article_id: 100, tag_id: 1, display_order: 1, featured: true }
 * const relData = [
 *   { type: 'tags', id: '1' },  // This tag stays
 *   { type: 'tags', id: '2' }   // New tag added
 * ];
 * await updateManyToManyRelationship(api, '100', relDef, relData, trx);
 * // Result:
 * // - Tag 1 pivot: display_order and featured are preserved
 * // - Tag 2 pivot: created with default values for extra fields
 * 
 * @example
 * // Example 4: Skip validation for performance (when you know resources exist)
 * const relDef = {
 *   through: 'user_roles',
 *   foreignKey: 'user_id',
 *   otherKey: 'role_id',
 *   validateExists: false  // Skip GET requests for each role
 * };
 * await updateManyToManyRelationship(api, userId, relDef, roleData, trx);
 * // Faster execution, but could create orphaned relationships if roles don't exist
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Intelligently sync many-to-many relationships without data loss
 * // 2. Preserve pivot table metadata (timestamps, extra fields)
 * // 3. Minimize database operations (only delete/create what changed)
 * // 4. Maintain audit trails by preserving original created_at times
 * // 5. Support complex pivot tables with additional attributes
 * // 6. Provide atomic updates within transactions
 */
export const updateManyToManyRelationship = async (api, resourceId, relDef, relData, trx) => {
  // Get pivot table schema for transformation
  const pivotScope = api.resources[relDef.through];
  if (!pivotScope) {
    throw new Error(`Pivot table resource '${relDef.through}' not found`);
  }
  
  const pivotSchema = pivotScope.vars.schemaInfo.schema.structure;
  const pivotRelationships = pivotScope.vars.schemaInfo.schemaRelationships;
  
  // Get existing pivot records
  const existingPivotRecords = await api.resources[relDef.through].query({
    transaction: trx,
    queryParams: {
      filters: { [relDef.foreignKey]: resourceId }
    }
  });
  
  // Create maps for easier lookup
  const existingMap = new Map();
  for (const record of existingPivotRecords.data || []) {
    // Need to find which field is the otherKey by looking at relationships
    let otherKeyValue = null;
    
    // Look through relationships to find the one that's not the main resource
    if (record.relationships) {
      for (const [relName, relData] of Object.entries(record.relationships)) {
        // Find the schema field that has this relationship name
        const schemaField = Object.entries(pivotSchema).find(([fieldName, fieldDef]) => 
          fieldDef.as === relName && fieldName === relDef.otherKey
        );
        
        if (schemaField && relData.data) {
          otherKeyValue = relData.data.id;
          break;
        }
      }
    }
    
    if (otherKeyValue) {
      existingMap.set(String(otherKeyValue), record);
    }
  }
  
  const newMap = new Map();
  for (const related of relData) {
    newMap.set(String(related.id), related);
  }
  
  // Delete records that are no longer in the relationship
  for (const [otherId, record] of existingMap) {
    if (!newMap.has(otherId)) {
      await api.resources[relDef.through].delete({
        transaction: trx,
        id: record.id
      });
    }
  }
  
  // Add new records (those not in existing)
  for (const [otherId, related] of newMap) {
    if (!existingMap.has(otherId)) {
      // Validate related resource exists if needed
      if (relDef.validateExists !== false) {
        try {
          await api.resources[related.type].get({
            id: related.id,
            transaction: trx
          });
        } catch (error) {
          throw new RestApiResourceError(
            `Related ${related.type} with id ${related.id} not found`,
            { 
              subtype: 'not_found',
              resourceType: related.type, 
              resourceId: related.id 
            }
          );
        }
      }
      
      // Create pivot record data as a simple object
      const pivotData = {
        [relDef.foreignKey]: resourceId,
        [relDef.otherKey]: related.id
      };
      
      // Transform to JSON:API format using the helper
      const jsonApiDocument = transformSimplifiedToJsonApi(
        pivotData,
        relDef.through,
        pivotSchema,
        pivotRelationships
      );
      
      // Create new pivot record using proper JSON:API format
      await api.resources[relDef.through].post({
        transaction: trx,
        inputRecord: jsonApiDocument
      });
    }
  }
  
  // Records that exist in both are automatically preserved with their pivot data
};

/**
 * Deletes all existing pivot records for a resource's many-to-many relationship.
 * 
 * This function performs a complete cleanup of pivot table records for a specific
 * resource and relationship. It's typically used in two scenarios:
 * 1. Before creating new relationships from scratch (in POST operations)
 * 2. When explicitly clearing all relationships
 * 
 * Unlike updateManyToManyRelationship, this function doesn't preserve any records -
 * it removes everything. Use updateManyToManyRelationship when you need to
 * intelligently sync relationships while preserving pivot data.
 * 
 * @param {Object} api - The API instance with access to resources
 * @param {string|number} resourceId - The ID of the resource whose relationships to clear
 * @param {Object} relDef - The relationship definition
 * @param {string} relDef.through - The pivot table/scope name
 * @param {string} relDef.foreignKey - The foreign key field in the pivot table
 * @param {Object} trx - Database transaction object
 * 
 * @example
 * // Example 1: Clear all tags from an article before reassigning
 * const relDef = {
 *   through: 'article_tags',
 *   foreignKey: 'article_id',
 *   otherKey: 'tag_id'
 * };
 * await deleteExistingPivotRecords(api, '100', relDef, trx);
 * // All article_tags records where article_id = 100 are deleted
 * 
 * @example
 * // Example 2: Used internally during POST to ensure clean slate
 * // When creating a new article with tags:
 * const articleId = '200';
 * // First, ensure no orphaned relationships exist
 * await deleteExistingPivotRecords(api, articleId, relDef, trx);
 * // Then create the new relationships
 * await createPivotRecords(api, articleId, relDef, tagData, trx);
 * 
 * @example
 * // Example 3: Clearing user roles before reassignment
 * const userRoleDef = {
 *   through: 'user_roles',
 *   foreignKey: 'user_id',
 *   otherKey: 'role_id'
 * };
 * // Remove all roles from user 50
 * await deleteExistingPivotRecords(api, '50', userRoleDef, trx);
 * // User 50 now has no roles assigned
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Ensure clean slate before creating new relationships
 * // 2. Handle "replace all" operations in POST requests
 * // 3. Clear relationships when a resource is being reset
 * // 4. Prevent duplicate pivot records
 * // 5. Support explicit relationship clearing operations
 */
export const deleteExistingPivotRecords = async (api, resourceId, relDef, trx) => {
  // Query for all existing pivot records
  const existingPivotRecords = await api.resources[relDef.through].query({
    transaction: trx,
    queryParams: {
      filters: { [relDef.foreignKey]: resourceId }
    }
  });
  
  // Delete each found record
  for (const record of existingPivotRecords.data || []) {
    await api.resources[relDef.through].delete({
      transaction: trx,
      id: record.id
    });
  }
};

/**
 * Creates new pivot table records for many-to-many relationships.
 * 
 * This function handles the creation of pivot table records that link resources
 * in many-to-many relationships. It includes optional validation to ensure that
 * the related resources actually exist before creating the pivot records.
 * 
 * Key features:
 * - Validates related resources exist (optional but recommended)
 * - Creates minimal pivot records with just the foreign keys
 * - Works within database transactions for consistency
 * - Throws descriptive errors if related resources are missing
 * 
 * @param {Object} api - The API instance with access to resources
 * @param {string|number} resourceId - The ID of the primary resource
 * @param {Object} relDef - The relationship definition
 * @param {string} relDef.through - The pivot table/scope name
 * @param {string} relDef.foreignKey - Field name for the primary resource's ID
 * @param {string} relDef.otherKey - Field name for the related resource's ID
 * @param {boolean} [relDef.validateExists=true] - Whether to validate resources exist
 * @param {Array} relData - Array of related resources to link
 * @param {string} relData[].type - The type of the related resource
 * @param {string} relData[].id - The ID of the related resource
 * @param {Object} trx - Database transaction object
 * @throws {RestApiResourceError} If a related resource doesn't exist
 * 
 * @example
 * // Example 1: Creating article-tag relationships
 * const relDef = {
 *   through: 'article_tags',
 *   foreignKey: 'article_id',
 *   otherKey: 'tag_id'
 * };
 * const relData = [
 *   { type: 'tags', id: '10' },
 *   { type: 'tags', id: '20' },
 *   { type: 'tags', id: '30' }
 * ];
 * await createPivotRecords(api, '100', relDef, relData, trx);
 * // Creates 3 records in article_tags:
 * // { article_id: 100, tag_id: 10 }
 * // { article_id: 100, tag_id: 20 }
 * // { article_id: 100, tag_id: 30 }
 * 
 * @example
 * // Example 2: With validation - ensures tags exist
 * const relData = [
 *   { type: 'tags', id: '999' }  // Non-existent tag
 * ];
 * try {
 *   await createPivotRecords(api, '100', relDef, relData, trx);
 * } catch (error) {
 *   // RestApiResourceError: "Related tags with id 999 not found"
 *   // No pivot record is created
 * }
 * 
 * @example
 * // Example 3: Skip validation for bulk operations
 * const relDef = {
 *   through: 'user_permissions',
 *   foreignKey: 'user_id',
 *   otherKey: 'permission_id',
 *   validateExists: false  // Trust that permissions exist
 * };
 * const permissions = [
 *   { type: 'permissions', id: '1' },
 *   { type: 'permissions', id: '2' },
 *   // ... hundreds more
 * ];
 * await createPivotRecords(api, userId, relDef, permissions, trx);
 * // Much faster without validation, but could create invalid relationships
 * 
 * @example
 * // Example 4: Used after clearing relationships
 * // Common pattern for "replace all" operations:
 * await deleteExistingPivotRecords(api, articleId, relDef, trx);
 * await createPivotRecords(api, articleId, relDef, newTags, trx);
 * // Old relationships removed, new ones created
 * 
 * @example
 * // Example 5: Empty relData creates no records
 * await createPivotRecords(api, '100', relDef, [], trx);
 * // No operations performed, no errors thrown
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this to:
 * // 1. Create pivot records after relationship validation
 * // 2. Ensure referential integrity by validating resources exist
 * // 3. Support bulk relationship creation in POST operations
 * // 4. Work within transactions for atomic operations
 * // 5. Provide clear error messages when relationships are invalid
 * // 6. Allow performance optimization by skipping validation when safe
 */
export const createPivotRecords = async (api, resourceId, relDef, relData, trx) => {
  // Get pivot table schema for transformation
  const pivotScope = api.resources[relDef.through];
  if (!pivotScope) {
    throw new Error(`Pivot table resource '${relDef.through}' not found`);
  }
  
  const pivotSchema = pivotScope.vars.schemaInfo.schema.structure;
  const pivotRelationships = pivotScope.vars.schemaInfo.schemaRelationships;
  
  for (const related of relData) {
    // Optionally validate related resource exists
    if (relDef.validateExists !== false) {
      try {
        await api.resources[related.type].get({
          id: related.id,
          transaction: trx
        });
      } catch (error) {
        throw new RestApiResourceError(
          `Related ${related.type} with id ${related.id} not found`,
          { 
            subtype: 'not_found',
            resourceType: related.type, 
            resourceId: related.id 
          }
        );
      }
    }
    
    // Create pivot record data as a simple object
    const pivotData = {
      [relDef.foreignKey]: resourceId,
      [relDef.otherKey]: related.id
    };
    
    // Transform to JSON:API format using the helper
    const jsonApiDocument = transformSimplifiedToJsonApi(
      pivotData,
      relDef.through,
      pivotSchema,
      pivotRelationships
    );
    
    // Create pivot record using proper JSON:API format
    await api.resources[relDef.through].post({
      transaction: trx,
      inputRecord: jsonApiDocument
    });
  }
};