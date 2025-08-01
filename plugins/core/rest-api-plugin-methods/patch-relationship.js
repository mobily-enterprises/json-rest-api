/**
 * PATCH RELATIONSHIP
 * Completely replaces a relationship
 * PATCH /api/articles/1/relationships/author
 * 
 * @param {string} id - The ID of the resource
 * @param {string} relationshipName - The name of the relationship
 * @param {object|array} relationshipData - New relationship data
 * @returns {Promise<void>} 204 No Content
 */
export default async function patchRelationshipMethod ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName, api }) {
  context.method = 'patchRelationship';
  context.id = params.id;
  context.relationshipName = params.relationshipName;

  // Transaction handling
  context.transaction = params.transaction || 
    (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
  context.shouldCommit = !params.transaction && !!context.transaction;
  context.db = context.transaction || api.knex.instance

  try {
    // Check permissions
    await runHooks('checkPermissions');
    await runHooks('checkPermissionsPatchRelationship');

    // Reuse existing patch with relationship data
    await scope.patch({
      id: context.id,
      inputRecord: {
        data: {
          type: scopeName,
          id: context.id,
          relationships: {
            [params.relationshipName]: { data: params.relationshipData }
          }
        }
      },
      transaction: context.transaction,
      simplified: false,
      isTransport: params.isTransport
    });

    await runHooks('finish');
    await runHooks('finishPatchRelationship');

    if (context.shouldCommit) {
      await context.transaction.commit();
    }

    return; // 204 No Content

  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH_RELATIONSHIP', scopeName, log);
  }
}