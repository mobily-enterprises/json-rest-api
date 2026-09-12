import {
  JsonRestApi, RestApiError, RestApiPlugin, RestApiKnexPlugin, AutoFilterPlugin, FastifyPlugin,
  LocalStorage, RestApiWriteError, RestApiVersionConflictError,
  getUrlPrefix, REST_API_INCLUDE_ERROR_CODE
} from 'json-rest-api'
import type {
  ResourceCoreMethods, TransactionMethods, RestApiPluginOptions,
  AutoFilterPluginOptions, RowPolicyPluginOptions, FileStorage,
  ResourceVersionOptions, BulkResourceMethods, RelationshipMethods,
  ToManyRelationship, HttpConnectorOptions, CorsPluginOptions, JsonApiDocument, JsonApiResource,
  ResourceSchema, InferInput, InferOutput, RuntimeCustomization, HookHandler
} from 'json-rest-api'

const options = { format: 'plain', returning: 'minimal' } satisfies RestApiPluginOptions
const plugins = [RestApiPlugin, RestApiKnexPlugin, AutoFilterPlugin, FastifyPlugin]
const storage: FileStorage = new LocalStorage({ directory: '/tmp/uploads' })
const prefix: string = getUrlPrefix({}, { vars: { transport: { mountPath: '/api' } } })
const code: 'REST_API_INCLUDE_INVALID' = REST_API_INCLUDE_ERROR_CODE
const writeError = new RestApiWriteError('Failed', { transactionOutcome: 'rolledBack', cause: new Error('Database') })
const conflict: Error = new RestApiVersionConflictError({ resourceType: 'books', resourceId: 1 })
interface Book { title: string }
declare const books: ResourceCoreMethods<Book>
declare const api: TransactionMethods
const record = await books.get({ id: 1 })
const title: string | undefined = record.title
const plainDocument = await books.post({ document: { data: { type: 'books', attributes: { title: 'Imported' } }, meta: { source: 'catalog' } } })
const importedTitle: string | undefined = plainDocument.title
const jsonPlain: JsonApiDocument<JsonApiResource<Book>> = await books.post({ data: { title: 'New' }, format: 'jsonapi' })
await api.transaction(async transaction => {
  const updated = await books.patch({ id: 1, data: { title: 'New' }, returning: 'minimal', transaction, expectedVersion: 'v1' })
  const id: string = updated.id
  return id
})
const filters: AutoFilterPluginOptions = { resolvers: { workspace: () => 'w1' } }
const policies: RowPolicyPluginOptions = { policies: { denied: () => false } }
void [options, plugins, storage, prefix, code, writeError, conflict, title, filters, policies, importedTitle, jsonPlain]

// @ts-expect-error Removed options must remain rejected through the package entry point.
const legacy: RestApiPluginOptions = { simplified: true }
// @ts-expect-error Canonical returning values remain checked through the package entry point.
await books.patch({ id: 1, data: { title: 'New' }, returning: 'record' })
// @ts-expect-error Sparse reads do not promise all fields are present.
const requiredTitle: string = record.title
// @ts-expect-error Removed inputRecord cannot be supplied alongside the new data key.
await books.post({ data: { title: 'New' }, ...{ inputRecord: { title: 'Old' } } })
// @ts-expect-error A write accepts either data or document, never both.
await books.post({ data: { title: 'New' }, document: { data: { type: 'books' } } })
// @ts-expect-error A write requires an input representation even with output format selected.
await books.post({ format: 'jsonapi' })
// @ts-expect-error Compound document writes are unsupported.
await books.post({ document: { data: { type: 'books' }, included: [] } })
void [legacy, requiredTitle]

const versioning = { versionField: 'revision' } satisfies ResourceVersionOptions
const validators = { httpValidators: true } satisfies HttpConnectorOptions
const cors = { exposedHeaders: ['ETag'], allowedHeaders: ['Content-Type', 'If-Match'] } satisfies CorsPluginOptions
declare const bulk: BulkResourceMethods<Book>
declare const relationships: RelationshipMethods<{ authors: ToManyRelationship<{ name: string }, 'authors'> }>
await books.put({ id: 1, data: { title: 'Replacement' }, expectedVersion: 'v1' })
await books.delete({ id: 1, expectedVersion: 'v2' })
await books.patch({ id: 1, data: { title: 'Unconditional' } })
await bulk.bulkPatch({ operations: [{ id: 1, data: { title: 'New' } }], expectedVersions: ['v1'] })
await bulk.bulkDelete({ ids: [1], expectedVersions: ['v2'] })
await bulk.bulkDelete({ ids: [1] })
await relationships.postRelationship({ id: 1, relationshipName: 'authors', relationshipData: [{ type: 'authors', id: 'a1' }], expectedVersion: 'v1' })
await relationships.patchRelationship({ id: 1, relationshipName: 'authors', relationshipData: [], expectedVersion: 'v2' })
await relationships.deleteRelationship({ id: 1, relationshipName: 'authors', relationshipData: [] })
void [versioning, validators, cors]

// @ts-expect-error Version configuration names a field, not a boolean toggle.
const invalidVersioning: ResourceVersionOptions = { versionField: true }
// @ts-expect-error Revision arguments are opaque strings, not numeric counters.
await books.delete({ id: 1, expectedVersion: 1 })
// @ts-expect-error Creation does not accept an expected revision.
await books.post({ data: { title: 'New' }, expectedVersion: 'v1' })
// @ts-expect-error Bulk revision conditions are arrays aligned with operations.
await bulk.bulkDelete({ ids: [1], expectedVersions: 'v1' })
// @ts-expect-error Relationship revision conditions are opaque strings too.
await relationships.patchRelationship({ id: 1, relationshipName: 'authors', relationshipData: [], expectedVersion: 1 })
// @ts-expect-error HTTP validator opt-in is boolean.
const invalidValidators: HttpConnectorOptions = { httpValidators: 'true' }
// @ts-expect-error CORS exposed header names are an array.
const invalidCors: CorsPluginOptions = { exposedHeaders: 'ETag' }
void [invalidVersioning, invalidValidators, invalidCors]

const host = new JsonRestApi<{ books: ResourceCoreMethods<Book> }>({ name: 'typed-host' })
await host.use(RestApiPlugin, { format: 'plain' })
await host.addResource('books', { schema: { title: { type: 'string' } } })
const typedBook = await host.resources.books.get({ id: 1 })
const typedTitle: string | undefined = typedBook.title
const baseError: RestApiError = new RestApiWriteError('Failed', { transactionOutcome: 'none' })
void [typedTitle, baseError]
// @ts-expect-error Hooked-api logging options are no longer constructor options.
new JsonRestApi({ logging: { level: 'error' } })
// @ts-expect-error Resource names follow the explicitly supplied resource interfaces.
await host.resources.authors.get({ id: 1 })
// @ts-expect-error Method customization uses methods, not scopeMethods.
await host.customize({ scopeMethods: {} })

const inferredHost = new JsonRestApi()
const inferred = await inferredHost.addResource('inferred', {
  schema: {
    title: { type: 'string', required: true },
    pages: { type: 'number', nullable: true },
    summary: { type: 'string', computed: true }
  },
  hooks: {
    beforeSchemaValidatePost: ({ context }) => {
      context.inputRecord.data.attributes ??= {}
      context.inputRecord.data.attributes.title ??= 'Default'
    }
  }
})
const inferredResult = await inferred.post({ data: { pages: null } })
const inferredTitle: string | undefined = inferredResult.title
const inferredPages: number | null | undefined = inferredResult.pages
// @ts-expect-error Packed declarations infer writable value types from the schema.
await inferred.patch({ id: 1, data: { pages: 'long' } })
// @ts-expect-error Packed declarations reject undeclared writable fields.
await inferred.patch({ id: 1, data: { titel: 'Typo' } })
// @ts-expect-error Computed values are output-only.
await inferred.post({ data: { summary: 'Forged' } })
// @ts-expect-error Resource options are checked without an unrestricted option index.
await inferredHost.addResource('typo', { schema: {}, sortableField: ['title'] })
// @ts-expect-error Literal field option names are checked through the packed declaration.
await inferredHost.addResource('fieldTypo', { schema: { title: { type: 'string', requird: true } } })

const literalSchema = { title: { type: 'string' } } as const satisfies ResourceSchema
const literalInput: InferInput<typeof literalSchema> = { title: 'Typed' }
const literalOutput: InferOutput<typeof literalSchema> = { title: 'Typed' }
interface HookState { cache: Map<string, boolean> }
const typedHooks: RuntimeCustomization<HookState> = {
  hooks: {
    beforeSchemaValidatePatch: ({ context }) => {
      context.cache.set('seen', true)
      // @ts-expect-error Operation identity is library-owned.
      context.method = 'post'
    },
    enrichAttributes: ({ context }) => {
      context.attributes.canEdit = context.parentContext.cache.get('edit')
    }
  }
}
const defaultHook: HookHandler<'beforeSchemaValidatePatch'> = ({ context }) => {
  context.customCache = new Map()
  // @ts-expect-error Default application context preserves named library-field ownership.
  context.returning = 'none'
}
void [inferredTitle, inferredPages, literalInput, literalOutput, typedHooks, defaultHook]
