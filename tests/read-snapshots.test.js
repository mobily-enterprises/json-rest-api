import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'

const noop = () => {}
const renameFirst = ({ context }) => {
  const first = Array.isArray(context.record.data) ? context.record.data[0] : context.record.data
  first.attributes.name = 'Renamed'
}

// A get or query copies its records into context.originalRecord before
// enrichment only when a hook that runs afterwards could read the copy.
const cases = [
  { name: 'no hooks', snapshot: false },
  { name: "another resource's enrichRecord", apiOptions: { groupOptions: { hooks: { enrichRecord: noop } } }, snapshot: false },
  { name: "an included resource's enrichRecord", apiOptions: { groupOptions: { hooks: { enrichRecord: noop } } }, include: true, snapshot: false },
  { name: 'enrichRecord on the resource', apiOptions: { itemOptions: { hooks: { enrichRecord: renameFirst } } }, snapshot: true },
  { name: 'enrichAttributes on the resource', apiOptions: { itemOptions: { hooks: { enrichAttributes: noop } } }, snapshot: true },
  { name: "an included resource's enrichAttributes", apiOptions: { groupOptions: { hooks: { enrichAttributes: noop } } }, include: true, snapshot: true },
  { name: "an unincluded resource's enrichAttributes", apiOptions: { groupOptions: { hooks: { enrichAttributes: noop } } }, snapshot: false },
  { name: 'a global finish', globalHooks: { finish: noop }, snapshot: true },
  { name: 'finishQuery and finishGet', apiOptions: { itemOptions: { hooks: { finishQuery: noop, finishGet: noop } } }, snapshot: true },
  { name: 'enrichRecordWithRelationships', apiOptions: { itemOptions: { hooks: { enrichRecordWithRelationships: noop } } }, snapshot: { get: true, query: false } },
  { name: 'a global transport:response', globalHooks: { 'transport:response': noop }, snapshot: true }
]

describe(`Read snapshots (${storageMode.mode})`, () => {
  const fixtures = []
  after(async () => { for (const fixture of fixtures) await fixture.close() })

  async function createFixture ({ apiOptions = {}, globalHooks }) {
    const fixture = await createConformanceFixture({ apiOptions })
    fixtures.push(fixture)
    if (globalHooks) await fixture.api.customize({ hooks: globalHooks })
    await fixture.reset()
    const group = await fixture.seed('groups', { name: 'Group' })
    for (const name of ['First', 'Second', 'Third']) {
      await fixture.seed('items', { name }, { group: { data: { type: 'groups', id: group.id } } })
    }
    return fixture
  }

  for (const testCase of cases) {
    describe(testCase.name, () => {
      let fixture
      before(async () => { fixture = await createFixture(testCase) })
      const queryParams = testCase.include ? { include: ['group'] } : {}

      for (const method of ['query', 'get']) {
        const expected = typeof testCase.snapshot === 'object' ? testCase.snapshot[method] : testCase.snapshot
        it(`${method} ${expected ? 'takes' : 'skips'} the snapshot`, async () => {
          const context = {}
          const params = method === 'get'
            ? { id: (await fixture.api.resources.items.query({ queryParams: { sort: ['id'] } })).data[0].id, queryParams }
            : { queryParams: { ...queryParams, sort: ['id'] } }
          const response = await fixture.api.resources.items[method](params, context)
          const records = [response.data].flat()
          assert.equal(records.length, method === 'get' ? 1 : 3)
          if (testCase.include) assert.equal(response.included?.length, 1)
          assert.equal(Object.hasOwn(context, 'originalRecord'), expected)
          if (!expected) return

          // The snapshot is a copy: it keeps the stored values the hooks changed afterwards.
          const snapshot = [context.originalRecord.data].flat()
          assert.notEqual(context.originalRecord, context.record)
          assert.equal(snapshot[0].attributes.name, 'First')
          const renamed = testCase.apiOptions?.itemOptions?.hooks?.enrichRecord === renameFirst
          assert.equal(records[0].attributes.name, renamed ? 'Renamed' : 'First')
        })
      }
    })
  }
})
