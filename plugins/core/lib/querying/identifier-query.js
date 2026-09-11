import { RELATIONSHIP_READ_BATCH_SIZE } from '../querying-writing/knex-constants.js'

// Keep collection sorting and limits in one query even for large parent sets.
export function whereInIdentifiers (query, column, identifiers) {
  const ids = [...new Set(identifiers)]
  if (ids.length <= RELATIONSHIP_READ_BATCH_SIZE) return query.whereIn(column, ids)

  const client = query.client.config.client
  if (client === 'pg' || client === 'postgresql') {
    return query.whereRaw('?? = ANY(?)', [column, ids])
  }
  if (client === 'sqlite3' || client === 'better-sqlite3') {
    const values = JSON.stringify(ids, (_key, value) => typeof value === 'bigint' ? String(value) : value)
    return query.whereIn(column, query.client.raw('select value from json_each(?)', [values]))
  }

  // Knex's MySQL text protocol does not impose a prepared-parameter count limit.
  return query.whereIn(column, ids)
}
