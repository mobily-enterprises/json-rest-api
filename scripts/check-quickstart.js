import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { Api } from 'hooked-api'
import knexLib from 'knex'
import express from 'express'
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from '../index.js'

const source = await readFile(new URL('../docs/QUICKSTART.md', import.meta.url), 'utf8')
const blocks = [...source.matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1])
assert.equal(blocks.length, 3)
// Use an allocated port; every other executable statement comes from the guide.
const code = blocks.join('\n').replace(/^import .*\n/gm, '').replace('app.listen(3000,', 'app.listen(0,')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let database
let state
try {
  state = await new AsyncFunction('Api', 'knexLib', 'express', 'RestApiPlugin', 'RestApiKnexPlugin', 'ExpressPlugin', `${code}\nreturn { server, shutdown, publisher, author, found, withAuthors, updated, document }`)(
    Api, options => { database = knexLib(options); return database }, express, RestApiPlugin, RestApiKnexPlugin, ExpressPlugin
  )
  assert.equal(state.found.data.length, 1)
  assert.equal(state.found.data[0].name, 'George')
  assert.deepEqual(state.found.meta.pagination, { page: 1, pageSize: 10, pageCount: 1, total: 1, hasMore: false })
  assert.equal(state.withAuthors.authors[0].name, 'George')
  assert.deepEqual(state.updated, { type: 'authors', id: state.author.id })
  assert.equal(state.document.data.attributes.name, 'Oxford University Press')
  if (!state.server.listening) await once(state.server, 'listening')
  const base = `http://127.0.0.1:${state.server.address().port}/api`
  for (const path of [
    '/publishers', '/publishers/1?include=authors',
    '/authors?filter[nameContains]=Georg', '/authors?fields[authors]=name,surname',
    '/publishers?page[number]=1&page[size]=10', '/authors?sort=-surname'
  ]) {
    const response = await fetch(`${base}${path}`)
    assert.equal(response.status, 200, path)
    const document = await response.json()
    assert.ok(document.data)
    if (path.includes('include=')) assert.equal(document.included[0].attributes.name, 'George')
    if (path.includes('filter[')) assert.equal(document.data.length, 1)
    if (path.includes('fields[')) assert.deepEqual(Object.keys(document.data[0].attributes).sort(), ['name', 'surname'])
    if (path.includes('page[')) assert.equal(document.meta.pagination.total, 2)
  }
  const headers = { 'Content-Type': 'application/vnd.api+json' }
  const created = await fetch(`${base}/authors`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: { type: 'authors', attributes: { name: 'Jane', surname: 'Austen' }, relationships: { publisher: { data: { type: 'publishers', id: '1' } } } } })
  })
  assert.equal(created.status, 201)
  const { data } = await created.json()
  assert.equal(data.id, '2')
  const patched = await fetch(`${base}/authors/${data.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ data: { type: 'authors', id: data.id, attributes: { surname: 'Austen (1775-1817)' } } })
  })
  assert.equal(patched.status, 200)
  assert.equal((await patched.json()).data.attributes.surname, 'Austen (1775-1817)')
  assert.equal((await fetch(`${base}/authors/${data.id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await fetch(`${base}/authors/${data.id}`)).status, 404)
  console.log('Quickstart literal setup, programmatic calls, server and HTTP CRUD passed')
} finally {
  if (state) {
    process.removeListener('SIGINT', state.shutdown)
    process.removeListener('SIGTERM', state.shutdown)
    await new Promise((resolve, reject) => state.server.close(error => error ? reject(error) : resolve()))
  }
  if (database) await database.destroy()
}
