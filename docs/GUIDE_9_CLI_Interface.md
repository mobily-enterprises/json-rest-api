# Chapter 12: CLI Interface

The CLI plugin provides a command-line interface to interact with your JSON REST API, perfect for administration, debugging, and scripting.

## Installation

```javascript
import { Api, Schema, MemoryPlugin, CLIPlugin } from 'json-rest-api'

const api = new Api()
api.use(MemoryPlugin)
api.use(CLIPlugin)  // Add CLI capabilities
```

## Interactive Mode

Start an interactive REPL (Read-Eval-Print Loop) session:

```bash
$ node your-script.js --interactive
JSON REST API CLI
Commands: <resource>.<method>(...args), help, exit
Example: users.get(1), users.create({name: "John"})
api> 
```

### REPL Commands

```javascript
// Get a single record
api> users.get(1)

// Query records with filters
api> users.query({filter: {age: {$gt: 25}}})

// Create a new record
api> users.create({name: "Alice", email: "alice@example.com"})

// Update an existing record
api> users.update(1, {age: 31})

// Delete a record
api> users.delete(2)

// Get help
api> help

// Exit the REPL
api> exit
```

## Command Line Mode

Execute one-off commands directly from your shell:

```bash
# Get a user by ID
$ node api.js get users 1

# List all users
$ node api.js list users

# Create a new user (JSON must be properly escaped)
$ node api.js create users '{"name":"Bob","email":"bob@example.com"}'

# With complex queries
$ node api.js query users '{"filter":{"age":{"$gt":25}},"sort":"name"}'
```

## Setting Up a CLI Script

Create a dedicated CLI script for your API:

```javascript
// cli.js
import { Api, Schema, MemoryPlugin, MySQLPlugin, CLIPlugin } from 'json-rest-api'

const api = new Api()

// Use appropriate storage
if (process.env.NODE_ENV === 'production') {
  api.use(MySQLPlugin, {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  })
} else {
  api.use(MemoryPlugin)
}

api.use(CLIPlugin)

// Define your resources
api.addResource('users', {
  schema: new Schema({
    name: { type: 'string', required: true },
    email: { type: 'string' },
    role: { type: 'string', default: 'user' }
  })
})

api.addResource('posts', {
  schema: new Schema({
    title: { type: 'string', required: true },
    content: { type: 'string' },
    authorId: { type: 'id', refs: 'users' },
    published: { type: 'boolean', default: false }
  })
})

// Handle command line arguments
if (process.argv[2] === '--interactive') {
  api.cli.start()
} else if (process.argv.length > 2) {
  try {
    const result = await api.cli.runCommand(process.argv.slice(2))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
} else {
  console.log('Usage:')
  console.log('  Interactive: node cli.js --interactive')
  console.log('  Command:     node cli.js <command> <resource> [args...]')
  console.log('Examples:')
  console.log('  node cli.js get users 1')
  console.log('  node cli.js list posts')
  console.log('  node cli.js create users \'{"name":"Alice"}\'')
}
```

## Advanced Usage

### With Authentication

If using the Authorization plugin, you can pass user context:

```javascript
// In your CLI setup
api.hook('beforeOperation', async (context) => {
  // Set CLI user from environment or config
  context.user = { id: 1, role: 'admin' }
})
```

### Scripting

The CLI is perfect for automation and scripts:

```bash
#!/bin/bash
# backup-users.sh

# Export all users
node cli.js list users > users-backup.json

# Count active users
ACTIVE_COUNT=$(node cli.js query users '{"filter":{"active":true}}' | jq length)
echo "Active users: $ACTIVE_COUNT"
```

### Custom Commands

Extend the CLI with custom commands:

```javascript
api.cli.registerCommand('stats', async (resource) => {
  const count = await api.resources[resource].query({ count: true })
  const latest = await api.resources[resource].query({ 
    limit: 1, 
    sort: '-createdAt' 
  })
  return {
    total: count,
    latest: latest[0]
  }
})

// Usage: api> stats.users()
```

## Integration with Other Plugins

The CLI works seamlessly with all other plugins:

```javascript
// With Validation plugin - validation errors are shown
api> users.create({})
Error: Validation failed: name is required

// With Views plugin - respects view configurations
api> users.get(1)  // Returns fields based on default view

// With Positioning plugin
api> items.query({sort: 'position'})  // Returns ordered items
```

## Tips and Best Practices

1. **Create aliases** for common commands:
   ```bash
   alias api-users="node /path/to/cli.js list users"
   ```

2. **Use with jq** for JSON processing:
   ```bash
   node cli.js list users | jq '.[] | select(.age > 25)'
   ```

3. **Pipe to other tools**:
   ```bash
   node cli.js list users | grep -i admin | wc -l
   ```

4. **Interactive debugging**:
   ```javascript
   api> users.get(999)  // See actual errors
   api> users.query({debug: true})  // If debug mode is implemented
   ```

5. **Batch operations** with shell scripts:
   ```bash
   # Deactivate all users older than 30
   for id in $(node cli.js query users '{"filter":{"age":{"$gt":30}}}' | jq -r '.[].id'); do
     node cli.js update users $id '{"active":false}'
   done
   ```

The CLI plugin transforms your JSON REST API into a powerful command-line tool, making it easy to manage data, debug issues, and integrate with shell scripts and automation tools.