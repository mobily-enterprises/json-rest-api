# JSON REST API

A powerful REST API plugin for [hooked-api](https://github.com/mobily-enterprises/hooked-api) that provides JSON:API-compliant endpoints with minimal configuration. This library makes it easy to create fully-featured REST APIs with support for relationships, filtering, sorting, pagination, and file uploads.

## Features

* **JSON:API Compliant** - Full support for the JSON:API specification
* **Relationship Support** - `belongsTo`, `hasMany`, and many-to-many relationships, including polymorphic
* **Advanced Querying** - Filtering, sorting, pagination, and field selection (sparse fieldsets)
* **File Uploads** - Built-in support for file handling with multiple storage adapters (local, S3)
* **Framework Agnostic** - Works with raw Node.js HTTP, Express, and other Node.js frameworks via flexible connectors
* **Validation** - Schema-based validation with detailed error messages and custom rules
* **Simplified Mode** - A developer-friendly option to work with plain JavaScript objects instead of verbose JSON:API structure
* **Extensible** - Built on `hooked-api`'s powerful plugin and hook system for deep customization

## Installation

```bash
npm install json-rest-api hooked-api json-rest-schema knex sqlite3
```

> **Note:** `json-rest-schema` and a database driver like `knex` and `sqlite3` are peer dependencies, meaning you need to install them explicitly. This gives you control over your database choice.



