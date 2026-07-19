import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  cleanTables,
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier,
  validateJsonApiStructure
} from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createRowPolicyApi } from './fixtures/api-configs.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api
const policyEvents = []

const adminContext = () => ({ visibility: { all: true } })
const groupContext = (...groups) => ({ visibility: { groups } })

const postProject = async (name, accessGroup) => {
  return api.resources.policy_projects.post({
    inputRecord: createJsonApiDocument('policy_projects', {
      name,
      access_group: accessGroup
    }),
    simplified: false
  }, adminContext())
}

const postTask = async ({ title, accessGroup, projectId, context = adminContext() }) => {
  const relationships = projectId === undefined
    ? {}
    : {
        project: createRelationship(resourceIdentifier('policy_projects', projectId))
      }

  return api.resources.policy_tasks.post({
    inputRecord: createJsonApiDocument('policy_tasks', {
      title,
      access_group: accessGroup
    }, relationships),
    simplified: false
  }, context)
}

describe('RowPolicy Plugin', () => {
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
      'row_policy_projects',
      'row_policy_tasks',
      'row_policy_broken'
    ])
  })

  it('applies visibility before offset pagination and counts the same dataset', async () => {
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
      simplified: false
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
      simplified: false
    }, groupContext('group-a'))

    assert.deepEqual(
      secondPage.data.map((record) => record.attributes.name),
      ['Allowed 3']
    )
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
      simplified: false
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
      simplified: false
    }, groupContext('group-a'))

    assert.deepEqual(
      secondPage.data.map((record) => record.attributes.name),
      ['Allowed 3']
    )
    assert.equal(secondPage.meta.pagination.hasMore, false)
  })

  if (storageMode.isAnyApi()) {
    it('applies the policy to the standalone AnyAPI count helper', async () => {
      await postProject('Allowed 1', 'group-a')
      await postProject('Hidden 1', 'group-b')
      await postProject('Allowed 2', 'group-a')

      policyEvents.length = 0
      const total = await api.helpers.dataQueryCount({
        scopeName: 'policy_projects',
        context: {
          db: knex,
          queryParams: {},
          ...groupContext('group-a')
        }
      })

      assert.equal(total, 2)
      assert(policyEvents.some((event) => event.queryPurpose === 'count'))
    })
  }

  it('uses the policy for single-record and write preflight lookups', async () => {
    const allowed = await postProject('Allowed', 'group-a')
    const hidden = await postProject('Hidden', 'group-b')

    const visibleRecord = await api.resources.policy_projects.get({
      id: allowed.data.id,
      simplified: false
    }, groupContext('group-a'))
    assert.equal(visibleRecord.data.attributes.name, 'Allowed')

    await assert.rejects(
      api.resources.policy_projects.get({
        id: hidden.data.id,
        simplified: false
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.patch({
        id: hidden.data.id,
        inputRecord: {
          data: {
            type: 'policy_projects',
            id: hidden.data.id,
            attributes: { name: 'Changed' }
          }
        },
        simplified: false
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.delete({
        id: hidden.data.id,
        simplified: false
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    const stillPresent = await api.resources.policy_projects.get({
      id: hidden.data.id,
      simplified: false
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
      simplified: false
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
      simplified: false
    }, groupContext('group-a'))

    assert.deepEqual(relationship.data, [
      resourceIdentifier('policy_tasks', visibleTask.data.id)
    ])
    assert(policyEvents.some((event) => event.queryPurpose === 'relationship-parent'))
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
      simplified: false
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

  it('does not expose relationship routes for a hidden parent', async () => {
    const hiddenProject = await postProject('Hidden project', 'group-b')

    await assert.rejects(
      api.resources.policy_projects.getRelated({
        id: hiddenProject.data.id,
        relationshipName: 'tasks',
        queryParams: {},
        simplified: false
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.getRelationship({
        id: hiddenProject.data.id,
        relationshipName: 'tasks',
        simplified: false
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    await assert.rejects(
      api.resources.policy_projects.patchRelationship({
        id: hiddenProject.data.id,
        relationshipName: 'tasks',
        relationshipData: [],
        simplified: false
      }, groupContext('group-a')),
      (error) => error.code === 'REST_API_RESOURCE'
    )

    assert(policyEvents.some((event) => event.queryPurpose === 'relationship-parent'))
  })

  it('filters related children before pagination and keeps target filters off the parent lookup', async () => {
    const project = await postProject('Visible project', 'group-a')
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
      simplified: false
    }, groupContext('group-a'))

    assert.deepEqual(
      firstPage.data.map((record) => record.attributes.title),
      ['Allowed 1', 'Allowed 2']
    )
    assert.equal(firstPage.meta.pagination.total, 3)

    const filtered = await api.resources.policy_projects.getRelated({
      id: project.data.id,
      relationshipName: 'tasks',
      queryParams: {
        filters: { title: 'Allowed 3' },
        page: { number: 1, size: 2 }
      },
      simplified: false
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
      simplified: false
    })

    assert.deepEqual(result.data, [])
    assert.equal(result.meta.pagination.total, 0)
  })

  it('fails closed when a policy does not return an explicit decision', async () => {
    await assert.rejects(
      api.resources.policy_broken.query({ simplified: false }),
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
