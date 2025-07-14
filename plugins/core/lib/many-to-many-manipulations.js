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
import { transformSimplifiedToJsonApi } from './simplified-helpers.js';

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
 * @param {Object} scope - The scope object (not used directly, for consistency)
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.api - The API instance with access to resources
 * @param {Object} deps.context - Request context
 * @param {string|number} deps.context.resourceId - The ID of the resource being updated
 * @param {Object} deps.context.relDef - The relationship definition object
 * @param {string} deps.context.relDef.through - The pivot table/scope name
 * @param {string} deps.context.relDef.foreignKey - The foreign key field pointing to this resource
 * @param {string} deps.context.relDef.otherKey - The foreign key field pointing to the related resource
 * @param {boolean} [deps.context.relDef.validateExists=true] - Whether to validate related resources exist
 * @param {Array} deps.context.relData - Array of relationship data objects with type and id
 * @param {Object} deps.context.transaction - Database transaction object
 * @throws {RestApiResourceError} If a related resource doesn't exist when validation is enabled
 * 
 * @example
 * // Example 1: Updating article tags (some added, some removed, some kept)
 * const deps = {
 *   api,
 *   context: {
 *     resourceId: '100',
 *     relDef: {
 *       through: 'article_tags',
 *       foreignKey: 'article_id',
 *       otherKey: 'tag_id',
 *       validateExists: true
 *     },
 *     relData: [
 *       { type: 'tags', id: '1' },  // Existing - will be kept
 *       { type: 'tags', id: '3' },  // New - will be added
 *       // Tag 2 was in the relationship but not in relData - will be removed
 *     ],
 *     transaction: trx
 *   }
 * };
 * await updateManyToManyRelationship(null, deps);
 * // Result in article_tags table:
 * // - Record linking article 100 to tag 1: Preserved with original created_at
 * // - Record linking article 100 to tag 2: Deleted
 * // - Record linking article 100 to tag 3: Created new
 * 
 * @example
 * // Example 2: Clearing all relationships
 * const deps = {
 *   api,
 *   context: {
 *     resourceId: '100',
 *     relDef,
 *     relData: [],
 *     transaction: trx
 *   }
 * };
 * await updateManyToManyRelationship(null, deps);
 * // All pivot records for article 100 will be deleted
 * 
 * @example
 * // Example 3: Pivot table with extra data preservation
 * // Assume article_tags has extra fields like 'display_order' and 'featured'
 * // Existing pivot record: { article_id: 100, tag_id: 1, display_order: 1, featured: true }
 * const deps = {
 *   api,
 *   context: {
 *     resourceId: '100',
 *     relDef,
 *     relData: [
 *       { type: 'tags', id: '1' },  // This tag stays
 *       { type: 'tags', id: '2' }   // New tag added
 *     ],
 *     transaction: trx
 *   }
 * };
 * await updateManyToManyRelationship(null, deps);
 * // Result:
 * // - Tag 1 pivot: display_order and featured are preserved
 * // - Tag 2 pivot: created with default values for extra fields
 * 
 * @example
 * // Example 4: Skip validation for performance (when you know resources exist)
 * const deps = {
 *   api,
 *   context: {
 *     resourceId: userId,
 *     relDef: {
 *       through: 'user_roles',
 *       foreignKey: 'user_id',
 *       otherKey: 'role_id',
 *       validateExists: false  // Skip GET requests for each role
 *     },
 *     relData: roleData,
 *     transaction: trx
 *   }
 * };
 * await updateManyToManyRelationship(null, deps);
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
export const updateManyToManyRelationship = async (scope, deps) => {
  // Extract values from deps
  const { api, context } = deps;
  const { resourceId, relDef, relData, transaction: trx } = context;
  
  // Get the knex instance from the pivot scope
  const pivotScope = api.resources[relDef.through];
  if (!pivotScope) {
    throw new Error(`Pivot table resource '${relDef.through}' not found`);
  }
  
  // Get the actual database table name (might be different from scope name)
  const tableName = pivotScope.vars.schemaInfo.tableName || relDef.through;
  
  // Get existing pivot records directly from database
  const existingRecords = await trx(tableName)
    .where(relDef.foreignKey, resourceId)
    .select(relDef.otherKey);
  
  // Create sets for efficient comparison
  const existingIds = new Set(existingRecords.map(r => String(r[relDef.otherKey])));
  const newIds = new Set(relData.map(r => String(r.id)));
  
  // Determine what to delete and add
  const toDelete = [...existingIds].filter(id => !newIds.has(id));
  const toAdd = [...newIds].filter(id => !existingIds.has(id));
  
  // Validate related resources exist if needed (do this before any changes)
  if (relDef.validateExists !== false && toAdd.length > 0) {
    for (const relatedId of toAdd) {
      const related = relData.find(r => String(r.id) === relatedId);
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
  }
  
  // Bulk delete records that should be removed
  if (toDelete.length > 0) {
    await trx(tableName)
      .where(relDef.foreignKey, resourceId)
      .whereIn(relDef.otherKey, toDelete)
      .delete();
  }
  
  // Bulk insert new records
  if (toAdd.length > 0) {
    const recordsToInsert = toAdd.map(relatedId => ({
      [relDef.foreignKey]: resourceId,
      [relDef.otherKey]: relatedId
    }));
    
    await trx(tableName).insert(recordsToInsert);
  }
  
  // Records that exist in both are automatically preserved with their pivot data
};

// Note: deleteExistingPivotRecords has been removed in favor of using
// updateManyToManyRelationship for all sync operations (including PUT).
// This aligns with industry standards where ORMs use intelligent sync
// rather than delete-all-then-recreate patterns.

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
  if (relData.length === 0) return; // Early exit if nothing to create
  
  // Get pivot table info
  const pivotScope = api.resources[relDef.through];
  if (!pivotScope) {
    throw new Error(`Pivot table resource '${relDef.through}' not found`);
  }
  
  // Get the actual database table name (might be different from scope name)
  const tableName = pivotScope.vars.schemaInfo.tableName || relDef.through;
  
  // Validate all related resources exist if needed (do this before any inserts)
  if (relDef.validateExists !== false) {
    for (const related of relData) {
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
  }
  
  // Prepare records for bulk insert
  const recordsToInsert = relData.map(related => ({
    [relDef.foreignKey]: resourceId,
    [relDef.otherKey]: related.id
  }));
  
  // Bulk insert all pivot records in a single query
  await trx(tableName).insert(recordsToInsert);
};