import { JsonRestApi } from '../../lib/runtime/json-rest-api.js'
import { AutoFilterPlugin, RestApiPlugin, RowPolicyPlugin } from '../../index.js'
import { createTestDatabase } from '../helpers/test-database.js'
import { storageMode } from '../helpers/storage-mode.js'
import { cleanTables } from '../helpers/test-utils.js'
import { mapTable, seedStorageAdapterRecords, useStoragePlugin } from './api-configs.js'

// Two workspaces and a row policy: viewers in group g1 cannot see g2 rows.
export const workspaceA = () => ({ scopeValues: { workspaceId: 'ws-a' }, visibility: { groups: ['g1'] } })
export const workspaceB = () => ({ scopeValues: { workspaceId: 'ws-b' }, visibility: { groups: ['g1'] } })

export const DATA_ACCESS_TABLES = {
  accounts: 'da_accounts',
  entries: 'da_entries',
  labels: 'da_labels',
  entryLabels: 'da_entry_labels',
  jobs: 'da_jobs'
}

/**
 * A ledger with workspace ownership and a group row policy:
 * accounts own entries; labels are shared (NULL workspace) or owned; jobs feed claim.
 */
export async function createDataAccessApi (knex, { storage = storageMode.mode, extraPlugins = async () => {}, entryOptions = {} } = {}) {
  const api = new JsonRestApi({ name: 'data-access-test-api' })
  const tenantId = storage === 'anyapi' ? 'data_access_tenant' : storageMode.defaultTenant
  await api.use(RestApiPlugin, { format: 'plain', returning: 'full', queryMaxLimit: 100 })
  await useStoragePlugin(api, knex, { tenantId, storage })
  await api.use(RowPolicyPlugin, {
    policies: {
      groupVisibility: ({ query, context, system, column, value, queryPurpose }) => {
        context.policyCalls?.push({ system, queryPurpose })
        if (context.visibility?.all === true || system) return true
        const groups = context.visibility?.groups
        if (!Array.isArray(groups) || !groups.length) return false
        query.whereIn(column('access_group'), groups.map(group => value('access_group', group)))
        return true
      },
      // Joins an account to decide visibility, which claim must refuse.
      joinedVisibility: ({ query, context, system, column }) => {
        if (system || !context.joinPolicy) return true
        query.join('da_accounts as policy_accounts', 'policy_accounts.id', column('account_id'))
          .where('policy_accounts.access_group', 'g1')
        return true
      }
    }
  })
  await api.use(AutoFilterPlugin, {
    resolvers: { workspace: ({ context }) => context.scopeValues?.workspaceId },
    presets: {
      workspace: { filters: [{ field: 'workspace_id', resolver: 'workspace' }] },
      workspace_or_shared: { filters: [{ field: 'workspace_id', resolver: 'workspace', shared: true }] }
    }
  })
  await extraPlugins(api)

  await api.addResource('da_accounts', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 },
      workspace_id: { type: 'string', required: true, max: 40 },
      access_group: { type: 'string', required: true, max: 20 }
    },
    autofilter: 'workspace',
    rowPolicy: 'groupVisibility',
    tableName: 'da_accounts'
  })
  await api.addResource('da_entries', {
    schema: {
      id: { type: 'id' },
      code: { type: 'string', required: true, max: 40, search: true },
      amount: { type: 'integer', required: true, search: true },
      status: { type: 'string', default: 'open', max: 20, search: true },
      workspace_id: { type: 'string', required: true, max: 40 },
      access_group: { type: 'string', required: true, max: 20, search: true },
      posted_at: { type: 'dateTime', nullable: true },
      ...(storage === 'anyapi' ? {} : { lock_version: { type: 'integer', default: 0 } }),
      account_id: { type: 'number', nullable: true, belongsTo: 'da_accounts', as: 'account', search: true }
    },
    relationships: {
      labels: { type: 'manyToMany', target: 'da_labels', through: 'da_entry_labels', foreignKey: 'entry_id', otherKey: 'label_id' }
    },
    autofilter: 'workspace',
    rowPolicy: 'groupVisibility',
    ...(storage === 'anyapi' ? {} : { lockVersionField: 'lock_version' }),
    indexes: [{ columns: ['workspace_id', 'code'], unique: true }],
    tableName: 'da_entries',
    ...entryOptions
  })
  await api.addResource('da_labels', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 40, search: true },
      color: { type: 'string', nullable: true, max: 20 },
      slug: { type: 'string', nullable: true, max: 40 },
      workspace_id: { type: 'string', nullable: true, max: 40 }
    },
    autofilter: 'workspace_or_shared',
    indexes: [{ columns: ['workspace_id', 'name'], unique: true }, { columns: ['slug'], unique: true }],
    tableName: 'da_labels'
  })
  await api.addResource('da_entry_labels', {
    schema: {
      id: { type: 'id' },
      entry_id: { type: 'number', required: true, belongsTo: 'da_entries', as: 'entry' },
      label_id: { type: 'number', required: true, belongsTo: 'da_labels', as: 'label' }
    },
    tableName: 'da_entry_labels'
  })
  await api.addResource('da_jobs', {
    schema: {
      id: { type: 'id' },
      state: { type: 'string', required: true, max: 20, search: true },
      priority: { type: 'integer', default: 0 },
      workspace_id: { type: 'string', required: true, max: 40 },
      account_id: { type: 'number', nullable: true, belongsTo: 'da_accounts', as: 'account' }
    },
    autofilter: 'workspace',
    rowPolicy: 'joinedVisibility',
    tableName: 'da_jobs'
  })

  for (const [resource, table] of [['da_accounts', 'da_accounts'], ['da_entries', 'da_entries'], ['da_labels', 'da_labels'], ['da_entry_labels', 'da_entry_labels'], ['da_jobs', 'da_jobs']]) {
    if (storage === 'knex') await api.resources[resource].createKnexTable()
    mapTable(knex, api, table, resource)
  }
  if (storage === 'anyapi') {
    const descriptor = await api.anyapi.registry.getDescriptor(tenantId, 'da_entries')
    storageMode.registerLink(knex, 'da_entry_labels', 'da_entries', 'labels', descriptor?.manyToMany?.labels?.relationship, null, tenantId)
  }
  return api
}

export async function createDataAccessFixture (options = {}) {
  const storage = options.storage ?? storageMode.mode
  const database = await createTestDatabase(undefined, options.databaseOptions)
  const { knex } = database
  try {
    const api = await createDataAccessApi(knex, options)
    // In slices: SQLite takes at most 500 rows in one multi-row INSERT.
    const seed = async (type, records) => {
      for (let offset = 0; offset < records.length; offset += 100) {
        await seedStorageAdapterRecords(knex, api.resources[type].vars.schemaInfo, records.slice(offset, offset + 100))
      }
      // PostgreSQL sequences do not see explicit ids: move them past the seed.
      if (knex.client.config.client === 'pg' && storage === 'knex') {
        const table = api.resources[type].vars.schemaInfo.tableName
        await knex.raw("select setval(pg_get_serial_sequence(?, 'id'), coalesce((select max(id) from ??), 0) + 1, false)", [table, table])
      }
    }
    return {
      api,
      knex,
      client: knex.client.config.client,
      seed,
      reset: () => cleanTables(knex, Object.values(DATA_ACCESS_TABLES).reverse()),
      async rows (table) {
        return knex(table).orderBy('id')
      },
      // Statements the work runs, from the driver's query events.
      async measure (work) {
        const statements = []
        const record = query => statements.push(query.sql)
        knex.on('query', record)
        try {
          const result = await work()
          return { result, statements: statements.length, sql: statements }
        } finally {
          knex.removeListener('query', record)
        }
      },
      async close () {
        try { await database.close() } finally { storageMode.clearRegistry(knex) }
      }
    }
  } catch (error) {
    try { await database.close() } finally { storageMode.clearRegistry(knex) }
    throw error
  }
}

// Standard seed: an account per workspace and group, entries per account.
export async function seedLedger (fixture, { entriesPerAccount = 3 } = {}) {
  await fixture.reset()
  await fixture.seed('da_accounts', [
    { id: '1', name: 'A visible', workspace_id: 'ws-a', access_group: 'g1' },
    { id: '2', name: 'A hidden', workspace_id: 'ws-a', access_group: 'g2' },
    { id: '3', name: 'B visible', workspace_id: 'ws-b', access_group: 'g1' }
  ])
  const entries = []
  let id = 0
  for (const account of [1, 2, 3]) {
    for (let index = 0; index < entriesPerAccount; index++) {
      id++
      entries.push({
        id: String(id),
        code: `E${id}`,
        amount: id * 10,
        status: 'open',
        workspace_id: account === 3 ? 'ws-b' : 'ws-a',
        access_group: account === 2 ? 'g2' : 'g1',
        account_id: account,
        ...(storageMode.isAnyApi() ? {} : { lock_version: 0 })
      })
    }
  }
  await fixture.seed('da_entries', entries)
  return entries
}
