import { JsonRestApi } from '../../lib/runtime/json-rest-api.js'
import { AutoFilterPlugin, RestApiPlugin } from '../../index.js'
import { createTestDatabase } from '../helpers/test-database.js'
import { useStoragePlugin } from './api-configs.js'

// Revisions of records, owned by workspaces, as an application keeps a
// record's history: each record has four past revisions (1 to 4) and one
// current revision, numbered 10 for an even record and 11 for an odd one, under
// a unique key of (workspace_id, record_id, revision_number). A lock of the
// current revisions of many records lists the records and the current numbers:
// it names one row per record. The caller's workspace (ws-a) has
// RECORDS_PER_WORKSPACE records and ws-b as many, their rows interleaved as
// rows several owners create over time are.
// Stages and tasks: each task names a stage of its own workspace
// (il_tasks.stage_id), every task a different one, so a lock of a thousand
// tasks checks a thousand links with one locking read of the stages.
export const IN_LIST_WORKSPACES = Object.freeze(['ws-a', 'ws-b'])
export const RECORDS_PER_WORKSPACE = 1200
export const currentRevisionOf = record => record % 2 === 0 ? 10 : 11

/**
 * The API, its tables, and the caller's (ws-a) revision rows by record.
 * @returns {Promise<{ api: any, database: any, revisionsOf: Map<number, Map<number, string>>, otherRevisions: string[], stages: string[], tasks: string[] }>}
 */
export async function createLockedInListFixture () {
  const database = await createTestDatabase(undefined, { maxConnections: 4 })
  try {
    const api = new JsonRestApi({ name: 'locked-in-list' })
    await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full', queryMaxLimit: 1000 })
    await useStoragePlugin(api, database.knex, { storage: 'knex' })
    await api.use(AutoFilterPlugin, {
      resolvers: { workspace: ({ context }) => context.scopeValues?.workspaceId },
      presets: { workspace: { filters: [{ field: 'workspace_id', resolver: 'workspace' }] } }
    })
    await api.addResource('il_revisions', {
      schema: {
        id: { type: 'id' },
        workspace_id: { type: 'string', required: true, max: 40 },
        record_id: { type: 'integer', required: true },
        revision_number: { type: 'integer', required: true },
        name: { type: 'string', required: true, max: 60 }
      },
      searchSchema: {
        records: { type: 'array', actualField: 'record_id', filterOperator: 'in' },
        revisions: { type: 'array', actualField: 'revision_number', filterOperator: 'in' }
      },
      autofilter: 'workspace',
      indexes: [{ columns: ['workspace_id', 'record_id', 'revision_number'], unique: true }],
      tableName: 'il_revisions'
    })
    await api.addResource('il_stages', {
      schema: {
        id: { type: 'id' },
        workspace_id: { type: 'string', required: true, max: 40 },
        name: { type: 'string', required: true, max: 60 }
      },
      autofilter: 'workspace',
      tableName: 'il_stages'
    })
    await api.addResource('il_tasks', {
      schema: {
        id: { type: 'id' },
        workspace_id: { type: 'string', required: true, max: 40 },
        name: { type: 'string', required: true, max: 60 },
        stage_id: { type: 'number', belongsTo: 'il_stages', as: 'stage' }
      },
      autofilter: 'workspace',
      // lockWhere on MySQL and MariaDB reads through an index that starts with the ownership column.
      indexes: [{ columns: ['workspace_id'] }],
      tableName: 'il_tasks'
    })
    for (const resource of ['il_revisions', 'il_stages', 'il_tasks']) await api.resources[resource].createKnexTable()
    const { knex } = database
    const insert = async (table, rows) => {
      for (let start = 0; start < rows.length; start += 500) await knex(table).insert(rows.slice(start, start + 500))
    }
    const revisions = []
    for (let record = 1; record <= RECORDS_PER_WORKSPACE; record++) {
      for (const revision of [1, 2, 3, 4, currentRevisionOf(record)]) {
        for (const workspace of IN_LIST_WORKSPACES) {
          revisions.push({ workspace_id: workspace, record_id: record, revision_number: revision, name: `R${record}.${revision}` })
        }
      }
    }
    await insert('il_revisions', revisions)
    const stages = []
    for (let index = 0; index < RECORDS_PER_WORKSPACE; index++) {
      for (const workspace of IN_LIST_WORKSPACES) stages.push({ workspace_id: workspace, name: `S${String(index).padStart(4, '0')}` })
    }
    await insert('il_stages', stages)
    const ownStages = (await knex('il_stages').where({ workspace_id: 'ws-a' }).orderBy('id').pluck('id')).map(String)
    await insert('il_tasks', ownStages.map((stage, index) => ({ workspace_id: 'ws-a', name: `T${String(index).padStart(4, '0')}`, stage_id: stage })))
    const revisionsOf = new Map()
    for (const row of await knex('il_revisions').where({ workspace_id: 'ws-a' }).select('id', 'record_id', 'revision_number')) {
      if (!revisionsOf.has(Number(row.record_id))) revisionsOf.set(Number(row.record_id), new Map())
      revisionsOf.get(Number(row.record_id)).set(Number(row.revision_number), String(row.id))
    }
    return {
      api,
      database,
      revisionsOf,
      otherRevisions: (await knex('il_revisions').where({ workspace_id: 'ws-b' }).orderBy('id').pluck('id')).map(String),
      stages: ownStages,
      tasks: (await knex('il_tasks').where({ workspace_id: 'ws-a' }).orderBy('id').pluck('id')).map(String)
    }
  } catch (error) {
    await database.close()
    throw error
  }
}
