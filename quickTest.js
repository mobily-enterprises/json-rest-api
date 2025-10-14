//
// index.js
//
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from './index.js' // Added: ExpressPlugin
import { Api } from 'hooked-api'
import knexLib from 'knex'
import util from 'util'
import express from 'express' // Added: Express

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
const api = new Api({ name: 'book-catalog-api', logLevel: 'trace' })

// Install plugins
await api.use(RestApiPlugin, { returnBasePath: '/api' })
await api.use(RestApiKnexPlugin, { knex })
await api.use(ExpressPlugin, { mountPath: '/api' }) // Added: Express Plugin

// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true },
  },
  relationships: {
    // A publisher has many authors
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
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

// Method 1: Simplified mode without inputRecord (most concise)
const penguinResult = await api.resources.publishers.post({
  name: 'Penguin Random House'
})
console.log('Created publisher:', inspect(penguinResult))

// Method 2: Simplified mode with inputRecord (explicit)
const harperResult = await api.resources.publishers.post({
  inputRecord: {
    name: 'HarperCollins'
  }
})

// Method 3: Full JSON:API mode (standards compliant)
const oxfordResult = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: {
        name: 'Oxford University Press'
      }
    }
  },
  simplified: false
})
console.log('JSON:API response:', inspect(oxfordResult))

// Create an author linked to the first publisher (simplified)
const authorResult = await api.resources.authors.post({
  name: 'George',
  surname: 'Orwell',
  publisher_id: penguinResult.id
})
console.log('Created author:', inspect(authorResult))

// Get all publishers
const allPublishers = await api.resources.publishers.query({})
console.log('All publishers:', inspect(allPublishers))

// Get publisher with included authors
const publisherWithAuthors = await api.resources.publishers.get({
  id: penguinResult.id,
  include: ['authors']
})
console.log('Publisher with authors:', inspect(publisherWithAuthors))

// Search authors by name
const searchResult = await api.resources.authors.query({
  filter: { name: 'George' }
})
console.log('Search results:', inspect(searchResult))

// Update an author
const updateResult = await api.resources.authors.patch({
  id: authorResult.id,
  surname: 'Orwell (Eric Blair)'
})
console.log('Updated author:', inspect(updateResult))

/// *** ...programmatic calls here... ***

// Create the express server and add the API's routes
const app = express()
app.use(api.http.express.router)
app.use(api.http.express.notFoundRouter)

app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api')
}).on('error', (err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
}).on('error', (err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
