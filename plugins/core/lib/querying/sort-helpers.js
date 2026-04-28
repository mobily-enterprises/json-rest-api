export function normalizeStableSort (sort = [], { idField = 'id' } = {}) {
  const sortList = Array.isArray(sort)
    ? sort.filter((entry) => typeof entry === 'string' && entry.trim())
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
