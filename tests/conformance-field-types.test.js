import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createFieldTypesApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

const tables = { contacts: 'field_type_contacts' }
const token = '3f1c2a4e-9b7d-4c1e-8f00-0123456789ab'
const rejectsWith = (promise, rule, pattern) => assert.rejects(promise, error => {
  const cause = error instanceof RestApiValidationError ? error : error.cause
  return cause instanceof RestApiValidationError &&
    (rule === null || cause.details.violations.some(violation => violation.rule === rule)) &&
    pattern.test(cause.message)
})

describe(`Field types and retired fields (${storageMode.mode})`, () => {
  let fixture
  const contacts = () => fixture.api.resources.contacts
  const post = attributes => contacts().post({ document: { data: { type: 'contacts', attributes } } })
  const names = async filters => (await contacts().query({ queryParams: { filters, sort: ['id'] } })).data.map(row => row.attributes.name)

  before(async () => {
    fixture = await createConformanceFixture({ createApi: createFieldTypesApi, tables })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('stores and filters email and uuid fields as strings', async () => {
    const created = await post({ name: 'Ann', email: ' ann@example.com ', token })
    assert.equal(created.data.attributes.email, 'ann@example.com')
    assert.equal(created.data.attributes.token, token)
    await post({ name: 'Bob', email: 'bob@test.org', token: null })

    assert.deepEqual(await names({ email: 'bob@test.org' }), ['Bob'])
    assert.deepEqual(await names({ token }), ['Ann'])
    // Partial matches search fragments, which are not addresses.
    assert.deepEqual(await names({ emailContains: 'example' }), ['Ann'])
  })

  it('rejects malformed emails and uuids on writes and equality filters', async () => {
    await rejectsWith(post({ name: 'Ann', email: 'not-an-email' }), null, /validation failed/i)
    await rejectsWith(post({ name: 'Ann', token: '1234' }), null, /validation failed/i)
    await rejectsWith(post({ name: 'Ann', email: 42 }), null, /validation failed/i)
    await assert.rejects(names({ email: 'example' }), RestApiValidationError)
  })

  it('exports formats for transport validation', () => {
    const exported = JSON.stringify(contacts().vars.schemaInfo.schemaInstance.toJsonSchema({ mode: 'patch' }))
    assert.match(exported, /"format":"email"/)
    assert.match(exported, /"format":"uuid"/)
  })

  it('rejects field types no casting function exists for when the resource is added', async () => {
    for (const type of ['text', 'float', 'decimal', 'datetime', 'json', 'phone']) {
      await assert.rejects(
        createConformanceFixture({ createApi: (knex, options) => createFieldTypesApi(knex, { ...options, fields: { extra: { type } } }), tables }),
        new RegExp(`Field 'extra' in resource 'contacts' has unknown type '${type}'`)
      )
    }
  })

  it('keeps retired values readable and accepts no new ones', async () => {
    await seedStorageAdapterRecords(fixture.knex, contacts().vars.schemaInfo, [
      { id: '1', name: 'Ann', phone: '555-1000' },
      { id: '2', name: 'Bob', phone: '555-2000' }
    ])
    const ann = await contacts().get({ id: '1' })
    assert.equal(ann.data.attributes.phone, '555-1000')
    assert.deepEqual(await names({ phone: '555-2000' }), ['Bob'])

    await rejectsWith(post({ name: 'Cy', phone: '555-3000' }), 'retired_field', /Field 'phone' is retired/)
    await rejectsWith(post({ name: 'Cy', phone: null }), 'retired_field', /Field 'phone' is retired/)
    await rejectsWith(contacts().patch({ id: '1', document: { data: { type: 'contacts', id: '1', attributes: { phone: '1' } } } }), 'retired_field', /retired/)

    // Required and defaultTo no longer apply, and replacement leaves the stored value alone.
    const created = await post({ name: 'Cy' })
    assert.equal(created.data.attributes.phone, null)
    const replaced = await contacts().put({ id: '1', document: { data: { type: 'contacts', id: '1', attributes: { name: 'Ann B' } } } })
    assert.equal(replaced.data.attributes.name, 'Ann B')
    assert.equal(replaced.data.attributes.phone, '555-1000')
  })

  it('refuses to retire relationships and non-boolean flags', async () => {
    const register = fields => createConformanceFixture({ createApi: (knex, options) => createFieldTypesApi(knex, { ...options, fields }), tables })
    await assert.rejects(register({ ownerId: { type: 'id', belongsTo: 'contacts', as: 'owner', retired: true } }), /'ownerId'.*cannot be retired/)
    await assert.rejects(register({ extra: { type: 'string', retired: 'yes' } }), /non-boolean retired option/)
  })
})
