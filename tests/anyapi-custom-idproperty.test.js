import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { Api } from 'hooked-api'

import { RestApiPlugin, RestApiAnyapiKnexPlugin } from '../index.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import {
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier,
} from './helpers/test-utils.js'

const maybeDescribe = storageMode.isAnyApi() ? describe : describe.skip

maybeDescribe('AnyAPI custom idProperty', () => {
  const knex = knexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })

  let api

  before(async () => {
    await ensureAnyApiSchema(knex)

    api = new Api({ name: 'anyapi-custom-idproperty-test', log: { level: 'warn' } })
    await api.use(RestApiPlugin, {
      simplifiedApi: false,
      simplifiedTransport: false,
      returnRecordApi: {
        post: 'full',
        put: 'full',
        patch: 'full',
      },
      sortableFields: ['id', 'owner_id', 'item_id', 'code', 'name', 'category'],
      queryDefaultLimit: 20,
      queryMaxLimit: 100,
    })
    await api.use(RestApiAnyapiKnexPlugin, { knex })

    await api.addResource('owners', {
      schema: {
        owner_id: { type: 'id' },
        name: { type: 'string', required: true },
      },
      idProperty: 'owner_id',
      tableName: 'custom_id_owners',
    })
    await api.resources.owners.createKnexTable()

    await api.addResource('items', {
      schema: {
        item_id: { type: 'id' },
        code: { type: 'string', required: true, search: true },
        name: { type: 'string', required: true },
        category: { type: 'string', required: true },
        owner_id: { type: 'id', belongsTo: 'owners', as: 'owner' },
      },
      idProperty: 'item_id',
      tableName: 'custom_id_items',
    })
    await api.resources.items.createKnexTable()
  })

  after(async () => {
    await api?.release()
    await knex.destroy()
  })

  beforeEach(async () => {
    await knex('any_links').delete()
    await knex('any_records').delete()
  })

  it('uses logical ids for post, get, query, sparse fields, cursors, and includes', async () => {
    const owner = await api.resources.owners.post({
      inputRecord: createJsonApiDocument('owners', { name: 'Owner One' }),
      simplified: false,
    })

    const itemInputs = [
      { code: 'A001', name: 'Apple', category: 'Fruit' },
      { code: 'A002', name: 'Apricot', category: 'Fruit' },
      { code: 'B001', name: 'Broccoli', category: 'Vegetable' },
      { code: 'C001', name: 'Carrot', category: 'Vegetable' },
    ]

    const createdItems = []
    for (const item of itemInputs) {
      const created = await api.resources.items.post({
        inputRecord: createJsonApiDocument(
          'items',
          item,
          { owner: createRelationship(resourceIdentifier('owners', owner.data.id)) }
        ),
        simplified: false,
      })
      createdItems.push(created)
    }

    const fetched = await api.resources.items.get({
      id: createdItems[0].data.id,
      queryParams: {
        include: ['owner'],
        fields: {
          items: 'item_id,code,name,category',
          owners: 'owner_id,name',
        },
      },
      simplified: false,
    })

    assert.equal(fetched.data.id, createdItems[0].data.id)
    assert.equal(fetched.data.attributes.code, 'A001')
    assert.equal(fetched.data.attributes.name, 'Apple')
    assert.equal(fetched.data.attributes.item_id, undefined)
    assert.equal(fetched.included?.[0]?.type, 'owners')
    assert.equal(fetched.included?.[0]?.id, owner.data.id)
    assert.equal(fetched.included?.[0]?.attributes.owner_id, undefined)

    const firstPage = await api.resources.items.query({
      queryParams: {
        include: ['owner'],
        fields: {
          items: 'item_id,code,name,category',
          owners: 'owner_id,name',
        },
        sort: ['category', 'name'],
        page: { size: 2 },
      },
      simplified: false,
    })

    assert.equal(firstPage.data.length, 2)
    assert(firstPage.meta.pagination.cursor.next, 'first page should include a next cursor')
    assert(firstPage.data.every((item) => item.attributes.item_id === undefined))
    assert(firstPage.included?.some((entry) => entry.type === 'owners' && entry.id === owner.data.id))

    const secondPage = await api.resources.items.query({
      queryParams: {
        include: ['owner'],
        fields: {
          items: 'item_id,code,name,category',
          owners: 'owner_id,name',
        },
        sort: ['category', 'name'],
        page: {
          size: 2,
          after: firstPage.meta.pagination.cursor.next,
        },
      },
      simplified: false,
    })

    const firstIds = firstPage.data.map((item) => item.id)
    const secondIds = secondPage.data.map((item) => item.id)
    assert.equal(secondPage.data.length, 2)
    assert(!secondIds.some((id) => firstIds.includes(id)), 'cursor page should not repeat records')
  })
})
