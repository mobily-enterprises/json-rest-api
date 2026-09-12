import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JsonRestApi } from '../index.js'
import { createTestDatabase, databaseClient } from '../tests/helpers/test-database.js'
import { storageMode } from '../tests/helpers/storage-mode.js'
import fastify from 'fastify'
import * as library from '../index.js'
import { BulkOperationsPlugin } from '../plugins/core/bulk-operations-plugin.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'

const guides = {
  policies: {
    filename: '17-row-policies.md',
    names: 'acmePage, otherPage, deniedPage',
    blockCount: 3
  },
  projections: {
    filename: '15-query-projections.md',
    names: 'jane, sparse, firstPage, nextPage, included',
    blockCount: 6
  },
  fastify: {
    filename: '23-fastify.md',
    names: 'createdResponse, listResponse, invalidResponse, malformedResponse',
    blockCount: 3
  },
  bulk: {
    filename: '27-bulk-operations.md',
    names: 'created, updated, partial, atomicError, afterAtomicFailure, managedError, afterManagedRollback, deleted, remaining',
    blockCount: 7
  },
  temporal: {
    filename: '32-date-and-time.md',
    names: 'januaryArticle, onDate, inJanuary',
    blockCount: 3
  },
  service: {
    filename: '14-custom-resource-methods.md',
    names: 'serviceApi, availability',
    blockCount: 3,
    modes: ['none']
  },
  updates: {
    filename: '10-put-and-patch.md',
    names: 'publisher, book, patched, incompletePutError, afterRejectedPut, replaced, retainedBooks, clearedBooks, detachedBook, reattachedBooks, unchangedPublisher',
    blockCount: 6
  },
  search: {
    filename: '04-creating-and-querying.md',
    names: 'patched, replaced, exact, byCode, contains, range, allWords, custom, page',
    blockCount: 5
  },
  pagination: {
    filename: '09-pagination-and-sorting.md',
    names: 'defaultPage, numbered, emptyPage, firstCursorPage, secondCursorPage, sparse, nextSparse',
    blockCount: 4
  },
  'relationship-urls': {
    filename: '11-relationship-endpoints.md',
    names: 'linkage, related, replaced, empty, peterPublisher, cleared',
    blockCount: 4
  },
  transformations: {
    filename: '12-field-transformations.md',
    names: 'created, fetched, marginOnly, selectedCost, included, minimal, afterPriceChange',
    blockCount: 5
  },
  hooks: {
    filename: '13-hooks-and-lifecycle.md',
    names: 'fullNote, minimalNote, fullEvents, minimalEvents, noteContext, permissionContext, editedNote, lookupsAfterEdit, editableNote, readOnlyNote, notifications, notificationsBeforeCommit, notificationsAfterCommit',
    blockCount: 6
  },
  autofilter: {
    filename: '16-autofiltering.md',
    names: 'acmeProject, acmePage, replacedProject, otherPage',
    blockCount: 3
  },
  plugins: {
    filename: '29-writing-plugins.md',
    names: 'authorDescription, publisherDescription, createdAuthor',
    blockCount: 3
  }
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const selectedGuides = new Set(process.argv.slice(2))
for (const guide of selectedGuides) {
  if (!Object.hasOwn(guides, guide)) throw new Error(`Unknown tutorial guide '${guide}'; choose from ${Object.keys(guides).join(', ')}`)
}
for (const [guide, { filename, names, blockCount, modes = ['knex', 'anyapi'] }] of Object.entries(guides)) {
  if (selectedGuides.size && !selectedGuides.has(guide)) continue
  const source = await readFile(new URL(`../docs/GUIDE/${filename}`, import.meta.url), 'utf8')
  const blocks = [...source.matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1])
  assert.equal(blocks.length, blockCount, `${guide}: review changed executable blocks`)
  const selectedModes = process.env.JSON_REST_API_STORAGE ? modes.filter(mode => mode === 'none' || mode === storageMode.mode) : modes
  for (const mode of selectedModes) {
    const database = mode === 'none' ? null : await createTestDatabase()
    const knex = database?.knex
    try {
      const api = new JsonRestApi({ name: `guide-${guide}-${mode}` })
      await api.use(library.RestApiPlugin)
      if (mode === 'anyapi') {
        await ensureAnyApiSchema(knex)
        await api.use(library.RestApiAnyapiKnexPlugin, { knex, tenantId: 'guide' })
      } else if (knex) await api.use(library.RestApiKnexPlugin, { knex })
      const result = await new AsyncFunction('api', 'console', 'RestApiValidationError', 'RestApiResourceError', 'AutoFilterPlugin', 'JsonRestApi', 'RestApiPlugin', 'BulkOperationsPlugin', 'fastify', 'FastifyPlugin', 'QueryProjectionsPlugin', 'RowPolicyPlugin', `${blocks.join('\n').replace(/^import .*\n/gm, '')}\nreturn { ${names} }`)(api, { log () {} }, library.RestApiValidationError, library.RestApiResourceError, library.AutoFilterPlugin, JsonRestApi, library.RestApiPlugin, BulkOperationsPlugin, fastify, library.FastifyPlugin, library.QueryProjectionsPlugin, library.RowPolicyPlugin)
      const namesOf = collection => collection.data.map(record => record.name)
      if (guide === 'policies') {
        assert.deepEqual(result.acmePage.data.map(record => record.attributes.title), ['Alpha'])
        assert.equal(result.acmePage.meta.pagination.total, 2)
        assert.deepEqual(result.otherPage.data.map(record => record.title), ['Other workspace'])
        assert.deepEqual(result.deniedPage.data, [])
        assert.deepEqual(api.rowPolicies.getScopeConfig('documents'), { policy: 'workspaceMember', source: 'registry' })
        assert.deepEqual(api.rowPolicies.getConfig(), { policies: ['workspaceMember'] })
      } else if (guide === 'projections') {
        assert.equal(result.jane.full_name, 'Jane Doe')
        assert.deepEqual(result.sparse.data.attributes, { first_name: 'Jane', full_name: 'Jane Doe' })
        assert.deepEqual(result.firstPage.data.map(record => record.attributes.full_name), ['Jane Doe', 'Jane Smith'])
        assert.deepEqual(result.nextPage.data.map(record => record.attributes.full_name), ['John Adams'])
        assert.deepEqual(result.included.included[0].attributes, { full_name: 'Jane Doe' })
      } else if (guide === 'fastify') {
        assert.equal(result.createdResponse.statusCode, 201)
        assert.equal(result.createdResponse.headers['content-type'], 'application/vnd.api+json')
        assert.equal(result.createdResponse.json().data.attributes.title, 'Fastify example')
        assert.equal(result.listResponse.statusCode, 200)
        assert.equal(result.listResponse.json().meta.pagination.total, 1)
        assert.equal(result.invalidResponse.statusCode, 422)
        assert.ok(result.invalidResponse.json().errors.length)
        assert.equal(result.malformedResponse.statusCode, 400)
        assert.ok(result.malformedResponse.json().errors.length)
        const remaining = await api.resources.books.query({})
        assert.equal(remaining.data.length, 1)
      } else if (guide === 'bulk') {
        assert.deepEqual(result.created.meta, { total: 2, succeeded: 2, failed: 0, atomic: true })
        assert.deepEqual(result.created.data.map(record => record.title), ['Alpha', 'Beta'])
        assert.deepEqual(result.updated.data, result.created.data.map(record => ({ type: 'books', id: record.id })))
        assert.deepEqual(result.partial.meta, { total: 2, succeeded: 1, failed: 1, atomic: false })
        assert.equal(result.partial.errors[0].index, 1)
        assert.equal(result.partial.errors[0].error.transactionOutcome, 'rolledBack')
        assert.equal(result.atomicError.transactionOutcome, 'rolledBack')
        assert.deepEqual(result.afterAtomicFailure.data.map(record => record.title).sort(), ['Alpha revised', 'Beta revised', 'Gamma'])
        assert.ok(result.managedError)
        assert.equal(result.afterManagedRollback.title, 'Gamma')
        assert.deepEqual(result.deleted.meta.deleted, result.created.data.map(record => record.id))
        assert.deepEqual(result.remaining.data.map(record => record.title), ['Gamma'])
      } else if (guide === 'temporal') {
        assert.equal(result.januaryArticle.publishedDate, '2024-01-15')
        assert.equal(result.januaryArticle.createdAt, '2024-01-15T14:30:00.000Z')
        assert.equal(result.januaryArticle.dailyPostTime, '14:30:00')
        assert.equal(result.januaryArticle.publishedEpoch, 1705329000000)
        assert.deepEqual(result.onDate.data.map(record => record.title), ['January'])
        assert.deepEqual(result.inJanuary.data.map(record => record.title), ['January'])
      } else if (guide === 'service') {
        assert.deepEqual(result.availability, { sku: 'BOOK-1', available: true })
        const catalog = result.serviceApi.resources.catalog
        await assert.rejects(catalog.lookupAvailability({ sku: 'BOOK-1' }), /Availability access denied/)
        await assert.rejects(catalog.lookupAvailability({ sku: '' }, { auth: { canCheckAvailability: true } }), /sku is required/)
        assert.deepEqual(await catalog.lookupAvailability({ sku: 'BOOK-2' }, { auth: { canCheckAvailability: true } }), { sku: 'BOOK-2', available: false })
        assert.equal(result.serviceApi.knex, undefined)
      } else if (guide === 'updates') {
        assert.equal(result.patched.data.attributes.note, 'Keep me')
        assert.equal(result.patched.data.attributes.title, 'Second edition')
        assert.deepEqual(result.patched.data.relationships.publisher.data, { type: 'publishers', id: result.publisher.id })
        assert.ok(result.incompletePutError.cause instanceof library.RestApiValidationError)
        assert.equal(result.incompletePutError.transactionOutcome, 'rolledBack')
        assert.equal(result.afterRejectedPut.title, 'Second edition')
        assert.equal(result.replaced.data.attributes.note, null)
        assert.equal(result.replaced.data.attributes.title, 'Third edition')
        const members = [{ type: 'books', id: result.book.id }]
        assert.deepEqual(result.retainedBooks.data, members)
        assert.deepEqual(result.clearedBooks.data, [])
        assert.equal(result.detachedBook.title, 'Third edition')
        assert.equal(Object.hasOwn(result.detachedBook, 'publisher'), false)
        assert.deepEqual(result.reattachedBooks.data, members)
        assert.equal(result.unchangedPublisher.name, 'Empty Press')
      } else if (guide === 'plugins') {
        assert.deepEqual(result.authorDescription, { scopeName: 'authors', enabled: true })
        assert.equal(result.createdAuthor.name, 'Ada')
        assert.equal((await api.resources.authors.get({ id: result.createdAuthor.id, format: 'plain' })).name, 'Ada')
        assert.deepEqual(result.publisherDescription, { scopeName: 'publishers', enabled: false })
      } else if (guide === 'autofilter') {
        assert.equal(result.acmeProject.workspace_id, 'acme')
        assert.equal(result.acmePage.meta.pagination.total, 1)
        assert.deepEqual(result.acmePage.data.map(record => record.attributes.name), ['Roadmap'])
        assert.equal(result.replacedProject.workspace_id, 'acme')
        assert.equal(result.replacedProject.name, 'Updated roadmap')
        assert.deepEqual(namesOf(result.otherPage), ['Other workspace'])
        await assert.rejects(api.resources.projects.post({ data: { name: 'Mismatch', workspace_id: 'other' } }, { session: { workspaceId: 'acme' } }), error => error.cause instanceof library.RestApiValidationError && error.transactionOutcome === 'rolledBack')
        await assert.rejects(api.resources.projects.query({}), { code: 'REST_API_AUTOFILTER_CONTEXT' })
        const after = await api.resources.projects.query({}, { session: { workspaceId: 'acme' } })
        assert.deepEqual(namesOf(after), ['Updated roadmap'])
      } else if (guide === 'hooks') {
        assert.equal(result.fullNote.title, 'First note')
        assert.deepEqual(result.fullEvents, ['validate:post', 'write:post', 'read:get', 'finish:post', 'commit:post'])
        assert.deepEqual(result.minimalEvents, ['validate:post', 'write:post', 'finish:post', 'commit:post'])
        assert.deepEqual(result.minimalNote, { type: 'notes', id: result.minimalNote.id })
        assert.ok(result.minimalNote.id)
        assert.equal(result.noteContext.savedNoteId, result.fullNote.id)
        assert.equal(result.editedNote.title, 'Edited note')
        assert.deepEqual(result.permissionContext.notePermissions, { canEdit: true })
        assert.equal(result.lookupsAfterEdit, 1)
        assert.equal(result.editableNote.canEdit, true)
        assert.equal(result.readOnlyNote.canEdit, false)
        assert.equal(result.notificationsBeforeCommit, 0)
        assert.deepEqual(result.notificationsAfterCommit, [{ id: result.fullNote.id, title: 'Ready to share' }])
        const sparse = await api.resources.notes.get({
          id: result.fullNote.id, queryParams: { fields: { notes: 'title' } }
        }, { auth: { userId: 'editor' } })
        assert.deepEqual(sparse, { id: result.fullNote.id, title: 'Ready to share' })
        const deniedContext = { auth: { userId: 'reader' } }
        await assert.rejects(api.resources.notes.patch({
          id: result.fullNote.id, data: { title: 'Denied edit' }
        }, deniedContext), error => error.cause instanceof library.RestApiResourceError && error.subtype === 'forbidden' && error.transactionOutcome === 'rolledBack')
        assert.deepEqual(deniedContext.notePermissions, { canEdit: false })
        const cancellation = new Error('Cancel the notification example')
        await assert.rejects(api.transaction(async transaction => {
          await api.resources.notes.patch({
            id: result.fullNote.id, data: { title: 'Rolled back edit' }, transaction
          }, { auth: { userId: 'editor' } })
          throw cancellation
        }), error => error.cause === cancellation && error.transactionOutcome === 'rolledBack')
        assert.deepEqual(result.notifications, result.notificationsAfterCommit)
        assert.equal((await api.resources.notes.get({ id: result.fullNote.id })).title, 'Ready to share')
        const stored = await api.resources.notes.get({ id: result.minimalNote.id })
        assert.equal(stored.title, 'Second note')
      } else if (guide === 'transformations') {
        assert.equal(result.created.name, 'WIDGET')
        assert.equal(result.created.code, 'W01:WIDGET')
        assert.equal(result.created.marginPercent, 75)
        assert.equal(result.created.previewLabel, 'Preview')
        assert.equal(Object.hasOwn(result.fetched, 'previewLabel'), false)
        for (const field of ['cost', 'profit', 'privateNote']) assert.equal(Object.hasOwn(result.fetched, field), false)
        assert.deepEqual(result.marginOnly, { id: result.created.id, marginPercent: 75 })
        assert.deepEqual(result.selectedCost, { id: result.created.id, cost: 5 })
        assert.deepEqual(result.included.products[0], { id: result.created.id, code: 'W01:WIDGET', marginPercent: 75 })
        assert.deepEqual(result.minimal, { type: 'products', id: result.created.id })
        assert.equal(result.afterPriceChange.marginPercent, 80)
        const adapter = api.knex.helpers.getStorageAdapter('products')
        const stored = await adapter.buildBaseQuery().select({ storedName: adapter.translateColumn('name'), storedCode: adapter.translateColumn('code') }).first()
        assert.deepEqual(stored, { storedName: 'Widget', storedCode: 'W01' })
        await assert.rejects(api.resources.products.post({ data: { name: 'Rejected', code: 'R', price: 1, cost: 0, previewLabel: 'x'.repeat(21) } }), error => error.cause instanceof library.RestApiValidationError && error.transactionOutcome === 'rolledBack')
      } else if (guide === 'relationship-urls') {
        assert.equal(result.linkage.data.length, 2)
        assert.deepEqual(namesOf(result.related), ['Peter Straub', 'Stephen King'])
        assert.equal(result.replaced.data.length, 1)
        assert.deepEqual(result.empty.data, [])
        assert.equal(result.peterPublisher.name, 'Scribner')
        assert.equal(result.cleared.data, null)
      } else if (guide === 'search') {
        assert.equal(result.patched.code, 'DE')
        assert.equal(result.replaced.code, null)
        assert.equal(result.replaced.population, null)
        assert.deepEqual(namesOf(result.exact), ['France'])
        assert.deepEqual(namesOf(result.byCode), ['Germany'])
        assert.deepEqual(namesOf(result.contains), ['United Kingdom', 'United States'])
        assert.deepEqual(namesOf(result.range), ['France', 'Germany', 'United Kingdom'])
        assert.deepEqual(namesOf(result.allWords), ['United States'])
        assert.deepEqual(namesOf(result.custom), ['Austria', 'United States'])
        assert.deepEqual(namesOf(result.page), ['Austria', 'France'])
        assert.equal(result.page.meta.pagination.total, 5)
        assert.equal(Object.hasOwn(result.page.data[0], 'population'), false)
      } else {
        assert.deepEqual(namesOf(result.defaultPage), ['Austria', 'France'])
        assert.equal(result.defaultPage.meta, undefined)
        assert.deepEqual(namesOf(result.numbered), ['Germany', 'Italy'])
        assert.deepEqual(result.numbered.meta.pagination, { page: 2, pageSize: 2, pageCount: 3, total: 5, hasMore: true })
        assert.deepEqual(result.emptyPage.data, [])
        assert.deepEqual(namesOf(result.firstCursorPage), ['Austria', 'France'])
        assert.deepEqual(namesOf(result.secondCursorPage), ['Germany', 'Italy'])
        assert.equal(result.firstCursorPage.meta.pagination.total, undefined)
        assert.deepEqual(result.sparse.data.map(record => record.code), ['AT', 'FR'])
        assert.deepEqual(result.nextSparse.data.map(record => record.code), ['DE', 'IT'])
        assert.equal(Object.hasOwn(result.sparse.data[0], 'name'), false)
      }
      console.log(`Literal ${guide} guide passed: ${mode} / ${mode === 'none' ? 'no database' : databaseClient}`)
    } finally { await database?.close() }
  }
}
