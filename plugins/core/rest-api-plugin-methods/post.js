import { validatePostPayload } from '../lib/querying-writing/payload-validators.js';
import { processRelationships } from '../lib/writing/relationship-processor.js';
import { createPivotRecords } from '../lib/writing/many-to-many-manipulations.js';
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
 * POST
 * Creates a new resource. The request must include a JSON:API document with a 'data' object
 * containing 'type' and 'attributes'. It can also establish relationships to existing resources.
 * The returned document contains the created resource with its server-assigned ID.
 */
export default async function postMethod({ 
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
  context.method = 'post';

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

    // Run early hooks for pre-processing (e.g., file handling)
    await runHooks('beforeProcessing');
    await runHooks('beforeProcessingPost');

    // Validate POST payload to ensure it follows JSON:API format and references valid resources.
    // This checks the payload has required 'data' object with 'type' and 'attributes', validates
    // that data.type matches a real resource type (preventing creation of non-existent resources),
    // and ensures any relationships reference valid resource types with proper ID format.
    // Example: data.type: 'articles' must be a registered scope, relationships.author must reference 'users'.
    validatePostPayload(context.inputRecord, scopes);
    
    // Validate that user has read access to all related resources
    // This ensures users can only create relationships to resources they can access
    await validateRelationshipAccess(context, context.inputRecord, helpers, runHooks, api);
    
    // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
    // Example: relationships.author -> author_id: '123' for storage
    // Example: relationships.tags -> array of pivot records to create later
    const { belongsToUpdates, manyToManyRelationships } = await processRelationships(
      scope,
      { context }
    );

    // Merge belongsTo updates into attributes before validation (like PUT/PATCH do)
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      };
    }

    await validateResourceAttributesBeforeWrite({ 
      context, 
      schema, 
      belongsToUpdates, 
      runHooks
    });

    // Centralised checkPermissions function
    await scope.checkPermissions({
      method: 'post',
      originalContext: context,
    });

    await runHooks('beforeDataCall');
    await runHooks('beforeDataCallPost');
    
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
    
    // Create the main record - storage helper should return the created record with its ID
    context.id = await helpers.dataPost({
      scopeName,
      context
    });
    
    await runHooks('afterDataCallPost');
    await runHooks('afterDataCall');
    
    // Process many-to-many relationships after main record creation
    for (const { relName, relDef, relData } of manyToManyRelationships) {
      if (api.youapi?.links?.attachMany && relDef?.through) {
        await api.youapi.links.attachMany({
          context,
          scopeName,
          relName,
          relDef,
          relData,
        });
        continue;
      }

      // Validate pivot resource exists
      validatePivotResource(scopes, relDef, relName);
      await createPivotRecords(api, context.id, relDef, relData, context.transaction);
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
    await handleWriteMethodError(error, context, 'POST', scopeName, log, runHooks);
  }
}
