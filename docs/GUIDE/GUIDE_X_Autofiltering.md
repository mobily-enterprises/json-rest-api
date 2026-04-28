# Autofiltering

The `AutoFilterPlugin` provides declarative dataset scoping for `json-rest-api`.

It does one job:

- resolve scope values from request/runtime context
- apply those values as automatic filters
- stamp scoped fields on create
- preserve scoped fields on replace
- reject inconsistent scoped-field updates

It does **not** define authentication, roles, or permissions.

## Overview

Autofiltering is useful whenever a resource should be constrained by one or more persisted fields:

- `workspace_id`
- `user_id`
- `workspace_id + user_id`
- any other application-defined scope field

The plugin is generic. It does not assume:

- `context.auth`
- `authenticated`
- `admin`
- JWTs
- sessions

Your application decides where scope values come from. The plugin only consumes configured resolver functions.

## Installation

```js
import { Api } from 'hooked-api'
import {
  RestApiPlugin,
  RestApiKnexPlugin,
  AutoFilterPlugin
} from 'json-rest-api'

const api = new Api({ name: 'scoped-api' })

await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex })

await api.use(AutoFilterPlugin, {
  resolvers: {
    workspace: ({ context }) => context.session?.workspaceId,
    user: ({ context }) => context.subject?.id,
  },

  presets: {
    public: { filters: [] },

    workspace: {
      filters: [
        { field: 'workspace_id', resolver: 'workspace' }
      ]
    },

    user: {
      filters: [
        { field: 'user_id', resolver: 'user' }
      ]
    },

    workspace_user: {
      filters: [
        { field: 'workspace_id', resolver: 'workspace' },
        { field: 'user_id', resolver: 'user' }
      ]
    }
  }
})
```

## Resource Configuration

Apply a preset by name:

```js
await api.addResource('projects', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    workspace_id: { type: 'string', required: true },
    user_id: { type: 'number', required: true }
  },
  autofilter: 'workspace_user'
})
```

Use a preset with extra filters:

```js
await api.addResource('documents', {
  schema: {
    id: { type: 'id' },
    workspace_id: { type: 'string', required: true },
    user_id: { type: 'number', required: true },
    locale: { type: 'string', required: true }
  },
  autofilter: {
    preset: 'workspace_user',
    filters: [
      {
        field: 'locale',
        resolve: ({ context }) => context.requestState?.locale
      }
    ]
  }
})
```

Use inline filters with no preset:

```js
await api.addResource('reports', {
  schema: {
    id: { type: 'id' },
    account_id: { type: 'string', required: true }
  },
  autofilter: {
    filters: [
      {
        field: 'account_id',
        resolve: ({ context }) => context.scopeValues?.accountId
      }
    ]
  }
})
```

Declare a public resource explicitly:

```js
await api.addResource('system_settings', {
  schema: {
    id: { type: 'id' },
    key: { type: 'string', required: true },
    value: { type: 'string', required: true }
  },
  autofilter: 'public'
})
```

If a resource has no `autofilter` setting, the plugin does nothing for that resource.

## Runtime Behavior

### Query Scoping

Collection queries automatically receive all configured filters.

For a `workspace_user` resource:

```js
await api.resources.projects.query(
  { simplified: false },
  {
    session: { workspaceId: 'acme' },
    subject: { id: 101 }
  }
)
```

behaves like:

```sql
SELECT * FROM projects
WHERE workspace_id = 'acme'
  AND user_id = 101
```

### Single-Record Scoping

`get`, `put`, `patch`, and `delete` operate on the already-scoped dataset.

If a record is outside the current scope, it behaves as not found.

### Create-Time Stamping

On `POST`, scoped fields are injected automatically when missing.

Example:

```js
await api.resources.projects.post({
  inputRecord: {
    data: {
      type: 'projects',
      attributes: {
        name: 'Roadmap'
      }
    }
  },
  simplified: false
}, {
  session: { workspaceId: 'acme' },
  subject: { id: 101 }
})
```

Stored attributes:

```js
{
  name: 'Roadmap',
  workspace_id: 'acme',
  user_id: 101
}
```

### Replace/Update Consistency

On `PUT`:

- missing scoped fields are injected so replacement stays consistent
- mismatched scoped fields are rejected

On `PATCH`:

- omitted scoped fields stay omitted
- explicitly provided mismatched scoped fields are rejected

## Relationship-Aware Scoping

Autofiltering also affects relationship validation because scoped single-record lookups are used when checking related resources.

So this will fail if the referenced project is outside scope:

```js
await api.resources.tasks.post({
  inputRecord: {
    data: {
      type: 'tasks',
      attributes: { title: 'Cross-scope task' },
      relationships: {
        project: {
          data: { type: 'projects', id: '123' }
        }
      }
    }
  },
  simplified: false
}, {
  scopeValues: {
    workspaceId: 'workspace-a',
    userId: 101
  }
})
```

## Missing Scope Values

By default, each filter is required.

If a resolver returns `undefined`, the plugin throws:

```text
Missing autofilter value for resolver 'workspace' on resource 'projects'
```

To make a filter optional, set `required: false`:

```js
{
  field: 'workspace_id',
  resolver: 'workspace',
  required: false
}
```

When `required: false` and the resolver returns `undefined`, that filter is skipped.

## BelongsTo Foreign Keys

If the scoped field is a `belongsTo` foreign key with an alias, the plugin works through the JSON:API relationship shape.

Example:

```js
user_id: {
  type: 'number',
  belongsTo: 'users',
  as: 'user'
}
```

The plugin will stamp or validate:

```js
data.relationships.user.data.id
```

instead of treating it as a direct client-owned attribute.

## Storage Mapping

Autofiltering uses the compiled storage adapter automatically.

So this works correctly:

```js
workspace_id: {
  type: 'string',
  storage: { column: 'workspace_key' }
}
```

The plugin scopes using the logical field name, while Knex filtering uses the mapped storage column.

## Introspection Helpers

The plugin exposes light runtime inspection helpers:

```js
api.autofilter.getConfig()
api.autofilter.getScopeConfig('projects')
```

Example:

```js
api.autofilter.getScopeConfig('projects')
// {
//   preset: 'workspace_user',
//   filters: [
//     { field: 'workspace_id', resolver: 'workspace', required: true },
//     { field: 'user_id', resolver: 'user', required: true }
//   ]
// }
```

## Design Boundary

`AutoFilterPlugin` is intentionally narrower than an auth plugin.

It owns:

- dataset scoping
- scoped-field stamping
- scoped-field consistency

It does **not** own:

- authentication meaning
- role policy
- admission checks
- permissions like `authenticated` or `owns`

That logic belongs in higher layers or custom `checkPermissions` hooks.
