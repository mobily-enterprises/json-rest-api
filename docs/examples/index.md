---
layout: default
title: Examples
---

# JSON REST API Examples

This directory contains working examples demonstrating various features of the JSON REST API library.

## Basic Examples

- [example.js](example.js) - Basic setup with memory and MySQL storage
- [example-versioning.js](example-versioning.js) - API versioning with auto-negotiation

## Advanced Queries

- [advanced-queries.js](advanced-queries.js) - Complex filtering and joins
- [example-operators.js](example-operators.js) - Using query operators
- [query-builder-json-api.js](query-builder-json-api.js) - Direct SQL generation
- [resource-queries.js](resource-queries.js) - Resource-specific queries

## Relationships & Joins

- [advanced-refs-demo.js](advanced-refs-demo.js) - Advanced relationship demos
- [advanced-refs-final.js](advanced-refs-final.js) - Final relationship implementation
- [simple-smart-joins.js](simple-smart-joins.js) - Simple join examples
- [smart-joins.js](smart-joins.js) - Advanced join strategies

## Security

- [example-authorization.js](example-authorization.js) - Role-based access control
- [example-error-sanitization.js](example-error-sanitization.js) - Error handling in production
- [example-input-limits.js](example-input-limits.js) - Input validation and limits
- [silent-fields.js](silent-fields.js) - Hiding sensitive fields
- [no-sql-strings.js](no-sql-strings.js) - SQL injection prevention

## Enterprise Features

- [example-microservices.js](example-microservices.js) - Microservices architecture
- [example-cqrs.js](example-cqrs.js) - CQRS pattern implementation
- [example-ddd.js](example-ddd.js) - Domain-Driven Design
- [example-api-gateway.js](example-api-gateway.js) - API Gateway pattern

## Other Examples

- [example-cli.js](example-cli.js) - Command-line interface
- [virtual-search-fields.js](virtual-search-fields.js) - Virtual fields for searching
- [query-modification.js](query-modification.js) - Modifying queries with hooks

## Running the Examples

Most examples can be run directly with Node.js:

```bash
node example.js
```

Some examples require environment variables for MySQL:

```bash
DB_TYPE=mysql MYSQL_USER=root MYSQL_PASSWORD=password node example.js
```

Make sure to install dependencies first:

```bash
npm install
```

## Learn More

- [Back to Guide](../GUIDE.md)
- [API Reference](../API.md)
- [Getting Started](../GUIDE_1_Getting_Started.md)