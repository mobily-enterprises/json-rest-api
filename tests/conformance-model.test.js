import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fc from 'fast-check'
import { createConformanceFixture } from './fixtures/conformance.js'
import { generatedCaseOptions, itemValues } from './helpers/generated-cases.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

const compareIds = idOrder => idOrder === 'numeric'
  ? (a, b) => Number(a) - Number(b)
  : (a, b) => a < b ? -1 : a > b ? 1 : 0

async function assertModelState (model, real) {
  const response = await real.fixture.api.resources.items.query({
    format: 'jsonapi', queryParams: { sort: ['id'], page: { size: 50 }, include: ['group'] }
  })
  const expectedIds = [...model.records.keys()].sort(compareIds(real.fixture.idOrder))
  assert.deepEqual(response.data.map(record => record.id), expectedIds)
  assert.equal(await real.fixture.count('items'), model.records.size)
  const expectedGroups = new Set()
  for (const record of response.data) {
    const expected = model.records.get(record.id)
    for (const [field, value] of Object.entries(expected.attributes)) assert.equal(record.attributes[field], value)
    const groupId = expected.group === null ? null : real.groups[expected.group].id
    assert.deepEqual(record.relationships.group.data, groupId === null ? null : { type: 'groups', id: groupId })
    if (groupId) expectedGroups.add(groupId)
  }
  assert.deepEqual((response.included || []).map(group => group.id).sort(), [...expectedGroups].sort())
}

class ItemCommand {
  constructor (kind, index = 0, value = null) {
    this.kind = kind
    this.index = index
    this.value = value
  }

  check (model) {
    return ['create', 'query', 'reject'].includes(this.kind) || model.records.size > 0
  }

  async run (model, real) {
    const items = real.fixture.api.resources.items
    const selected = [...model.records.keys()][this.index % model.records.size]
    if (this.kind === 'create') {
      const created = await real.fixture.seed('items', this.value)
      assert.equal(model.records.has(created.id), false)
      model.records.set(created.id, { attributes: { ...this.value }, group: null })
    } else if (this.kind === 'patch') {
      await items.patch({ id: selected, format: 'jsonapi', inputRecord: createJsonApiDocument('items', this.value) })
      Object.assign(model.records.get(selected).attributes, this.value)
    } else if (this.kind === 'relate') {
      const relationshipData = this.value === null ? null : { type: 'groups', id: real.groups[this.value].id }
      await items.patchRelationship({ id: selected, relationshipName: 'group', relationshipData })
      model.records.get(selected).group = this.value
    } else if (this.kind === 'delete') {
      await items.delete({ id: selected, format: 'jsonapi' })
      model.records.delete(selected)
      await assert.rejects(items.get({ id: selected, format: 'jsonapi' }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
    } else if (this.kind === 'reject') {
      await assert.rejects(items.post({
        format: 'jsonapi', inputRecord: createJsonApiDocument('items', { name: this.value })
      }), { code: 'REST_API_VALIDATION' })
    } else if (this.kind === 'query') {
      const response = await items.query({
        format: 'jsonapi', queryParams: { filters: { active: this.value }, sort: ['id'], page: { size: 50 } }
      })
      const expected = [...model.records].filter(([, record]) => record.attributes.active === this.value).map(([id]) => id)
      assert.deepEqual(response.data.map(record => record.id), expected.sort(compareIds(real.fixture.idOrder)))
    }
    real.executed.add(this.kind)
    await assertModelState(model, real)
  }

  toString () {
    return `${this.kind}(${this.index}, ${JSON.stringify(this.value)})`
  }
}

describe(`Generated operation model (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createConformanceFixture({ storage: storageMode.mode }) })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('matches an independent model through create, patch, relate, query, reject and delete sequences', async () => {
    const index = fc.nat({ max: 30 })
    const commands = [
      itemValues.map(attributes => new ItemCommand('create', 0, attributes)),
      fc.tuple(index, itemValues).map(([index, attributes]) => new ItemCommand('patch', index, attributes)),
      fc.tuple(index, fc.option(fc.integer({ min: 0, max: 1 }), { nil: null })).map(([index, group]) => new ItemCommand('relate', index, group)),
      index.map(index => new ItemCommand('delete', index)),
      fc.boolean().map(active => new ItemCommand('query', 0, active)),
      fc.constantFrom(null, {}, [], 'x'.repeat(61)).map(value => new ItemCommand('reject', 0, value))
    ]
    const executed = new Set()
    const replay = process.env.FC_REPLAY_PATH ? { replayPath: process.env.FC_REPLAY_PATH } : {}
    await fc.assert(fc.asyncProperty(fc.commands(commands, { maxCommands: 25, ...replay }), async sequence => {
      await fixture.reset()
      const groups = [await fixture.seed('groups', { name: 'Left' }), await fixture.seed('groups', { name: 'Right' })]
      const model = { records: new Map() }
      const real = { fixture, groups, executed }
      await fc.asyncModelRun(() => ({ model, real }), sequence)
      await assertModelState(model, real)
    }), generatedCaseOptions(20260911, 80))
    // Replay may intentionally select a sequence containing only one operation.
    if (!process.env.FC_PATH && !process.env.FC_REPLAY_PATH && !process.env.FC_RUNS && !process.env.FC_SEED) {
      assert.deepEqual([...executed].sort(), ['create', 'delete', 'patch', 'query', 'reject', 'relate'])
    }
  })
})
