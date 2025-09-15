import { RestApiResourceError } from '../../../lib/rest-api-errors.js';
import { validatePatchPayload } from '../lib/querying-writing/payload-validators.js';
import { processRelationships } from '../lib/writing/relationship-processor.js';
import { updateManyToManyRelationship } from '../lib/writing/many-to-many-manipulations.js';
import { ERROR_SUBTYPES } from '../lib/querying-writing/knex-constants.js';
import { 
  setupCommonRequest, 
  validateResourceAttributesBeforeWrite,
  validateRelationshipAccess,
  applyFieldSetters,
  validatePivotResource,
  handleRecordReturnAfterWrite,
  handleWriteMethodError
} from './common.js';

/**
 * PATCH
 * Performs a partial update on an existing resource's attributes or relationships.
 * Unlike PUT, PATCH only updates the fields provided, leaving other fields unchanged.
 * This method supports updating both attributes and relationships (1:1 and n:n).
 * For relationships, only the ones explicitly provided will be updated.
 * Just like PUT, it CANNOT have the `included` array in data.
 */
export default async function patchMethod({ 
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
  context.method = 'patch';
    
  try {
    const { schema, schemaStructure, schemaRelationships } = await setupCommonRequest({
      params, 
      context, 
      vars, 
      scopes, 
      scopeOptions, 
      scopeName,
      api, 
      helpers
    });
    context.id = context.inputRecord.data.id;
    
    // Run early hooks for pre-processing (e.g., file handling)
    await runHooks('beforeProcessing');
    await runHooks('beforeProcessingPatch');

    // Validate PATCH payload to ensure the partial update actually contains changes.
    // PATCH requests must include either attributes to update or relationships to modify -
    // an empty PATCH is invalid. This prevents accidental no-op requests and ensures clients
    // are explicit about what they want to change. Unlike PUT, PATCH preserves all fields
    // not mentioned in the request.
    // Example: data must have either attributes: {title: 'New'} or relationships: {author: {...}}
    validatePatchPayload(context.inputRecord, scopes);
    
    // Validate that user has read access to all related resources
    // This ensures users can only create relationships to resources they can access
    await validateRelationshipAccess(context, context.inputRecord, helpers, runHooks, api);

    // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
    // Example: relationships.author -> author_id: '123' for storage
    // Example: relationships.tags -> array of pivot records to create later (only for provided relationships in PATCH)
    const { belongsToUpdates, manyToManyRelationships } = processRelationships(
      scope,
      { context }
    );

    await validateResourceAttributesBeforeWrite({ 
      context, 
      schema, 
      belongsToUpdates, 
      runHooks,
      isPartialValidation: true 
    });

    // Fetch minimal record for authorization checks
    const minimalRecord = await helpers.dataGetMinimal({
      scopeName,
      context,
      runHooks
    });

    if (!minimalRecord) {
      throw new RestApiResourceError(
        `Resource not found: ${scopeName}/${context.id}`,
        ERROR_SUBTYPES.NOT_FOUND
      );
    }

    context.minimalRecord = minimalRecord;

    // Centralised checkPermissions function
    await scope.checkPermissions({
      method: 'patch',
      originalContext: context,
    });

    // Debug: Log what's being patched
    console.log('[PATCH DEBUG] Attempting to patch:', {
      scopeName,
      id: context.id,
      attributes: context.inputRecord.data.attributes,
      belongsToUpdates,
      userId: context.auth?.userId,
      authProvider: context.auth?.provider
    });

    // Merge belongsTo updates into attributes before patching the record
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      };
    }

    await runHooks('beforeDataCall');
    await runHooks('beforeDataCallPatch');

    // Apply field setters after validation and before storage
    if (context.inputRecord?.data?.attributes) {
      context.inputRecord.data.attributes = await applyFieldSetters(
        context.inputRecord.data.attributes,
        context.schemaInfo,
        context,
        api,
        helpers
      );
    }

    // Call the storage helper - should return the patched record
    await helpers.dataPatch({
      scopeName,
      context
    });

    await runHooks('afterDataCallPatch');
    await runHooks('afterDataCall');

    // Process many-to-many relationships after main record update
    // For PATCH, we only update the relationships that were explicitly provided
    for (const { relName, relDef, relData } of manyToManyRelationships) {
      
      // Validate pivot resource exists
      validatePivotResource(scopes, relDef, relName);
      
      // Update many-to-many relationships using intelligent synchronization that preserves pivot data.
      // This compares current relationships with desired state: removes records no longer needed,
      // adds new relationships, and crucially preserves existing pivot records with their metadata
      // (like created_at timestamps or extra pivot fields). This is superior to delete-all-recreate
      // because it maintains audit trails and custom pivot data.
      // Example: If article has tags [1,2,3] and you update to [2,3,4], it keeps the pivot records
      // for tags 2&3 (preserving their created_at), deletes tag 1, and adds new record for tag 4.
      // Example: If article has tags [1,2,3] and update sends [2,3,4], tag 1 is removed, tags 2,3 kept, tag 4 added
      await updateManyToManyRelationship(null, {
        api,
        context: {
          resourceId: context.id,
          relDef,
          relData,
          transaction: context.transaction
        }
      });
    }
    
    const ret = await handleRecordReturnAfterWrite({
      context,
      scopeName,
      api,
      scopes,
      schemaStructure,
      schemaRelationships,
      scopeOptions,
      vars,
      runHooks,
      helpers,
      log
    });

    // Commit transaction if we created it
    if (context.shouldCommit) {
      await context.transaction.commit();
      await runHooks('afterCommit');
    }

    return ret;
  
  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH', scopeName, log, runHooks);
  }
}