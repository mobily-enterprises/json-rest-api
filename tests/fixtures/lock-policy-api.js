import { JsonRestApi } from '../../lib/runtime/json-rest-api.js'
import { AutoFilterPlugin, RestApiPlugin, RowPolicyPlugin, readOnlyQueryBuilder } from '../../index.js'
import { createTestDatabase } from '../helpers/test-database.js'
import { cleanTables } from '../helpers/test-utils.js'
import { useStoragePlugin } from './api-configs.js'

// Projects a caller sees through two other tables, the way a row policy
// decides visibility: a membership of the project's workspace (lp_members) and
// a grant of the project itself (lp_grants). The policy writes its two
// subqueries in the shape the context's policyShape names, one for each way
// Knex takes a subquery a policy writes. Tasks (lp_tasks) belong to projects,
// so a lock read of tasks checks each task's project link through that policy.
export const LOCK_POLICY_TABLES = ['lp_tasks', 'lp_grants', 'lp_members', 'lp_projects']

/**
 * - callback: whereExists and whereIn callbacks;
 * - builder: whereExists and whereIn over builders made from the transaction;
 * - group: one parenthesised group over read-only builders, as a policy
 *   composer that groups each policy writes it;
 * - scoped: whereExists over other resources' scoped rows, read-only derived
 *   tables under an alias;
 * - on clause: one whereExists whose membership check sits in a join's ON
 *   clause (the granted project joins only when the user is a member of its
 *   workspace).
 */
export const POLICY_SHAPES = Object.freeze(['callback', 'builder', 'group', 'scoped', 'on clause'])

/** The SELECTs each shape nests in a lock read: a scoped source is two, the derived table and the read of it. */
export const DECIDING_SELECTS = Object.freeze({ callback: 2, builder: 2, group: 2, scoped: 4, 'on clause': 2 })

export const asUser = (userId, policyShape = 'callback') => ({ scopeValues: { workspaceId: 'ws-a' }, userId, policyShape })

async function membershipAndGrant ({ query, context, db, column, system, api }) {
  if (system) return true
  const user = context.userId
  if (!user) return false
  const workspace = column('workspace_id')
  const project = column('id')
  switch (context.policyShape) {
    case 'callback':
      query.whereExists(function () {
        this.select(1).from('lp_members').whereColumn('lp_members.workspace_id', workspace).where('lp_members.user_id', user)
      })
      query.whereIn(project, function () {
        this.select('project_id').from('lp_grants').where('lp_grants.user_id', user)
      })
      return true
    case 'builder':
      query.whereExists(db('lp_members').select(1).whereColumn('lp_members.workspace_id', workspace).where('lp_members.user_id', user))
      query.whereIn(project, db('lp_grants').select('project_id').where('lp_grants.user_id', user))
      return true
    case 'group':
      query.where(function () {
        this.whereExists(readOnlyQueryBuilder(db('lp_members')).select(1).whereColumn('lp_members.workspace_id', workspace).where('lp_members.user_id', user))
          .whereExists(readOnlyQueryBuilder(db('lp_grants')).select(1).whereColumn('lp_grants.project_id', project).where('lp_grants.user_id', user))
      })
      return true
    case 'scoped': {
      const scope = { scopeValues: context.scopeValues }
      const { query: members } = await api.resources.lp_members.scopedQuery({ transaction: db, alias: 'm' }, scope)
      const { query: grants } = await api.resources.lp_grants.scopedQuery({ transaction: db, alias: 'g' }, scope)
      query.whereExists(members.select(1).whereColumn('m.workspace_id', workspace).where('m.user_id', user))
      query.whereExists(grants.select(1).whereColumn('g.project_id', project).where('g.user_id', user))
      return true
    }
    case 'on clause':
      query.whereExists(function () {
        this.select(1).from('lp_grants')
          .join('lp_projects as granted', function () {
            this.on('granted.id', '=', 'lp_grants.project_id').andOnExists(function () {
              this.select(1).from('lp_members').whereColumn('lp_members.workspace_id', 'granted.workspace_id').where('lp_members.user_id', user)
            })
          })
          .whereColumn('lp_grants.project_id', project).where('lp_grants.user_id', user)
      })
      return true
    default:
      throw new Error(`Unknown policy shape '${context.policyShape}'`)
  }
}

export async function createLockPolicyApi (knex) {
  const api = new JsonRestApi({ name: 'lock-policy-test-api' })
  await api.use(RestApiPlugin, { format: 'plain', returning: 'full', queryMaxLimit: 100 })
  await useStoragePlugin(api, knex, { storage: 'knex' })
  await api.use(RowPolicyPlugin, { policies: { membershipAndGrant } })
  await api.use(AutoFilterPlugin, {
    resolvers: { workspace: ({ context }) => context.scopeValues?.workspaceId },
    presets: { workspace: { filters: [{ field: 'workspace_id', resolver: 'workspace' }] } }
  })
  await api.addResource('lp_members', {
    schema: {
      id: { type: 'id' },
      workspace_id: { type: 'string', required: true, max: 40 },
      user_id: { type: 'string', required: true, max: 40 }
    },
    autofilter: 'workspace',
    indexes: [{ columns: ['workspace_id', 'user_id'], unique: true }],
    tableName: 'lp_members'
  })
  await api.addResource('lp_grants', {
    schema: {
      id: { type: 'id' },
      user_id: { type: 'string', required: true, max: 40 },
      project_id: { type: 'integer', required: true }
    },
    indexes: [{ columns: ['user_id', 'project_id'] }],
    tableName: 'lp_grants'
  })
  await api.addResource('lp_projects', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 40, search: true },
      workspace_id: { type: 'string', required: true, max: 40 }
    },
    autofilter: 'workspace',
    rowPolicy: 'membershipAndGrant',
    // lockWhere on MySQL and MariaDB reads through an index that starts with the
    // ownership column; with a name filter it examines that project's row alone.
    indexes: [{ columns: ['workspace_id', 'name'] }],
    tableName: 'lp_projects'
  })
  // A task's project is visible to the caller through the projects' policy: a
  // lock read of tasks checks each task's project link with it.
  await api.addResource('lp_tasks', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 40, search: true },
      workspace_id: { type: 'string', required: true, max: 40 },
      project_id: { type: 'id', nullable: true, belongsTo: 'lp_projects', as: 'project' }
    },
    autofilter: 'workspace',
    indexes: [{ columns: ['workspace_id', 'name'] }],
    tableName: 'lp_tasks'
  })
  for (const resource of ['lp_members', 'lp_grants', 'lp_projects', 'lp_tasks']) await api.resources[resource].createKnexTable()
  return api
}

/**
 * Three projects of workspace ws-a; users u1 and u2 are its members; u1 holds
 * a grant of project 1, and with `grants` more.
 */
export async function createLockPolicyFixture ({ databaseOptions } = {}) {
  const database = await createTestDatabase(undefined, databaseOptions)
  const { knex } = database
  try {
    const api = await createLockPolicyApi(knex)
    return {
      api,
      knex,
      projects: api.resources.lp_projects,
      tasks: api.resources.lp_tasks,
      async reset ({ grants = [] } = {}) {
        await cleanTables(knex, LOCK_POLICY_TABLES, { storage: 'knex' })
        await knex('lp_projects').insert([1, 2, 3].map(id => ({ id, name: `P${id}`, workspace_id: 'ws-a' })))
        await knex('lp_members').insert([{ id: 1, workspace_id: 'ws-a', user_id: 'u1' }, { id: 2, workspace_id: 'ws-a', user_id: 'u2' }])
        await knex('lp_grants').insert([{ id: 1, user_id: 'u1', project_id: 1 }, ...grants])
        // Task 1 belongs to project 1, which u1 sees.
        await knex('lp_tasks').insert({ id: 1, name: 'T1', workspace_id: 'ws-a', project_id: 1 })
      },
      // Statements the work runs, from the driver's query events.
      async measure (work) {
        const statements = []
        const record = query => statements.push(query.sql)
        knex.on('query', record)
        try {
          return { result: await work(), sql: statements }
        } finally {
          knex.removeListener('query', record)
        }
      },
      close: () => database.close()
    }
  } catch (error) {
    await database.close()
    throw error
  }
}
