import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { once } from 'node:events'
import express from 'express'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createBlobFieldsApi, registerBlobResource } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { introspectKnexTableSnapshot } from '../plugins/core/lib/dbIntrospection.js'

// A blob holds bytes a process keeps whole: a write takes a Buffer or a
// Uint8Array of at most maxBytes, a read answers it only where its fields name
// it and holds at most 16 MiB of them (or one record's), and no include, HTTP
// response, sort, filter or read of every row touches one.
const MiB = 1024 * 1024
const BIG = 4 * MiB
const READ_BYTES = 16 * MiB
const mysql = ['mysql2', 'mysql', 'mariadb'].includes(databaseClient)
const tables = { albums: 'blob_albums', photos: 'blob_photos' }

const validation = error => error instanceof RestApiValidationError ? error : error?.cause instanceof RestApiValidationError ? error.cause : null
const refused = (promise, rule, pattern = /./) => assert.rejects(promise, error => {
  const cause = validation(error)
  assert.ok(cause, error?.stack)
  if (rule) assert.ok(cause.details.violations?.some(violation => violation.rule === rule), JSON.stringify(cause.details))
  assert.match(cause.message + JSON.stringify(cause.details), pattern)
  return true
})

// Bytes no compression or encoding shortcut could pass off as another value.
const bytesOf = (size, seed = 7) => {
  const buffer = Buffer.allocUnsafe(size)
  let value = seed
  for (let index = 0; index < size; index++) {
    value = (value * 1103515245 + 12345) & 0x7fffffff
    buffer[index] = value >>> 16
  }
  return buffer
}

describe(`Blob fields on AnyAPI storage (${databaseClient})`, { skip: !storageMode.isAnyApi() }, () => {
  it('refuses to register a blob, which AnyAPI storage keeps no bytes for', async () => {
    let fixture
    await assert.rejects(async () => {
      fixture = await createConformanceFixture({ createApi: createBlobFieldsApi, tables })
    }, /AnyAPI storage keeps no bytes/)
    await fixture?.close()
  })
})

describe(`Blob fields (${databaseClient})`, { skip: storageMode.isAnyApi() }, () => {
  let fixture
  const photos = () => fixture.api.resources.photos
  const post = (attributes, relationships) => photos().post({ document: { data: { type: 'photos', attributes, ...(relationships ? { relationships } : {}) } } })
  const patch = (id, attributes) => photos().patch({ id, document: { data: { type: 'photos', id, attributes } } })
  const stored = async id => (await fixture.knex(tables.photos).where('id', id).first())
  const seedPhotos = async (count, attributes = {}) => {
    const ids = []
    for (let index = 1; index <= count; index++) ids.push((await post({ code: `p${index}`, thumb: bytesOf(16, index), ...attributes })).data.id)
    return ids
  }
  // The SQL statements `run` sends, with their bindings.
  const statements = async run => {
    const sent = []
    const listener = query => sent.push(query)
    fixture.knex.on('query', listener)
    try { await run() } finally { fixture.knex.off('query', listener) }
    return sent
  }
  const inTransaction = async run => {
    const transaction = await fixture.knex.transaction()
    try { return await run(transaction) } finally { await transaction.rollback() }
  }

  before(async () => {
    fixture = await createConformanceFixture({ createApi: createBlobFieldsApi, apiOptions: { includeExpress: true }, tables })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  describe('registration', () => {
    const register = (fields, options) => registerBlobResource(fixture.knex, fields, options)

    for (const [fields, pattern] of [
      [{ scan: { type: 'blob' } }, /needs maxBytes/],
      [{ scan: { type: 'blob', maxBytes: 0 } }, /needs maxBytes/],
      [{ scan: { type: 'blob', maxBytes: 1.5 } }, /needs maxBytes/],
      [{ scan: { type: 'blob', maxBytes: 10, search: true } }, /'scan' is a blob, which is written and read whole and cannot be used in filter operations/],
      [{ scan: { type: 'blob', maxBytes: 10, unique: true } }, /takes no unique/],
      [{ scan: { type: 'blob', maxBytes: 10, indexed: true } }, /takes no indexed/],
      [{ scan: { type: 'blob', maxBytes: 10, defaultTo: Buffer.from('x') } }, /takes no defaultTo/],
      [{ scan: { type: 'blob', maxBytes: 10, belongsTo: 'scans', as: 'original' } }, /takes no belongsTo/],
      [{ label: { type: 'string', maxBytes: 10 } }, /has maxBytes, a blob's limit, but type 'string'/]
    ]) {
      it(`refuses ${JSON.stringify(fields)}`, async () => {
        await assert.rejects(register(fields), pattern)
      })
    }

    it('refuses a search field over a blob', async () => {
      await assert.rejects(register({ scan: { type: 'blob', maxBytes: 10 } }, { searchSchema: { scanIs: { type: 'string', oneOf: ['scan'], filterOperator: 'contains' } } }), /blob/)
    })

    it('refuses blobs whose hex writes exceed max_allowed_packet on MySQL and MariaDB, and takes them elsewhere', async () => {
      const packet = fixture.api.knex.capabilities.dbInfo.maxAllowedPacket
      assert.equal(Number.isSafeInteger(packet), mysql)
      const large = { scan: { type: 'blob', maxBytes: 64 * MiB } }
      if (mysql) await assert.rejects(register(large), /max_allowed_packet/)
      else await register(large)
    })
  })

  it('stores a Buffer and a Uint8Array whole, and answers them only where the fields name them', async () => {
    const big = bytesOf(BIG)
    const created = await post({ code: 'p1', title: 'Large', bytes: big, thumb: new Uint8Array([0, 1, 2, 255]) })
    assert.equal(Object.hasOwn(created.data.attributes, 'bytes'), false)
    assert.equal(Object.hasOwn(created.data.attributes, 'thumb'), false)

    const read = await photos().get({ id: created.data.id, queryParams: { fields: { photos: 'code,bytes,thumb' } } })
    assert.ok(Buffer.isBuffer(read.data.attributes.bytes))
    assert.equal(read.data.attributes.bytes.length, BIG)
    assert.ok(read.data.attributes.bytes.equals(big))
    assert.ok(Buffer.isBuffer(read.data.attributes.thumb))
    assert.deepEqual([...read.data.attributes.thumb], [0, 1, 2, 255])

    const plain = await photos().get({ id: created.data.id })
    assert.deepEqual(Object.keys(plain.data.attributes).sort(), ['code', 'title'])
    const listed = await photos().query({ queryParams: {} })
    assert.deepEqual(Object.keys(listed.data[0].attributes).sort(), ['code', 'title'])

    // A null blob stays null, and a patch replaces the bytes whole.
    await patch(created.data.id, { bytes: null, thumb: Buffer.from('new') })
    const row = await stored(created.data.id)
    assert.equal(row.bytes, null)
    assert.equal(Buffer.from(row.thumb).toString(), 'new')
  })

  it('refuses a value that is not bytes, or holds more than maxBytes, before writing it', async () => {
    await refused(post({ code: 'p1', thumb: 'not bytes' }), 'TYPE_CAST_FAILED', /data\.attributes\.thumb/)
    await refused(post({ code: 'p1', thumb: [1, 2, 3] }), null, /thumb/)
    await refused(post({ code: 'p1', thumb: bytesOf(1025) }), 'MAX_BYTES', /at most 1024 bytes/)
    assert.equal(await fixture.count('photos'), 0)

    const created = await post({ code: 'p1', thumb: bytesOf(1024) })
    await refused(patch(created.data.id, { thumb: bytesOf(1025, 3) }), 'MAX_BYTES')
    await refused(photos().postMany({ data: [{ code: 'p2' }, { code: 'p3', thumb: bytesOf(2000) }] }), 'MAX_BYTES')
    assert.equal(await fixture.count('photos'), 1)
    assert.ok(Buffer.from((await stored(created.data.id)).thumb).equals(bytesOf(1024)))
  })

  it('answers a page of named blobs only when its records fit 16 MiB of them', async () => {
    await seedPhotos(5, { bytes: bytesOf(64) })
    const page = size => photos().query({ queryParams: { fields: { photos: 'code,bytes' }, sort: ['id'], page: { size } } })
    // Four records of a 4 MiB blob hold 16 MiB.
    assert.equal((await page(4)).data.length, 4)
    await refused(page(5), 'blob_read', /up to 5 records, and 4 of them already hold 16777216 bytes of photos\.bytes/)
    // The default page (20) is refused too, and so is one naming both blobs past three records.
    await refused(photos().query({ queryParams: { fields: { photos: 'bytes' } } }), 'blob_read')
    await refused(photos().query({ queryParams: { fields: { photos: 'bytes,thumb' }, page: { size: 4 } } }), 'blob_read')
    // A small blob fits a large page.
    const thumbs = await photos().query({ queryParams: { fields: { photos: 'thumb' }, page: { size: 50 } } })
    assert.equal(thumbs.data.length, 5)
    assert.ok(thumbs.data.every(record => Buffer.isBuffer(record.attributes.thumb)))
  })

  it('refuses blobs of included resources, in sorts and filters, and in reads of every row', async () => {
    const album = await fixture.api.resources.albums.post({ document: { data: { type: 'albums', attributes: { name: 'Trip', cover: bytesOf(100) } } } })
    const photo = await post({ code: 'p1' }, { album: { data: { type: 'albums', id: album.data.id } } })
    await refused(photos().query({ queryParams: { include: ['album'], fields: { albums: 'name,cover' }, page: { size: 1 } } }), 'blob_read', /blob of an included resource/)
    await refused(photos().get({ id: photo.data.id, queryParams: { include: ['album'], fields: { photos: 'code', albums: 'cover' } } }), 'blob_read')
    const included = await photos().get({ id: photo.data.id, queryParams: { include: ['album'] } })
    assert.deepEqual(Object.keys(included.included[0].attributes), ['name'])
    // The album's own get answers its cover.
    const cover = await fixture.api.resources.albums.get({ id: album.data.id, queryParams: { fields: { albums: 'cover' } } })
    assert.ok(cover.data.attributes.cover.equals(bytesOf(100)))

    await refused(photos().query({ queryParams: { sort: ['thumb'] } }), null, /'thumb' is not sortable/)
    // A blob has no search field (registration refuses one), so no filter reaches it.
    await refused(photos().query({ queryParams: { filters: { thumb: Buffer.from('x') } } }), null, /thumb/)

    await refused(photos().queryAll({ queryParams: { fields: { photos: 'code,thumb' } } }), 'blob_read', /reads every matching record at once/)
    assert.equal((await photos().queryAll({ queryParams: {} })).data.length, 1)
  })

  it('bounds lock reads and claims by the blobs they name', async () => {
    const ids = await seedPhotos(5)
    await inTransaction(async transaction => {
      const fields = { photos: 'code,bytes' }
      await refused(photos().lockByIds({ ids, transaction, queryParams: { fields } }), 'blob_read', /up to 5 records/)
      const locked = await photos().lockByIds({ ids: ids.slice(0, 4), transaction, queryParams: { fields } })
      assert.equal(locked.data.length, 4)
      assert.ok(locked.data.every(record => Object.hasOwn(record.attributes, 'bytes')))
      await refused(photos().lockWhere({ filters: { code: 'p1' }, transaction, queryParams: { fields } }), 'blob_read')
      await refused(photos().claim({ filters: { code: 'p1' }, limit: 5, transaction, queryParams: { fields } }), 'blob_read')
      await assert.rejects(photos().claim({ sort: ['thumb'], transaction }), /not a stored field that sorts/)
    })
  })

  it('bounds a many-row write\'s full answer before writing, and its statements by blob bytes', async () => {
    const full = { returning: 'full', queryParams: { fields: { photos: 'code,bytes' } } }
    const rows = count => Array.from({ length: count }, (_, index) => ({ code: `m${index}`, bytes: bytesOf(32, index), thumb: bytesOf(8, index) }))
    await refused(photos().postMany({ data: rows(5), ...full }), 'blob_read')
    assert.equal(await fixture.count('photos'), 0)
    const answered = await photos().postMany({ data: rows(4), ...full })
    assert.equal(answered.data.length, 4)
    assert.ok(answered.data[3].attributes.bytes.equals(bytesOf(32, 3)))
    const patchIds = answered.data.map(record => record.id)
    patchIds.push(String(Number(patchIds[3]) + 1))
    await refused(photos().patchMany({ data: patchIds.map(id => ({ id, title: 'x' })), ...full }), 'blob_read')
    await fixture.reset()

    // Each statement writes at most 16 MiB of blobs by their maxBytes (on MySQL
    // and MariaDB, at most what max_allowed_packet holds as hex), so six rows of
    // 4 MiB + 1 KiB take two statements of three, or one each.
    const packet = fixture.api.knex.capabilities.dbInfo.maxAllowedPacket
    const budget = mysql ? Math.min(READ_BYTES, Math.floor((packet - MiB) / 2)) : READ_BYTES
    const perStatement = Math.max(1, Math.floor(budget / (BIG + 1024)))
    const inserts = (await statements(() => photos().postMany({ data: rows(6) }))).filter(query => /^insert/i.test(query.sql))
    assert.equal(inserts.length, Math.ceil(6 / perStatement))
    assert.ok(inserts.length >= 2)
    assert.equal(await fixture.count('photos'), 6)

    const ids = (await photos().query({ queryParams: { sort: ['id'] } })).data.map(record => record.id)
    const updates = (await statements(() => photos().patchMany({ data: ids.map((id, index) => ({ id, bytes: bytesOf(16, 100 + index) })) })))
      .filter(query => /^update/i.test(query.sql))
    assert.equal(updates.length, Math.ceil(6 / Math.max(1, Math.floor(budget / BIG))))
    assert.ok(Buffer.from((await stored(ids[5])).bytes).equals(bytesOf(16, 105)))
  })

  it('reads several records\' ids and fields without their blob columns', async () => {
    const [, second] = await seedPhotos(3, { bytes: bytesOf(256) })
    // A merge reads the matched rows minimally, then writes them.
    const sent = await statements(() => photos().postMany({
      data: [{ code: 'p1', title: 'one' }, { code: 'p2', title: 'two' }, { code: 'p4', title: 'four' }],
      onConflict: { keys: ['code'], action: 'merge', merge: ['title'] }
    }))
    const selects = sent.filter(query => /^select/i.test(query.sql))
    assert.ok(selects.length > 0)
    for (const query of selects) assert.doesNotMatch(query.sql, /\*|bytes|thumb/, query.sql)
    assert.equal((await stored(second)).title, 'two')
    assert.ok(Buffer.from((await stored(second)).bytes).equals(bytesOf(256)))

    // A report's derived table carries no blob column either.
    const { query } = await photos().scopedQuery({})
    const report = await query.select('*')
    assert.deepEqual(Object.keys(report[0]).filter(column => ['bytes', 'thumb'].includes(column)), [])
  })

  it('creates a binary column that holds maxBytes, and grows a smaller one on MySQL and MariaDB', async () => {
    const snapshot = await introspectKnexTableSnapshot(fixture.knex, { tableName: tables.photos })
    const columns = Object.fromEntries(snapshot.columns.map(column => [column.name, column]))
    assert.equal(columns.bytes.typeKind, 'binary')
    assert.equal(columns.thumb.typeKind, 'binary')
    if (!mysql) return
    const [rows] = await fixture.knex.raw(
      'select column_name as name, data_type as type from information_schema.columns where table_schema = database() and table_name in (?, ?)',
      [tables.photos, tables.albums]
    )
    const types = Object.fromEntries(rows.map(row => [row.name, row.type.toLowerCase()]))
    assert.deepEqual([types.bytes, types.thumb, types.cover], ['mediumblob', 'blob', 'tinyblob'])
    assert.deepEqual((await photos().generateKnexMigrationDiff()).plan.alterColumns, [])
    await fixture.knex.raw('alter table ?? modify ?? blob null', [tables.photos, 'bytes'])
    try {
      assert.deepEqual((await photos().generateKnexMigrationDiff()).plan.alterColumns.map(column => column.name), ['bytes'])
    } finally {
      await fixture.knex.raw('alter table ?? modify ?? mediumblob null', [tables.photos, 'bytes'])
    }
  })

  it('refuses a blob in an HTTP response, which answers JSON', async () => {
    const app = express()
    fixture.api.http.express.mount(app)
    const server = createServer(app)
    server.listen(0)
    await once(server, 'listening')
    try {
      const { data: { id } } = await post({ code: 'p1', thumb: bytesOf(16) })
      const base = `http://127.0.0.1:${server.address().port}/api`
      const named = await fetch(`${base}/photos/${id}?fields[photos]=code,thumb`)
      assert.equal(named.status, 422)
      const body = await named.json()
      assert.match(JSON.stringify(body), /blob_read|HTTP response/)
      const plain = await fetch(`${base}/photos/${id}`)
      assert.equal(plain.status, 200)
      assert.equal((await plain.json()).data.attributes.code, 'p1')
    } finally {
      server.close()
      await once(server, 'close')
    }
  })
})
