import { randomUUID } from 'node:crypto'

// One-off migration example: stop writers first; the caller owns the transaction.
export async function backfillResourceVersions (transaction, { tableName, idColumn, versionColumn, scope }) {
  if (!transaction?.isTransaction || transaction.isCompleted()) throw new Error('An active caller-owned Knex transaction is required')
  if (![tableName, idColumn, versionColumn].every(name => typeof name === 'string' && name.length) || idColumn === versionColumn) {
    throw new Error('Specify the physical table, unique ID column and distinct version column')
  }
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.values(scope).some(value => value === undefined)) {
    throw new Error('Specify an explicit scope object; use {} only for a dedicated resource table')
  }
  if (tableName === 'any_records' && (!scope.tenant_id || !scope.resource)) {
    throw new Error('Canonical backfills require both tenant_id and resource')
  }
  const base = () => transaction(tableName).where(scope)
  let cursor
  let scanned = 0
  let initialized = 0
  while (true) {
    const query = base().select(idColumn, versionColumn).orderBy(idColumn).limit(100)
    if (cursor !== undefined) query.where(idColumn, '>', cursor)
    const rows = await query
    if (!rows.length) break
    for (const row of rows) {
      const token = row[versionColumn]
      if (token === null) {
        const changed = await base().where(idColumn, row[idColumn]).whereNull(versionColumn).update({ [versionColumn]: randomUUID() })
        if (changed !== 1) throw new Error('Backfill target changed; stop writers before migration')
        initialized++
      } else if (typeof token !== 'string' || !token.length || token.length > 128) {
        throw new Error('Existing version must be a non-empty string of at most 128 characters')
      }
      scanned++
    }
    cursor = rows.at(-1)[idColumn]
  }
  return { scanned, initialized }
}
