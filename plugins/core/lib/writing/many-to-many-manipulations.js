import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { transformSimplifiedToJsonApi } from '../querying-writing/simplified-helpers.js'

/**
 * Updates many-to-many relationships intelligently by synchronizing pivot table records
 *
 * @param {Object} scope - The scope object (not used directly, for consistency)
 * @param {Object} deps - Dependencies object
 * @returns {Promise<void>}
 *
 * @example
 * // Input: Article currently has tags [1, 2], want to change to [1, 3]
 * const deps = {
 *   api,
 *   context: {
 *     resourceId: '100',
 *     relDef: {
 *       through: 'article_tags',     // Pivot table
 *       foreignKey: 'article_id',    // Points to article
 *       otherKey: 'tag_id'          // Points to tag
 *     },
 *     relData: [
 *       { type: 'tags', id: '1' },  // Keep this
 *       { type: 'tags', id: '3' }   // Add this
 *     ],
 *     transaction: trx
 *   }
 * };
 *
 * // Before: article_tags table
 * // article_id | tag_id | created_at
 * // 100        | 1      | 2024-01-01
 * // 100        | 2      | 2024-01-02
 *
 * await updateManyToManyRelationship(null, deps);
 *
 * // After: article_tags table
 * // article_id | tag_id | created_at
 * // 100        | 1      | 2024-01-01  (preserved!)
 * // 100        | 3      | 2024-12-01  (new)
 * // Tag 2 was deleted, Tag 1 kept its metadata
 *
 * @example
 * // Input: Pivot table has extra fields to preserve
 * // article_tags has: article_id, tag_id, display_order, featured
 *
 * // Current data:
 * // article_id | tag_id | display_order | featured
 * // 100        | 1      | 1            | true
 * // 100        | 2      | 2            | false
 *
 * const deps = {
 *   context: {
 *     resourceId: '100',
 *     relData: [
 *       { type: 'tags', id: '1' },  // Keep tag 1
 *       { type: 'tags', id: '5' }   // Add tag 5
 *     ]
 *   }
 * };
 *
 * await updateManyToManyRelationship(null, deps);
 *
 * // Result:
 * // article_id | tag_id | display_order | featured
 * // 100        | 1      | 1            | true      (preserved!)
 * // 100        | 5      | NULL         | NULL      (new with defaults)
 *
 * @example
 * // Input: Clear all relationships
 * const deps = {
 *   context: {
 *     resourceId: '100',
 *     relData: []  // Empty array means remove all
 *   }
 * };
 *
 * await updateManyToManyRelationship(null, deps);
 * // All article_tags records for article 100 are deleted
 *
 * @description
 * Used by:
 * - relationship-processor.js calls this for many-to-many updates
 * - Used in PATCH operations to sync relationships
 * - Also used in PUT operations (replaces deleteExistingPivotRecords pattern)
 *
 * Purpose:
 * - Intelligently syncs pivot table to match desired state
 * - Preserves existing pivot records that should remain (with their metadata)
 * - Only deletes records that should be removed
 * - Only creates records that are new
 * - Much better than delete-all-then-recreate pattern
 *
 * Data flow:
 * 1. Queries existing pivot records for the resource
 * 2. Compares existing IDs with desired IDs
 * 3. Calculates which to delete and which to add
 * 4. Validates new related resources exist (optional)
 * 5. Performs bulk delete for removed relationships
 * 6. Performs bulk insert for new relationships
 * 7. Records that exist in both are untouched (metadata preserved)
 */
export const updateManyToManyRelationship = async (scope, deps) => {
  // Extract values from deps
  const { api, context } = deps
  const { resourceId, relDef, relData, transaction: trx } = context

  // Get the knex instance from the pivot scope
  const pivotScope = api.resources[relDef.through]
  if (!pivotScope) {
    throw new Error(`Pivot table resource '${relDef.through}' not found`)
  }

  // Get the actual database table name (might be different from scope name)
  const tableName = pivotScope.vars.schemaInfo.tableName || relDef.through

  // Get existing pivot records directly from database
  const existingRecords = await trx(tableName)
    .where(relDef.foreignKey, resourceId)
    .select(relDef.otherKey)

  // Create sets for efficient comparison
  const existingIds = new Set(existingRecords.map(r => String(r[relDef.otherKey])))
  const newIds = new Set(relData.map(r => String(r.id)))

  // Determine what to delete and add
  const toDelete = [...existingIds].filter(id => !newIds.has(id))
  const toAdd = [...newIds].filter(id => !existingIds.has(id))

  // Validate related resources exist if needed (do this before any changes)
  if (relDef.validateExists !== false && toAdd.length > 0) {
    for (const relatedId of toAdd) {
      const related = relData.find(r => String(r.id) === relatedId)
      try {
        await api.resources[related.type].get({
          id: related.id,
          transaction: trx
        })
      } catch (error) {
        throw new RestApiResourceError(
          `Related ${related.type} with id ${related.id} not found`,
          {
            subtype: 'not_found',
            resourceType: related.type,
            resourceId: related.id
          }
        )
      }
    }
  }

  // Bulk delete records that should be removed
  if (toDelete.length > 0) {
    await trx(tableName)
      .where(relDef.foreignKey, resourceId)
      .whereIn(relDef.otherKey, toDelete)
      .delete()
  }

  // Bulk insert new records
  if (toAdd.length > 0) {
    const recordsToInsert = toAdd.map(relatedId => ({
      [relDef.foreignKey]: resourceId,
      [relDef.otherKey]: relatedId
    }))

    await trx(tableName).insert(recordsToInsert)
  }

  // Records that exist in both are automatically preserved with their pivot data
}

// Note: deleteExistingPivotRecords has been removed in favor of using
// updateManyToManyRelationship for all sync operations (including PUT).
// This aligns with industry standards where ORMs use intelligent sync
// rather than delete-all-then-recreate patterns.

/**
 * Creates new pivot table records for many-to-many relationships
 *
 * @param {Object} api - The API instance with access to resources
 * @param {string|number} resourceId - The ID of the primary resource
 * @param {Object} relDef - The relationship definition
 * @param {Array} relData - Array of related resources to link
 * @param {Object} trx - Database transaction object
 * @returns {Promise<void>}
 *
 * @example
 * // Input: Create article-tag relationships
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
 *
 * await createPivotRecords(api, '100', relDef, relData, trx);
 *
 * // Result: 3 new records in article_tags table
 * // article_id | tag_id
 * // 100        | 10
 * // 100        | 20
 * // 100        | 30
 *
 * @example
 * // Input: Validation ensures related resources exist
 * const relData = [
 *   { type: 'tags', id: '999' }  // Non-existent tag
 * ];
 *
 * try {
 *   await createPivotRecords(api, '100', relDef, relData, trx);
 * } catch (error) {
 *   console.log(error.message);
 *   // "Related tags with id 999 not found"
 *   // Transaction rolled back, no records created
 * }
 *
 * @example
 * // Input: Skip validation for performance
 * const relDef = {
 *   through: 'user_permissions',
 *   foreignKey: 'user_id',
 *   otherKey: 'permission_id',
 *   validateExists: false  // Skip GET requests
 * };
 *
 * // With 100 permissions, saves 100 GET requests
 * await createPivotRecords(api, userId, relDef, permissions, trx);
 *
 * // Risk: Could create orphaned relationships if permissions don't exist
 * // Benefit: Much faster for bulk operations when you trust the data
 *
 * @description
 * Used by:
 * - relationship-processor.js for POST operations
 * - updateManyToManyRelationship internally for new relationships
 * - Any code that needs to create pivot records
 *
 * Purpose:
 * - Creates pivot table records to link resources
 * - Validates related resources exist by default (referential integrity)
 * - Supports bulk insert for efficiency
 * - Works within transactions for atomicity
 * - Allows skipping validation when performance matters
 *
 * Data flow:
 * 1. Validates pivot table resource exists
 * 2. Gets actual database table name
 * 3. Optionally validates each related resource exists (GET requests)
 * 4. Prepares bulk insert data with foreign keys
 * 5. Performs single INSERT with all records
 * 6. Returns (no data returned, throws on error)
 */
export const createPivotRecords = async (api, resourceId, relDef, relData, trx) => {
  if (relData.length === 0) return // Early exit if nothing to create

  // Get pivot table info
  const pivotScope = api.resources[relDef.through]
  if (!pivotScope) {
    throw new Error(`Pivot table resource '${relDef.through}' not found`)
  }

  // Get the actual database table name (might be different from scope name)
  const tableName = pivotScope.vars.schemaInfo.tableName || relDef.through

  // Validate all related resources exist if needed (do this before any inserts)
  if (relDef.validateExists !== false) {
    for (const related of relData) {
      try {
        await api.resources[related.type].get({
          id: related.id,
          transaction: trx
        })
      } catch (error) {
        throw new RestApiResourceError(
          `Related ${related.type} with id ${related.id} not found`,
          {
            subtype: 'not_found',
            resourceType: related.type,
            resourceId: related.id
          }
        )
      }
    }
  }

  // Prepare records for bulk insert
  const recordsToInsert = relData.map(related => ({
    [relDef.foreignKey]: resourceId,
    [relDef.otherKey]: related.id
  }))

  // Bulk insert all pivot records in a single query
  await trx(tableName).insert(recordsToInsert)
}
