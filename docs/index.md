---
layout: default
---

# Build REST APIs in Minutes, Not Days

JSON REST API is a lightweight, plugin-based framework that makes building REST APIs incredibly simple. With automatic validation, smart relationships, and native JSON:API support, you can focus on your business logic instead of boilerplate.

<div style="display: flex; gap: 24px; margin: 32px 0; align-items: flex-start;">
  <div style="display: flex; gap: 16px; flex-wrap: wrap;">
    <a href="{{ '/QUICKSTART' | relative_url }}" class="button">Get Started</a>
    <a href="{{ '/GUIDE' | relative_url }}" class="button secondary">Read the Guide</a>
  </div>
  
  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px 20px; font-style: italic; color: #555; flex: 1; margin-left: 24px;">
    A heartfelt thank you to Dario and Daniela Amodei and the entire Anthropic team for creating transformative AI technology that opens endless possibilities for developers worldwide. Your vision, combined with incredibly accessible pricing, has democratized access to cutting-edge AI and empowered countless innovators to build the future. (No, we weren't asked nor paid in any way for this message - we're just genuinely grateful!)
  </div>
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
  
  <div class="feature-card">
    <h3>🌐 Microservices Ready</h3>
    <p>Build distributed systems with native microservices support. Multiple transports, service discovery, and more.</p>
  </div>
  
  <div class="feature-card">
    <h3>🎭 CQRS Support</h3>
    <p>Implement Command Query Responsibility Segregation with event sourcing, projections, and sagas.</p>
  </div>
  
  <div class="feature-card">
    <h3>🔄 API Gateway</h3>
    <p>Transform into an API gateway to orchestrate external services with circuit breakers and saga support.</p>
  </div>
</div>

## Quick Example

```javascript
import { createApi, Schema } from 'json-rest-api'
import express from 'express'

const app = express()
const api = createApi({ 
  storage: 'memory',
  http: { app }
})

api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', format: 'email' },
  age: { type: 'number', min: 0 }
}))

app.listen(3000, () => {
  console.log('API running at http://localhost:3000/api/users')
})
```

That's it! You now have a fully functional REST API with:
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get a specific user
- `POST /api/users` - Create a new user
- `PATCH /api/users/:id` - Update a user
- `DELETE /api/users/:id` - Delete a user

## Try It Out

```bash
# Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"data":{"attributes":{"name":"Alice","email":"alice@example.com","age":28}}}'

# List all users
curl http://localhost:3000/api/users

# Get a specific user
curl http://localhost:3000/api/users/1

# Update a user
curl -X PATCH http://localhost:3000/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{"data":{"attributes":{"age":29}}}'

# Delete a user
curl -X DELETE http://localhost:3000/api/users/1
```

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
- [GitHub](https://github.com/mobily-enterprises/json-rest-api) - Source code and issues

### Advanced Topics

- [API Gateway]({{ '/GUIDE_8_API_Gateway' | relative_url }}) - Orchestrate external services
- [CLI Interface]({{ '/GUIDE_9_CLI_Interface' | relative_url }}) - Command-line interface for your API

### Enterprise Features

- [Enterprise Guide]({{ '/enterprise/ENTERPRISE_GUIDE' | relative_url }}) - Complete guide for enterprise teams
- [Microservices Architecture]({{ '/enterprise/GUIDE_8_Microservices' | relative_url }}) - Build distributed systems
- [CQRS Pattern]({{ '/enterprise/GUIDE_9_CQRS' | relative_url }}) - Command Query Responsibility Segregation
- [Domain-Driven Design]({{ '/enterprise/GUIDE_11_Domain_Driven_Design' | relative_url }}) - DDD patterns and implementation