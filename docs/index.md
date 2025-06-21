---
layout: default
---

# Build REST APIs in Minutes, Not Days

JSON REST API is a lightweight, plugin-based framework that makes building REST APIs incredibly simple. With automatic validation, smart relationships, and native JSON:API support, you can focus on your business logic instead of boilerplate.

<div style="margin: 32px 0; display: flex; gap: 16px; flex-wrap: wrap;">
  <a href="{{ '/QUICKSTART' | relative_url }}" class="button">Get Started</a>
  <a href="{{ '/GUIDE' | relative_url }}" class="button secondary">Read the Guide</a>
</div>

## Why JSON REST API?

<div class="feature-grid">
  <div class="feature-card">
    <h3>🚀 Zero Configuration</h3>
    <p>Get a fully functional API running in under 5 minutes. No complex setup or configuration files needed.</p>
  </div>
  
  <div class="feature-card">
    <h3>🔌 Plugin Architecture</h3>
    <p>Extend your API with powerful plugins. Authentication, validation, CORS, and more - just plug and play.</p>
  </div>
  
  <div class="feature-card">
    <h3>🔗 Smart Relationships</h3>
    <p>Define relationships once and get automatic joins, nested queries, and eager loading out of the box.</p>
  </div>
  
  <div class="feature-card">
    <h3>✅ Built-in Validation</h3>
    <p>Schema-based validation ensures your data is always clean. No more manual validation code.</p>
  </div>
  
  <div class="feature-card">
    <h3>📦 Multiple Storage Options</h3>
    <p>Start with in-memory storage for development, switch to MySQL for production. Same API, no code changes.</p>
  </div>
  
  <div class="feature-card">
    <h3>🎯 JSON:API Compliant</h3>
    <p>Follow industry standards with native JSON:API support. Compatible with any JSON:API client library.</p>
  </div>
</div>

## Quick Example

```javascript
import { Api, HTTPPlugin, MemoryPlugin, Schema } from 'json-rest-api'
import express from 'express'

// Create your API
const api = new Api()
api.use(MemoryPlugin)
api.use(HTTPPlugin, { app: express() })

// Define a schema
const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', format: 'email' },
  age: { type: 'number', min: 0 }
})

// Add a resource
api.addResource('users', userSchema)

// Start the server
api.listen(3000)
```

That's it! You now have a fully functional REST API with:
- `GET /users` - List all users
- `GET /users/:id` - Get a specific user
- `POST /users` - Create a new user
- `PATCH /users/:id` - Update a user
- `DELETE /users/:id` - Delete a user

## Ready to Start?

<div style="margin: 32px 0;">
  <a href="{{ '/QUICKSTART' | relative_url }}" class="button">Get Started in 5 Minutes →</a>
</div>

## Installation

```bash
npm install json-rest-api
```

## Learn More

- [Complete Guide]({{ '/GUIDE' | relative_url }}) - Everything you need to know
- [API Reference]({{ '/API' | relative_url }}) - Detailed API documentation
- [Tutorial]({{ '/ONBOARDING' | relative_url }}) - Step-by-step walkthrough
- [GitHub](https://github.com/yourusername/json-rest-api) - Source code and issues