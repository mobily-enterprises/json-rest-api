import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedUnqueriedIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'

const tables = { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
const relationships = [
  ['items', 'group', 'groups'],
  ['items', 'subject', 'groups'],
  ['items', 'groups', 'groups'],
  ['groups', 'items', 'items'],
  ['groups', 'firstItem', 'items'],
  ['groups', 'mentions', 'items']
]

for (const [type, relationship, target] of relationships) {
  for (const primeTarget of [false, true]) {
    describe(`Include adapter ${type}.${relationship}, target ${primeTarget ? 'queried first' : 'unqueried'} (${storageMode.mode})`, () => {
      let fixture
      before(async () => {
        fixture = await createConformanceFixture({
          createApi: createIdConformanceApi,
          tables,
          apiOptions: {
            includeProjection: true,
            resourcePolicy: ({ query, context, column }) => {
              if (context.hideScope === context.scopeName) query.whereNot(column('name'), 'like', '%1')
              return true
            },
            computedDependencies: ['displayName'],
            fieldCallback: (phase, resourceType, value, context) => phase === 'computed' ? `${context.attributes.displayName}!` : value
          }
        })
      })
      beforeEach(async () => {
        await fixture.reset()
        await seedUnqueriedIdConformanceApi(fixture.knex, fixture.api)
      })
      after(async () => fixture?.close())

      it('returns the same mapped IDs, projections and dependencies in full and sparse GET/query includes', async () => {
        if (fixture.storage === 'knex') assert.equal(fixture.api.resources[target].vars.storageAdapter, undefined)
        if (primeTarget) await fixture.api.resources[target].get({ id: '0' })
        for (const hideSecond of [false, true]) {
          for (const format of ['jsonapi', 'plain']) {
            for (const method of ['get', 'query']) {
              for (const fieldset of [undefined, 'displayName', 'derivedName']) {
                if (fixture.storage === 'knex') assert.equal(Boolean(fixture.api.resources[target].vars.storageAdapter), primeTarget)
                const result = await fixture.api.resources[type][method]({
                  ...(method === 'get' ? { id: '0' } : {}),
                  format,
                  queryParams: {
                    include: [relationship],
                    ...(fieldset ? { fields: { [type]: relationship, [target]: fieldset } } : {})
                  }
                }, { hideScope: hideSecond ? target : undefined })
                const primary = method === 'query' ? result.data : [format === 'plain' ? result : result.data]
                assert.deepEqual(primary.map(record => record.id).sort(), method === 'query' ? ['0', '1'] : ['0'])
                let included
                if (format === 'plain') {
                  included = primary.flatMap(record => record[relationship]).filter(Boolean)
                } else {
                  included = result.included.filter(record => record.type === target)
                  for (const record of primary) {
                    const linkage = record.relationships[relationship].data
                    if (hideSecond && record.id === '1') {
                      assert.deepEqual(linkage, ['groups', 'items', 'mentions'].includes(relationship) ? [] : null)
                    } else assert.deepEqual(Array.isArray(linkage) ? linkage : [linkage], [{ type: target, id: record.id }])
                  }
                }
                assert.deepEqual(included.map(record => record.id).sort(), method === 'query' && !hideSecond ? ['0', '1'] : ['0'])
                for (const record of included) {
                  const attributes = format === 'plain' ? record : record.attributes
                  const label = `${target === 'groups' ? 'GROUP' : 'ITEM'} ${record.id}`
                  if (fieldset !== 'derivedName') assert.equal(attributes.displayName, label)
                  if (fieldset !== 'displayName') assert.equal(attributes.derivedName, `${label}!`)
                  assert.equal(attributes.display_name, undefined)
                  assert.equal(attributes[`${target}_key`], undefined)
                  if (format === 'plain' && relationship === 'subject') assert.equal(attributes._type, target)
                  if (fieldset) {
                    const expected = format === 'plain' ? [fieldset, 'id'] : [fieldset]
                    if (format === 'plain' && relationship === 'subject') expected.push('_type')
                    assert.deepEqual(Object.keys(attributes).sort(), expected.sort())
                  }
                }
              }
            }
          }
        }
      })

      if (storageMode.isAnyApi()) {
        it('refreshes an included target after canonical field additions before another direct target read', async () => {
          const resource = fixture.api.resources[target]
          if (primeTarget) await resource.get({ id: '0' })
          await fixture.api.resources[type].get({ id: '0', queryParams: { include: [relationship] } })
          const previousAdapter = resource.vars.storageAdapter
          await resource.addKnexFields({
            fields: {
              note: { type: 'string', nullable: true, getter: value => value?.toUpperCase() ?? null },
              noteLabel: { type: 'string', computed: true, dependencies: ['note'], compute: ({ attributes }) => `${attributes.note}!` }
            }
          })
          assert.notEqual(resource.vars.storageAdapter, previousAdapter)
          const adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo: resource.vars.schemaInfo })
          await adapter.buildBaseQuery().where(adapter.getIdColumn(), '0').update(adapter.toStorageRow({ note: 'added' }))
          for (const format of ['jsonapi', 'plain']) {
            for (const fieldset of [undefined, 'noteLabel']) {
              const result = await fixture.api.resources[type].get({
                id: '0',
                format,
                queryParams: { include: [relationship], ...(fieldset ? { fields: { [type]: relationship, [target]: fieldset } } : {}) }
              })
              const record = format === 'jsonapi'
                ? result.included.find(record => record.type === target && record.id === '0').attributes
                : [result[relationship]].flat()[0]
              assert.equal(record.noteLabel, 'ADDED!')
              assert.equal(record.note, fieldset ? undefined : 'ADDED')
            }
          }
        })
      }
    })
  }
}
