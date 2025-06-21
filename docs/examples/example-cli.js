import { Api, Schema, MemoryPlugin, CLIPlugin } from '../index.js'

const api = new Api()
api.use(MemoryPlugin)
api.use(CLIPlugin)

api.addResource('users', {
  schema: new Schema({
    name: { type: 'string', required: true },
    email: { type: 'string' },
    age: { type: 'number' }
  })
})

api.addResource('posts', {
  schema: new Schema({
    title: { type: 'string', required: true },
    content: { type: 'string' },
    authorId: { type: 'id', refs: 'users' }
  })
})

// Seed some data
await api.resources.users.insert({ name: 'John Doe', email: 'john@example.com', age: 30 })
await api.resources.users.insert({ name: 'Jane Smith', email: 'jane@example.com', age: 25 })
await api.resources.posts.insert({ title: 'Hello World', content: 'First post!', authorId: 1 })

console.log('Starting CLI with sample data...\n')

// Two ways to use the CLI:

// 1. Interactive mode
if (process.argv[2] === '--interactive') {
  api.cli.start()
} else {
  // 2. Command line mode
  console.log('Examples:')
  console.log('node examples/example-cli.js --interactive')
  console.log('node examples/example-cli.js get users 1')
  console.log('node examples/example-cli.js create users \'{"name":"Bob"}\'')
  console.log('node examples/example-cli.js list users\n')
  
  if (process.argv.length > 2) {
    try {
      const result = await api.cli.runCommand(process.argv.slice(2))
      console.log(JSON.stringify(result, null, 2))
    } catch (error) {
      console.error('Error:', error.message)
      process.exit(1)
    }
  }
}