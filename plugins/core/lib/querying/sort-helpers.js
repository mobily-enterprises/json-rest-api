// @ts-check

/**
 * @param {unknown} [sort]
 * @param {{ idField?: string }} [options]
 * @returns {string[]}
 */
export function normalizeStableSort (sort = [], { idField = 'id' } = {}) {
  /** @type {Set<string>} */
  const seenFields = new Set()
  const sortList = Array.isArray(sort)
    ? sort.filter(/** @param {unknown} entry @returns {entry is string} */ (entry) => {
      if (typeof entry !== 'string' || !entry.trim()) return false
      const field = entry.startsWith('-') ? entry.slice(1) : entry
      if (seenFields.has(field)) return false
      seenFields.add(field)
      return true
    })
    : []

  if (sortList.length === 0) {
    return [idField]
  }

  const hasId = sortList.some((entry) => {
    const fieldName = entry.startsWith('-') ? entry.slice(1) : entry
    return fieldName === idField
  })

  if (!hasId) {
    sortList.push(idField)
  }

  return sortList
}

/**
 * @param {string} sortEntry
 * @returns {{ raw: string, field: string, desc: boolean, direction: 'asc' | 'desc', sqlDirection: 'ASC' | 'DESC' }}
 */
export function parseSortEntry (sortEntry) {
  const desc = typeof sortEntry === 'string' && sortEntry.startsWith('-')
  const field = desc ? sortEntry.slice(1) : sortEntry

  return {
    raw: sortEntry,
    field,
    desc,
    direction: desc ? 'desc' : 'asc',
    sqlDirection: desc ? 'DESC' : 'ASC'
  }
}
