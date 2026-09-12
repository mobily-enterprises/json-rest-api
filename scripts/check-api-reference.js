import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JsonRestApi } from '../index.js'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const require = createRequire(`${root}/package.json`)
const { default: knexFactory } = await import(pathToFileURL(require.resolve('knex')))
const library = await import(pathToFileURL(`${root}/index.js`))
const { ensureAnyApiSchema } = await import(pathToFileURL(`${root}/plugins/core/lib/anyapi/schema-utils.js`))
const source = await readFile(`${root}/docs/API.md`, 'utf8')
const blocks = [...source.matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1])
const schema = blocks.find(code => code.includes("await api.addResource('articles'"))
const trimHook = blocks.find(code => code.includes("functionName: 'trim-article-title'"))
const validationHook = blocks.find(code => code.includes("functionName: 'validate-article-title'"))
const inputExamples = blocks.find(code => code.includes('async function renameArticle'))
assert.ok(schema && trimHook && validationHook && inputExamples)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const evaluate = (code, api) => new AsyncFunction('api', 'RestApiValidationError', code.replace(/^import .*;\n/m, ''))(api, library.RestApiValidationError)
for (const mode of ['knex', 'anyapi']) {
  const knex = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  try {
    const api = new JsonRestApi({ name: `reference-${mode}` })
    await api.use(library.RestApiPlugin, { format: 'plain', returning: 'full' })
    if (mode === 'anyapi') {
      await ensureAnyApiSchema(knex)
      await api.use(library.RestApiAnyapiKnexPlugin, { knex, tenantId: 'reference' })
    } else await api.use(library.RestApiKnexPlugin, { knex })
    await evaluate(schema, api)
    await evaluate(trimHook, api)
    const created = await api.resources.articles.post({ data: { title: '  A documented title  ', content: 'two words' } })
    assert.equal(created.title, 'A documented title')
    const computed = await api.resources.articles.get({ id: created.id, queryParams: { fields: { articles: 'title,word_count' } } })
    assert.equal(computed.word_count, 2)
    const found = await api.resources.articles.query({ queryParams: { filters: { titleContains: 'documented' }, page: { number: 1, size: 10 } } })
    assert.deepEqual(found.meta.pagination, { page: 1, pageSize: 10, pageCount: 1, total: 1, hasMore: false })
    assert.equal(found.data.length, 1)
    const minimal = await api.resources.articles.put({ id: created.id, data: { title: 'Replacement title', content: 'three short words' }, returning: 'minimal' })
    assert.deepEqual(minimal, { type: 'articles', id: created.id })
    assert.equal(await api.resources.articles.patch({ id: created.id, data: { title: 'Updated title' }, returning: 'none' }), undefined)
    await api.resources.articles.post({ data: { id: '42', title: 'Before input examples', content: 'Repository example' } })
    const examples = await evaluate(`${inputExamples}\nreturn { renameArticle, wireResponse, plainResult }`, api)
    assert.equal(examples.wireResponse.data.attributes.title, 'Revised')
    assert.equal(examples.plainResult.title, 'Revised')
    const renamed = await examples.renameArticle('42', 'Ordinary repository', {})
    assert.equal(renamed.title, 'Ordinary repository')
    assert.equal(renamed.id, '42')
    await evaluate(validationHook, api)
    await assert.rejects(api.resources.articles.post({ data: { title: 'Short', content: 'Rejected content' } }), error => {
      assert.equal(error.cause instanceof library.RestApiValidationError, true)
      assert.equal(error.transactionOutcome, 'rolledBack')
      return true
    })
    console.log(`Reference schema, hooks, computed field, filtering, pagination, target ID and return modes passed: ${mode}`)
  } finally { await knex.destroy() }
}
