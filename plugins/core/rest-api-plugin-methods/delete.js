import { RestApiResourceError } from '../../../lib/rest-api-errors.js';
import { handleWriteMethodError } from './common.js';

/**
 * DELETE
 * Permanently deletes a resource.
 * Returns 204 No Content on success, indicating the resource has been removed.
 * This method does not return the deleted resource.
 */
export default async function deleteMethod({ 
  params, 
  context, 
  vars, 
  helpers, 
  scope, 
  scopes, 
  runHooks, 
  apiOptions, 
  pluginOptions, 
  scopeOptions, 
  scopeName,
  api,
  log
}) {
  // Make the method available to all hooks
  context.method = 'delete';
  
  // Set the ID in context
  context.id = params.id;
  
  // Set scopeName in context (needed for broadcasting)
  context.scopeName = scopeName;
  
  // Set schema info even for DELETE (needed by storage layer)
  context.schemaInfo = scopes[scopeName].vars.schemaInfo;
  
  // Transaction handling
  context.transaction = params.transaction || 
      (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
  context.shouldCommit = !params.transaction && !!context.transaction;
  context.db = context.transaction || api.knex.instance;
  
  try {
    // No payload validation needed for DELETE
    
    // Fetch minimal record for authorization and logging
    const minimalRecord = await helpers.dataGetMinimal({
      scopeName,
      context,
      runHooks
    });
    
    if (!minimalRecord) {
      throw new RestApiResourceError(
        `Resource not found`,
        { 
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        }
      );
    }
    
    context.originalMinimalRecord = minimalRecord;
    context.minimalRecord = minimalRecord;
    
    // Centralised checkPermissions function
    await scope.checkPermissions({
      method: 'delete',
      auth: context.auth,
      id: context.id,
      minimalRecord: context.minimalRecord,
      transaction: context.transaction
    });
    
    // Before data operations
    await runHooks('beforeDataCall');
    await runHooks('beforeDataCallDelete');
    
    // Initialize record context for hooks
    context.record = {};
    
    // Call the storage helper
    await helpers.dataDelete({
      scopeName,
      context
    });
    
    await runHooks('afterDataCallDelete');
    await runHooks('afterDataCall');
    
    // No return record for DELETE (204 No Content)
    
    await runHooks('finish');
    await runHooks('finishDelete');
    
    // Commit transaction if we created it
    if (context.shouldCommit) {
      await context.transaction.commit();
      await runHooks('afterCommit');
    }
    
    // DELETE typically returns void/undefined (204 No Content)
    return;
    
  } catch (error) {
    await handleWriteMethodError(error, context, 'DELETE', scopeName, log, runHooks);
  }
}