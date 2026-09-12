import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  cleanTables,
  countRecords,
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier,
  validateJsonApiStructure
} from './helpers/test-utils.js'
import { createRowPolicyApi } from './fixtures/api-configs.js'
import { createStorageAdapterUtilities } from '../plugins/core/lib/querying/storage-adapter-utils.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api
const policyEvents = []

const adminContext = (workspaceId = 'workspace-a') => ({
  visibility: { all: true },
  scopeValues: { workspaceId }
})
const groupContext = (...groups) => ({
  visibility: { groups },
  scopeValues: { workspaceId: 'workspace-a' }
})

const postProject = async (name, accessGroup, context = adminContext()) => {
  return api.resources.policy_projects.post({
    document: createJsonApiDocument('policy_projects', {
      name,
      access_group: accessGroup
    }),
    format: 'jsonapi'
  }, context)
}

const postTask = async ({ title, accessGroup, projectId, context = adminContext() }) => {
  const relationships = projectId === undefined
    ? {}
    : {
        project: createRelationship(resourceIdentifier('policy_projects', projectId))
      }

  return api.resources.policy_tasks.post({
    document: createJsonApiDocument('policy_tasks', {
      title,
      access_group: accessGroup
    }, relationships),
    format: 'jsonapi'
  }, context)
}

describe('RowPolicy Plugin', () => {
  it('keeps active query translation stable after the hook context is restored', () => {
    const queryStorageAdapter = {
      translateColumn: (field) => field === 'id' ? 'record_id' : field
    }
    const ambientStorageAdapter = {
      translateColumn: (field) => field === 'id' ? 'wrong_id' : field
    }
    const context = {
      knexQuery: {
        scopeName: 'organisationUnits',
        tableName: 'organisation_units',
        storageAdapter: queryStorageAdapter
      },
      storageAdapter: ambientStorageAdapter
    }
    const utilities = createStorageAdapterUtilities({ context })

    delete context.knexQuery
    delete context.storageAdapter

    assert.equal(
      utilities.translateColumn('organisationUnits', 'id'),
      'organisation_units.record_id'
    )
    assert.equal(
      utilities.translateColumn('organisationUnits', 'id', 'visible_units'),
      'visible_units.record_id'
    )
    assert.equal(utilities.defaultAliasForScope('users'), 'users')
    assert.equal(Object.hasOwn(context, 'knexQuery'), false)
    assert.equal(Object.hasOwn(context, 'storageAdapter'), false)
  })

  before(async () => {
    api = await createRowPolicyApi(knex, {
      onPolicy: (event) => policyEvents.push(event)
    })
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    policyEvents.length = 0
    await cleanTables(knex, [
      'row_policy_project_tasks',
      'row_policy_projects',
      'row_policy_tasks',
      'row_policy_broken'
    ])
  })

  it('applies deferred grouped visibility before offset pagination and counts the same dataset', async () => {
    await postProject('Allowed 1', 'group-a')
    await postProject('Hidden 1', 'group-b')
    await postProject('Allowed 2', 'group-a')
    await postProject('Hidden 2', 'group-b')
    await postProject('Allowed 3', 'group-a')

    policyEvents.length = 0
    const firstPage = await api.resources.policy_projects.query({
      queryParams: {
        sort: ['id'],
        page: { number: 1, size: 2 }
      },
      format: 'jsonapi'
    }, groupContext('group-a'))

    validateJsonApiStructure(firstPage, true)
    assert.deepEqual(
      firstPage.data.map((record) => record.attributes.name),
      ['Allowed 1', 'Allowed 2']
    )
    assert.equal(firstPage.meta.pagination.total, 3)
    assert.equal(firstPage.meta.pagination.pageCount, 2)
    assert(policyEvents.some((event) => event.queryPurpose === 'collection'))

    const secondPage = await api.resources.policy_projects.query({
      queryParams: {
        sort: ['id'],
        page: { number: 2, size: 2 }
      },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(
      secondPage.data.map((record) => record.attributes.name),
      ['Allowed 3']
    )
  })

  it('combines row policy visibility with the resource autofilter for rows and pagination totals', async () => {
    await postProject('Visible', 'group-a')
    await postProject('Wrong group', 'group-b')
    await postProject('Wrong workspace', 'group-a', adminContext('workspace-b'))

    const result = await api.resources.policy_projects.query({
      queryParams: { sort: ['id'], page: { number: 1, size: 1 } },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(
      result.data.map((record) => record.attributes.name),
      ['Visible']
    )
    assert.equal(result.meta.pagination.total, 1)
    assert.equal(result.meta.pagination.pageCount, 1)
  })

  it('keeps cursor pagination inside the visible dataset', async () => {
    await postProject('Allowed 1', 'group-a')
    await postProject('Hidden 1', 'group-b')
    await postProject('Allowed 2', 'group-a')
    await postProject('Hidden 2', 'group-b')
    await postProject('Allowed 3', 'group-a')

    const firstPage = await api.resources.policy_projects.query({
      queryParams: {
        sort: ['name'],
        page: { size: 2 }
      },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(
      firstPage.data.map((record) => record.attributes.name),
      ['Allowed 1', 'Allowed 2']
    )
    assert.equal(firstPage.meta.pagination.hasMore, true)
    assert(firstPage.meta.pagination.cursor.next)

    const secondPage = await api.resources.policy_projects.query({
      queryParams: {
        sort: ['name'],
        page: {
          size: 2,
          after: firstPage.meta.pagination.cursor.next
        }
      },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(
      secondPage.data.map((record) => record.attributes.name),
      ['Allowed 3']
    )
    assert.equal(secondPage.meta.pagination.hasMore, false)
  })

  it('uses the policy for single-record and write preflight lookups', async () => {
    const allowed = await postProject('Allowed', 'group-a')
    const hidden = await postProject('Hidden', 'group-b')

    const visibleRecord = await api.resources.policy_projects.get({
      id: allowed.data.id,
      format: 'jsonapi'
    }, groupContext('group-a'))
    assert.equal(visibleRecord.data.attributes.name, 'Allowed')

    await assert.rejects(
      api.resources.policy_projects.get({
        id: hidden.data.id,
        format: 'jsonapi'
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.patch({
        id: hidden.data.id,
        document: {
          data: {
            type: 'policy_projects',
            id: hidden.data.id,
            attributes: { name: 'Changed' }
          }
        },
        format: 'jsonapi'
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.delete({
        id: hidden.data.id,
        format: 'jsonapi'
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    const stillPresent = await api.resources.policy_projects.get({
      id: hidden.data.id,
      format: 'jsonapi'
    }, adminContext())
    assert.equal(stillPresent.data.attributes.name, 'Hidden')
  })

  it('filters included children and relationship identifiers', async () => {
    const project = await postProject('Visible project', 'group-a')
    const visibleTask = await postTask({
      title: 'Visible task',
      accessGroup: 'group-a',
      projectId: project.data.id
    })
    await postTask({
      title: 'Hidden task',
      accessGroup: 'group-b',
      projectId: project.data.id
    })

    policyEvents.length = 0
    const result = await api.resources.policy_projects.get({
      id: project.data.id,
      queryParams: { include: ['tasks'] },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(result.data.relationships.tasks.data, [
      resourceIdentifier('policy_tasks', visibleTask.data.id)
    ])
    assert.deepEqual(
      result.included.map((record) => record.attributes.title),
      ['Visible task']
    )
    assert(policyEvents.some((event) => event.queryPurpose === 'relationship-identifiers'))
    assert(policyEvents.some((event) => event.queryPurpose === 'include'))

    policyEvents.length = 0
    const relationship = await api.resources.policy_projects.getRelationship({
      id: project.data.id,
      relationshipName: 'tasks',
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(relationship.data, [
      resourceIdentifier('policy_tasks', visibleTask.data.id)
    ])
    assert(policyEvents.some((event) => event.queryPurpose === 'single'))
  })

  it('filters a belongs-to include through the target resource policy', async () => {
    const hiddenProject = await postProject('Hidden project', 'group-b')
    await postTask({
      title: 'Visible task',
      accessGroup: 'group-a',
      projectId: hiddenProject.data.id
    })

    const result = await api.resources.policy_tasks.query({
      queryParams: { include: ['project'], sort: ['id'] },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.equal(result.data.length, 1)
    assert.equal(result.included?.length || 0, 0)
  })

  it('uses target row policies during relationship validation', async () => {
    const hiddenProject = await postProject('Hidden project', 'group-b')

    await assert.rejects(
      postTask({
        title: 'Cross-policy task',
        accessGroup: 'group-a',
        projectId: hiddenProject.data.id,
        context: groupContext('group-a')
      }),
      (error) => error.code === 'REST_API_RESOURCE' || error.code === 'REST_API_VALIDATION'
    )

    assert(policyEvents.some((event) => event.queryPurpose === 'relationship-validation'))
  })

  it('uses target row policies when adding many-to-many relationships', async () => {
    const project = await postProject('Visible project', 'group-a')
    const visibleTask = await postTask({ title: 'Visible task', accessGroup: 'group-a' })
    const hiddenTask = await postTask({ title: 'Hidden task', accessGroup: 'group-b' })

    await api.resources.policy_projects.postRelationship({
      id: project.data.id,
      relationshipName: 'shared_tasks',
      relationshipData: [resourceIdentifier('policy_tasks', visibleTask.data.id)],
      format: 'jsonapi'
    }, groupContext('group-a'))

    await assert.rejects(
      api.resources.policy_projects.postRelationship({
        id: project.data.id,
        relationshipName: 'shared_tasks',
        relationshipData: [resourceIdentifier('policy_tasks', hiddenTask.data.id)],
        format: 'jsonapi'
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    assert.equal(await countRecords(knex, 'row_policy_project_tasks'), 1)
  })

  it('preserves caller visibility while replacing many-to-many membership', async () => {
    const parent = await postProject('Visible parent', 'group-a')
    const task = await postTask({ title: 'Visible task', accessGroup: 'group-a' })
    await api.resources.policy_projects.patchRelationship({
      id: parent.data.id,
      relationshipName: 'shared_tasks',
      relationshipData: [resourceIdentifier('policy_tasks', task.data.id)]
    }, groupContext('group-a'))
    const result = await api.resources.policy_projects.getRelationship({ id: parent.data.id, relationshipName: 'shared_tasks' }, groupContext('group-a'))
    assert.deepEqual(result.data, [resourceIdentifier('policy_tasks', task.data.id)])
    const related = await api.resources.policy_projects.getRelated({ id: parent.data.id, relationshipName: 'shared_tasks' }, groupContext('group-a'))
    assert.deepEqual(related.data.map(record => ({ type: record.type, id: record.id })), result.data)
    const included = await api.resources.policy_projects.get({ id: parent.data.id, queryParams: { include: ['shared_tasks'] } }, groupContext('group-a'))
    assert.deepEqual(included.included.map(record => ({ type: record.type, id: record.id })), result.data)
  })

  it('rejects partial replacement of a relationship containing hidden children', async () => {
    const parent = await postProject('Visible parent', 'group-a')
    const visible = await postTask({ title: 'Visible child', accessGroup: 'group-a', projectId: parent.data.id })
    const hidden = await postTask({ title: 'Hidden child', accessGroup: 'group-b', projectId: parent.data.id })
    await assert.rejects(api.resources.policy_projects.patchRelationship({
      id: parent.data.id, relationshipName: 'tasks', relationshipData: []
    }, groupContext('group-a')), error => {
      assert.equal(error.code, 'REST_API_RESOURCE')
      assert.equal(error.subtype, 'forbidden')
      assert.equal(error.message.includes(`policy_tasks/${hidden.data.id}`), false)
      assert.equal(error.details.resourceId, undefined)
      assert.equal(error.cause.code, 'REST_API_RESOURCE')
      return true
    })
    const result = await api.resources.policy_projects.getRelationship({ id: parent.data.id, relationshipName: 'tasks' }, adminContext())
    assert.deepEqual(result.data.map(record => record.id).sort(), [visible.data.id, hidden.data.id].sort())
  })

  it('applies child visibility when adding and removing hasMany linkage', async () => {
    const parent = await postProject('Visible parent', 'group-a')
    const visible = await postTask({ title: 'Visible child', accessGroup: 'group-a' })
    const hidden = await postTask({ title: 'Hidden child', accessGroup: 'group-b', projectId: parent.data.id })
    await api.resources.policy_projects.postRelationship({
      id: parent.data.id, relationshipName: 'tasks', relationshipData: [resourceIdentifier('policy_tasks', visible.data.id)]
    }, groupContext('group-a'))
    await assert.rejects(api.resources.policy_projects.deleteRelationship({
      id: parent.data.id, relationshipName: 'tasks', relationshipData: [resourceIdentifier('policy_tasks', visible.data.id), resourceIdentifier('policy_tasks', hidden.data.id)]
    }, groupContext('group-a')), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
    const result = await api.resources.policy_projects.getRelationship({ id: parent.data.id, relationshipName: 'tasks' }, adminContext())
    assert.deepEqual(result.data.map(record => record.id).sort(), [visible.data.id, hidden.data.id].sort())
  })

  it('does not expose relationship routes for a hidden parent', async () => {
    const hiddenProject = await postProject('Hidden project', 'group-b')

    await assert.rejects(
      api.resources.policy_projects.getRelated({
        id: hiddenProject.data.id,
        relationshipName: 'tasks',
        queryParams: {},
        format: 'jsonapi'
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.getRelationship({
        id: hiddenProject.data.id,
        relationshipName: 'tasks',
        format: 'jsonapi'
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.patchRelationship({
        id: hiddenProject.data.id,
        relationshipName: 'tasks',
        relationshipData: [],
        format: 'jsonapi'
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    assert(policyEvents.some((event) => event.queryPurpose === 'relationship-parent'))
  })

  it('filters related children before pagination and keeps target filters off the parent lookup', async () => {
    const project = await postProject('Visible project', 'group-a')
    const otherProject = await postProject('Other visible project', 'group-a')
    await postTask({ title: 'Other parent', accessGroup: 'group-a', projectId: otherProject.data.id })
    const otherWorkspace = await postProject('Other workspace', 'group-a', adminContext('workspace-b'))
    await postTask({ title: 'Other workspace task', accessGroup: 'group-a', projectId: otherWorkspace.data.id, context: adminContext('workspace-b') })
    await postTask({ title: 'Allowed 1', accessGroup: 'group-a', projectId: project.data.id })
    await postTask({ title: 'Hidden 1', accessGroup: 'group-b', projectId: project.data.id })
    await postTask({ title: 'Allowed 2', accessGroup: 'group-a', projectId: project.data.id })
    await postTask({ title: 'Hidden 2', accessGroup: 'group-b', projectId: project.data.id })
    await postTask({ title: 'Allowed 3', accessGroup: 'group-a', projectId: project.data.id })

    const firstPage = await api.resources.policy_projects.getRelated({
      id: project.data.id,
      relationshipName: 'tasks',
      queryParams: {
        sort: ['id'],
        page: { number: 1, size: 2 }
      },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(
      firstPage.data.map((record) => record.attributes.title),
      ['Allowed 1', 'Allowed 2']
    )
    assert.equal(firstPage.meta.pagination.total, 3)
    assert.equal(new URL(firstPage.links.next, 'https://api.example.test').pathname, `/policy_projects/${project.data.id}/tasks`)

    const filtered = await api.resources.policy_projects.getRelated({
      id: project.data.id,
      relationshipName: 'tasks',
      queryParams: {
        filters: { title: 'Allowed 3' },
        page: { number: 1, size: 2 }
      },
      format: 'jsonapi'
    }, groupContext('group-a'))

    assert.deepEqual(
      filtered.data.map((record) => record.attributes.title),
      ['Allowed 3']
    )
    assert.equal(filtered.meta.pagination.total, 1)
  })

  it('denies all rows when a policy explicitly returns false', async () => {
    await postProject('Hidden without context', 'group-a')

    const result = await api.resources.policy_projects.query({
      queryParams: { page: { number: 1, size: 10 } },
      format: 'jsonapi'
    }, { scopeValues: { workspaceId: 'workspace-a' } })

    assert.deepEqual(result.data, [])
    assert.equal(result.meta.pagination.total, 0)
  })

  it('fails closed when a policy does not return an explicit decision', async () => {
    await assert.rejects(
      api.resources.policy_broken.query({ format: 'jsonapi' }),
      (error) => error.code === 'REST_API_ROW_POLICY_CONTRACT'
    )
  })

  it('exposes compiled policy configuration for inspection', () => {
    assert.deepEqual(api.rowPolicies.getConfig(), {
      policies: ['groupVisibility']
    })
    assert.deepEqual(api.rowPolicies.getScopeConfig('policy_projects'), {
      policy: 'groupVisibility',
      source: 'registry'
    })
    assert.deepEqual(api.rowPolicies.getScopeConfig('policy_broken'), {
      policy: '<inline>',
      source: 'inline'
    })
  })
})
