import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { databaseClient } from './helpers/test-database.js'

const failures = [
  new RestApiValidationError('Descriptor access failed'),
  Object.freeze(new Error('Descriptor read failed')),
  null,
  undefined
]
const errorChain = error => {
  const chain = [error]
  while (error && typeof error === 'object' && Object.hasOwn(error, 'cause') && !chain.includes(error.cause)) {
    error = error.cause
    chain.push(error)
  }
  return chain
}
const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }

function installDescriptorProbe (registry, knex, getProbe) {
  const load = registry.getDescriptor.bind(registry)
  const intercept = db => new Proxy(db, {
    apply (target, receiver, args) {
      const probe = getProbe()
      if (args[0] === 'any_resource_configs' && probe) {
        probe.injected++
        throw probe.error
      }
      return Reflect.apply(target, receiver, args)
    }
  })
  registry.getDescriptor = async (tenant, resource, options) => {
    const probe = getProbe()
    if (probe) probe.reads.push(resource)
    return load(tenant, resource, {
      ...options,
      bypassCache: true,
      ...(options?.transaction ? { transaction: intercept(options.transaction) } : {})
    })
  }
  registry.knex = intercept(knex)
  return () => {
    registry.getDescriptor = load
    registry.knex = knex
  }
}

describe(`Canonical descriptor publication failures (${databaseClient})`, () => {
  let fixture, registry, restoreProbe, probe, records
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'anyapi', createApi: createIdConformanceApi, apiOptions: { inverseMembership: true }, databaseOptions: { concurrent: true }, tables })
    registry = fixture.api.anyapi.registry
    restoreProbe = installDescriptorProbe(registry, fixture.knex, () => probe)
  })
  async function seed () {
    probe = undefined
    await fixture.reset()
    const group = await fixture.seed('groups', { name: 'Group' })
    const item = await fixture.seed('items', { name: 'Item' }, {
      group: { data: { type: 'groups', id: group.id } },
      subject: { data: { type: 'groups', id: group.id } },
      groups: { data: [{ type: 'groups', id: group.id }] }
    })
    const other = await fixture.seed('items', { name: 'Other' })
    records = { groups: group, items: item, other }
  }
  beforeEach(seed)
  after(async () => {
    restoreProbe?.()
    await fixture?.close()
  })

  const snapshot = async () => ({
    records: await fixture.knex('any_records').orderBy('id'),
    links: await fixture.knex('any_links').orderBy('id')
  })
  const assertFailure = (error, original, resource) => {
    const chain = errorChain(error)
    assert.equal(chain.at(-1), original)
    if (original === failures[0]) assert.equal(error, original)
    else {
      assert.ok(chain.some(value => value?.context?.phase === 'descriptor' &&
        value.context.scopeName === resource && value.context.tenant === 'conformance'))
    }
    return true
  }

  for (const [index, original] of failures.entries()) {
    for (const borrowed of [false, true]) {
      it(`direct descriptor read ${index} preserves its cause and ${borrowed ? 'borrowed transaction' : 'global connection'}`, async () => {
        const transaction = borrowed ? await fixture.knex.transaction() : undefined
        probe = { reads: [], error: original, injected: 0 }
        try {
          await assert.rejects(registry.getDescriptor('conformance', 'items', { transaction }), error => assertFailure(error, original, 'items'))
          assert.equal(probe.injected, 1)
          if (transaction) assert.equal(transaction.isCompleted(), false)
        } finally {
          probe = undefined
          if (transaction && !transaction.isCompleted()) await transaction.rollback()
        }
        assert.equal((await registry.getDescriptor('conformance', 'items')).resource, 'items')
      })
    }

    it(`failed explicit refresh ${index} leaves the published resource and records intact`, async () => {
      const published = fixture.api.resources.items.vars.schemaInfo
      const rows = await snapshot()
      probe = { reads: [], error: original, injected: 0 }
      try {
        await assert.rejects(fixture.api.resources.items.createKnexTable(), error => assertFailure(error, original, 'items'))
        assert.equal(probe.injected, 1)
        assert.equal(fixture.api.resources.items.vars.schemaInfo, published)
        const result = await fixture.api.resources.items.get({ id: records.items.id, queryParams: { include: ['group'] } })
        assert.equal(result.data.attributes.name, 'Item')
        assert.equal(result.included.find(row => row.type === 'groups').id, records.groups.id)
        assert.equal(probe.reads.length, 1, 'resource reads must not retry failed metadata loads')
      } finally { probe = undefined }
      assert.deepEqual(await snapshot(), rows)
      await fixture.api.resources.items.createKnexTable()
      assert.notEqual(fixture.api.resources.items.vars.schemaInfo, published)
    })
  }

  it('rejects missing published relationship metadata without falling back to the registry', async () => {
    const published = fixture.api.resources.groups.vars.schemaInfo
    const descriptor = published.descriptor
    probe = { reads: [], error: new Error('Registry fallback is not allowed'), injected: 0 }
    try {
      delete published.descriptor
      await assert.rejects(fixture.api.resources.items.get({ id: records.items.id, queryParams: { include: ['group'] } }), /Descriptor not found.*groups/)
      assert.deepEqual(probe.reads, [])
    } finally {
      published.descriptor = descriptor
      probe = undefined
    }
  })

  it('distinguishes absent persisted metadata from the already published resource', async () => {
    assert.equal(await registry.getDescriptor('conformance', 'unregistered'), null)
    const published = fixture.api.resources.groups.vars.schemaInfo
    const saved = await registry.getDescriptor('conformance', 'groups')
    try {
      await fixture.knex('any_resource_configs').where({ tenant_id: 'conformance', resource: 'groups' }).delete()
      registry.invalidateDescriptor('conformance', 'groups')
      assert.equal(await registry.getDescriptor('conformance', 'groups'), null)
      await assert.rejects(fixture.api.resources.groups.createKnexTable(), /Descriptor not found/)
      assert.equal(fixture.api.resources.groups.vars.schemaInfo, published)
      const result = await fixture.api.resources.items.get({ id: records.items.id, queryParams: { include: ['group'] } })
      assert.equal(result.included.find(row => row.type === 'groups').id, records.groups.id)
    } finally { await registry.registerResource(saved) }
    await fixture.api.resources.groups.createKnexTable()
    const recovered = await fixture.api.resources.items.get({ id: records.items.id, queryParams: { include: ['group'] } })
    assert.equal(recovered.included.find(row => row.type === 'groups').id, records.groups.id)
  })
})

for (const connector of ['express', 'fastify']) {
  describe(`Real ${connector} published canonical descriptors (${databaseClient})`, () => {
    let fixture, app, server, baseUrl, probe, restoreProbe, group, item
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({
        storage: 'anyapi',
        createApi: createIdConformanceApi,
        tables,
        apiOptions: { inverseMembership: true, app, connector },
        databaseOptions: { concurrent: true }
      })
      restoreProbe = installDescriptorProbe(fixture.api.anyapi.registry, fixture.knex, () => probe)
      if (connector === 'express') {
        server = await new Promise(resolve => {
          const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
        })
        baseUrl = `http://127.0.0.1:${server.address().port}`
      } else baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    })
    beforeEach(async () => {
      probe = undefined
      await fixture.reset()
      group = await fixture.seed('groups', { name: 'Group' })
      item = await fixture.seed('items', { name: 'Item' }, {
        group: { data: { type: 'groups', id: group.id } },
        subject: { data: { type: 'groups', id: group.id } },
        groups: { data: [{ type: 'groups', id: group.id }] }
      })
    })
    after(async () => {
      restoreProbe?.()
      try {
        if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        if (connector === 'fastify') await app?.close()
      } finally { await fixture?.close() }
    })

    for (const method of ['get', 'nested get', 'patch']) {
      it(`${method} uses published metadata when registry reads fail`, async () => {
        const url = method === 'nested get' ? `${baseUrl}/api/items/${item.id}?include=subject.items` : `${baseUrl}/api/groups/${group.id}`
        const options = method === 'patch'
          ? { method: 'PATCH', headers: { 'content-type': 'application/vnd.api+json' }, body: JSON.stringify({ data: { type: 'groups', id: group.id, attributes: { name: 'Changed' } } }) }
          : {}
        probe = { reads: [], error: new Error('Registry is unavailable'), injected: 0 }
        try {
          const response = await fetch(url, options)
          assert.equal(response.status, 200)
          const body = await response.json()
          assert.equal(body.data.id, method === 'nested get' ? item.id : group.id)
          assert.equal(body.data.attributes.name, method === 'patch' ? 'Changed' : method === 'get' ? 'Group' : 'Item')
          if (method === 'nested get') assert.equal(body.included.find(row => row.type === 'groups').id, group.id)
          assert.deepEqual(probe.reads, [])
          assert.equal(probe.injected, 0)
        } finally { probe = undefined }
      })
    }
  })
}
