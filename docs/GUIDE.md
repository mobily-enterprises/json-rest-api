# JSON REST API Guide

A comprehensive guide to building REST APIs with json-rest-api.

## Table of Contents

### Core Documentation

1. **[Core Library and Plugins](./1.CORE_AND_PLUGINS-CORE.md)**
   - Basics: Creating APIs with `createApi` and manual setup
   - Core plugins overview (memory, mysql, http, validation, positioning, timestamps)
   - Relations: One-to-many and many-to-one relationships
   - Querying: Searchable fields and filtering
   - Validation: Schema validation system
   - Positioning: Ordered records
   - Hooks: Resource and API-wide lifecycle hooks
   - API Usage: Programmatic access patterns

2. **[Core Extra Plugins](./2.PLUGINS-CORE-EXTRA.md)**
   - audit-log: Track all changes
   - authorization: Role-based access control
   - computed: Dynamic field calculations
   - cors: Cross-origin resource sharing
   - csrf: CSRF protection
   - jwt: JSON Web Token authentication
   - logging: Request/response logging
   - migration-plugin: Database migrations
   - query-limits: Prevent resource exhaustion
   - security: Security headers and protections
   - versioning: API versioning support
   - views: Custom data transformations

3. **[Protocol Plugins](./3.PLUGINS-PROTOCOLS.md)**
   - simplified-records: Simplified JSON format
   - graphql: GraphQL API support
   - websocket: Real-time subscriptions
   - grpc: gRPC protocol support
   - schema-export: OpenAPI/JSON Schema generation

4. **[Infrastructure Plugins](./4.PLUGINS-INFRASTRUCTURE.md)**
   - api-gateway: Multi-API routing
   - cli: Command-line interface
   - service-discovery: Microservice integration

5. **[Enterprise Plugins](./5.PLUGINS-ENTERPRISE.md)**
   - microservices: Distributed API patterns
   - cqrs: Command Query Responsibility Segregation
   - ddd: Domain-Driven Design support
   - bounded-context: DDD context boundaries
   - architecture-enforcement: Code structure rules
   - dependency-graph: Dependency visualization

### Reference Documentation

6. **[API Reference](./API.md)**
   - Complete API documentation
   - Method signatures
   - Configuration options
   - Plugin interfaces

7. **[Examples](./EXAMPLES.md)**
   - Real-world use cases
   - Common patterns
   - Best practices
   - Integration examples

## Quick Start

```javascript
import { createApi, Schema } from 'json-rest-api';
import express from 'express';

const app = express();
const api = createApi({ 
  storage: 'memory',
  http: { app }
});

// Define a resource
api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  age: { type: 'number', min: 0 }
}));

// Start server
app.listen(3000, () => {
  console.log('API running on http://localhost:3000');
});
```

## Philosophy

This library follows these core principles:

1. **Plugin-Based Architecture**: Everything is a plugin, allowing maximum flexibility
2. **Schema-First**: Define your data structure and let the library handle the rest
3. **Standards Compliant**: JSON:API format by default
4. **Type Safe**: Built-in validation and type checking
5. **Relationship Aware**: First-class support for relational data
6. **Production Ready**: Security, performance, and monitoring built-in

## Getting Help

- Read through the guide sections in order for the best learning experience
- Check the [API Reference](./API.md) for detailed method documentation
- Browse [Examples](./EXAMPLES.md) for real-world patterns
- Review plugin documentation for specific features

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to this project.