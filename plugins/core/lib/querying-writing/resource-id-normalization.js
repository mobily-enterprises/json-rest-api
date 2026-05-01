import {
  RestApiResourceError,
  RestApiValidationError
} from '../../../../lib/rest-api-errors.js'

export function defaultNormalizeResourceId (value) {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }

  if (typeof value === 'bigint') {
    return String(value)
  }

  const normalized = String(value).trim()
  return normalized || null
}

export function resolveResourceIdNormalizer ({ scopeOptions = null, vars = null } = {}) {
  if (typeof scopeOptions?.normalizeId === 'function') {
    return scopeOptions.normalizeId
  }

  if (typeof vars?.normalizeId === 'function') {
    return vars.normalizeId
  }

  return defaultNormalizeResourceId
}

export function normalizeResourceId (value, options = {}) {
  const normalizer = resolveResourceIdNormalizer(options)
  return defaultNormalizeResourceId(normalizer(value))
}

export function requireExistingResourceId (value, {
  scopeOptions = null,
  vars = null,
  scopeName = ''
} = {}) {
  const normalizedId = normalizeResourceId(value, { scopeOptions, vars })
  if (normalizedId) {
    return normalizedId
  }

  throw new RestApiResourceError(
    'Resource not found',
    {
      subtype: 'not_found',
      resourceType: scopeName,
      resourceId: value == null ? null : String(value)
    }
  )
}

export function requireDocumentResourceId (value, {
  scopeOptions = null,
  vars = null
} = {}) {
  const normalizedId = normalizeResourceId(value, { scopeOptions, vars })
  if (normalizedId) {
    return normalizedId
  }

  throw new RestApiValidationError(
    'Resource document id is invalid',
    {
      fields: ['data.id'],
      violations: [{
        field: 'data.id',
        rule: 'invalid_resource_id',
        message: 'Resource document id must normalize to a non-empty value.'
      }]
    }
  )
}

function resolveResourceNormalizationOptions (resourceType, { api } = {}) {
  const scope = api?.resources?.[resourceType]
  return {
    scopeOptions: scope?.scopeOptions || scope?._scopeOptions || null,
    vars: scope?.vars || null,
    scopeName: resourceType
  }
}

export function requireReferencedResourceId (resourceType, value, { api } = {}) {
  return requireExistingResourceId(
    value,
    resolveResourceNormalizationOptions(resourceType, { api })
  )
}

function normalizeRelationshipIdentifier (identifier, { api } = {}) {
  if (!identifier || typeof identifier !== 'object' || Array.isArray(identifier)) {
    return identifier
  }

  const type = typeof identifier.type === 'string' ? identifier.type : ''
  if (!type || !Object.hasOwn(identifier, 'id')) {
    return {
      ...identifier
    }
  }

  return {
    ...identifier,
    id: requireReferencedResourceId(type, identifier.id, { api })
  }
}

export function normalizeRelationshipIdentifiers (relationshipData, { api } = {}) {
  if (Array.isArray(relationshipData)) {
    return relationshipData.map((identifier) => normalizeRelationshipIdentifier(identifier, { api }))
  }

  if (relationshipData == null) {
    return relationshipData
  }

  return normalizeRelationshipIdentifier(relationshipData, { api })
}
