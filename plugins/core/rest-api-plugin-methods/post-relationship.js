import { RestApiResourceError } from "../../../lib/rest-api-errors.js";
import { findRelationshipDefinition, handleWriteMethodError } from "./common.js";
import { createPivotRecords } from "../lib/writing/many-to-many-manipulations.js";
import { RestApiValidationError } from "../../../lib/rest-api-errors.js";

/**
   * POST RELATIONSHIP
   * Adds members to a to-many relationship
   * POST /api/articles/1/relationships/tags
   * 
   * @param {string} id - The ID of the resource
   * @param {string} relationshipName - The name of the relationship
   * @param {array} relationshipData - Array of resource identifiers to add
   * @returns {Promise<void>} 204 No Content
  */ 
 export default async function postRelationshipMethod({ params, context, vars, helpers, scope, scopes, runHooks, scopeName, api, log }) {
  context.method = 'postRelationship';
  context.id = params.id;
  context.relationshipName = params.relationshipName;
  context.schemaInfo = scopes[scopeName].vars.schemaInfo;

  // Transaction handling
  context.transaction = params.transaction || 
  (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
  context.shouldCommit = !params.transaction && !!context.transaction;

  context.db = context.transaction || api.knex.instance

  try {
  // Validate
  const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName);
  if (!relDef) {
      throw new RestApiResourceError(
      `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
      { subtype: 'relationship_not_found' }
      );
  }

  if (!relDef.hasMany && !relDef.manyToMany) {
      throw new RestApiValidationError(
      `Cannot POST to to-one relationship '${context.relationshipName}'. Use PATCH instead.`,
      { fields: ['data'] }
      );
  }

  if (!Array.isArray(params.relationshipData)) {
      throw new RestApiPayloadError('POST to relationship requires array of resource identifiers');
  }

  // Check permissions
  await runHooks('checkPermissions');
  await runHooks('checkPermissionsPostRelationship');

  // Verify parent exists
  const exists = await helpers.dataExists({
      scopeName,
      context: { db: context.db, id: context.id, schemaInfo: context.schemaInfo },
  });

  if (!exists) {
      throw new RestApiResourceError('Resource not found', { subtype: 'not_found' });
  }

  // Add relationships
  if (relDef.manyToMany || (relDef.hasMany && relDef.through)) {
      const manyToManyDef = relDef.manyToMany || {
      through: relDef.through,
      foreignKey: relDef.foreignKey,
      otherKey: relDef.otherKey
      };
      
      await createPivotRecords(api, context.id, manyToManyDef, params.relationshipData, context.transaction);
  } else {
      // Update foreign keys for hasMany
      const targetType = relDef.hasMany;
      for (const identifier of params.relationshipData) {
      await api.resources[targetType].patch({
          id: identifier.id,
          inputRecord: {
          data: {
              type: targetType,
              id: identifier.id,
              attributes: { [relDef.foreignKey]: context.id }
          }
          },
          transaction: context.transaction,
          simplified: false
      });
      }
  }

  await runHooks('finish');
  await runHooks('finishPostRelationship');

  if (context.shouldCommit) {
      await context.transaction.commit();
  }

  return; // 204 No Content

  } catch (error) {
  await handleWriteMethodError(error, context, 'POST_RELATIONSHIP', scopeName, log, runHooks);
}
};