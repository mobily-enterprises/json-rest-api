import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin, JsonRestApi } from './index.js'
import knexLib from 'knex'
import util from 'util'
import express from 'express'

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 8 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

// Create API instance
const api = new JsonRestApi({ name: 'book-catalog-api' })

// Install plugins
await api.use(RestApiPlugin, { format: 'plain', returning: 'full' })
await api.use(RestApiKnexPlugin, { knex })
await api.use(ExpressPlugin, { mountPath: '/api' })

// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true },
  },
  relationships: {
    // A publisher has many authors
    authors: { type: 'hasMany', target: 'authors', foreignKey: 'publisher_id' },
  },
  searchSchema: { // Adding search schema for publishers
    name: { type: 'string', filterOperator: 'like' }
  }
})
await api.resources.publishers.createKnexTable()

// Define authors resource, which belongs to a publisher
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: { // Adding search schema for authors
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
  }
})
await api.resources.authors.createKnexTable()

// Plain records keep data inside inputRecord.
const penguinResult = await api.resources.publishers.post({ format: 'plain', inputRecord: { name: 'Penguin Random House' } })
console.log('Created publisher:', inspect(penguinResult))

// Calls can use the plugin defaults.
const harperResult = await api.resources.publishers.post({
  inputRecord: {
    name: 'HarperCollins'
  }
})
console.log('Created second publisher:', inspect(harperResult))

// Select JSON:API explicitly for document input and output.
const oxfordResult = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: {
        name: 'Oxford University Press'
      }
    }
  },
  format: 'jsonapi'
})
console.log('JSON:API response:', inspect(oxfordResult))

// Plain relationship input uses the relationship name.
const authorResult = await api.resources.authors.post({ format: 'plain', inputRecord: { name: 'George', surname: 'Orwell', publisher: penguinResult.id } })
console.log('Created author:', inspect(authorResult))

// Get all publishers
const allPublishers = await api.resources.publishers.query({})
console.log('All publishers:', inspect(allPublishers))

// Get publisher with included authors
const publisherWithAuthors = await api.resources.publishers.get({
  id: penguinResult.id,
  queryParams: { include: ['authors'] }
})
console.log('Publisher with authors:', inspect(publisherWithAuthors))

// Search authors by name
const searchResult = await api.resources.authors.query({
  queryParams: { filters: { name: 'George' } }
})
console.log('Search results:', inspect(searchResult))

// Update an author
const updateResult = await api.resources.authors.patch({ id: authorResult.id, format: 'plain', inputRecord: { surname: 'Orwell (Eric Blair)' } })
console.log('Updated author:', inspect(updateResult))

const app = express()
api.http.express.mount(app)
const server = app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
  console.log(`API available at http://127.0.0.1:${server.address().port}/api`)
})
server.on('error', async (error) => {
  console.error('Failed to start server:', error)
  await knex.destroy()
  process.exitCode = 1
})
const close = () => { server.close(() => { knex.destroy() }) }
process.once('SIGINT', close)
process.once('SIGTERM', close)
