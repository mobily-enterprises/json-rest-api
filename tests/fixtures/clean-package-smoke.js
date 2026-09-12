import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { JsonRestApi } from 'json-rest-api'
import * as library from 'json-rest-api'

const require = createRequire(import.meta.url)
for (const peer of ['express', 'socket.io', 'redis', 'formidable', 'busboy', 'fractional-indexing']) {
  assert.throws(() => require.resolve(peer), { code: 'MODULE_NOT_FOUND' })
}
assert.equal(Object.keys(library).length, 28)
assert.equal((await import('json-rest-api/plugins/core/connectors/express-plugin.js')).ExpressPlugin, library.ExpressPlugin)
assert.equal((await import('json-rest-api/plugins/storage/local-storage.js')).LocalStorage, library.LocalStorage)

if (process.argv[2] === 'core') {
  assert.throws(() => require.resolve('knex'), { code: 'MODULE_NOT_FOUND' })
  const api = new JsonRestApi({ name: 'clean-core' })
  await api.use(library.RestApiPlugin)
  await assert.rejects(api.use(library.ExpressPlugin), /express/i)
  console.log('Clean core import and missing optional Express checks passed')
} else {
  const { default: knexFactory } = await import('knex')
  for (const mode of ['knex', 'anyapi']) {
    const knex = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
    try {
      const api = new JsonRestApi({ name: `clean-${mode}` })
      await api.use(library.RestApiPlugin, { format: 'jsonapi', returning: 'full' })
      if (mode === 'anyapi') {
        const { ensureAnyApiSchema } = await import('json-rest-api/plugins/core/lib/anyapi/schema-utils.js')
        await ensureAnyApiSchema(knex)
        await api.use(library.RestApiAnyapiKnexPlugin, { knex, tenantId: 'clean_package' })
      } else await api.use(library.RestApiKnexPlugin, { knex })
      await api.addResource('items', { schema: { name: { type: 'string', required: true } }, tableName: 'package_items' })
      await api.resources.items.createKnexTable()
      const created = await api.resources.items.post({ document: { data: { type: 'items', attributes: { name: 'Created' } } } })
      const id = created.data.id
      assert.equal(created.data.attributes.name, 'Created')
      assert.equal((await api.resources.items.get({ id, format: 'plain' })).name, 'Created')
      await api.resources.items.patch({ id, format: 'plain', returning: 'none', data: { name: 'Updated' } })
      assert.equal((await api.resources.items.query()).data[0].attributes.name, 'Updated')
      await api.resources.items.delete({ id })
      assert.deepEqual((await api.resources.items.query()).data, [])
      console.log(`Clean ${mode} CRUD passed`)
    } finally { await knex.destroy() }
  }
}
