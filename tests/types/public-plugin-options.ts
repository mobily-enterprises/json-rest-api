import type { CorsPluginOptions, HttpConnectorOptions, RestApiPluginOptions } from '../../types/plugin-options.js'
import type { InputResourceIdentifier } from '../../types/representations.js'
import type { BulkResourceMethods } from '../../types/bulk-methods.js'
import type { RelationshipMethods } from '../../types/relationship-methods.js'

const core: RestApiPluginOptions = {
  format: 'plain', returning: 'full', enablePaginationCounts: false,
  normalizeId: value => typeof value === 'bigint' ? value : typeof value === 'string' ? value.trim() : null
}
const http: HttpConnectorOptions = { httpValidators: true, mountPath: '/api' }
const cors: CorsPluginOptions = {
  origin: ['https://app.example.com', /^https:\/\/preview\./, async origin => origin.endsWith('.example.com')],
  credentials: true, allowedHeaders: ['Content-Type', 'If-Match'], exposedHeaders: ['ETag']
}
declare const relationships: RelationshipMethods
await relationships.getRelationship({ id: 1n, relationshipName: 'children' })
declare const bulk: BulkResourceMethods
await bulk.bulkDelete({ ids: [1n], expectedVersions: ['token'] })
void [core, http, cors]

// @ts-expect-error HTTP validator opt-in is boolean.
const invalidHttp: HttpConnectorOptions = { httpValidators: 'true' }
// @ts-expect-error The old representation configuration is removed.
const oldCore: RestApiPluginOptions = { simplified: true }
// @ts-expect-error ID normalization is synchronous.
const asyncNormalizer: RestApiPluginOptions = { normalizeId: async () => '1' }
// @ts-expect-error ID normalizers must return a supported scalar or missing value.
const objectNormalizer: RestApiPluginOptions = { normalizeId: () => ({ id: '1' }) }
// @ts-expect-error An origin predicate returns a decision, not a replacement origin.
const invalidOrigin: CorsPluginOptions = { origin: () => 'https://app.example.com' }
// @ts-expect-error Header configuration uses arrays, not comma-separated strings.
const invalidHeaders: CorsPluginOptions = { exposedHeaders: 'ETag' }
// @ts-expect-error Direct BigInt IDs must be converted before use in linkage payloads.
const invalidLinkage: InputResourceIdentifier = { type: 'items', id: 1n }
void [invalidHttp, oldCore, asyncNormalizer, objectNormalizer, invalidOrigin, invalidHeaders, invalidLinkage]
