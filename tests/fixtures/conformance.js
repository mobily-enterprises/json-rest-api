import { createConformanceApi } from './api-configs.js'
import { cleanTables, countRecords, createJsonApiDocument } from '../helpers/test-utils.js'
import { storageMode } from '../helpers/storage-mode.js'
import { createTestDatabase } from '../helpers/test-database.js'

export async function createConformanceFixture ({
  storage = storageMode.mode,
  knexConfig,
  databaseOptions,
  apiOptions = {},
  createApi = createConformanceApi,
  tables = { items: 'conformance_items', groups: 'conformance_groups' }
} = {}) {
  const database = await createTestDatabase(knexConfig, databaseOptions)
  const { knex } = database
  try {
    const api = await createApi(knex, { ...apiOptions, storage })
    const actualStorage = api.anyapi ? 'anyapi' : 'knex'
    if (actualStorage !== storage) throw new Error(`Expected ${storage} fixture, got ${actualStorage}`)
    const nextIds = new Map()
    return {
      api,
      knex,
      databaseName: database.name,
      storage: actualStorage,
      idOrder: actualStorage === 'anyapi' ? 'lexical' : 'numeric',
      async reset () {
        await cleanTables(knex, Object.values(tables), { storage })
        nextIds.clear()
      },
      async seed (type, attributes, relationships, { generatedId = false } = {}) {
        const id = (nextIds.get(type) || 0) + 1
        const inputRecord = createJsonApiDocument(type, attributes, relationships)
        if (!generatedId) inputRecord.data.id = String(id)
        const created = (await api.resources[type].post({
          format: 'jsonapi',
          returning: 'full',
          document: inputRecord
        })).data
        if (!generatedId) nextIds.set(type, id)
        return created
      },
      count: type => countRecords(knex, tables[type], { storage }),
      async close () {
        try { await database.close() } finally { storageMode.clearRegistry(knex) }
      }
    }
  } catch (error) {
    try { await database.close() } finally { storageMode.clearRegistry(knex) }
    throw error
  }
}
