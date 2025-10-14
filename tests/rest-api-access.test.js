import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  validateJsonApiStructure,
  cleanTables,
  createJsonApiDocument,
  assertResourceAttributes,
  assertResourceRelationship
} from './helpers/test-utils.js'
import { createAccessControlApi } from './fixtures/api-configs.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

let api

async function createUser (email, displayName = 'Test User') {
  const userDoc = createJsonApiDocument('users', {
    email,
    display_name: displayName
  })

  const result = await api.resources.users.post({
    inputRecord: userDoc,
    simplified: false
  }, { auth: { system: true } })

  validateJsonApiStructure(result)
  assertResourceAttributes(result.data, {
    email,
    display_name: displayName
  })

  return Number(result.data.id)
}

async function createProjectForUser (userId, name, status = null) {
  const projectDoc = createJsonApiDocument('projects', {
    name,
    status
  })

  const result = await api.resources.projects.post({
    inputRecord: projectDoc,
    simplified: false
  }, { auth: { userId } })

  validateJsonApiStructure(result)
  return result.data
}

describe('Access plugin', () => {
  before(async () => {
    api = await createAccessControlApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'access_notes',
      'access_projects',
      'access_users'
    ])
  })

  it('rejects unauthenticated requests for protected operations', async () => {
    const projectDoc = createJsonApiDocument('projects', {
      name: 'Unauthenticated project'
    })

    await assert.rejects(async () => {
      await api.resources.projects.post({
        inputRecord: projectDoc,
        simplified: false
      })
    }, (error) => {
      assert.equal(error.statusCode, 403)
      assert.match(error.message, /Access denied/)
      return true
    })
  })

  it('auto assigns ownership when creating a project', async () => {
    const ownerId = await createUser('owner@example.com', 'Owner One')

    const projectDoc = createJsonApiDocument('projects', {
      name: 'Owned Project',
      status: 'active'
    })

    const createResult = await api.resources.projects.post({
      inputRecord: projectDoc,
      simplified: false
    }, { auth: { userId: ownerId } })

    validateJsonApiStructure(createResult)
    assertResourceAttributes(createResult.data, {
      name: 'Owned Project',
      status: 'active'
    })
    assertResourceRelationship(createResult.data, 'user', {
      type: 'users',
      id: String(ownerId)
    })

    const getResult = await api.resources.projects.get({
      id: createResult.data.id,
      simplified: false
    }, { auth: { userId: ownerId } })

    validateJsonApiStructure(getResult)
    assertResourceRelationship(getResult.data, 'user', {
      type: 'users',
      id: String(ownerId)
    })
  })

  it('filters query results by ownership for non-admin users', async () => {
    const aliceId = await createUser('alice@example.com', 'Alice')
    const bobId = await createUser('bob@example.com', 'Bob')

    const aliceProject = await createProjectForUser(aliceId, 'Alice Project', 'active')
    await createProjectForUser(bobId, 'Bob Project', 'planning')

    const queryResult = await api.resources.projects.query({
      simplified: false
    }, { auth: { userId: aliceId } })

    validateJsonApiStructure(queryResult, true)
    assert.equal(queryResult.data.length, 1)
    assert.equal(queryResult.data[0].id, aliceProject.id)
    assertResourceRelationship(queryResult.data[0], 'user', {
      type: 'users',
      id: String(aliceId)
    })
  })

  it('allows admin roles to bypass ownership filtering', async () => {
    const userA = await createUser('admin_a@example.com', 'Admin A')
    const userB = await createUser('admin_b@example.com', 'Admin B')

    await createProjectForUser(userA, 'Admin Project A')
    await createProjectForUser(userB, 'Admin Project B')

    const adminQuery = await api.resources.projects.query({
      simplified: false
    }, { auth: { userId: 999, roles: ['admin'] } })

    validateJsonApiStructure(adminQuery, true)
    assert.equal(adminQuery.data.length, 2)

    const relatedUserIds = adminQuery.data.map((resource) => resource.relationships.user.data.id).sort()
    assert.deepEqual(relatedUserIds, [String(userA), String(userB)])
  })

  it('prevents users from accessing records they do not own', async () => {
    const ownerId = await createUser('primary@example.com', 'Primary')
    const otherId = await createUser('secondary@example.com', 'Secondary')

    const project = await createProjectForUser(ownerId, 'Primary Project')

    await assert.rejects(async () => {
      await api.resources.projects.get({
        id: project.id,
        simplified: false
      }, { auth: { userId: otherId } })
    }, (error) => {
      assert.equal(error.statusCode, 403)
      assert.match(error.message, /Access denied/)
      return true
    })
  })

  it('enforces helper ownership checks', () => {
    const context = { auth: { userId: 123 } }
    const resource = { user_id: 123 }

    const auth = api.helpers.auth.requireOwnership(context, resource)
    assert.equal(auth.userId, 123)

    assert.throws(() => {
      api.helpers.auth.requireOwnership({ auth: { userId: 123 } }, { user_id: 456 })
    }, (error) => {
      assert.equal(error.statusCode, 403)
      assert.match(error.message, /Access denied/)
      return true
    })

    assert.throws(() => {
      api.helpers.auth.requireAuth({})
    }, (error) => {
      assert.equal(error.statusCode, 401)
      assert.match(error.message, /Authentication required/)
      return true
    })
  })
})
