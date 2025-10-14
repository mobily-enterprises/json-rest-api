export default async function validateIncludeConfigurations ({ context, scopes, log }) {
  const { scopeName } = context
  const scope = scopes[scopeName]
  const relationships = scope.vars.schemaInfo?.schemaRelationships

  if (!relationships) return

  // Check each relationship for include configuration
  for (const [relName, relDef] of Object.entries(relationships)) {
    if (relDef.include?.strategy === 'window') {
      // This relationship requires window functions
      // We'll validate this at query time since the database might not be connected yet
      log.debug(`Relationship ${scopeName}.${relName} configured for window function includes`)
    }

    // Validate include configuration
    if (relDef.include?.limit) {
      if (typeof relDef.include.limit !== 'number') {
        throw new Error(
          `Invalid include limit for ${scopeName}.${relName}: limit must be a number`
        )
      }
      // Check against queryMaxLimit if available
      const maxLimit = scope.vars?.queryMaxLimit
      if (maxLimit && relDef.include.limit > maxLimit) {
        throw new Error(
          `Invalid include limit for ${scopeName}.${relName}: ` +
          `limit (${relDef.include.limit}) exceeds queryMaxLimit (${maxLimit})`
        )
      }
    }

    if (relDef.include?.orderBy && !Array.isArray(relDef.include.orderBy)) {
      throw new Error(
        `Invalid include orderBy for ${scopeName}.${relName}: orderBy must be an array`
      )
    }
  }
}
