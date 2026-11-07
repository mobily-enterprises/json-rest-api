import type { Knex } from 'knex'
import type { ManagedTransaction } from '../../types/transactions.js'
import type { ResourceCoreMethods } from '../../types/resource-methods.js'

declare const transaction: ManagedTransaction
declare const raw: Knex.Transaction
declare const knex: Knex
declare const items: ResourceCoreMethods<{ name: string; rank: number }, { name: string; rank?: number }, 'items'>

const none = await items.postMany({ data: [{ name: 'First' }, { name: 'Second' }] })
const nothing: void = none
const created = await items.postMany({ format: 'jsonapi', returning: 'full', document: { data: [{ type: 'items', attributes: { name: 'First' } }] } })
const createdName: string | undefined = created.data[0]?.attributes?.name
const upserted = await items.postMany({ data: [{ name: 'First' }], onConflict: { keys: ['name'], action: 'merge', merge: ['rank'] }, returning: 'minimal', transaction })
const upsertedId: string | undefined = upserted.data[0]?.id
const patched = await items.patchMany({ data: [{ id: 1, rank: knex.raw('?? + 1', ['rank']) }], onlyIf: { rank: 0 }, missing: 'skip', returning: 'full' })
const patchedName: string | undefined = patched.data[0]?.name
await items.patchWhereIds({ ids: [1, '2'], data: { rank: 3 }, transaction })
await items.patchWhere({ filters: { name: 'First' }, data: { rank: 4 } })
const deleted = await items.deleteMany({ ids: [1], returning: 'minimal' })
const deletedId: string | undefined = deleted.data[0]?.id
await items.deleteWhere({ filters: { name: 'Old' } })
const { query } = await items.scopedQuery({ alias: 'i', purpose: 'report' })
const all = await items.queryAll({ pageSize: 500, rowLimit: 10000 })
const allNames: Array<string | undefined> = all.data.map(item => item.name)
const locked = await items.lockByIds({ ids: [1, 2], transaction: raw })
const lockedWhere = await items.lockWhere({ filters: { name: 'First' }, transaction })
const claimed = await items.claim({ filters: { name: 'queued' }, sort: ['-rank'], limit: 10, transaction })
void [nothing, createdName, upsertedId, patchedName, deletedId, query, allNames, locked, lockedWhere, claimed]

// @ts-expect-error Many-row writes need a managed transaction from api.transaction.
await items.postMany({ data: [{ name: 'Raw' }], transaction: raw })
// @ts-expect-error Many-row writes are all-or-nothing; there is no atomic option.
await items.postMany({ data: [{ name: 'New' }], atomic: false })
// @ts-expect-error Versioned resources refuse many-row writes, so there are no expected versions.
await items.deleteMany({ ids: [1], expectedVersions: ['v1'] })
// @ts-expect-error A delete returns nothing or identifiers.
await items.deleteMany({ ids: [1], returning: 'full' })
// @ts-expect-error Both input keys are ambiguous.
await items.postMany({ data: [{ name: 'New' }], document: { data: [{ type: 'items' }] } })
// @ts-expect-error patchMany rows need an id.
await items.patchMany({ data: [{ name: 'No id' }] })
// @ts-expect-error A shared patch carries no id.
await items.patchWhereIds({ ids: [1], data: { id: 1, name: 'x' } })
// @ts-expect-error Upsert keys are input fields.
await items.postMany({ data: [{ name: 'New' }], onConflict: { keys: ['missing'], action: 'ignore' } })
// @ts-expect-error Writes return nothing unless returning asks for rows.
none.data
