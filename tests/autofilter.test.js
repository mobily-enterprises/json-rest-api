import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  validateJsonApiStructure,
  cleanTables,
  createJsonApiDocument,
  assertResourceAttributes,
  createRelationship,
  resourceIdentifier
} from './helpers/test-utils.js'
import { createAutoFilterApi } from './fixtures/api-configs.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api

const scopedContext = (workspaceId, userId) => ({
  scopeValues: {
    workspaceId,
    userId
  }
})

describe('AutoFilter Plugin', () => {
  before(async () => {
    api = await createAutoFilterApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'autofilter_workspace_reports',
      'autofilter_user_notes',
      'autofilter_projects',
      'autofilter_tasks',
      'autofilter_system_settings'
    ])
  })

  it('stamps workspace-scoped records and filters collections by workspace', async () => {
    const reportA = await api.resources.workspace_reports.post({
      inputRecord: createJsonApiDocument('workspace_reports', {
        title: 'Workspace A report'
      }),
      simplified: false
    }, scopedContext('workspace-a', 101))

    await api.resources.workspace_reports.post({
      inputRecord: createJsonApiDocument('workspace_reports', {
        title: 'Workspace B report'
      }),
      simplified: false
    }, scopedContext('workspace-b', 202))

    validateJsonApiStructure(reportA)
    assertResourceAttributes(reportA.data, {
      title: 'Workspace A report',
      workspace_id: 'workspace-a'
    })

    const queryA = await api.resources.workspace_reports.query({
      simplified: false
    }, scopedContext('workspace-a', 999))

    validateJsonApiStructure(queryA, true)
    assert.equal(queryA.data.length, 1)
    assert.equal(queryA.data[0].attributes.title, 'Workspace A report')
    assert.equal(queryA.data[0].attributes.workspace_id, 'workspace-a')
  })

  it('stamps user-scoped records and filters collections by user', async () => {
    const noteA = await api.resources.user_notes.post({
      inputRecord: createJsonApiDocument('user_notes', {
        body: 'User 101 note'
      }),
      simplified: false
    }, scopedContext('workspace-a', 101))

    await api.resources.user_notes.post({
      inputRecord: createJsonApiDocument('user_notes', {
        body: 'User 202 note'
      }),
      simplified: false
    }, scopedContext('workspace-a', 202))

    validateJsonApiStructure(noteA)
    assertResourceAttributes(noteA.data, {
      body: 'User 101 note',
      user_id: 101
    })

    const queryA = await api.resources.user_notes.query({
      simplified: false
    }, scopedContext('workspace-b', 101))

    validateJsonApiStructure(queryA, true)
    assert.equal(queryA.data.length, 1)
    assert.equal(queryA.data[0].attributes.body, 'User 101 note')
    assert.equal(queryA.data[0].attributes.user_id, 101)
  })

  it('applies composite workspace+user scoping', async () => {
    const ownProject = await api.resources.projects.post({
      inputRecord: createJsonApiDocument('projects', {
        name: 'Workspace A / User 101'
      }),
      simplified: false
    }, scopedContext('workspace-a', 101))

    await api.resources.projects.post({
      inputRecord: createJsonApiDocument('projects', {
        name: 'Workspace A / User 202'
      }),
      simplified: false
    }, scopedContext('workspace-a', 202))

    await api.resources.projects.post({
      inputRecord: createJsonApiDocument('projects', {
        name: 'Workspace B / User 101'
      }),
      simplified: false
    }, scopedContext('workspace-b', 101))

    validateJsonApiStructure(ownProject)
    assertResourceAttributes(ownProject.data, {
      name: 'Workspace A / User 101',
      workspace_id: 'workspace-a',
      user_id: 101
    })

    const scopedQuery = await api.resources.projects.query({
      simplified: false
    }, scopedContext('workspace-a', 101))

    validateJsonApiStructure(scopedQuery, true)
    assert.equal(scopedQuery.data.length, 1)
    assert.equal(scopedQuery.data[0].attributes.name, 'Workspace A / User 101')
  })

  it('treats public resources as unscoped', async () => {
    const created = await api.resources.system_settings.post({
      inputRecord: createJsonApiDocument('system_settings', {
        key: 'app.version',
        value: '1.0.0'
      }),
      simplified: false
    })

    validateJsonApiStructure(created)

    const anonymousQuery = await api.resources.system_settings.query({
      simplified: false
    })
    validateJsonApiStructure(anonymousQuery, true)
    assert.equal(anonymousQuery.data.length, 1)

    const scopedQuery = await api.resources.system_settings.query({
      simplified: false
    }, scopedContext('workspace-a', 101))
    validateJsonApiStructure(scopedQuery, true)
    assert.equal(scopedQuery.data.length, 1)
  })

  it('scopes single-record lookups so out-of-scope records are not found', async () => {
    const project = await api.resources.projects.post({
      inputRecord: createJsonApiDocument('projects', {
        name: 'Scoped Project'
      }),
      simplified: false
    }, scopedContext('workspace-a', 101))

    await assert.rejects(
      async () => {
        await api.resources.projects.get({
          id: project.data.id,
          simplified: false
        }, scopedContext('workspace-a', 202))
      },
      (error) => error.code === 'REST_API_RESOURCE',
      'Out-of-scope records should behave as not found'
    )
  })

  it('stamps scoped fields on PUT and rejects inconsistent scoped updates', async () => {
    const project = await api.resources.projects.post({
      inputRecord: createJsonApiDocument('projects', {
        name: 'Original Project',
        description: 'Original Description'
      }),
      simplified: false
    }, scopedContext('workspace-a', 101))

    await api.resources.projects.put({
      inputRecord: {
        data: {
          type: 'projects',
          id: project.data.id,
          attributes: {
            name: 'Updated Project',
            description: 'Updated Description',
            status: 'active'
          }
        }
      },
      simplified: false
    }, scopedContext('workspace-a', 101))

    const afterPut = await api.resources.projects.get({
      id: project.data.id,
      simplified: false
    }, scopedContext('workspace-a', 101))

    validateJsonApiStructure(afterPut)
    assertResourceAttributes(afterPut.data, {
      name: 'Updated Project',
      description: 'Updated Description',
      workspace_id: 'workspace-a',
      user_id: 101
    })

    await assert.rejects(
      async () => {
        await api.resources.projects.patch({
          id: project.data.id,
          inputRecord: {
            data: {
              type: 'projects',
              id: project.data.id,
              attributes: {
                workspace_id: 'workspace-b'
              }
            }
          },
          simplified: false
        }, scopedContext('workspace-a', 101))
      },
      (error) => error.code === 'REST_API_VALIDATION',
      'PATCH should reject inconsistent scope-field updates'
    )
  })

  it('uses scoped lookups when validating relationships', async () => {
    const projectA = await api.resources.projects.post({
      inputRecord: createJsonApiDocument('projects', {
        name: 'Project A'
      }),
      simplified: false
    }, scopedContext('workspace-a', 101))

    const projectB = await api.resources.projects.post({
      inputRecord: createJsonApiDocument('projects', {
        name: 'Project B'
      }),
      simplified: false
    }, scopedContext('workspace-b', 101))

    const task = await api.resources.tasks.post({
      inputRecord: createJsonApiDocument('tasks',
        {
          title: 'Task A'
        },
        {
          project: createRelationship(resourceIdentifier('projects', projectA.data.id))
        }
      ),
      simplified: false
    }, scopedContext('workspace-a', 101))

    validateJsonApiStructure(task)
    assertResourceAttributes(task.data, {
      title: 'Task A',
      workspace_id: 'workspace-a',
      user_id: 101
    })

    await assert.rejects(
      async () => {
        await api.resources.tasks.post({
          inputRecord: createJsonApiDocument('tasks',
            {
              title: 'Cross-scope Task'
            },
            {
              project: createRelationship(resourceIdentifier('projects', projectB.data.id))
            }
          ),
          simplified: false
        }, scopedContext('workspace-a', 101))
      },
      (error) => error.code === 'REST_API_RESOURCE' || error.code === 'REST_API_VALIDATION',
      'Relationship validation should respect scoped datasets'
    )
  })

  it('fails cleanly when a required autofilter value is missing', async () => {
    await assert.rejects(
      async () => {
        await api.resources.projects.query({
          simplified: false
        })
      },
      (error) => error.code === 'REST_API_AUTOFILTER_CONTEXT',
      'Scoped resources should require configured scope values'
    )

    await assert.rejects(
      async () => {
        await api.resources.projects.post({
          inputRecord: createJsonApiDocument('projects', {
            name: 'No Scope'
          }),
          simplified: false
        })
      },
      (error) => error.code === 'REST_API_AUTOFILTER_CONTEXT',
      'Scoped writes should require configured scope values'
    )
  })

  it('exposes compiled preset configuration without auth semantics', () => {
    assert.deepEqual(api.autofilter.getConfig(), {
      presets: ['public', 'workspace', 'user', 'workspace_user'],
      resolvers: ['workspace', 'user']
    })

    assert.deepEqual(api.autofilter.getScopeConfig('projects'), {
      preset: 'workspace_user',
      filters: [
        { field: 'workspace_id', resolver: 'workspace', required: true },
        { field: 'user_id', resolver: 'user', required: true }
      ]
    })
  })
})
