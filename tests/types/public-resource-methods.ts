import type { ResourceCoreMethods } from '../../types/resource-methods.js'
import type { JsonApiDocument, JsonApiResource, ResourceIdentifier } from '../../types/representations.js'
interface Fields { name: string; revision: string }
interface Input { name: string }
declare const items: ResourceCoreMethods<Fields, Input, 'items'>
declare const jsonItems: ResourceCoreMethods<Fields, Input, 'items', 'jsonapi', 'minimal'>
interface AppContext { userId: string }
declare const context: AppContext

const plain = await items.get({ id: 1 })
await items.get({ id: 1n })
await items.patch({ id: 1n, data: { name: 'BigInt target' } })
const name: string | undefined = plain.name
const full: JsonApiDocument<JsonApiResource<Fields, 'items'>> = await items.patch({
  id: '1', format: 'jsonapi', returning: 'full', expectedVersion: 'revision',
  document: { data: { type: 'items', attributes: { name: 'Changed' } } }
})
const minimal: JsonApiDocument<ResourceIdentifier<'items'>> = await jsonItems.post({
  document: { data: { type: 'items', attributes: { name: 'New' } } }
})
const none: void = await items.put({ data: { id: '1', name: 'Replaced' }, returning: 'none' })
await jsonItems.patch({ document: { data: { type: 'items', id: '1', attributes: { name: 'Changed' } } } })
const plainDocument = await items.post({ document: {
  data: { type: 'items', attributes: { name: 'New' } },
  meta: { reason: 'Import' }, links: { self: '/items' }, jsonapi: { version: '1.1' }
} })
const documentName: string | undefined = plainDocument.name
const jsonPlain: JsonApiDocument<JsonApiResource<Fields, 'items'>> = await items.post({
  data: { name: 'New' }, format: 'jsonapi'
})
const configuredJson: JsonApiDocument<ResourceIdentifier<'items'>> = await jsonItems.post({ data: { name: 'New' } })
await items.put({ document: { data: { type: 'items', id: '1', attributes: { name: 'Replaced' } } } })
declare const dataFields: ResourceCoreMethods<{ data: string; document: string }>
await dataFields.post({ data: { data: 'An ordinary field', document: 'Another ordinary field' } })
await items.query({ queryParams: { fields: { items: 'name' }, include: [], sort: ['name'], page: { after: 'cursor', size: 10 } } })
await items.delete({ id: '1', expectedVersion: 'revision' }, context)
void [name, full, minimal, none, documentName, jsonPlain, configuredJson]

// @ts-expect-error A target is required either in params or in the input record.
await items.patch({ data: { name: 'Missing target' } })
// @ts-expect-error POST cannot require an existing revision.
await items.post({ data: { name: 'New' }, expectedVersion: 'revision' })
// @ts-expect-error A writable schema need not include its managed revision field.
await items.patch({ id: '1', data: { revision: 'forged' } })
// @ts-expect-error Both input keys are ambiguous even when passed through a variable.
await items.post({ ...{ data: { name: 'New' }, document: { data: { type: 'items', attributes: { name: 'New' } } } } })
// @ts-expect-error Write calls require an explicit input key.
await items.post({ format: 'jsonapi' })
// @ts-expect-error Removed inputRecord is rejected even alongside valid input.
await items.post({ data: { name: 'New' }, ...{ inputRecord: { name: 'Old' } } })
// @ts-expect-error Document input requires the expected resource type.
await items.post({ document: { data: { type: 'authors', attributes: { name: 'Wrong type' } } } })
// @ts-expect-error A JSON:API document does not become plain data based on its contents.
await items.post({ data: { data: { type: 'items', attributes: { name: 'Wrong shape' } } } })
// @ts-expect-error A partial document needs a target in params or document.data.
await items.patch({ document: { data: { type: 'items', attributes: { name: 'Missing target' } } } })
// @ts-expect-error Compound writes are not supported.
await items.post({ document: { data: { type: 'items' }, included: [] } })
// @ts-expect-error Errors cannot be submitted as resource writes.
await items.post({ document: { data: { type: 'items' }, errors: [] } })
// @ts-expect-error Single-record selection has no pagination.
await items.get({ id: '1', queryParams: { page: { size: 10 } } })
// @ts-expect-error Offset and cursor pagination cannot be combined.
await items.query({ queryParams: { page: { number: 2, after: 'cursor' } } })
// @ts-expect-error Removed options remain invalid even in previously assigned objects.
await items.get({ id: '1', ...{ simplified: true } })
// @ts-expect-error Minimal results do not have attributes.
minimal.data.attributes
// @ts-expect-error Concurrency conditions are opaque string tokens.
await items.delete({ id: '1', expectedVersion: 3 })
