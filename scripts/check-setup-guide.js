import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Api } from 'hooked-api'
import knexLib from 'knex'
import { RestApiPlugin, RestApiKnexPlugin } from '../index.js'

const source = await readFile(new URL('../docs/GUIDE/GUIDE_1_Initial_Setup.md', import.meta.url), 'utf8')
const blocks = [...source.matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1])
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const output = new Map()
const basic = blocks.find(code => code.includes("name: 'book-catalog-api'"))
assert.ok(basic)
await new AsyncFunction('Api', 'knexLib', 'RestApiPlugin', 'RestApiKnexPlugin', 'console', basic.replace(/^import .*\n/gm, ''))(
  Api, knexLib, RestApiPlugin, RestApiKnexPlugin, { log: (label, value) => output.set(label, value) }
)
assert.equal(output.get('Country:').name, 'United States')
assert.equal(output.get('Country:').code, 'US')
assert.equal(output.get('Matches:').length, 1)
assert.equal(output.get('Matches:')[0].id, output.get('Country:').id)
assert.deepEqual(output.get('Changed identifier:'), { type: 'countries', id: output.get('Country:').id })
assert.equal(output.get('JSON:API attributes:').name, 'United States of America')

const defaults = blocks.find(code => code.startsWith('await api.use(RestApiPlugin, { format:'))
assert.ok(defaults)
const database = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
try {
  const api = new Api({ name: 'setup-defaults', logging: { level: 'error' } })
  // Install storage and create the declared table between registration and use.
  const executable = defaults
    .replace("await api.addResource('countries'", "await api.use(RestApiKnexPlugin, { knex })\nawait api.addResource('countries'")
    .replace('const result =', 'await api.resources.countries.createKnexTable()\nconst result =')
  const result = await new AsyncFunction('api', 'knex', 'RestApiPlugin', 'RestApiKnexPlugin', `${executable}\nreturn result`)(api, database, RestApiPlugin, RestApiKnexPlugin)
  assert.equal(result, undefined)
  const full = await api.resources.countries.post({ inputRecord: { name: 'France' } })
  assert.equal(full.name, 'France')
  const minimal = await api.resources.countries.post({ inputRecord: { name: 'Italy' }, returning: 'minimal' })
  assert.deepEqual(minimal, { type: 'countries', id: minimal.id })
  assert.equal((await api.resources.countries.query({})).data.length, 3)
} finally { await database.destroy() }
console.log('Setup guide literal SQLite example and response-default overrides passed')
