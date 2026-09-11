import type { Knex } from 'knex'
import type {
  RestApiKnexPluginOptions, RestApiAnyapiKnexPluginOptions,
  BulkOperationsPluginOptions, LabelPluginOptions
} from '../../types/plugin-options.js'

declare const knex: Knex
const ordinary: RestApiKnexPluginOptions = { knex }
const canonical: RestApiAnyapiKnexPluginOptions = { knex, tenantId: 'workspace' }
const canonicalDefault: RestApiAnyapiKnexPluginOptions = { knex }
const bulk: BulkOperationsPluginOptions = { defaultAtomic: false, maxBulkOperations: 100 }
const labels: LabelPluginOptions = { preferNameFields: ['title', 'name'], disable: false }
void [ordinary, canonical, canonicalDefault, bulk, labels]

// @ts-expect-error Storage plugins need the database instance.
const missingDatabase: RestApiKnexPluginOptions = {}
// @ts-expect-error A connection configuration is not a Knex instance.
const configuration: RestApiKnexPluginOptions = { knex: { client: 'sqlite3' } }
// @ts-expect-error Canonical tenant IDs are strings.
const invalidTenant: RestApiAnyapiKnexPluginOptions = { knex, tenantId: 42 }
// @ts-expect-error Atomic defaults are booleans.
const invalidAtomic: BulkOperationsPluginOptions = { defaultAtomic: 'false' }
// @ts-expect-error Bulk limits are numbers; integer/range validation is runtime.
const invalidLimit: BulkOperationsPluginOptions = { maxBulkOperations: '100' }
// @ts-expect-error Label preferences are ordered field-name arrays.
const invalidLabels: LabelPluginOptions = { preferNameFields: 'name,title' }
void [missingDatabase, configuration, invalidTenant, invalidAtomic, invalidLimit, invalidLabels]
