# Row Policies

`RowPolicyPlugin` is the server-side visibility seam for resources whose readable rows depend on more than a fixed equality filter.

Use it when the database must decide which rows are visible **before** it sorts, counts, or paginates them. Typical examples are:

- a user may see records assigned directly to them or to one of their teams
- a manager may see an organisation unit and all of its descendants
- access is granted through a membership or permission table
- several domain packages contribute different ways to make a row visible

A row policy is not a client filter and is not post-processing. It changes the SQL query that selects the resource.

## The problem it solves

This is unsafe and paginates the wrong dataset:

```js
const page = await api.resources.organisation_units.query({
  queryParams: { page: { number: 1, size: 20 } },
  simplified: false
}, context)

page.data = page.data.filter((unit) => canSeeUnit(context, unit))
```

The database chose 20 rows before `canSeeUnit()` ran. If only two of those rows are visible, the caller receives a two-row page even when later matching rows exist. Counts, cursors, relationship data, and included children can also disagree with the filtered result.

With a row policy, visibility is part of the database query:

```js
await api.use(RowPolicyPlugin, {
  policies: {
    organisationUnitsVisible: organisationUnitVisibilityPolicy
  }
})

await api.addResource('organisation_units', {
  schema: organisationUnitSchema,
  rowPolicy: 'organisationUnitsVisible'
})
```

The effective order is:

```text
request context
      │
      ▼
client filters + mandatory row policy
      │
      ▼
sorting
      │
      ▼
pagination / count
      │
      ▼
JSON:API response
```

The page size and count now describe the visible dataset.

## Choosing the right mechanism

| Requirement | Use |
| --- | --- |
| The caller asks to filter by a public search field | Normal `queryParams.filters` / `searchSchema` |
| Every row must match one or more context-derived persisted fields, and those fields should be stamped on writes | [`AutoFilterPlugin`](GUIDE_X_Autofiltering.md) |
| Visibility needs `OR`, `EXISTS`, joins, hierarchy traversal, or domain-composed SQL | `RowPolicyPlugin` |
| The caller may perform an action such as update, approve, or delete | Permission hooks, usually in addition to a row policy |
| A response-only field must be calculated | Computed fields or query projections |

`AutoFilterPlugin` and `RowPolicyPlugin` can be installed together. Their predicates are combined with the other query filters. Autofilter remains the better choice for simple workspace ownership because it also stamps and validates writes. A row policy is deliberately read-oriented and does not stamp `POST` data.

## Installation

Install the REST plugin, one supported Knex storage plugin, and then the row-policy plugin. Install `RowPolicyPlugin` before adding resources that declare `rowPolicy`.

### Normal table storage

```js
import { Api } from 'hooked-api'
import {
  RestApiPlugin,
  RestApiKnexPlugin,
  RowPolicyPlugin
} from 'json-rest-api'

const api = new Api({ name: 'application-api' })

await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex })
await api.use(RowPolicyPlugin, {
  policies: {
    workspaceMember: ({ query, context, column, value }) => {
      const workspaceId = context.session?.workspaceId
      if (!workspaceId) return false

      query.where(
        column('workspace_id'),
        value('workspace_id', workspaceId)
      )
      return true
    }
  }
})
```

### AnyAPI canonical storage

Use the same plugin and logical field names:

```js
await api.use(RestApiPlugin)
await api.use(RestApiAnyapiKnexPlugin, {
  knex,
  tenantId: 'application'
})
await api.use(RowPolicyPlugin, {
  policies: {
    workspaceMember: ({ query, context, column, value }) => {
      const workspaceId = context.session?.workspaceId
      if (!workspaceId) return false

      query.where(
        column('workspace_id'),
        value('workspace_id', workspaceId)
      )
      return true
    }
  }
})
```

`column()` and `value()` translate logical schema fields and values through the active storage adapter. The example therefore works with both normal tables and AnyAPI canonical slots.

## Resource configuration

### Registered policy

Registered policies are preferred for shared or package-owned behavior:

```js
await api.addResource('documents', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    workspace_id: { type: 'string', required: true }
  },
  rowPolicy: 'workspaceMember',
  tableName: 'documents'
})
```

The string must match a function in `RowPolicyPlugin`'s `policies` option. Unknown names fail while the resource is being added.

### Inline policy

An inline function is supported for a policy that belongs to one resource:

```js
await api.addResource('personal_notes', {
  schema: {
    id: { type: 'id' },
    body: { type: 'string', required: true },
    owner_id: { type: 'string', required: true }
  },
  rowPolicy: ({ query, context, column, value }) => {
    const subjectId = context.subject?.id
    if (!subjectId) return false

    query.where(column('owner_id'), value('owner_id', subjectId))
    return true
  }
})
```

Omitting `rowPolicy`, or setting it to `false`, leaves that resource unrestricted by this plugin.

## The policy contract

A policy receives one object:

| Property | Meaning |
| --- | --- |
| `query` | The active query builder. Add the mandatory visibility predicate to this builder. |
| `context` | The original operation context, including application-owned identity/session values. |
| `scopeName` | The resource currently being selected. For includes, this is the child resource. |
| `tableName` | The table name or active query alias for this selection. |
| `queryPurpose` | Why the selection is running; see the table below. |
| `db` | The active Knex connection or transaction. Use it to build subqueries. |
| `isAnyApi` | `true` when the AnyAPI storage path is active. |
| `column(field, options?)` | Translate and qualify a logical field. |
| `value(field, rawValue, options?)` | Translate a value for a logical field. |
| `storageAdapter` | The current resource's storage adapter. Prefer `column()` and `value()` for normal policy code. |
| `api` | The API instance. This is mainly useful for AnyAPI descriptor lookup in storage-specific subqueries. |

`column()` accepts an optional object:

```js
column('owner_id')
column('id', { scopeName: 'users', alias: 'visible_users' })
column('status', { alias: null }) // translated but deliberately unqualified
```

`value()` accepts the same `scopeName` option:

```js
value('owner_id', context.subject.id)
value('status', 'active', { scopeName: 'projects' })
```

### Required return value

Every invocation must make an explicit decision:

- return `true` after applying the intended predicate
- return `false` to deny all rows
- throw when the request context itself is invalid and the request should fail

Any other return value is a `REST_API_ROW_POLICY_CONTRACT` error and the query does not run. This makes a missing `return`, an unfinished branch, or a mistakenly omitted decision fail closed.

```js
function assignedTeamPolicy ({ query, context, column, value }) {
  const teamIds = context.subject?.teamIds

  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    return false
  }

  query.whereIn(
    column('team_id'),
    teamIds.map((id) => value('team_id', id))
  )

  return true
}
```

Do not return the Knex builder. Knex builders are thenable; returning one from an async policy can execute it accidentally. Mutate `query`, then return the boolean decision.

### Group `OR` branches

Client filters, autofilters, and row policies share one query. Group a policy that contains `OR` so it cannot change the meaning of earlier predicates:

```js
function documentVisibilityPolicy ({ query, context, column, value }) {
  const subjectId = context.subject?.id
  const teamIds = context.subject?.teamIds || []
  if (!subjectId) return false

  query.where(function documentVisibilityGroup () {
    this.where(column('owner_id'), value('owner_id', subjectId))

    if (teamIds.length > 0) {
      this.orWhereIn(
        column('team_id'),
        teamIds.map((id) => value('team_id', id))
      )
    }
  })

  return true
}
```

Do not add an ungrouped top-level `orWhere()` from a mandatory policy.

## Query purposes and lifecycle coverage

Policies are reused for the resource selections that define externally visible data:

| `queryPurpose` | Selection |
| --- | --- |
| `collection` | Top-level collection query, before sorting and pagination. On AnyAPI this filtered builder is also cloned for the matching count. |
| `count` | A separate count query, including native offset-pagination counts and standalone count helpers. |
| `single` | Minimal lookup used by `get`, and by existing-record preflights for `put`, `patch`, and `delete`. |
| `include` | A target resource loaded into JSON:API `included` data. |
| `relationship-identifiers` | Child identifiers attached to a relationship, including has-many and AnyAPI many-to-many links. |
| `relationship-validation` | A target record referenced by a write payload. |
| `relationship-parent` | The parent of a relationship route such as `getRelated`. |
| `unspecified` | A custom call to the lower-level query-filtering seam did not provide a purpose. |

The important invariant is not the label. It is that the predicate is attached before any limit, offset, cursor boundary, per-parent include limit, or count is evaluated.

Treat `queryPurpose` as diagnostic context, not as permission to weaken a policy. A policy should normally add the same visibility predicate for every purpose. If an advanced policy uses a purpose-specific SQL shape, each branch must enforce equivalent visibility and must be tested independently; never skip a predicate for counts, includes, identifiers, or relationship validation.

### Collections and counts

Offset pagination applies the same mandatory policy to the data query and its count. This remains true when the caller supplies no `filters` object.

Cursor predicates are added after the row policy, so the cursor moves through visible rows rather than through a page that will later be filtered.

### Single records and writes

An existing row outside the policy behaves as not found for `get`, `patch`, and `delete`. Existing-record `put` authorization uses the same scoped minimal lookup.

The policy does not stamp or validate new `POST` attributes. Use schema validation, write hooks, and `AutoFilterPlugin` for write ownership. A row policy also does not replace action permissions: being able to see a record does not necessarily mean the caller may edit or delete it.

### Includes and relationship data

The target resource's policy is used when the framework loads:

- included belongs-to, has-one, has-many, many-to-many, and polymorphic targets
- has-many and many-to-many relationship identifiers
- nested includes
- per-parent windowed include queries
- a relationship target during write validation

Filtering the parent resource does not automatically define child visibility. Put `rowPolicy` on every child resource that has its own visibility rule.

Relationship routes preserve the caller's trusted context when they invoke the target resource. Filters, sorting, and pagination supplied for a related-resource request are applied to that target query; they are deliberately withheld from the preliminary parent-visibility lookup. This keeps a target-only filter from being misinterpreted as a parent field while still enforcing the parent's policy.

## Hierarchies and recursive CTEs

A recursive common table expression (recursive CTE) is a temporary query result that can refer to itself. For a tree, it starts with one or more roots and repeatedly follows `parent_id` until no more children are found.

Conceptually:

```text
manager's unit
    ├── child
    │     └── grandchild
    └── child
```

The CTE produces the set `{ manager's unit, child, grandchild, child }`. The outer resource query then keeps rows whose id is in that set. The recursion happens in SQL before pagination; it is not recursive JavaScript and it does not load the whole tree into memory.

### Normal-table Knex example

```js
function organisationUnitVisibilityPolicy ({
  query,
  context,
  db,
  column,
  value,
  isAnyApi,
  api,
  storageAdapter
}) {
  const rootUnitId = context.subject?.managedOrganisationUnitId
  if (!rootUnitId) return false

  if (isAnyApi) {
    return applyAnyApiOrganisationUnitPolicy({
      query,
      context,
      db,
      column,
      value,
      api,
      storageAdapter
    })
  }

  const visibleUnitIds = db
    .withRecursive('visible_units', ['unit_id'], (cte) => {
      cte
        .select('id as unit_id')
        .from('organisation_units')
        .where('id', value('id', rootUnitId))
        .unionAll(function descendantUnits () {
          this
            .select('child.id as unit_id')
            .from('organisation_units as child')
            .join('visible_units as visible', 'child.parent_id', 'visible.unit_id')
        })
    })
    .select('unit_id')
    .from('visible_units')

  query.whereIn(column('id'), visibleUnitIds)
  return true
}
```

This example assumes an acyclic organisation-unit tree. Enforce the tree invariant in writes and add the indexes described below.

### AnyAPI hierarchy branch

Simple policies need no backend branch. A raw recursive CTE does, because AnyAPI stores logical fields in canonical slots and multiple resources share the canonical table.

The policy can resolve the resource descriptor and constrain every CTE leg by tenant and resource:

```js
async function applyAnyApiOrganisationUnitPolicy ({
  query,
  context,
  db,
  column,
  value,
  api,
  storageAdapter
}) {
  const rootUnitId = context.subject?.managedOrganisationUnitId
  if (!rootUnitId) return false

  const descriptor = await api.anyapi.registry.getDescriptor(
    api.anyapi.tenantId,
    'organisation_units'
  )
  if (!descriptor) return false

  const table = descriptor.canonical.tableName
  const tenantColumn = descriptor.canonical.tenantColumn
  const resourceColumn = descriptor.canonical.resourceColumn
  const idColumn = storageAdapter.translateColumn('id')
  const parentColumn = storageAdapter.translateColumn('parent_id')

  const visibleUnitIds = db
    .withRecursive('visible_units', ['unit_id'], (cte) => {
      cte
        .select(`root.${idColumn} as unit_id`)
        .from({ root: table })
        .where(`root.${tenantColumn}`, descriptor.tenant)
        .where(`root.${resourceColumn}`, descriptor.resource)
        .where(`root.${idColumn}`, value('id', rootUnitId))
        .unionAll(function descendantUnits () {
          this
            .select(`child.${idColumn} as unit_id`)
            .from({ child: table })
            .join('visible_units as visible', `child.${parentColumn}`, 'visible.unit_id')
            .where(`child.${tenantColumn}`, descriptor.tenant)
            .where(`child.${resourceColumn}`, descriptor.resource)
        })
    })
    .select('unit_id')
    .from('visible_units')

  query.whereIn(column('id'), visibleUnitIds)
  return true
}
```

Pass `api` and `storageAdapter` from the outer policy call if you split the implementation into helpers. Do not reuse normal-table names or assume a particular AnyAPI slot. Resolve AnyAPI's physical table and slot names from its descriptor and storage adapter at query construction time.

For very large or frequently queried trees, a closure table can be a better model. A closure table stores ancestor/descendant pairs explicitly, turning traversal into an indexed `EXISTS` or join at the cost of more complex writes.

Recommended indexes for an adjacency-list tree are:

- the resource primary key
- `parent_id`
- every membership or permission-table foreign key used by the policy

Inspect the query plan on the production database; recursive queries that are fast on a small fixture can still need database-specific tuning.

## Composing visibility without package cycles

`RowPolicyPlugin` deliberately owns query timing and logical-field translation. It does not know which domain package grants access.

When several packages can grant visibility, the package that owns the resource can own a small contributor registry:

```js
const contributors = new Map()

export function registerOrganisationUnitVisibility ({ id, apply }) {
  if (!id || typeof apply !== 'function') {
    throw new Error('Visibility contributors require an id and apply function')
  }
  if (contributors.has(id)) {
    throw new Error(`Duplicate organisation-unit visibility contributor '${id}'`)
  }
  contributors.set(id, apply)
}

export function organisationUnitVisibilityPolicy (policyContext) {
  if (contributors.size === 0) return false

  policyContext.query.where(function visibilityContributors () {
    for (const [id, apply] of contributors) {
      this.orWhere(function oneVisibilityGrant () {
        const result = apply({ ...policyContext, query: this })

        if (result === false) {
          this.whereRaw('1 = 0')
        } else if (result !== true) {
          throw new Error(
            `Visibility contributor '${id}' must return true or false`
          )
        }
      })
    }
  })

  return true
}
```

Each contributor synchronously adds one grouped SQL grant and returns `true`, or returns `false` when it grants nothing for this request. A `false` contributor becomes an always-false branch; an omitted return fails the request. Do not return a promise from a Knex grouping callback.

The package ownership is then:

```text
organisation-units package
  owns the resource
  owns the contributor registry
  sets rowPolicy: 'organisationUnitsVisible'

safety package
  depends on organisation-units
  registers the safety-manager descendant grant

organisation-units package does not import safety
```

For example, the safety package can register at application boot:

```js
registerOrganisationUnitVisibility({
  id: 'safety-manager-descendants',
  apply: ({ query, context, db, column }) => {
    const subjectId = context.subject?.id
    if (!subjectId) return false

    query.whereExists(function safetyManagerGrant () {
      this
        .select(db.raw('1'))
        .from('safety_manager_visible_units as visible')
        .where('visible.user_id', subjectId)
        .whereColumn('visible.organisation_unit_id', column('id'))
    })

    return true
  }
})
```

Here `safety_manager_visible_units` may be a normal table, a view, or a query backed by a recursive CTE. The important part is that the grant becomes SQL on the organisation-unit query before pagination.

This registry is an application/domain composition pattern, not a second filtering engine. Register contributors during boot, reject duplicate ids, and do not mutate the registry while requests are running.

## Inspection

The plugin exposes compiled configuration without exposing function source:

```js
api.rowPolicies.getConfig()
// { policies: ['workspaceMember', 'organisationUnitsVisible'] }

api.rowPolicies.getScopeConfig('organisation_units')
// { policy: 'organisationUnitsVisible', source: 'registry' }

api.rowPolicies.getScopeConfig('public_settings')
// null
```

Inline policies report `policy: '<inline>'` and `source: 'inline'`.

## Security rules

1. Derive identity and scope values from trusted context, not unverified filter/query parameters.
2. Return `false` or throw when required identity is missing. Never silently skip the predicate.
3. Group every policy-owned `OR` expression.
4. Use `column()` and `value()` for logical fields.
5. Constrain tenant and resource columns in every raw AnyAPI subquery or CTE leg.
6. Put policies on child resources too; a parent policy does not imply child visibility.
7. Keep action authorization in permission hooks. Row visibility alone is not permission to mutate.
8. Test allowed and denied rows in an interleaved order so post-pagination filtering cannot accidentally pass.
9. Test counts, subsequent pages, cursors, includes, relationship identifiers, and relationship writes.
10. Treat a policy error as a request failure. Do not catch it and retry without the policy.

## Testing recipe

A useful regression fixture inserts rows in this order:

```text
allowed 1
denied 1
allowed 2
denied 2
allowed 3
```

Then request page size 2 and assert:

- page 1 is `allowed 1`, `allowed 2`
- page 2 is `allowed 3`
- total is 3
- a cursor from page 1 reaches only `allowed 3`
- direct `get`, `patch`, and `delete` of `denied 1` behave as not found
- included children and relationship identifiers omit denied targets
- a relationship write cannot reference a denied target
- missing identity returns no rows or the documented context error
- the same suite passes with `RestApiKnexPlugin` and `RestApiAnyapiKnexPlugin`

Do not seed all allowed rows together and all denied rows together. That arrangement can hide the exact paginate-then-filter bug this feature is meant to prevent.

## Migration checklist

When replacing post-query filtering:

1. Identify the resource that owns the list query.
2. Move the visibility decision into a named row policy.
3. Keep the public resource/filter definition unchanged unless it truly needs a new client-facing filter.
4. Delete the in-memory filter only after pagination, count, include, and relationship tests pass.
5. Add the policy to dynamically loaded child resources with independent visibility rules.
6. Run the suite once with normal Knex storage and once with AnyAPI.
7. Inspect production query plans and add hierarchy/membership indexes.
8. Keep permission hooks for create/update/delete actions.

The end state is one resource-owned visibility contract, applied consistently by the storage layer before pagination.
