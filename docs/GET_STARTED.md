# Get Started with JSON REST API

Welcome! In the next 5 minutes, you'll build a complete REST API with validation, relationships, and powerful querying. Let's go! 🚀

## 1. Install (30 seconds)

```bash
npm install json-rest-api express
```

## 2. Your First API (2 minutes)

Create a file `server.js`:

```javascript
import express from 'express';
import { createApi, Schema } from 'json-rest-api';

const app = express();

// Create your API
const api = createApi({ 
  storage: 'memory'  // Use in-memory storage for now
});

// Define what a "task" looks like
api.addResource('tasks', new Schema({
  title: { type: 'string', required: true },
  done: { type: 'boolean', default: false },
  priority: { type: 'number', min: 1, max: 5 }
}));

// Mount it on Express
api.mount(app);

// Start the server
app.listen(3000, () => {
  console.log('🎉 API ready at http://localhost:3000/api/tasks');
});
```

Run it:
```bash
node server.js
```

## 3. Try Your API (1 minute)

Your API is ready! Test it with curl or your favorite tool:

```bash
# Create a task
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"data": {"type": "tasks", "attributes": {"title": "Learn JSON REST API"}}}'

# List all tasks
curl http://localhost:3000/api/tasks

# Update a task (use the ID from the create response)
curl -X PATCH http://localhost:3000/api/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"data": {"type": "tasks", "attributes": {"done": true}}}'

# Query tasks
curl "http://localhost:3000/api/tasks?filter[done]=true"
```

## 4. Add Relationships (1 minute)

Let's add users and link tasks to them:

```javascript
// Add this after your tasks resource

// Define users
api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
}));

// Update tasks to have an owner
api.addResource('tasks', new Schema({
  title: { type: 'string', required: true },
  done: { type: 'boolean', default: false },
  priority: { type: 'number', min: 1, max: 5 },
  userId: { 
    type: 'id',
    refs: { 
      resource: 'users',
      join: { 
        eager: true,  // Auto-include user data
        fields: ['name']  // Only include the name
      }
    }
  }
}));
```

Now when you fetch tasks, the user data is automatically included!

## 5. Add Custom Logic (30 seconds)

Want to add custom behavior? Use hooks:

```javascript
// Add this before api.mount(app)

// Automatically set high priority for urgent tasks
api.hook('beforeInsert', async (context) => {
  if (context.options.type === 'tasks') {
    const task = context.data;
    if (task.title.toLowerCase().includes('urgent')) {
      task.priority = 5;
    }
  }
});

// Add a computed field
api.hook('afterGet', async (context) => {
  if (context.options.type === 'tasks' && context.result) {
    context.result.isHighPriority = context.result.priority >= 4;
  }
});
```

## 🎊 Congratulations!

You just built a fully-featured REST API with:
- ✅ Complete CRUD operations
- ✅ Automatic validation
- ✅ Relationships with auto-joining
- ✅ Filtering and querying
- ✅ Custom business logic

## What's Next?

### Switch to MySQL (2 minutes)

Replace the memory storage with MySQL:

```javascript
const api = createApi({ 
  storage: 'mysql',
  mysql: {
    connection: {
      host: 'localhost',
      user: 'root',
      password: 'password',
      database: 'myapp'
    }
  }
});

// Sync your schemas to create tables
await api.syncSchema(api.resources.tasks.schema, 'tasks');
await api.syncSchema(api.resources.users.schema, 'users');
```

### Try Advanced Queries

```bash
# Filter with operators
curl "http://localhost:3000/api/tasks?filter[priority][$gte]=3"

# Sort and paginate
curl "http://localhost:3000/api/tasks?sort=-priority,title&page[size]=10"

# Include relationships
curl "http://localhost:3000/api/tasks?include=user"

# Combine everything
curl "http://localhost:3000/api/tasks?filter[done]=false&filter[priority][$gte]=3&include=user&sort=-createdAt"
```

### Explore More Features

- **Nested Relationships**: `include=user.department.company`
- **Field Selection**: `fields[tasks]=title,priority`
- **Batch Operations**: Create/update/delete multiple records
- **API Versioning**: Support multiple API versions
- **Plugins**: Timestamps, soft delete, audit logs, and more

## 📚 Ready to Master It?

Now that you've seen how easy it is, dive deeper:

- **[GUIDES.md](./GUIDES.md)** - Learn every feature with practical examples
- **[API.md](./API.md)** - Complete API reference
- **[Architecture Docs](./architecture/)** - Understand how it all works

## Need Help?

- 📖 Read the [comprehensive guide](./GUIDES.md)
- 🏗️ Check the [examples](../examples/) directory
- 🐛 Report issues on GitHub

---

**Happy coding!** 🎉 You're now ready to build amazing APIs with minimal code.