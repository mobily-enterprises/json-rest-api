import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createFieldTypesApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

const tables = { contacts: 'field_type_contacts' }
const fields = {
  photo: { type: 'none', nullable: true, search: true },
  bytes: { type: 'blob', nullable: true },
  workspace_id: { type: 'string', nullable: true },
  role: { type: 'string', nullable: true }
}
// mysql2 before 3.17 formats an object bound as a value into `key` = value pairs,
// so this value, stored as is, would also set workspace_id and role.
const injected = { photo: '', workspace_id: 'ws-b', role: 'admin' }
const original = { photo: 'ann.png', workspace_id: 'ws-a', role: 'member' }

const validationCause = error => error instanceof RestApiValidationError ? error : error?.cause

// AnyAPI storage has no 'none' or 'blob' fields; its field types refuse objects in validation.
describe(`Object values in scalar fields (${storageMode.mode})`, { skip: storageMode.isAnyApi() }, () => {
  let fixture, contact
  const contacts = () => fixture.api.resources.contacts
  const document = (attributes, id) => ({ data: { type: 'contacts', ...(id ? { id } : {}), attributes } })
  // The stored columns, read past the API.
  const row = id => fixture.knex(tables.contacts).where('id', id).first()
  const stored = async id => {
    const { photo, workspace_id: workspaceId, role } = await row(id)
    return { photo, workspace_id: workspaceId, role }
  }
  const refused = (failure, path) => {
    const cause = validationCause(failure)
    assert.ok(cause instanceof RestApiValidationError, failure?.stack || 'the write was accepted')
    assert.deepEqual(cause.details.fields, [path])
  }

  before(async () => {
    fixture = await createConformanceFixture({ createApi: (knex, options) => createFieldTypesApi(knex, { ...options, fields }), tables })
  })
  beforeEach(async () => {
    await fixture.reset()
    contact = (await contacts().post({ document: document({ name: 'Ann', ...original }) })).data
  })
  after(async () => { await fixture?.close() })

  for (const field of ['photo', 'bytes']) {
    it(`refuses an object in a '${fields[field].type}' field instead of writing other columns`, async () => {
      let failure
      try {
        await contacts().patch({ id: contact.id, document: document({ [field]: injected }, contact.id) })
      } catch (error) { failure = error }
      // Without the check, MySQL and MariaDB through mysql2 3.16 stored workspace_id 'ws-b' and
      // role 'admin' here; later mysql2 stored '[object Object]' and PostgreSQL the JSON text.
      assert.deepEqual(await stored(contact.id), original)
      refused(failure, `data.attributes.${field}`)
    })
  }

  it('refuses an object in a create', async () => {
    let failure
    try {
      await contacts().post({ document: document({ name: 'Bob', photo: injected }) })
    } catch (error) { failure = error }
    assert.equal(await fixture.count('contacts'), 1)
    refused(failure, 'data.attributes.photo')
  })

  it('refuses an object as a filter value', async () => {
    await contacts().post({ document: document({ name: 'Bob', photo: 'bob.png' }) })
    let failure, rows
    try {
      rows = (await contacts().query({ queryParams: { filters: { photo: { name: 'nobody' } } } })).data
    } catch (error) { failure = error }
    // Without the check, PostgreSQL compared the column with the JSON text and SQLite failed to bind it.
    assert.equal(rows, undefined, `the filter returned ${rows?.length} rows`)
    refused(failure, 'filters.photo')
  })

  it('still stores strings, buffers and null in these fields', async () => {
    const bytes = Buffer.from('raw bytes')
    await contacts().patch({ id: contact.id, document: document({ photo: 'new.png', bytes }, contact.id) })
    const updated = await row(contact.id)
    assert.equal(updated.photo, 'new.png')
    assert.equal(Buffer.from(updated.bytes).toString(), 'raw bytes')
    await contacts().patch({ id: contact.id, document: document({ photo: null, bytes: null }, contact.id) })
    assert.deepEqual(await stored(contact.id), { ...original, photo: null })
    const names = async filters => (await contacts().query({ queryParams: { filters } })).data.length
    assert.equal(await names({ photo: 'new.png' }), 0)
  })
})
