export function normalizeStableSort (sort = [], { idField = 'id' } = {}) {
  const seenFields = new Set()
  const sortList = Array.isArray(sort)
    ? sort.filter((entry) => {
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
