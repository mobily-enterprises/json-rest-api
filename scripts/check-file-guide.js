import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Api } from 'hooked-api'
import express from 'express'
import knex from 'knex'
import { RestApiPlugin, RestApiKnexPlugin, FileHandlingPlugin, ExpressPlugin } from '../index.js'
import { LocalStorage } from '../plugins/storage/local-storage.js'

const directory = await mkdtemp(path.join(tmpdir(), 'json-rest-file-guide-'))
const source = await readFile(new URL('../docs/GUIDE/GUIDE_X_File_Uploads.md', import.meta.url), 'utf8')
const blocks = [...source.matchAll(/```js\n([\s\S]*?)\n```/g)]
const setup = blocks.find(match => match[1].includes("name: 'uploads'"))?.[1]
assert.ok(setup, 'The guide must retain an identifiable complete setup example')
// Allocate a port and isolate uploads; execute the remaining setup literally.
const code = setup.replace(/^import .*\n/gm, '').replaceAll("'./uploads'", JSON.stringify(directory)).replace('app.listen(3000)', "app.listen(0, '127.0.0.1')")
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let state, database
try {
  state = await new AsyncFunction('Api', 'express', 'knex', 'RestApiPlugin', 'RestApiKnexPlugin', 'FileHandlingPlugin', 'ExpressPlugin', 'LocalStorage', `${code}\nreturn { server, api }`)(
    Api, express, config => { database = knex(config); return database }, RestApiPlugin, RestApiKnexPlugin, FileHandlingPlugin, ExpressPlugin, LocalStorage
  )
  if (!state.server.listening) await once(state.server, 'listening')
  const base = `http://127.0.0.1:${state.server.address().port}`
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRz8AAAAASUVORK5CYII=', 'base64')
  const upload = async (title, bytes, type = 'image/png') => {
    const body = new FormData()
    if (title !== undefined) body.set('title', title)
    body.set('image', new Blob([bytes], { type }), type === 'image/png' ? 'photo.png' : 'note.txt')
    return fetch(`${base}/api/images`, { method: 'POST', body, headers: { Accept: 'application/vnd.api+json' }, signal: AbortSignal.timeout(5000) })
  }
  const created = await upload('Example', png)
  assert.equal(created.status, 201)
  const document = await created.json()
  assert.equal(document.data.attributes.title, 'Example')
  const fileUrl = document.data.attributes.image
  assert.match(fileUrl, /^\/uploads\/.+\.png$/)
  const served = await fetch(`${base}${fileUrl}`, { signal: AbortSignal.timeout(5000) })
  assert.equal(served.status, 200)
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png)
  const originalFiles = await readdir(directory)
  assert.equal(originalFiles.length, 1)
  const wrongMime = await upload('Rejected type', Buffer.from('not an image'), 'text/plain')
  assert.equal(wrongMime.status, 422)
  assert.ok((await wrongMime.json()).errors.length)
  const missingTitle = await upload(undefined, Buffer.concat([png, Buffer.from('different upload')]))
  assert.equal(missingTitle.status, 422)
  assert.ok((await missingTitle.json()).errors.length)
  assert.deepEqual(await readdir(directory), originalFiles, 'Rejected writes must not leave uploaded files or remove the committed file')
  const rows = await state.api.resources.images.query({ format: 'plain' })
  assert.equal(rows.data.length, 1)
  assert.equal(rows.data[0].image, fileUrl)
  console.log('Literal file guide passed: multipart creation, served bytes, MIME rejection and validation rollback cleanup')
} finally {
  try {
    if (state?.server.listening) await new Promise((resolve, reject) => state.server.close(error => error ? reject(error) : resolve()))
  } finally {
    try { await database?.destroy() } finally { await rm(directory, { recursive: true, force: true }) }
  }
}
