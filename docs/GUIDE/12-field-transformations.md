---
title: "Field transformations"
chapter: 12
chapter_label: "12"
---

# 12. Field transformations

Use setters to transform validated input before storage, getters to transform
selected read values, and computed fields to derive output from other fields.
Virtual fields accept temporary input without storing it. Hidden and normally
hidden declarations control which fields appear in output.

Computed fields are output-only. Supplying a computed field in POST, PUT or
PATCH attributes fails validation with `FIELD_NOT_ALLOWED`; it is not silently
discarded. The failed write rolls back. Virtual fields are the mechanism for
accepting temporary input that should not be stored.

For a derived SQL value that must support filtering, sorting or cursors, use
[query projections](15-query-projections.md). JavaScript computations happen
after fetching and cannot supply SQL ordering.

The examples below form one runnable configuration. Insert the JavaScript blocks
in order into the [starting script](03-running-example.md) before starting
the server, on a fresh database.

## Declare transformations

```javascript
await api.addResource('categories', {
  schema: { name: { type: 'string', required: true } },
  relationships: { products: { type: 'hasMany', target: 'products', foreignKey: 'category_id' } }
})
await api.addResource('products', {
  schema: {
    name: {
      type: 'string', required: true,
      setter: value => value.trim(),
      getter: async value => value.toUpperCase()
    },
    code: {
      type: 'string', required: true,
      setter: value => value.trim(),
      runGetterAfter: ['name'],
      getter: (value, { attributes }) => `${value}:${attributes.name}`
    },
    price: { type: 'number', required: true, setter: value => Math.round(value * 100) / 100 },
    cost: { type: 'number', required: true, normallyHidden: true },
    privateNote: { type: 'string', hidden: true },
    previewLabel: { type: 'string', virtual: true },
    category_id: { type: 'id', belongsTo: 'categories', as: 'category', nullable: true },
    marginPercent: {
      type: 'number', computed: true, dependencies: ['profit', 'price'],
      compute: ({ attributes }) => attributes.price === 0 ? 0 : attributes.profit / attributes.price * 100
    },
    profit: {
      type: 'number', computed: true, normallyHidden: true, dependencies: ['price', 'cost'],
      compute: ({ attributes }) => attributes.price - attributes.cost
    }
  }
})
await api.resources.categories.createKnexTable()
await api.resources.products.createKnexTable()
```

Setters store the trimmed name/code and rounded price. The asynchronous name
getter is awaited; the code getter runs after it, using the uppercase name.
The declaration order deliberately places `marginPercent` before its dependency
`profit`; dependency ordering ensures profit is computed first.

`hidden: true` means a field is never emitted, even when requested.
`normallyHidden: true` omits it from default output but permits explicit selection.
Neither declaration prevents its use as an explicit computation dependency.
Review what a derived value reveals about its inputs.

## Create and refetch

```javascript
const category = await api.resources.categories.post({ inputRecord: { name: 'Equipment' } })
const created = await api.resources.products.post({
  inputRecord: {
    name: '  Widget  ', code: '  W01  ', price: 20, cost: 5,
    privateNote: 'Internal only', previewLabel: 'Preview', category: category.id
  }
})
const fetched = await api.resources.products.get({ id: created.id })
console.log('Created:', created)
console.log('Fetched:', fetched)
```

Both responses have name `WIDGET`, code `W01:WIDGET`, and marginPercent `75`.
They omit cost, profit and privateNote. The full write response can include the
provided virtual previewLabel; a later read does not recover it from storage.
Getters transform read output without overwriting the stored name or code.

## Sparse fields and hidden dependencies

```javascript
const marginOnly = await api.resources.products.get({
  id: created.id,
  queryParams: { fields: { products: 'marginPercent' } }
})
const selectedCost = await api.resources.products.get({
  id: created.id,
  queryParams: { fields: { products: 'cost,privateNote' } }
})
console.log('Margin only:', marginOnly)
console.log('Selected cost:', selectedCost)
```

The first result contains ID and marginPercent only. Price, cost and profit are
available internally for computation without leaking into the selected output.
The second exposes cost `5` but still omits privateNote. Computed fields are
read-time output fields; do not submit them as stored attributes.

## Included resources and response modes

```javascript
const included = await api.resources.categories.get({
  id: category.id,
  queryParams: {
    include: ['products'],
    fields: { categories: 'name,products', products: 'code,marginPercent' }
  }
})
const minimal = await api.resources.products.patch({
  id: created.id, inputRecord: { price: 25 }, returning: 'minimal'
})
const afterPriceChange = await api.resources.products.get({
  id: created.id, queryParams: { fields: { products: 'marginPercent' } }
})
console.log('Included product:', included.products[0])
console.log('Minimal write:', minimal)
console.log('Updated margin:', afterPriceChange.marginPercent)
```

The included product receives the same getters and computations as a primary
record, with ID, code and marginPercent. The minimal PATCH returns only type/ID;
it does not run full response enrichment. The later read computes marginPercent
`80` from the changed price and existing cost. Sparse selection determines which
getters/computed fields are needed; they do not all run on every request.

## Validate virtual input with a supported hook

```javascript
import { RestApiValidationError } from 'json-rest-api'

await api.customize({ hooks: {
  afterSchemaValidatePost: {
    functionName: 'validate-product-preview-label',
    handler: ({ scopeName, context }) => {
      if (scopeName !== 'products') return
      const label = context.inputRecord.data.attributes.previewLabel
      if (label !== undefined && label.length > 20) {
        throw new RestApiValidationError('Preview label is too long', { fields: ['previewLabel'] })
      }
    }
  }
} })
```

This illustrates hook registration and access to the internal JSON:API input.
For field validation, prefer declaring schema constraints such as `max: 20`;
use a typed validation error when a custom validation hook is necessary. A real
hook may depend on several inputs or request context. See the
[hook guide](13-hooks-and-lifecycle.md) for lifecycle stages.
Virtual input is not universally available to every hook or unrelated resource.

## Dependency contract

Declare local field names in `runSetterAfter`, `runGetterAfter` or computed
`dependencies`. Each declaration must be an array of nonempty names. The
compiler rejects missing fields, cycles and dependencies unavailable at that
stage; repeated names are evaluated once. Registration and canonical
`addKnexFields` compile the orders. Reads select the required part of that
graph without compiling or sorting it again.

| Stage | Available dependencies |
| --- | --- |
| Setters | Validated input attributes, including virtual input and fields without setters. Earlier setters have already run. |
| Getters | Selected stored attributes, SQL projections and available virtual input. Earlier getters have already run. |
| Computed fields | Getter results, SQL projections, available virtual input and earlier computed results. |

Setters do not fetch missing PATCH attributes from storage. A dependency orders
processing; it does not make an optional input present. Getters cannot depend
on computed fields because computations run later. Logical `id` (or the
configured `idProperty`) can be declared as a read dependency; read it from the
callback's `id`, not `attributes`. Relationship aliases, belongs-to foreign
keys and polymorphic backing fields are linkage rather than callback attributes
and cannot be declared as read dependencies. Use the appropriate relationship
API when a computation needs related records.

```js
schema: {
  total: {
    type: 'number', computed: true, dependencies: ['subtotal'],
    compute: ({ attributes }) => attributes.subtotal * 1.1
  },
  subtotal: {
    type: 'number', computed: true, normallyHidden: true,
    dependencies: ['price', 'quantity'],
    compute: ({ attributes }) => attributes.price * attributes.quantity
  },
  price: { type: 'number', normallyHidden: true },
  quantity: { type: 'number', normallyHidden: true }
}
```

Selecting only `total` fetches `price` and `quantity`, computes `subtotal`, then
computes `total`. Only `total` appears in the attributes. This order is independent
of declaration order and fieldset order, and applies to included records too.
The `attributes` and `record` callback views both receive earlier computed results.
Declare every field a callback reads so sparse reads fetch the same inputs as
full reads.

The `enrichAttributes` hook runs after automatic computations. A value supplied
only by that later hook cannot serve as an automatic computation's prerequisite;
give the prerequisite its own `compute` callback or supply it before computation.

Explicit dependencies may use `hidden` or `normallyHidden` fields. Authors are
responsible for what the derived value reveals. Hidden fields never appear in
output; normally hidden fields appear only when selected. Unrelated computed
callbacks do not run merely because their definitions exist. Async callbacks
are awaited in order; a failed dependency stops subsequent callbacks and rejects
the operation under the documented error/transaction contract.

Virtual input is available only on the written resource's full response, before
its getters and computations. It is not copied onto included or unrelated
records. It remains absent on a later read unless a hook supplies it. Null and
undefined virtual input are not echoed. Selected virtual getters can declare
stored/projected dependencies; unused virtual input does not trigger getters.
Getter `originalValue` and `originalAttributes` reflect the available values
before getters, including that virtual input.


### Setter and getter context

Both callbacks receive the field value first and a context object second.
Their context objects differ:

| Callback | Context properties |
| --- | --- |
| Setter | `attributes`, `fieldName`, `originalValue`, `originalAttributes`, `scopeName`, `method`, `api`, `helpers`, `auth` |
| Getter | `id`, `attributes`, `fieldName`, `originalValue`, `originalAttributes`, `record`, `parentContext`, `scopeName`, `api`, `helpers`, `isMainResource` |

`attributes` contains the current transformation state. Earlier ordered setters
or getters have already modified it. The getter's `record` aliases these
attributes; it is not a full persisted record with ID and relationship state.
Read its ID from `id` and request context from `parentContext`.

A setter receives validated input, including available virtual fields. On PATCH,
omitted attributes are not fetched from storage to populate setter context.
Use `runSetterAfter` or `runGetterAfter` to declare dependencies at the relevant
stage, as described in the dependency contract below.


### Compute callback context

The callback receives `{ id, attributes, record, context, helpers, api }`.
`attributes` contains getter results and earlier computed results. `record` is
a copy of transformed attributes that also receives earlier computed results;
it does not contain an added `id`. Read the identifier from `id`.
`context` is the parent request context, not another copy of the attributes.
There is no separate top-level `scopeName` argument in this callback object.


## Storage and failure boundaries

Use serializers for storage representation and getters for response presentation.
Built-in object/array storage already serializes structured values; an extra
JSON.stringify/JSON.parse getter/setter pair can serialize twice. Custom serializers
must follow the [storage contract](33-migrating-to-v2.md).

Async setters/getters/computations are awaited. Declare dependencies instead of
relying on field declaration order, and keep remote work and database calls in
computed fields bounded: a collection can invoke a callback for many records.
Use the supplied transaction/context for related operations where appropriate.
Do not assume a setter has fetched the existing PATCH record.

Callback failures reject the operation. On a full write response, an enrichment
failure can cause the owned write transaction to roll back. Use the
[transaction outcome](20-transaction-outcomes.md) and original error cause when
handling failures; do not convert unexpected failures into successful null values.

For sensitive stored values, declare hidden output rather than relying on a
getter to mask them. Application encryption or password hashing requires an
actual implementation; a string prefix is not a hashing algorithm.
