We need to rethink the way we think about the documentation. I am mainly talking about the guide.
First of all, rename the guide GUIDE_OLD.md and let's start afresh.

I think this should be the structure:

# CORE LIBRARY 

1. Basics
  * How to create an API with createApi
  * How to do the same thing by hand
  * Explain that the following are the "core" plugins, used to get the basic functionality:
   './plugins/memory.js';
   './plugins/mysql.js';
   './plugins/http.js';
   './plugins/validation.js';
   './plugins/positioning.js';
   './plugins/versioning.js'; <--- I don't think this should be core NOT should be handled by createApi.
   './plugins/timestamps.js';

  * What a resource file normally looks like
  * How to integrate the code with Express
    - Starting from a "fresh off template" express file, placing the right commands
    - Explaining which middleware you will need in Express
    - Encourage structoring the API where each file is in the right directory
  * No refs at all here yet. Don't even mention them
  * How it's possible to use both memory or mysql totally interchangably

2. Relations
 * Example of two resources (following the same best practices as above)
 * Explain resouce 1 has resource2Id, and does lookup since it has refs etc.
 * Explain what the returned data looks like (JSON:API)
 * Explain the ability to use api.resources
 * Add another resource, this time 1:N with the first resource, ref, etc
 * Explain what the returned data looks like (JSON:API)
 * Get into the nitti gritty of fields, etc.
 * Explain all of the options. Cover ALL cases
 * Add another resource, with records in 
 * Throughout the guide, explain that the data is in JSON:API format. DO NOT mention the plugin to simplify
 
 3. Querying
 * Basics: defining fileds as "searchable"
 * Searching for 

 4. Validation
 * How validation works with the schema
 * Understanding the schema ojbect
 * How validation works 
 
 5. Positioning
 * How positioning works, and why it's invaluable
 * Full tutorial that shows how positioning works 

 6. Hooks. Declare resource-wide hooks, and api-wide hooks, complete life-cycle

 7. API usage
 * How to use the module programmatically. Step by step guide, covering everything

...What else do we consider "core plugin"?

Anyhow, these plugins should be placed in "plugins/core"

 # CORE EXTRA PLUGINS

(From this point on, the guide is much more "per-plugin". Each plugin is explained.
 What it's for, why it exists, and every possible option)

 1. Versioning
 
 2. Views
 
 3. Migration

 4. Audit-log (MAYBE, MAYBE NOT)

 5. Logging

What else?

These plugins should be placed in plugins/core-extra

Even the tests shoud follow this format: test:core, test:core-extra, and so on.

So, what do you think about this classification, and what other "groups" do you think we have? (look in plugins/)


Now, the first part, about core library and core plugins, we have already established how to do it.
About the other ones, it will be a matter of going through plugin after plugin, and for each one:


* Introduction. What the plugin is for

* What json-rest-api provide

* How it provides it: a code example with the options

* What to expect from this plugin
  - What it will do, in practical terms

 Limitations

And so on for every plugin. Make each section approachable, explanatory, taking the dev's hand and explaining how to do things.

Only do the first chapter,  and then the second one with core-extra. I will see how you go.

For chapter 1, it's important that you have 100% coverage of the features of the library since that's the actual documentation.

  1. GUIDE.md - Table of Contents only
  2. 1.CORE_AND_PLUGINS-CORE.md
  3. 2.PLUGINS-CORE-EXTRA.md - Documentation for each core-extra plugin
  4. 3.PLUGINS-PROTOCOLS.md - API protocols and formats
  5. 4.PLUGINS-INFRASTRUCTURE.md - System-level plugins
  6. 5.PLUGINS-ENTERPRISE.md - Enterprise patterns
  7. API.md - Complete API reference
  8. EXAMPLES.md - Example configurations and use cases





I want to start with the USE of the library, and THEN LATER cover hooks etc. The order was completely intentional. # CORE LIBRARY 

  1. Basics
    * How to create an API with createApi
    * How to do the same thing by hand
    * Explain that the following are the "core" plugins, used to get the basic functionality:
     './plugins/memory.js';
     './plugins/mysql.js';
     './plugins/http.js';
     './plugins/validation.js';
     './plugins/positioning.js';
     './plugins/versioning.js'; <--- I don't think this should be core NOT should be handled by createApi.
     './plugins/timestamps.js';

    * What a resource file normally looks like
    * How to integrate the code with Express
      - Starting from a "fresh off template" express file, placing the right commands
      - Explaining which middleware you will need in Express
      - Encourage structoring the API where each file is in the right directory
    * No refs at all here yet. Don't even mention them
    * How it's possible to use both memory or mysql totally interchangably

  2. Relations
   * Example of two resources (following the same best practices as above)
   * Explain resouce 1 has resource2Id, and does lookup since it has refs etc.
   * Explain what the returned data looks like (JSON:API)
   * Explain the ability to use api.resources
   * Add another resource, this time 1:N with the first resource, ref, etc
   * Explain what the returned data looks like (JSON:API)
   * Get into the nitti gritty of fields, etc.
   * Explain all of the options. Cover ALL cases
   * Add another resource, with records in 
   * Throughout the guide, explain that the data is in JSON:API format. DO NOT mention the plugin to simplify
   
   3. Querying
   * Basics: defining fileds as "searchable"
   * Searching for 

   4. Validation
   * How validation works with the schema
   * Understanding the schema ojbect
   * How validation works 
   
   5. Positioning
   * How positioning works, and why it's invaluable
   * Full tutorial that shows how positioning works 

   6. Hooks. Declare resource-wide hooks, and api-wide hooks, complete life-cycle

   7. API usage
   * How to use the module programmatically. Step by step guide, covering everything





● COMPLETE PLUGIN & DOCUMENTATION STRUCTURE

  PLUGIN DIRECTORY STRUCTURE:

  plugins/core/

  - memory.js - In-memory storage using AlaSQL
  - mysql.js - MySQL/MariaDB storage
  - sql-adapters/
    - alasql-adapter.js - AlaSQL database implementation
    - mysql-adapter.js - MySQL database implementation
    - sql-generic.js - Shared SQL CRUD operations, query building, joins
  - http.js - REST API endpoints with Express/Fastify integration
  - validation.js - Schema-based validation for all CRUD operations
  - positioning.js - Manages item ordering with position field and reordering
  - timestamps.js - Automatically adds createdAt/updatedAt fields

  plugins/core-extra/

  - versioning.js - API versioning with backward compatibility support
  - views.js - Custom views/projections of resources with field filtering
  - migration-plugin.js - Database schema migrations and version management
  - audit-log.js - Tracks all changes with who/what/when information
  - logging.js - Request/response logging with configurable levels
  - computed.js - Virtual fields calculated at query time
  - jwt.js - JWT token authentication and verification
  - authorization.js - Role-based access control with permissions
  - cors.js - Cross-origin resource sharing configuration
  - csrf.js - Cross-site request forgery protection
  - security.js - Security headers (CSP, HSTS, etc.)
  - query-limits.js - Prevents expensive queries with limits/pagination

  plugins/protocols/

  - schema-export/ - Exports API schema in OpenAPI/JSON Schema formats
  - graphql/ - GraphQL API with auto-generated schema from resources
  - grpc/ - gRPC service with protocol buffer generation
  - websocket/ - Real-time updates and live queries via WebSocket
  - simplified-records.js - Strips JSON:API wrapper for simple JSON responses

  plugins/infrastructure/

  - cache.js - Response caching with configurable TTL
  - config.js - Centralized configuration management
  - context.js - Request context propagation through hooks
  - interceptors.js - Request/response transformation pipeline
  - tracing.js - Distributed tracing with OpenTelemetry
  - health.js - Health check endpoints for monitoring
  - service-discovery/ - Service registry and dynamic routing for microservices
  - api-gateway.js - Rate limiting, routing, and gateway features
  - cli.js - Command-line tools for API management

  plugins/enterprise/

  - architecture-enforcement.js - Enforces architectural rules and patterns
  - bounded-context.js - Domain-driven design bounded contexts
  - cqrs.js - Command Query Responsibility Segregation pattern
  - ddd.js - Domain-driven design patterns and aggregates
  - dependency-graph.js - Visualizes resource dependencies
  - microservices.js - Microservice communication patterns
  - queue.js - Async job processing with queues
  - scheduler.js - Cron-like scheduled task execution

  TO BE DELETED:

  - plugins/adapters/ directory (contents moved to core/sql-adapters/)
  - plugins/openapi.js (duplicate of schema-export functionality)
  - plugins/advanced/ directory (contents reorganized into other categories)

  DOCUMENTATION STRUCTURE:

  docs/

  1. GUIDE.md - Table of Contents only
  2. 1.CORE_AND_PLUGINS-CORE.md
  CORE LIBRARY

    a. Basics
        - How to create an API with createApi
      - How to do the same thing by hand
      - Explain that the following are the "core" plugins, used to get the basic functionality:
            - './plugins/memory.js';
        - './plugins/mysql.js';
        - './plugins/http.js';
        - './plugins/validation.js';
        - './plugins/positioning.js';
        - './plugins/timestamps.js';
      - What a resource file normally looks like
      - How to integrate the code with Express
            - Starting from a "fresh off template" express file, placing the right commands
        - Explaining which middleware you will need in Express
        - Encourage structuring the API where each file is in the right directory
      - No refs at all here yet. Don't even mention them
      - How it's possible to use both memory or mysql totally interchangeably
    b. Relations
        - Example of two resources (following the same best practices as above)
      - Explain resource 1 has resource2Id, and does lookup since it has refs etc.
      - Explain what the returned data looks like (JSON:API)
      - Explain the ability to use api.resources
      - Add another resource, this time 1:N with the first resource, ref, etc
      - Explain what the returned data looks like (JSON:API)
      - Get into the nitty gritty of fields, etc.
      - Explain all of the options. Cover ALL cases
      - Add another resource, with records in
      - Throughout the guide, explain that the data is in JSON:API format. DO NOT mention the plugin to simplify
    c. Querying
        - Basics: defining fields as "searchable"
      - Searching for [content to be completed]
    d. Validation
        - How validation works with the schema
      - Understanding the schema object
      - How validation works
    e. Positioning
        - How positioning works, and why it's invaluable
      - Full tutorial that shows how positioning works
    f. Hooks
        - Declare resource-wide hooks, and api-wide hooks, complete life-cycle
    g. API usage
        - How to use the module programmatically. Step by step guide, covering everything
  3. 2.PLUGINS-CORE-EXTRA.md - Documentation for each core-extra plugin
  4. 3.PLUGINS-PROTOCOLS.md - API protocols and formats
  5. 4.PLUGINS-INFRASTRUCTURE.md - System-level plugins
  6. 5.PLUGINS-ENTERPRISE.md - Enterprise patterns
  7. API.md - Complete API reference
  8. EXAMPLES.md - Example configurations and use cases

  TESTING STRUCTURE:

  {
    "scripts": {
      "test": "npm run test:core",
      "test:core": "node tests/test-runner.js --group=core",
      "test:core-extra": "node tests/test-runner.js --group=core-extra",
      "test:protocols": "node tests/test-runner.js --group=protocols",
      "test:infrastructure": "node tests/test-runner.js --group=infrastructure",
      "test:enterprise": "node tests/test-runner.js --group=enterprise",
      "test:mysql": "DB_TYPE=mysql npm run test:core",
      "test:all": "npm run test:core && npm run test:core-extra && npm run test:protocols && npm run test:infrastructure && npm run test:enterprise"
    }
  }

  IMPORT EXAMPLES:

  // Core imports
  import { MemoryPlugin } from 'json-rest-api/plugins/core/memory.js'
  import { MySQLPlugin } from 'json-rest-api/plugins/core/mysql.js'
  import { HTTPPlugin } from 'json-rest-api/plugins/core/http.js'

  // Core-extra imports
  import { CORSPlugin } from 'json-rest-api/plugins/core-extra/cors.js'
  import { JWTPlugin } from 'json-rest-api/plugins/core-extra/jwt.js'

  // Protocol imports
  import { GraphQLPlugin } from 'json-rest-api/plugins/protocols/graphql/index.js'
  import { SimplifiedRecordsPlugin } from 'json-rest-api/plugins/protocols/simplified-records.js'

  // Infrastructure imports
  import { CachePlugin } from 'json-rest-api/plugins/infrastructure/cache.js'
  import { HealthPlugin } from 'json-rest-api/plugins/infrastructure/health.js'

  // Enterprise imports
  import { QueuePlugin } from 'json-rest-api/plugins/enterprise/queue.js'
  import { CQRSPlugin } from 'json-rest-api/plugins/enterprise/cqrs.js'


