import postMethod from '../../plugins/core/rest-api-plugin-methods/post.js'
import getMethod from '../../plugins/core/rest-api-plugin-methods/get.js'
import queryMethod from '../../plugins/core/rest-api-plugin-methods/query.js'
import enrichAttributesMethod from '../../plugins/core/rest-api-plugin-methods/enrich-attributes.js'
import { applyFieldSetters, handleRecordReturnAfterWrite, validateResourceAttributesBeforeWrite } from '../../plugins/core/rest-api-plugin-methods/common.js'
import type { LifecycleArguments, Resource, EnrichmentArguments, ProcessingContext, WriteContext, CompletedWriteContext } from '../../plugins/core/rest-api-plugin-methods/lifecycle-types.js'
import type { DataWriteContext, DataReadContext } from '../../plugins/core/lib/storage/storage-types.js'

declare const args: LifecycleArguments
declare const read: LifecycleArguments<Resource>
declare const query: LifecycleArguments<Resource[]>
declare const enrichment: EnrichmentArguments
declare const processing: ProcessingContext
declare const write: WriteContext
declare const completed: CompletedWriteContext

// Ordinary operation arguments have no fabricated relationship fields.
args.params = { data: { title: 'Dune' } }
read.params = { id: 'book-1' }
query.params = {}

// The actual checked JavaScript bodies expose these contracts.
void postMethod(args)
void getMethod(read)
void queryMethod(query)
void enrichAttributesMethod(enrichment)
void applyFieldSetters(write, args.api, args.helpers)
void handleRecordReturnAfterWrite({ ...args, context: completed })
void validateResourceAttributesBeforeWrite({
  context: write,
  schema: write.schemaInfo.schemaInstance,
  belongsToUpdates: { authorId: '17' },
  runHooks: args.runHooks,
  isPartialValidation: true
})

// @ts-expect-error Before-processing input has not established a resource document shape.
void applyFieldSetters(processing, args.api, args.helpers)

args.context = {}
// @ts-expect-error Caller state has not established schema/database/write fields.
void applyFieldSetters(args.context, args.api, args.helpers)

// These are the same mutable objects used by storage and hooks, not copied contexts.
const writeStorage: DataWriteContext = write
const readStorage: DataReadContext = write
write.inputRecord.data.attributes = { title: 'Dune', libraryValue: new Date() }
args.context.cachedPermission = new Map([['book-1', true]])
args.context.id = 'book-1'
args.context.transactionOutcome = 'rolledBack'

// @ts-expect-error Database handles must remain executable.
args.context.db = {}
// @ts-expect-error Attribute bags are records, not a scalar.
write.inputRecord.data.attributes = 'Dune'
// @ts-expect-error An acknowledged outcome cannot be invented by a hook.
args.context.transactionOutcome = 'successful'
// @ts-expect-error Query working state contains a collection, not a single resource.
query.context.record = { data: { type: 'books', id: '1' } }
// @ts-expect-error Single-resource working state does not accept a collection.
read.context.record = { data: [{ type: 'books', id: '1' }] }
// @ts-expect-error Computed values are unknown until user code checks its own field schema.
write.inputRecord.data.attributes.title.toUpperCase()
// @ts-expect-error Setters must remain callable; an arbitrary schema flag is not a setter.
write.schemaInfo.fieldSetters.title = { setter: true }
// @ts-expect-error A transaction must be a managed database handle.
args.context.transaction = { commit: async () => {} }
// @ts-expect-error Validation needs the schema's validation methods, not merely its field map.
void validateResourceAttributesBeforeWrite({ context: write, schema: write.schemaInfo.schemaStructure, belongsToUpdates: {}, runHooks: args.runHooks })
// @ts-expect-error Awaiting the raw storage POST result does not establish a scalar ID.
const storageId: string | number = await args.helpers.dataPost({ scopeName: 'books', context: write })

export { writeStorage, readStorage }
