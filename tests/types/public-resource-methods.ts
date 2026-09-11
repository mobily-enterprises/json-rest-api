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
await items.patch({ id: 1n, inputRecord: { name: 'BigInt target' } })
const name: string | undefined = plain.name
const full: JsonApiDocument<JsonApiResource<Fields, 'items'>> = await items.patch({
  id: '1', format: 'jsonapi', returning: 'full', expectedVersion: 'revision',
  inputRecord: { data: { type: 'items', attributes: { name: 'Changed' } } }
})
const minimal: JsonApiDocument<ResourceIdentifier<'items'>> = await jsonItems.post({
  inputRecord: { data: { type: 'items', attributes: { name: 'New' } } }
})
const none: void = await items.put({ inputRecord: { id: '1', name: 'Replaced' }, returning: 'none' })
await jsonItems.patch({ inputRecord: { data: { type: 'items', id: '1', attributes: { name: 'Changed' } } } })
await items.query({ queryParams: { fields: { items: 'name' }, include: [], sort: ['name'], page: { after: 'cursor', size: 10 } } })
await items.delete({ id: '1', expectedVersion: 'revision' }, context)
void [name, full, minimal, none]

// @ts-expect-error A target is required either in params or in the input record.
await items.patch({ inputRecord: { name: 'Missing target' } })
// @ts-expect-error POST cannot require an existing revision.
await items.post({ inputRecord: { name: 'New' }, expectedVersion: 'revision' })
// @ts-expect-error A writable schema need not include its managed revision field.
await items.patch({ id: '1', inputRecord: { revision: 'forged' } })
// @ts-expect-error Input shape follows the explicit format, not auto-detection.
await items.post({ format: 'jsonapi', inputRecord: { name: 'Wrong shape' } })
// @ts-expect-error Omitting format uses the configured plain default.
await items.post({ inputRecord: { data: { type: 'items', attributes: { name: 'Wrong default' } } } })
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
