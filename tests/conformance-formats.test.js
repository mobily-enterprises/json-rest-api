import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createJsonApiDocument, validateJsonApiStructure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

for (const defaultReturning of ['none', 'minimal', 'full']) {
  for (const scoped of [false, true]) {
    const globalOptions = { format: 'plain', returning: scoped ? 'full' : defaultReturning }
    const itemOptions = { format: 'jsonapi', returning: defaultReturning }
    describe(`Shared format conformance, ${scoped ? 'resource overrides' : 'global defaults'} (${storageMode.mode})`, () => {
      let fixture
      let items
      before(async () => {
        fixture = await createConformanceFixture({
          apiOptions: { ...globalOptions, ...(scoped ? { itemOptions } : {}) }
        })
        items = fixture.api.resources.items
      })
      beforeEach(async () => { await fixture.reset() })
      after(async () => { await fixture?.close() })

      const settings = scoped ? itemOptions : globalOptions
      for (const overrideFormat of [false, true]) {
        const format = overrideFormat ? (settings.format === 'plain' ? 'jsonapi' : 'plain') : settings.format
        const simplified = format === 'plain'
        const params = overrideFormat ? { format } : {}
        const label = `${defaultReturning} returns, ${overrideFormat ? 'overridden' : 'default'} format`

        it(`reads single records and collections with ${label}`, async () => {
          const empty = await items.query({ ...params })
          assert.deepEqual(empty.data, [])
          const group = await fixture.seed('groups', { name: 'Group' })
          const created = await fixture.seed('items', { name: 'Read', active: false, score: 0 }, {
            group: { data: { type: 'groups', id: group.id } }
          })
          const getResult = await items.get({ ...params, id: created.id, queryParams: { include: ['group'] } })
          const queryResult = await items.query({ ...params, queryParams: { include: ['group'] } })
          assert.equal(queryResult.data.length, 1)
          assert.ok(queryResult.links.self)
          if (!simplified) {
            validateJsonApiStructure(getResult)
            validateJsonApiStructure(queryResult, true)
          }
          for (const record of [simplified ? getResult : getResult.data, queryResult.data[0]]) {
            assert.equal(record.id, created.id)
            assert.equal(simplified ? record.name : record.attributes.name, 'Read')
            assert.equal(simplified ? record.active : record.attributes.active, false)
            assert.equal(simplified ? record.score : record.attributes.score, 0)
            if (simplified) {
              assert.equal(record.attributes, undefined)
              assert.equal(record.group.id, group.id)
              assert.equal(record.group.name, 'Group')
            } else {
              assert.deepEqual(record.relationships.group.data, { type: 'groups', id: group.id })
            }
          }
          if (!simplified) {
            assert.equal(getResult.included[0].attributes.name, 'Group')
            assert.equal(queryResult.included[0].attributes.name, 'Group')
          }
        })

        for (const operation of ['post', 'put-create', 'put-replace', 'patch']) {
          const method = operation.startsWith('put') ? 'put' : operation
          it(`${operation} honors return defaults and per-call overrides with ${label}`, async () => {
            for (const [index, overrideReturn] of [undefined, 'none', 'minimal', 'full'].entries()) {
              const id = operation === 'put-create'
                ? String(901 + index)
                : operation === 'post' ? undefined : (await fixture.seed('items', { name: 'Before' })).id
              const attributes = { name: 'After', active: false, score: 0 }
              const inputRecord = simplified ? { ...attributes } : createJsonApiDocument('items', attributes)
              const expectedMode = overrideReturn ?? defaultReturning
              const result = await items[method]({
                ...params,
                id,
                inputRecord,
                ...(overrideReturn === undefined ? {} : { returning: overrideReturn })
              })
              const stored = (await items.query({ format: 'jsonapi' })).data
              assert.equal(stored.length, 1)
              const storedId = stored[0].id
              if (id !== undefined) assert.equal(storedId, id)
              assert.equal(stored[0].attributes.name, 'After')
              assert.equal(stored[0].attributes.active, false)
              assert.equal(stored[0].attributes.score, 0)
              if (expectedMode === 'none') assert.equal(result, undefined)
              else if (expectedMode === 'minimal') {
                assert.deepEqual(result, simplified ? { type: 'items', id: storedId } : { data: { type: 'items', id: storedId } })
              } else {
                if (!simplified) validateJsonApiStructure(result)
                const record = simplified ? result : result.data
                assert.equal(record.id, storedId)
                assert.equal(simplified ? record.name : record.attributes.name, 'After')
                assert.equal(simplified ? record.active : record.attributes.active, false)
                assert.equal(simplified ? record.score : record.attributes.score, 0)
              }
              assert.equal(await items.delete({ ...params, id: storedId }), undefined)
              assert.equal(await fixture.count('items'), 0)
              await assert.rejects(items.get({ id: storedId, format: 'jsonapi' }), {
                code: 'REST_API_RESOURCE', subtype: 'not_found'
              })
            }
          })
        }
      }
    })
  }
}
