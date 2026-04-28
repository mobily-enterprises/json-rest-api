export const unwrapQueryBuilderState = (value, fallback = null) => {
  let current = value
  const seen = new Set()

  while (
    current &&
    typeof current === 'object' &&
    !Array.isArray(current) &&
    Object.hasOwn(current, 'query') &&
    current.query &&
    current.query !== current &&
    !seen.has(current)
  ) {
    seen.add(current)
    current = current.query
  }

  return current || fallback
}
