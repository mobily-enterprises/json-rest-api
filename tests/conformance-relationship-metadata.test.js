import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }

async function seed (fixture) {
  await fixture.reset()
  const group = await fixture.seed('groups', { name: 'Group' })
  const item = await fixture.seed('items', { name: 'Item' }, {
    group: { data: { type: 'groups', id: group.id } },
    subject: { data: { type: 'groups', id: group.id } }
  })
  const other = await fixture.seed('items', { name: 'Undeclared target' })
  return { group, item, other }
}

async function setSubject (fixture, itemId, type, targetId, transaction) {
  const db = transaction || fixture.knex
  if (fixture.storage === 'knex') {
    return db('conformance_items').where('items_key', itemId).update({ subject_type: type, subject_key: targetId })
  }
  const descriptor = await fixture.api.anyapi.registry.getDescriptor(fixture.api.anyapi.tenantId, 'items')
  const { canonical, polymorphicBelongsTo: { subject } } = descriptor
  return db(canonical.tableName)
    .where(canonical.tenantColumn, descriptor.tenant)
    .where(canonical.resourceColumn, 'items')
    .where(canonical.logicalIdColumn, itemId)
    .update({ [subject.typeColumn]: type, [subject.idColumn]: targetId })
}

function assertStoredTypeError (error) {
  const chain = []
  while (error && !chain.includes(error)) {
    chain.push(error)
    error = error.cause
  }
  assert.ok(chain.some(error => error.context?.phase === 'relationshipData' &&
    error.context.scopeName === 'items' && error.context.relationshipName === 'subject'))
  return true
}

describe(`Stored relationship metadata (${storageMode.mode})`, () => {
  let fixture, records, corruptWrite, corruptions
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables })
    await fixture.api.customize({
      hooks: {
        afterDataCallPatch: {
          functionName: 'inject-inconsistent-polymorphic-target',
          handler: async ({ context }) => {
            if (corruptWrite) {
              corruptions++
              await setSubject(fixture, context.id, 'items', records.other.id, context.transaction)
            }
          }
        }
      }
    })
  })
  beforeEach(async () => { corruptWrite = false; corruptions = 0; records = await seed(fixture) })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    for (const method of ['get', 'query']) {
      for (const [relationshipName, field, missing] of [['mentions', 'via', 'missingSubject'], ['items', 'foreignKey', 'missingGroup']]) {
        it(`${method} ${format} rejects missing reverse metadata for ${relationshipName}`, async () => {
          const definition = fixture.api.resources.groups.vars.schemaInfo.schemaRelationships[relationshipName]
          const original = definition[field]
          const published = fixture.api.resources.groups.vars.schemaInfo.descriptor?.relationships[relationshipName]
          const originalPublished = published?.[field]
          try {
            definition[field] = missing
            if (published) published[field] = missing
            await assert.rejects(fixture.api.resources.groups[method]({
              id: records.group.id, format, queryParams: { include: [relationshipName] }
            }))
          } finally {
            definition[field] = original
            if (published) published[field] = originalPublished
          }
          assert.ok(await fixture.api.resources.groups[method]({ id: records.group.id, format, queryParams: { include: [relationshipName] } }))
        })
      }

      for (const include of [false, true]) {
        it(`${method} ${format} rejects undeclared stored types ${include ? 'with' : 'without'} includes`, async () => {
          for (const type of ['items', 'unregistered', '']) {
            await setSubject(fixture, records.item.id, type, records.other.id)
            await assert.rejects(fixture.api.resources.items[method]({
              id: records.item.id, format, queryParams: include ? { include: ['subject'] } : {}
            }), assertStoredTypeError, `stored type: ${JSON.stringify(type)}`)
          }
          await setSubject(fixture, records.item.id, 'groups', records.group.id)
          assert.ok(await fixture.api.resources.items[method]({ id: records.item.id, format, queryParams: { include: ['subject'] } }))
        })
      }

      it(`${method} ${format} rejects an undeclared type in a nested include`, async () => {
        await setSubject(fixture, records.item.id, 'items', records.other.id)
        await assert.rejects(fixture.api.resources.groups[method]({
          id: records.group.id, format, queryParams: { include: ['items.subject'] }
        }), assertStoredTypeError)
      })
    }

    it(`${format} keeps intentionally empty relationships and unselected linkage valid`, async () => {
      await setSubject(fixture, records.item.id, null, null)
      const empty = await fixture.api.resources.items.get({ id: records.item.id, format, queryParams: { include: ['subject'] } })
      if (format === 'plain') assert.equal(Object.hasOwn(empty, 'subject'), false)
      else assert.equal(empty.data.relationships.subject.data, null)
      await setSubject(fixture, records.item.id, 'groups', records.group.id)
      const selected = await fixture.api.resources.items.get({ id: records.item.id, format, queryParams: { fields: { items: 'id' } } })
      assert.equal(format === 'plain' ? selected.id : selected.data.id, records.item.id)
    })

    it(`${format} still classifies a disallowed client target as validation failure`, async () => {
      const inputRecord = format === 'plain'
        ? { subject: { _type: 'items', id: records.other.id } }
        : { data: { type: 'items', id: records.item.id, relationships: { subject: { data: { type: 'items', id: records.other.id } } } } }
      await assert.rejects(fixture.api.resources.items.patch({ id: records.item.id, format, inputRecord }), { code: 'REST_API_VALIDATION' })
    })

    for (const borrowed of [false, true]) {
      it(`${format} fails a corrupt full write response before ${borrowed ? 'borrowed' : 'owned'} commit`, async () => {
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        const context = {}
        corruptWrite = true
        try {
          const inputRecord = format === 'plain' ? { name: 'Changed' } : { data: { type: 'items', id: records.item.id, attributes: { name: 'Changed' } } }
          await assert.rejects(fixture.api.resources.items.patch({ id: records.item.id, inputRecord, format, returning: 'full', transaction }, context), assertStoredTypeError)
          assert.equal(corruptions, 1)
          assert.equal(context.transactionCommitted, false)
          assert.equal(context.transaction.isCompleted(), !borrowed)
        } finally {
          corruptWrite = false
          await unit?.rollback()
        }
        const recovered = await fixture.api.resources.items.get({ id: records.item.id, format: 'jsonapi', queryParams: { include: ['subject'] } })
        assert.equal(recovered.data.attributes.name, 'Item')
        assert.deepEqual(recovered.data.relationships.subject.data, { type: 'groups', id: records.group.id })
      })
    }
  }

  for (const method of ['get', 'query']) {
    it(`${method} preserves a failure at each observed schema relationship read`, async () => {
      const relationships = fixture.api.resources.items.vars.schemaInfo.schemaRelationships
      const definition = Object.getOwnPropertyDescriptor(relationships, 'subject')
      const original = Object.freeze(new Error('Relationship metadata read failed'))
      const read = () => fixture.api.resources.items[method]({ id: records.item.id, format: 'jsonapi' })
      await read()
      let calls = 0; let failAt = 0
      Object.defineProperty(relationships, 'subject', {
        configurable: true,
        enumerable: true,
        get () {
          calls++
          if (calls === failAt) throw original
          return definition.value
        }
      })
      try {
        await read()
        const count = calls
        assert.ok(count > 0)
        for (let index = 1; index <= count; index++) {
          calls = 0
          failAt = index
          await assert.rejects(read(), error => {
            while (error && Object.hasOwn(error, 'cause')) error = error.cause
            assert.equal(error, original)
            return true
          }, `metadata read ${index}/${count}`)
          assert.ok(calls >= index)
        }
      } finally { Object.defineProperty(relationships, 'subject', definition) }
      assert.ok(await read())
    })
  }
})

for (const connector of ['express', 'fastify']) {
  describe(`Real ${connector} stored relationship metadata (${storageMode.mode})`, () => {
    let fixture, app, server, baseUrl, records
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { app, connector } })
      if (connector === 'express') {
        server = await new Promise(resolve => {
          const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
        })
        baseUrl = `http://127.0.0.1:${server.address().port}`
      } else baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    })
    beforeEach(async () => { records = await seed(fixture) })
    after(async () => {
      try {
        if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        if (connector === 'fastify') await app?.close()
      } finally { await fixture?.close() }
    })

    for (const method of ['GET', 'PATCH']) {
      it(`${method} rejects corrupted linkage with 500 and recovers after repair`, async () => {
        await setSubject(fixture, records.item.id, 'items', records.other.id)
        const url = `${baseUrl}/api/items/${records.item.id}?include=subject`
        const options = {
          method,
          ...(method === 'PATCH'
            ? {
                headers: { 'content-type': 'application/vnd.api+json' },
                body: JSON.stringify({ data: { type: 'items', id: records.item.id, attributes: { name: 'Changed' } } })
              }
            : {})
        }
        const failed = await fetch(url, options)
        const body = await failed.json()
        assert.equal(failed.status, 500)
        assert.equal(body.errors[0].status, '500')
        assert.equal(Object.hasOwn(body, 'data'), false)
        await setSubject(fixture, records.item.id, 'groups', records.group.id)
        const unchanged = await fixture.api.resources.items.get({ id: records.item.id, format: 'plain' })
        assert.equal(unchanged.name, 'Item')
        const recovered = await fetch(url, options)
        assert.equal(recovered.status, 200)
        assert.equal((await recovered.json()).included[0].type, 'groups')
      })
    }
  })
}
