import {
  JsonRestApi, RestApiError, RestApiPlugin, RestApiKnexPlugin, AutoFilterPlugin, FastifyPlugin,
  LocalStorage, S3Storage, RestApiWriteError, RestApiVersionConflictError,
  getUrlPrefix, REST_API_INCLUDE_ERROR_CODE
} from 'json-rest-api'
import type {
  ResourceCoreMethods, TransactionMethods, RestApiPluginOptions,
  AutoFilterPluginOptions, RowPolicyPluginOptions, FileStorage,
  ResourceVersionOptions, BulkResourceMethods, RelationshipMethods,
  ToManyRelationship, HttpConnectorOptions, CorsPluginOptions
} from 'json-rest-api'

const options = { format: 'plain', returning: 'minimal' } satisfies RestApiPluginOptions
const plugins = [RestApiPlugin, RestApiKnexPlugin, AutoFilterPlugin, FastifyPlugin]
const storage: FileStorage = new LocalStorage({ directory: '/tmp/uploads' })
const mockStorage = new S3Storage({ bucket: 'example' })
const prefix: string = getUrlPrefix({}, { vars: { transport: { mountPath: '/api' } } })
const code: 'REST_API_INCLUDE_INVALID' = REST_API_INCLUDE_ERROR_CODE
const writeError = new RestApiWriteError('Failed', { transactionOutcome: 'rolledBack', cause: new Error('Database') })
const conflict: Error = new RestApiVersionConflictError({ resourceType: 'books', resourceId: 1 })
interface Book { title: string }
declare const books: ResourceCoreMethods<Book>
declare const api: TransactionMethods
const record = await books.get({ id: 1 })
const title: string | undefined = record.title
await api.transaction(async transaction => {
  const updated = await books.patch({ id: 1, inputRecord: { title: 'New' }, returning: 'minimal', transaction, expectedVersion: 'v1' })
  const id: string = updated.id
  return id
})
const filters: AutoFilterPluginOptions = { resolvers: { workspace: () => 'w1' } }
const policies: RowPolicyPluginOptions = { policies: { denied: () => false } }
void [options, plugins, storage, mockStorage, prefix, code, writeError, conflict, title, filters, policies]

// @ts-expect-error Removed options must remain rejected through the package entry point.
const legacy: RestApiPluginOptions = { simplified: true }
// @ts-expect-error Canonical returning values remain checked through the package entry point.
await books.patch({ id: 1, inputRecord: { title: 'New' }, returning: 'record' })
// @ts-expect-error Sparse reads do not promise all fields are present.
const requiredTitle: string = record.title
void [legacy, requiredTitle]

const versioning = { versionField: 'revision' } satisfies ResourceVersionOptions
const validators = { httpValidators: true } satisfies HttpConnectorOptions
const cors = { exposedHeaders: ['ETag'], allowedHeaders: ['Content-Type', 'If-Match'] } satisfies CorsPluginOptions
declare const bulk: BulkResourceMethods<Book>
declare const relationships: RelationshipMethods<{ authors: ToManyRelationship<{ name: string }, 'authors'> }>
await books.put({ id: 1, inputRecord: { title: 'Replacement' }, expectedVersion: 'v1' })
await books.delete({ id: 1, expectedVersion: 'v2' })
await books.patch({ id: 1, inputRecord: { title: 'Unconditional' } })
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
await books.post({ inputRecord: { title: 'New' }, expectedVersion: 'v1' })
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
