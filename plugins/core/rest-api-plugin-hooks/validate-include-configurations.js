import { buildEffectiveSortList } from '../lib/querying/query-field-sort-helpers.js'

export function validateIncludeConfigurations ({ context, scopes, log }) {
  const { scopeName, scopeOptions, schemaInfo } = context
  const maxLimit = scopeOptions.queryMaxLimit !== undefined
    ? scopeOptions.queryMaxLimit
    : scopes[scopeName]?.vars?.queryMaxLimit

  for (const [relName, relDef] of Object.entries(schemaInfo.outputRelationships)) {
    if (relDef.include?.strategy === 'window') {
      // Database support is checked when the include query is prepared.
      log.debug(`Relationship ${scopeName}.${relName} configured for window function includes`)
    }

    const limit = relDef.include?.limit
    if (limit !== undefined && limit !== null && limit !== false) {
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error(`Invalid include limit for ${scopeName}.${relName}: expected a non-negative integer, null or false`)
      }
      if (maxLimit && limit > maxLimit) {
        throw new Error(`Invalid include limit for ${scopeName}.${relName}: limit (${limit}) exceeds queryMaxLimit (${maxLimit})`)
      }
    }

    const orderBy = relDef.include?.orderBy
    if (orderBy !== undefined && orderBy !== null) {
      if (!Array.isArray(orderBy)) {
        throw new Error(`Invalid include orderBy for ${scopeName}.${relName}: orderBy must be an array`)
      }
      buildEffectiveSortList(orderBy)
    }
  }
}
