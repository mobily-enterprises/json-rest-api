import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Api } from 'hooked-api'
import { RestApiPlugin, RestApiKnexPlugin, RestApiAnyapiKnexPlugin } from '../index.js'
import { createTestDatabase, databaseClient } from '../tests/helpers/test-database.js'
import { storageMode } from '../tests/helpers/storage-mode.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'

const source = await readFile(new URL('../docs/GUIDE/MIGRATING_API_V2.md', import.meta.url), 'utf8')
function blocks (heading) {
  const start = source.indexOf(`## ${heading}\n`)
  assert.notEqual(start, -1, heading)
  const end = source.indexOf('\n## ', start + 1)
  return [...source.slice(start, end === -1 ? undefined : end).matchAll(/```js\n([\s\S]*?)\n```/g)].map(match => match[1])
}
function after (code) {
  const parts = code.split('// After')
  assert.equal(parts.length, 2, 'Before/after example must have one After marker')
  return parts[1].slice(parts[1].indexOf('\n') + 1)
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const modes = process.env.JSON_REST_API_STORAGE ? [storageMode.mode] : ['knex', 'anyapi']
for (const mode of modes) {
  const database = await createTestDatabase()
  const knex = database.knex
  try {
    const api = new Api({ name: `migration-guide-${mode}`, logging: { level: 'error' } })
    await api.use(RestApiPlugin)
    if (mode === 'anyapi') {
      await ensureAnyApiSchema(knex)
      await api.use(RestApiAnyapiKnexPlugin, { knex, tenantId: 'migration-guide' })
    } else await api.use(RestApiKnexPlugin, { knex })
    await api.addResource('publishers', {
      schema: { name: { type: 'string', required: true } },
      relationships: { books: { type: 'hasMany', target: 'books', foreignKey: 'publisher_id' } }
    })
    await api.addResource('books', {
      schema: { title: { type: 'string', required: true }, publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true } }
    })
    await api.resources.publishers.createKnexTable()
    await api.resources.books.createKnexTable()
    await knex.schema.createTable('audit_entries', table => { table.string('book_id').notNullable() })
    const publisher = await api.resources.publishers.post({ inputRecord: { name: 'Migration publisher' } })
    await api.resources.books.post({ inputRecord: { id: '42', title: 'Original' } })
    const run = (code, result = 'undefined') => new AsyncFunction('api', 'knex', 'publisherId', 'bookId', 'requestContext', `${code}\nreturn ${result}`)(api, knex, publisher.id, '42', {})
    const responseBlocks = blocks('Rename the two response options')
    const book = await run(after(responseBlocks[0]), 'book')
    assert.deepEqual(book, { id: '42', title: 'Original' })
    const document = await run(responseBlocks[1], 'document')
    assert.equal(document.data[0].attributes.title, 'Original')
    const writeBlocks = blocks('Keep data inside inputRecord')
    const created = await run(`return ${after(writeBlocks[0])}`)
    assert.equal(created.title, 'Dune')
    assert.deepEqual((await api.resources.books.query({})).data.map(record => record.title).sort(), ['Dune', 'Original'])
    assert.equal(await run(`return ${writeBlocks[1]}`), undefined)
    assert.equal((await api.resources.books.get({ id: '42' })).title, 'Updated title')
    const patchedDocument = await run(`return ${writeBlocks[2]}`)
    assert.equal(patchedDocument.data.attributes.title, 'Updated title')
    assert.equal((await api.resources.books.get({ id: '42' })).title, 'Updated title')
    const other = await api.resources.books.post({ inputRecord: { title: 'Other', publisher: publisher.id } })
    const relationshipCode = blocks('Review relationship writes')[0]
    const [definitions, ...calls] = relationshipCode.split(/(?=await api.resources.publishers\.(?:post|patch|delete)Relationship)/)
    assert.equal(calls.length, 3)
    const expectedMembers = [['42', other.id].sort(), ['42'], []]
    for (const [index, call] of calls.entries()) {
      await run(definitions + call)
      const linkage = await api.resources.publishers.getRelationship({ id: publisher.id, relationshipName: 'books' })
      assert.deepEqual(linkage.data.map(record => record.id).sort(), expectedMembers[index])
    }
    const managedCode = after(blocks('Transactions and errors')[0])
    await api.resources.books.patch({ id: '42', inputRecord: { title: 'Before managed change' } })
    await run(managedCode)
    assert.equal((await api.resources.books.get({ id: '42' })).title, 'Updated title')
    assert.deepEqual(await knex('audit_entries').select('book_id'), [{ book_id: '42' }])
    assert.equal((await api.resources.books.get({ id: other.id })).title, 'Other')
    await knex.schema.dropTable('audit_entries')
    await api.resources.books.patch({ id: '42', inputRecord: { title: 'Before failed unit' } })
    await assert.rejects(run(managedCode))
    assert.equal((await api.resources.books.get({ id: '42' })).title, 'Before failed unit')
    console.log(`Migration guide after-snippets passed: ${mode} / ${databaseClient}`)
  } finally { await database.close() }
}

// The table-schema guide describes ordinary tables, independently of canonical storage.
{
  const schemaGuide = await readFile(new URL('../docs/GUIDE/GUIDE_X_Knex_Schema_And_Migrations.md', import.meta.url), 'utf8')
  const section = schemaGuide.split('## Logical IDs and `idProperty`\n')[1]?.split('### ID normalization')[0]
  assert.ok(section, 'Logical ID guide section exists')
  const examples = [...section.matchAll(/```js\n([\s\S]*?)\n```/g)].map(match => match[1])
  assert.equal(examples.length, 2, 'Mapped ID declaration and write example')
  const database = await createTestDatabase()
  const knex = database.knex
  try {
    const api = new Api({ name: 'schema-guide', logging: { level: 'error' } })
    await api.use(RestApiPlugin)
    await api.use(RestApiKnexPlugin, { knex })
    await new AsyncFunction('api', examples[0])(api)
    const profiles = api.resources.profiles
    const migration = {}
    // eslint-disable-next-line no-new-func -- Execute generated schema code against an isolated database.
    new Function('exports', await profiles.generateKnexMigration())(migration)
    await migration.up(knex)
    const result = await new AsyncFunction('api', `return ${examples[1]}`)(api)
    assert.equal(result.data.id, '42')
    assert.equal(result.data.attributes.displayName, 'Mercury')
    assert.equal(result.data.attributes.loginCount, 0)
    assert.equal(Object.hasOwn(result.data.attributes, 'id'), false)
    assert.deepEqual(await knex('profiles').select('user_id', 'display_name', 'login_count'), [
      { user_id: 42, display_name: 'Mercury', login_count: 0 }
    ])
    const snapshot = await profiles.introspectKnexTableSnapshot()
    assert.equal(snapshot.idColumn, 'user_id')
    assert.deepEqual(snapshot.primaryKeyColumns, ['user_id'])
    const diff = await profiles.generateKnexMigrationDiff()
    for (const [key, entries] of Object.entries(diff.plan)) assert.deepEqual(entries, [], key)
    await migration.down(knex)
    assert.equal(await knex.schema.hasTable('profiles'), false)
    console.log(`Schema guide mapped ID and generated migration passed: regular tables / ${databaseClient}`)
  } finally { await database.close() }
}
