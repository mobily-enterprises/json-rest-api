#!/usr/bin/env node

import { JsonRestApi } from '../index.js'
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from '../index.js'
import knexLib from 'knex'
import express from 'express'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
})
const api = new JsonRestApi({ name: 'url-override-demo' })
const publicUrls = new Set(['https://cdn.example.com/api', 'https://public.api.com/api'])
api.customize({
  hooks: {
    'transport:request': {
      functionName: 'select-public-url',
      handler: async ({ context }) => {
        const request = context.request
        const requestedUrl = request.headers['x-public-url']
        // Client headers may select a configured URL, never an arbitrary origin.
        if (publicUrls.has(requestedUrl)) context.urlPrefixOverride = requestedUrl
        else if (request.headers['x-api-version'] === 'v2') context.urlPrefixOverride = 'https://api.example.com/v2'
        else if (request.hostname === 'tenant-a.example.com') context.urlPrefixOverride = 'https://tenant-a.api.com/api'
        else if (process.env.FORCE_PRODUCTION_URLS === 'true') context.urlPrefixOverride = 'https://api.production.com/api'
      }
    }
  }
})
await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex })
await api.use(ExpressPlugin, { mountPath: '/api' })
await api.addResource('items', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    description: { type: 'string', max: 500 }
  }
})
await api.resources.items.createKnexTable()
await api.resources.items.post({ inputRecord: { name: 'Test Item 1', description: 'This is a test item' } })

const app = express()
api.http.express.mount(app)
const server = app.listen(Number(process.env.PORT || 3333), '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}/api/items`
  console.log(`Server ready: ${base}`)
  console.log('Default links are relative (/api/items/1); configured overrides are absolute.')
  console.log(`curl '${base}'`)
  console.log(`curl -H 'X-Public-URL: https://cdn.example.com/api' '${base}'`)
  console.log(`curl -H 'X-API-Version: v2' '${base}'`)
  console.log(`curl -H 'Host: tenant-a.example.com' '${base}'`)
  console.log(`curl -X POST -H 'Content-Type: application/vnd.api+json' -H 'X-Public-URL: https://public.api.com/api' -d '{"data":{"type":"items","attributes":{"name":"New Item"}}}' '${base}'`)
})
server.on('error', async error => {
  console.error(error)
  await knex.destroy()
  process.exitCode = 1
})
const shutdown = () => server.close(() => { knex.destroy() })
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
