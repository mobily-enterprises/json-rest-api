import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createStorageAdapterLookup } from '../plugins/core/lib/storage/storage-adapter.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'

let fixture
before(async () => {
  fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' } })
})
beforeEach(async () => { await fixture.reset() })
after(async () => { await fixture?.close() })
describe('Adapter lookup against real compiled resources', () => {
  it('exposes the same lookup through both installed helper paths', () => {
    const lookup = fixture.api.knex.helpers.getStorageAdapter
    assert.equal(lookup, fixture.api.helpers.getStorageAdapter)
    assert.equal(lookup('missing'), null)
    const adapter = lookup('items')
    assert.equal(adapter, lookup('items'))
    assert.equal(adapter, fixture.api.resources.items.vars.storageAdapter)
    assert.equal(adapter.isCanonical(), fixture.storage === 'anyapi')
  })
  it('reuses only the same resource/schema and does not cache missing scopes', () => {
    const resources = { ...fixture.api.resources }
    const lookup = createStorageAdapterLookup({ knex: fixture.knex, getResource: name => resources[name] })
    assert.equal(lookup('missing'), null)
    assert.equal(lookup(''), null)
    const first = lookup('items')
    assert.equal(first, lookup('items'))
    assert.equal(resources.items.vars.storageAdapter, first)
    assert.notEqual(first, lookup('groups'))
    resources.missing = { vars: { schemaInfo: resources.items.vars.schemaInfo } }
    assert.notEqual(lookup('missing'), first)
  })
  it('refreshes replaced compiled metadata and isolates lookup instances', () => {
    const schemaInfo = fixture.api.resources.items.vars.schemaInfo
    const resource = { vars: { schemaInfo } }
    const options = { knex: fixture.knex, getResource: () => resource }
    const firstLookup = createStorageAdapterLookup(options)
    const secondLookup = createStorageAdapterLookup(options)
    const first = firstLookup('items')
    assert.notEqual(secondLookup('items'), first)
    resource.vars.schemaInfo = { ...schemaInfo }
    const refreshed = firstLookup('items')
    assert.notEqual(refreshed, first)
    assert.equal(resource.vars.storageAdapter, refreshed)
    assert.equal(refreshed.translateColumn('name'), first.translateColumn('name'))
    assert.equal(refreshed.getTableName(), first.getTableName())
    assert.equal(refreshed.isCanonical(), first.isCanonical())
  })
})
