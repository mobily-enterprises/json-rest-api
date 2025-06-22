import { Api } from '../lib/api.js'
import { Schema } from '../lib/schema.js'
import { MemoryPlugin } from '../plugins/memory.js'
import { MigrationPlugin } from '../plugins/migration-plugin.js'
import { HTTPPlugin } from '../plugins/http.js'
import express from 'express'

// Create API instance
const api = new Api()

// Use memory storage
api.use(MemoryPlugin)

// Add migration support
api.use(MigrationPlugin, {
  directory: './examples/migrations',
  autoRun: true // Auto-run in development
})

// Create a simple config file that the CLI can use
export { api }

// Define schemas (these won't create tables - migrations will)
api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  role: { type: 'string', default: 'user' },
  createdAt: { type: 'datetime' }
}))

api.addResource('posts', new Schema({
  title: { type: 'string', required: true },
  content: { type: 'string' },
  authorId: { 
    type: 'id', 
    refs: { 
      resource: 'users',
      join: { eager: true }
    }
  },
  published: { type: 'boolean', default: false },
  publishedAt: { type: 'datetime' },
  tags: { type: 'array' }
}))

// Main function
async function main() {
  try {
    // Connect (migrations will auto-run if configured)
    await api.connect()
    
    // Check migration status
    const status = await api.migrations.status()
    console.log('\nMigration Status:')
    console.log('Applied:', status.applied.length)
    console.log('Pending:', status.pending.length)
    
    // Create some data
    const user = await api.get('users').insert({
      name: 'John Doe',
      email: 'john@example.com',
      role: 'admin'
    })
    
    const post = await api.get('posts').insert({
      title: 'First Post',
      content: 'This is my first post!',
      authorId: user.id,
      published: true,
      publishedAt: new Date(),
      tags: ['welcome', 'first']
    })
    
    // Query with joins
    const posts = await api.get('posts').query({
      filter: { published: true },
      include: 'authorId'
    })
    
    console.log('\nPublished posts:')
    console.log(JSON.stringify(posts, null, 2))
    
    // Set up HTTP if running directly
    if (import.meta.url === `file://${process.argv[1]}`) {
      const app = express()
      api.use(HTTPPlugin, { app })
      
      const PORT = 3000
      app.listen(PORT, () => {
        console.log(`\nAPI running at http://localhost:${PORT}`)
        console.log(`Try: http://localhost:${PORT}/api/v1/users`)
      })
    }
    
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}