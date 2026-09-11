// @ts-check

/** @import { RestApiPluginOptions } from '../../../../types/plugin-options.js' */
/** @typedef {Pick<RestApiPluginOptions, 'normalizeId'>} NormalizerConfig */
/** @typedef {{ scopeOptions?: NormalizerConfig | null, vars?: NormalizerConfig | null, scopeName?: string }} NormalizationOptions */
/** @typedef {{ resources?: Record<string, { scopeOptions?: NormalizerConfig | null, _scopeOptions?: NormalizerConfig | null, vars?: NormalizerConfig | null }> }} NormalizationApi */
/** @typedef {{ api?: NormalizationApi }} ReferenceOptions */

import {
  RestApiResourceError,
  RestApiValidationError
} from '../../../../lib/rest-api-errors.js'

/** @param {unknown} value @returns {string | null} */
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

  return null
}

/** @param {NormalizationOptions} [options] @returns {NonNullable<RestApiPluginOptions["normalizeId"]>} */
export function resolveResourceIdNormalizer ({ scopeOptions = null, vars = null } = {}) {
  if (typeof scopeOptions?.normalizeId === 'function') {
    return scopeOptions.normalizeId
  }

  if (typeof vars?.normalizeId === 'function') {
    return vars.normalizeId
  }

  return defaultNormalizeResourceId
}

/** @param {unknown} value @param {NormalizationOptions} [options] @returns {string | null} */
export function normalizeResourceId (value, options = {}) {
  const normalizer = resolveResourceIdNormalizer(options)
  return defaultNormalizeResourceId(normalizer(value))
}

/** @param {unknown} value @param {NormalizationOptions} [options] @returns {string} */
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
      resourceId: typeof value === 'string' ? value : defaultNormalizeResourceId(value)
    }
  )
}

/** @param {unknown} value @param {NormalizationOptions} [options] @returns {string} */
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

/** @param {string} resourceType @param {ReferenceOptions} [options] @returns {NormalizationOptions} */
function resolveResourceNormalizationOptions (resourceType, { api } = {}) {
  const scope = api?.resources?.[resourceType]
  return {
    scopeOptions: scope?.scopeOptions || scope?._scopeOptions || null,
    vars: scope?.vars || null,
    scopeName: resourceType
  }
}

/** @param {string} resourceType @param {unknown} value @param {ReferenceOptions} [options] @returns {string} */
export function requireReferencedResourceId (resourceType, value, { api } = {}) {
  return requireExistingResourceId(
    value,
    resolveResourceNormalizationOptions(resourceType, { api })
  )
}

/** @param {unknown} identifier @param {ReferenceOptions} [options] @returns {unknown} */
function normalizeRelationshipIdentifier (identifier, { api } = {}) {
  if (!identifier || typeof identifier !== 'object' || Array.isArray(identifier)) {
    return identifier
  }

  // Object shape is known here; its property values remain unvalidated.
  const record = /** @type {Record<string, unknown>} */ (identifier)
  const type = typeof record.type === 'string' ? record.type : ''
  if (!type || !Object.hasOwn(identifier, 'id')) {
    return {
      ...identifier
    }
  }

  return {
    ...identifier,
    id: requireReferencedResourceId(type, record.id, { api })
  }
}

/** @param {unknown} relationshipData @param {ReferenceOptions} [options] @returns {unknown} */
export function normalizeRelationshipIdentifiers (relationshipData, { api } = {}) {
  if (Array.isArray(relationshipData)) {
    return relationshipData.map((identifier) => normalizeRelationshipIdentifier(identifier, { api }))
  }

  if (relationshipData == null) {
    return relationshipData
  }

  return normalizeRelationshipIdentifier(relationshipData, { api })
}
