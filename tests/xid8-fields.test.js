import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JsonRestApi, RestApiPlugin, RestApiValidationError } from '../index.js'
import { useStoragePlugin } from './fixtures/api-configs.js'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'

const cause = error => error?.cause ?? error
const invalid = error => cause(error) instanceof RestApiValidationError
const resource = (searchSchema = {}) => ({
  schema: { id: { type: 'id' }, body: { type: 'string', required: true, max: 40 }, changed: { type: 'xid8', nullable: true } },
  searchSchema: {
    changedSince: { type: 'xid8', actualField: 'changed', filterOperator: '>=' },
    changedBefore: { type: 'xid8', actualField: 'changed', filterOperator: '<' },
    changedIn: { type: 'array', actualField: 'changed', filterOperator: 'in' },
    changedBetween: { type: 'array', actualField: 'changed', filterOperator: 'between' },
    ...searchSchema
  },
  tableName: 'xid8_messages'
})

const knexOnPostgres = databaseClient === 'pg' && !storageMode.isAnyApi()

describe(`xid8 fields (${storageMode.mode})`, () => {
  let database, api
  before(async () => {
    database = await createTestDatabase()
    api = new JsonRestApi({ name: 'xid8-api' })
    await api.use(RestApiPlugin, { format: 'plain' })
    await useStoragePlugin(api, database.knex)
  })
  after(async () => { await database?.close() })

  it('is refused at registration except on Knex storage on PostgreSQL', { skip: knexOnPostgres && 'Knex storage on PostgreSQL has the type' }, async () => {
    await assert.rejects(api.addResource('xid8_messages', resource()), /has type 'xid8', PostgreSQL's transaction id, which only Knex storage on PostgreSQL has/)
  })

  describe('on Knex storage on PostgreSQL', { skip: !knexOnPostgres && 'Knex storage on PostgreSQL only' }, () => {
    let changes
    const messages = () => api.resources.xid8_messages
    const bodies = async filters => (await messages().query({ queryParams: { filters, sort: ['id'] } })).data.map(record => record.body)
    before(async () => {
      await api.addResource('xid8_messages', resource())
      await database.knex.raw('create table xid8_messages (id serial primary key, body text not null, changed xid8 default pg_current_xact_id())')
      // Each insert is its own transaction, so each row gets a later transaction id.
      for (const body of ['first', 'second', 'third']) await messages().post({ data: { body }, returning: 'none' })
      changes = (await messages().query({ queryParams: { sort: ['id'] } })).data.map(record => record.changed)
    })

    it('reads back decimal text that orders as the transactions did', () => {
      assert.ok(changes.every(value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value)), JSON.stringify(changes))
      const [first, second, third] = changes.map(BigInt)
      assert.ok(first < second && second < third)
    })

    it('filters by comparison, in and between, as xid8 in the database', async () => {
      const [first, second, third] = changes
      assert.deepEqual(await bodies({ changedSince: second }), ['second', 'third'])
      assert.deepEqual(await bodies({ changedBefore: second }), ['first'])
      assert.deepEqual(await bodies({ changedIn: [first, third] }), ['first', 'third'])
      assert.deepEqual(await bodies({ changedBetween: [first, second] }), ['first', 'second'])
      // Leading zeros are dropped, and the largest xid8 is a valid bound.
      assert.deepEqual(await bodies({ changedSince: `000${first}` }), ['first', 'second', 'third'])
      assert.deepEqual(await bodies({ changedSince: '18446744073709551615' }), [])
      assert.deepEqual((await messages().query({ queryParams: { sort: ['-changed'] } })).data.map(record => record.body), ['third', 'second', 'first'])
    })

    it('refuses anything but decimal text below 2^64 before any statement', async () => {
      let statements = 0
      const count = () => { statements++ }
      database.knex.on('query', count)
      try {
        for (const value of ['abc', '-1', '1.5', ' 1', '', '18446744073709551616', '123456789012345678901']) {
          await assert.rejects(messages().query({ queryParams: { filters: { changedSince: value } } }), invalid, JSON.stringify(value))
        }
        await assert.rejects(messages().query({ queryParams: { filters: { changedIn: [changes[0], 'abc'] } } }), invalid)
        await assert.rejects(messages().query({ queryParams: { filters: { changedBetween: ['1', '18446744073709551616'] } } }), invalid)
      } finally {
        database.knex.off('query', count)
      }
      assert.equal(statements, 0)
      await assert.rejects(messages().post({ data: { body: 'bad', changed: 'not a transaction' } }), invalid)
      await assert.rejects(messages().post({ data: { body: 'bad', changed: 18446744073709551616n } }), invalid)
    })

    it('stores canonical text and accepts a bigint', async () => {
      const written = await messages().post({ data: { body: 'explicit', changed: '000123' } })
      assert.equal(written.changed, '123')
      const big = await messages().post({ data: { body: 'bigint', changed: 18446744073709551615n } })
      assert.equal(big.changed, '18446744073709551615')
      assert.equal((await messages().get({ id: big.id })).changed, '18446744073709551615')
      await messages().deleteMany({ ids: [written.id, big.id] })
    })

    it('takes min and max in aggregates, and refuses sum', async () => {
      const result = await messages().aggregate({ measures: { oldest: { min: 'changed' }, newest: { max: 'changed' } } })
      assert.deepEqual(result.data, [{ oldest: changes[0], newest: changes[2] }])
      await assert.rejects(messages().aggregate({ measures: { total: { sum: 'changed' } } }), invalid)
    })

    it('refuses text search on an xid8 field at registration', async () => {
      await assert.rejects(
        api.addResource('xid8_searched', resource({ changedLike: { type: 'xid8', actualField: 'changed', filterOperator: 'contains' } })),
        /searches text in an xid8 field/
      )
    })
  })
})
