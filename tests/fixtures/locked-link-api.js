import { JsonRestApi } from '../../lib/runtime/json-rest-api.js'
import { AutoFilterPlugin, RestApiPlugin } from '../../index.js'
import { createTestDatabase } from '../helpers/test-database.js'
import { useStoragePlugin } from './api-configs.js'

// Stages owned by workspaces, and tasks that each name a stage of their own
// workspace (ll_tasks.stage_id), at the size of a real application's table:
// 6,400 stages of four workspaces, their ids interleaved as rows several owners
// create over time are. A lock read of tasks checks its rows' stage links with
// a locking read of the stages, scoped to the caller's workspace.
// `ownerIndex` gives the stages an index that starts with the workspace
// (ll_owned_stages), and none otherwise (ll_stages): the planner reads the one
// owner's whole range of that index, or every owner's row of the table.
export const LOCKED_LINK_WORKSPACES = Object.freeze(['ws-a', 'ws-b', 'ws-c', 'ws-d'])
export const STAGES_PER_WORKSPACE = 1600

/**
 * The API, its stages table and the ids of the caller's (ws-a) stages and of
 * the other workspaces' stages, in id order. The tasks are seeded by the test.
 * @param {{ ownerIndex: boolean }} options
 */
export async function createLockedLinkFixture ({ ownerIndex }) {
  const stages = ownerIndex ? 'll_owned_stages' : 'll_stages'
  const tasks = ownerIndex ? 'll_owned_tasks' : 'll_tasks'
  const database = await createTestDatabase(undefined, { maxConnections: 4 })
  try {
    const api = new JsonRestApi({ name: `locked-link-${stages}` })
    await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full', queryMaxLimit: 1000 })
    await useStoragePlugin(api, database.knex, { storage: 'knex' })
    await api.use(AutoFilterPlugin, {
      resolvers: { workspace: ({ context }) => context.scopeValues?.workspaceId },
      presets: { workspace: { filters: [{ field: 'workspace_id', resolver: 'workspace' }] } }
    })
    await api.addResource(stages, {
      schema: {
        id: { type: 'id' },
        workspace_id: { type: 'string', required: true, max: 40 },
        name: { type: 'string', required: true, max: 60 }
      },
      autofilter: 'workspace',
      indexes: ownerIndex ? [{ columns: ['workspace_id', 'name'] }] : [],
      tableName: stages
    })
    await api.addResource(tasks, {
      schema: {
        id: { type: 'id' },
        workspace_id: { type: 'string', required: true, max: 40 },
        name: { type: 'string', required: true, max: 60 },
        stage_id: { type: 'number', belongsTo: stages, as: 'stage' }
      },
      autofilter: 'workspace',
      // lockWhere on MySQL and MariaDB reads through an index that starts with the ownership column.
      indexes: [{ columns: ['workspace_id'] }],
      tableName: tasks
    })
    await api.resources[stages].createKnexTable()
    await api.resources[tasks].createKnexTable()
    const rows = []
    for (let index = 0; index < STAGES_PER_WORKSPACE; index++) {
      for (const workspace of LOCKED_LINK_WORKSPACES) rows.push({ workspace_id: workspace, name: `S${String(index).padStart(4, '0')}` })
    }
    for (let start = 0; start < rows.length; start += 500) await database.knex(stages).insert(rows.slice(start, start + 500))
    const ids = async query => (await query.orderBy('id').pluck('id')).map(String)
    return {
      api,
      database,
      stages,
      tasks,
      own: await ids(database.knex(stages).where({ workspace_id: 'ws-a' })),
      others: await ids(database.knex(stages).whereNot({ workspace_id: 'ws-a' }))
    }
  } catch (error) {
    await database.close()
    throw error
  }
}
