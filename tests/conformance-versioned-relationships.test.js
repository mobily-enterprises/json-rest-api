import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

for (const relationshipName of ['items', 'members']) {
  for (const method of ['postRelationship', 'patchRelationship', 'deleteRelationship']) {
    describe(`Versioned ${method} ${relationshipName} (${storageMode.mode})`, () => {
      let fixture, group, first, second
      before(async () => {
        fixture = await createConformanceFixture({
          createApi: createQueryConformanceApi,
          databaseOptions: { concurrent: true, maxConnections: 2 },
          tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' },
          apiOptions: {
            groupOptions: {
              schema: { id: { type: 'id' }, name: { type: 'string', required: true }, revision: { type: 'string', required: true } },
              versionField: 'revision'
            }
          }
        })
        await fixture.api.customize({
          hooks: {
            checkPermissions: {
              functionName: 'synchronize-versioned-relationship-clients',
              handler: async ({ context }) => {
                if (context.method === method) await context.synchronize?.(context.transaction)
              }
            }
          }
        })
      })
      beforeEach(async () => {
        await fixture.reset()
        group = await fixture.seed('groups', { name: 'Group' })
        const relationships = method === 'deleteRelationship'
          ? relationshipName === 'items'
            ? { group: { data: { type: 'groups', id: group.id } } }
            : { collections: { data: [{ type: 'groups', id: group.id }] } }
          : undefined
        first = await fixture.seed('items', { name: 'First' }, relationships)
        second = await fixture.seed('items', { name: 'Second' }, relationships)
        group = (await fixture.api.resources.groups.get({ id: group.id, format: 'jsonapi' })).data
      })
      after(async () => { await fixture?.close() })

      it('allows only one concurrent relationship write with the same revision', async () => {
        const transactions = new Set()
        let release, rejectReady
        const ready = new Promise((resolve, reject) => { release = resolve; rejectReady = reject })
        const deadline = setTimeout(() => rejectReady(new Error('Both relationship clients did not reach the barrier')), 10000)
        const synchronize = async transaction => {
          assert.ok(transaction?.isTransaction && !transaction.isCompleted())
          transactions.add(transaction)
          if (transactions.size === 2) release()
          await ready
        }
        const groups = fixture.api.resources.groups
        const change = item => groups[method]({
          id: group.id,
          relationshipName,
          relationshipData: [{ type: 'items', id: item.id }],
          expectedVersion: group.attributes.revision
        }, { synchronize })
        let outcomes
        try { outcomes = await Promise.allSettled([change(first), change(second)]) } finally { clearTimeout(deadline) }
        assert.equal(transactions.size, 2)
        assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
        const failed = outcomes.filter(result => result.status === 'rejected')
        assert.equal(failed.length, 1)
        const error = failed[0].reason
        const sqliteBusy = fixture.knex.client.config.client === 'better-sqlite3' && /^SQLITE_BUSY/.test(error.code)
        assert.ok(sqliteBusy || error.subtype === 'conflict', error.stack)
        const winner = outcomes[0].status === 'fulfilled' ? first : second
        const loser = winner === first ? second : first
        const linkage = await groups.getRelationship({ id: group.id, relationshipName })
        assert.deepEqual(linkage.data.map(item => item.id), [method === 'deleteRelationship' ? loser.id : winner.id])
        const final = (await groups.get({ id: group.id, format: 'jsonapi' })).data
        assert.notEqual(final.attributes.revision, group.attributes.revision)
        assert.equal(await fixture.count('items'), 2)
      })

      it('rotates the parent revision and rejects a stale relationship mutation', async () => {
        const groups = fixture.api.resources.groups
        const change = (item, expectedVersion) => groups[method]({
          id: group.id, relationshipName, relationshipData: [{ type: 'items', id: item.id }], expectedVersion
        })
        await change(first, group.attributes.revision)
        const changed = (await groups.get({ id: group.id, format: 'jsonapi' })).data
        assert.notEqual(changed.attributes.revision, group.attributes.revision)
        await assert.rejects(change(second, group.attributes.revision), error => error.subtype === 'conflict')
        const final = (await groups.get({ id: group.id, format: 'jsonapi' })).data
        assert.equal(final.attributes.revision, changed.attributes.revision)
        const linkage = await groups.getRelationship({ id: group.id, relationshipName })
        assert.deepEqual(linkage.data.map(item => item.id), [method === 'deleteRelationship' ? second.id : first.id])
      })
    })
  }
}
