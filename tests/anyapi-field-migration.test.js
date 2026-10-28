import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createAnyApiFieldEvolutionApi } from './fixtures/api-configs.js'

const tenant = 'field_evolution'
const phone = { type: 'string', nullable: true, search: true }

// Each case owns a database, shared by the servers it starts.
function migrationCase (name, run) {
  describe(`AnyAPI field migration (${databaseClient}): ${name}`, () => {
    let database
    before(async () => { database = await createTestDatabase() })
    after(async () => {
      try { await database?.close() } finally { if (database) storageMode.clearRegistry(database.knex) }
    })
    it(name, async () => run(database.knex))
  })
}

const server = (knex, options = {}) => createAnyApiFieldEvolutionApi(knex, { fields: { phone }, ...options })
const post = (api, attributes) => api.resources.items.post({ document: createJsonApiDocument('items', attributes) })
const attributes = async (api, id) => (await api.resources.items.get({ id })).data.attributes
const resourceRow = knex => knex('any_resource_configs').where({ tenant_id: tenant, resource: 'items' }).first()
const fieldRows = async (knex) => {
  const config = await resourceRow(knex)
  return Object.fromEntries((await knex('any_field_configs').where({ resource_config_id: config.id })).map(row => [row.field_name, row.slot_column]))
}
const retired = async knex => JSON.parse((await resourceRow(knex)).definition_json).retired || []
const isRetiredRejection = field => error => error?.details?.violations?.some(violation => violation.rule === 'retired_field' && violation.field === `data.attributes.${field}`)

migrationCase('retiring a field keeps its slot and values and stops writes on every server', async (knex) => {
  const changes = []
  const first = await server(knex, { pluginOptions: { onSchemaChanged: change => changes.push(change) } })
  const second = await server(knex, { pluginOptions: { schemaCheckInterval: 0 } })
  const created = await post(first, { name: 'Ann', phone: '555-1000' })
  const slots = await fieldRows(knex)
  const version = await first.anyapi.getSchemaVersion('items')
  changes.length = 0

  await first.resources.items.retireKnexFields(['phone'])
  assert.deepEqual(await retired(knex), ['phone'])
  assert.deepEqual(await fieldRows(knex), slots)
  assert.equal(await first.anyapi.getSchemaVersion('items'), version + 1)
  assert.deepEqual(changes, [{ tenant, resource: 'items', version: version + 1 }])

  assert.equal((await attributes(first, created.data.id)).phone, '555-1000')
  await assert.rejects(post(first, { name: 'Bob', phone: '1' }), isRetiredRejection('phone'))
  // The second server checks the version on each request and catches up.
  await assert.rejects(post(second, { name: 'Bob', phone: '1' }), isRetiredRejection('phone'))
  const found = await second.resources.items.query({ queryParams: { filters: { phone: '555-1000' } } })
  assert.deepEqual(found.data.map(row => row.attributes.name), ['Ann'])

  // A restart with the declaration that still lists the field keeps it retired.
  const restarted = await server(knex)
  assert.deepEqual(await retired(knex), ['phone'])
  await assert.rejects(post(restarted, { name: 'Cy', phone: '1' }), isRetiredRejection('phone'))
  assert.equal((await attributes(restarted, created.data.id)).phone, '555-1000')
  await assert.rejects(first.resources.items.addKnexFields({ fields: { phone } }), /already exists/)
})

migrationCase('retirement refuses fields without their own slot', async (knex) => {
  const api = await server(knex, { fields: { phone, group_id: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true } } })
  await assert.rejects(api.resources.items.retireKnexFields(['group_id']), /not a stored attribute/)
  await assert.rejects(api.resources.items.retireKnexFields(['missing']), /not a stored attribute/)
  await assert.rejects(api.resources.items.retireKnexFields([]), /array of field names/)
})

migrationCase('migrating a field converts every value into a new slot and retires the old one', async (knex) => {
  const changes = []
  const first = await server(knex, { pluginOptions: { onSchemaChanged: change => changes.push(change) } })
  const second = await server(knex)
  const ids = []
  for (const [name, value] of [['Ann', '100'], ['Bob', ' 2.5 '], ['Cy', null]]) ids.push((await post(first, { name, phone: value })).data.id)
  const version = await first.anyapi.getSchemaVersion('items')
  changes.length = 0

  const seen = []
  await first.resources.items.migrateField({
    from: 'phone',
    to: { name: 'dialCode', type: 'number', nullable: true, search: true },
    transform: (value, { id }) => {
      seen.push([id, value])
      return value === null ? null : Number(value) * 2
    }
  })
  assert.deepEqual(seen.sort(), ids.map((id, index) => [id, ['100', '2.5', null][index]]).sort())
  const slots = await fieldRows(knex)
  assert.match(slots.dialCode, /^number_\d+$/)
  assert.deepEqual(await retired(knex), ['phone'])
  // Allocation and retirement each bump the version; servers hear about the result once.
  assert.equal(await first.anyapi.getSchemaVersion('items'), version + 2)
  assert.deepEqual(changes, [{ tenant, resource: 'items', version: version + 2 }])

  assert.deepEqual(await attributes(first, ids[0]), { name: 'Ann', phone: '100', dialCode: 200 })
  assert.deepEqual(await attributes(first, ids[2]), { name: 'Cy', phone: null, dialCode: null })
  await second.resources.items.reloadSchema()
  assert.deepEqual(await attributes(second, ids[1]), { name: 'Bob', phone: '2.5', dialCode: 5 })
  const found = await second.resources.items.query({ queryParams: { filters: { dialCode: 5 } } })
  assert.deepEqual(found.data.map(row => row.id), [ids[1]])
  await assert.rejects(post(second, { name: 'Dee', phone: '1' }), isRetiredRejection('phone'))
  assert.equal((await post(second, { name: 'Dee', dialCode: 7 })).data.attributes.dialCode, 7)

  // Without a transform the new field's own validation converts the value.
  await first.resources.items.migrateField({ from: 'dialCode', to: { name: 'label', type: 'string', nullable: true } })
  assert.equal((await attributes(first, ids[0])).label, '200')
})

migrationCase('a value the new field rejects rolls the whole migration back', async (knex) => {
  const api = await server(knex)
  await post(api, { name: 'Ann', phone: '100' })
  await post(api, { name: 'Bob', phone: 'call me' })
  const version = await api.anyapi.getSchemaVersion('items')
  const slots = await fieldRows(knex)

  await assert.rejects(
    api.resources.items.migrateField({ from: 'phone', to: { name: 'dialCode', type: 'number', nullable: true } }),
    error => /cannot migrate 'phone' to 'dialCode'/.test(error.message) || /cannot migrate 'phone' to 'dialCode'/.test(error.cause?.message)
  )
  assert.equal(await api.anyapi.getSchemaVersion('items'), version)
  assert.deepEqual(await fieldRows(knex), slots)
  assert.deepEqual(await retired(knex), [])
  assert.equal((await post(api, { name: 'Cy', phone: '1' })).data.attributes.phone, '1')
  const values = await knex('any_records').where({ tenant_id: tenant, resource: 'items' }).pluck(slots.phone)
  assert.deepEqual(values.sort(), ['1', '100', 'call me'])
})

migrationCase('migration arguments are checked before anything is written', async (knex) => {
  const api = await server(knex)
  const version = await api.anyapi.getSchemaVersion('items')
  const migrate = params => api.resources.items.migrateField(params)
  await assert.rejects(migrate({ from: 'phone' }), /requires from and to/)
  await assert.rejects(migrate({ from: 'phone', to: { name: 'name', type: 'string' } }), /already exists/)
  await assert.rejects(migrate({ from: 'phone', to: { name: 'code', type: 'string', setter: value => value } }), /plain stored attribute/)
  await assert.rejects(migrate({ from: 'phone', to: { name: 'code', type: 'string' }, transform: 'upper' }), /transform must be a function/)
  await assert.rejects(migrate({ from: 'missing', to: { name: 'code', type: 'string' } }), /not a stored attribute/)
  await api.resources.items.retireKnexFields(['phone'])
  await assert.rejects(migrate({ from: 'phone', to: { name: 'code', type: 'string' } }), /already retired/)
  assert.equal(await api.anyapi.getSchemaVersion('items'), version + 1)
})
