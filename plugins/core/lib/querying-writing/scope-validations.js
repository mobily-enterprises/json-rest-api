import { assertFieldName, assertFieldNameMap } from './field-utils.js'

export function validateSchemaFieldNames (fields, scopeName) {
  assertFieldNameMap(fields, `schema in '${scopeName}'`)
  for (const [name, definition] of Object.entries(fields || {})) {
    if (definition?.belongsTo !== undefined && typeof definition.belongsTo !== 'string') {
      throw new Error(`Invalid field '${scopeName}.${name}': 'belongsTo' must be a string`)
    }
    if (definition?.as !== undefined && typeof definition.as !== 'string') {
      throw new Error(`Invalid relationship alias for '${scopeName}.${name}': 'as' must be a string`)
    }
    assertFieldName(definition?.as, `relationship alias for '${scopeName}.${name}'`)
    for (const backing of [definition?.belongsToPolymorphic?.typeField, definition?.belongsToPolymorphic?.idField]) {
      assertFieldName(backing, `backing field for relationship '${scopeName}.${name}'`)
    }
    if (definition?.search && typeof definition.search === 'object') {
      assertFieldNameMap(definition.search, `search declaration for '${scopeName}.${name}'`)
    }
  }
}

export function validateRelationshipFieldNames (relationships, scopeName) {
  assertFieldNameMap(relationships, `relationships in '${scopeName}'`)
  for (const [name, definition] of Object.entries(relationships || {})) {
    for (const option of ['target', 'through', 'via', 'foreignKey', 'otherKey']) {
      if (definition?.[option] !== undefined && typeof definition[option] !== 'string') {
        throw new Error(`Invalid relationship '${scopeName}.${name}': '${option}' must be a string`)
      }
    }
    for (const field of [definition?.foreignKey, definition?.otherKey, definition?.belongsToPolymorphic?.typeField, definition?.belongsToPolymorphic?.idField]) {
      assertFieldName(field, `backing field for relationship '${scopeName}.${name}'`)
    }
    if (definition?.belongsToPolymorphic !== undefined) {
      const validation = validatePolymorphicRelationship(definition, scopeName)
      if (!validation.valid) {
        throw new Error(`Invalid polymorphic relationship '${name}' in scope '${scopeName}': ${validation.error}`)
      }
    }

    // Validate based on relationship type
    if (definition.type === 'hasMany') {
      const validation = validateHasManyRelationship(definition, name, scopeName)
      if (!validation.valid) {
        throw new Error(
          `Invalid hasMany relationship '${name}' in scope '${scopeName}': ${validation.error}`
        )
      }
    }

    if (definition.type === 'hasOne') {
      const validation = validateHasOneRelationship(definition, name, scopeName)
      if (!validation.valid) {
        throw new Error(
          `Invalid hasOne relationship '${name}' in scope '${scopeName}': ${validation.error}`
        )
      }
    }

    if (definition.type === 'manyToMany') {
      const validation = validateManyToManyRelationship(definition, name, scopeName)
      if (!validation.valid) {
        throw new Error(
          `Invalid manyToMany relationship '${name}' in scope '${scopeName}': ${validation.error}`
        )
      }
    }
  }
}

/** Registration-time shape checks for declared relationships and backing names. */

/**
 * Check declared relationship shapes before resource registration completes.
 * Polymorphic targets must already be registered. Other relationships are
 * checked for required mapping options here; this is not database introspection
 * or complete validation of every target field and referential constraint.
 *
 * @param {Object} params
 * @param {Object} params.context - scopeName and scopeOptions being registered
 * @param {Object} params.scopes - Registry used for polymorphic target lookup
 * @returns {void}
 * @throws {Error} On invalid relationship configuration
 */
export function validateRelationships ({ context, scopes }) {
  const { scopeName, scopeOptions } = context
  const relationships = scopeOptions.relationships || {}
  validateRelationshipFieldNames(relationships, scopeName)

  for (const [relName, relDef] of Object.entries(relationships)) {
    if (relDef.belongsToPolymorphic) {
      const validation = validatePolymorphicRelationship(relDef, scopeName, scopes)
      if (!validation.valid) {
        throw new Error(
          `Invalid polymorphic relationship '${relName}' in scope '${scopeName}': ${validation.error}`
        )
      }
    }
  }
}

/**
 * Check target and backing names, and registered targets when a registry is supplied.
 * This helper does not inspect whether the backing columns exist in a database.
 * @param {Object} relDef
 * @param {string} scopeName
 * @param {Object} [scopes]
 * @returns {Object} Validation result with valid and an optional error
 */
const validatePolymorphicRelationship = (relDef, scopeName, scopes) => {
  const { belongsToPolymorphic } = relDef

  if (!belongsToPolymorphic) {
    return { valid: false, error: 'Missing belongsToPolymorphic definition' }
  }

  const { types, typeField, idField } = belongsToPolymorphic

  if (!types || !Array.isArray(types) || types.length === 0) {
    return {
      valid: false,
      error: 'belongsToPolymorphic.types must be a non-empty array'
    }
  }

  if (!typeField || typeof typeField !== 'string') {
    return {
      valid: false,
      error: 'belongsToPolymorphic.typeField must be specified'
    }
  }

  if (!idField || typeof idField !== 'string') {
    return {
      valid: false,
      error: 'belongsToPolymorphic.idField must be specified'
    }
  }

  // Check that all types are valid scopes
  for (const type of types) {
    if (typeof type !== 'string' || !type) {
      return { valid: false, error: 'belongsToPolymorphic.types must contain non-empty strings' }
    }
    if (scopes && !scopes[type]) {
      return {
        valid: false,
        error: `Polymorphic type '${type}' is not a registered scope`
      }
    }
  }

  return { valid: true }
}

/**
 * Require a target and explicit foreign key, except for reverse polymorphic via.
 * @param {Object} relDef
 * @param {string} relName
 * @param {string} scopeName
 * @returns {Object} Validation result with valid and an optional error
 */
const validateHasManyRelationship = (relDef, relName, scopeName) => {
  // Validate target is specified
  if (!relDef.target) {
    return {
      valid: false,
      error: 'hasMany relationship requires \'target\' to be specified.'
    }
  }

  // Polymorphic hasMany relationships using 'via' don't need foreignKey
  // They use the polymorphic fields (typeField, idField) from the belongsToPolymorphic relationship
  if (relDef.via) {
    return { valid: true }
  }

  if (!relDef.foreignKey) {
    return {
      valid: false,
      error: 'hasMany relationship requires foreignKey to be specified. Add foreignKey: \'<field_name>\' to the relationship definition.'
    }
  }

  if (typeof relDef.foreignKey !== 'string') {
    return {
      valid: false,
      error: `hasMany relationship foreignKey must be a string, got ${typeof relDef.foreignKey}`
    }
  }

  return { valid: true }
}

/**
 * Validates a hasOne relationship definition
 *
 * @param {Object} relDef - Relationship definition with hasOne
 * @param {string} relName - Relationship name
 * @param {string} scopeName - Scope being registered
 * @returns {Object} Validation result {valid: boolean, error?: string}
 *
 * @example
 * // Input: Valid hasOne configuration
 * const relDef = {
 *   type: 'hasOne',
 *   target: 'profile',
 *   foreignKey: 'user_id'              // Required!
 * };
 * validateHasOneRelationship(relDef, 'profile', 'users');
 * // Output: { valid: true }
 *
 * @private
 */
const validateHasOneRelationship = (relDef, relName, scopeName) => {
  // Validate target is specified
  if (!relDef.target) {
    return {
      valid: false,
      error: 'hasOne relationship requires \'target\' to be specified.'
    }
  }

  if (!relDef.foreignKey) {
    return {
      valid: false,
      error: 'hasOne relationship requires foreignKey to be specified. Add foreignKey: \'<field_name>\' to the relationship definition.'
    }
  }

  if (typeof relDef.foreignKey !== 'string') {
    return {
      valid: false,
      error: `hasOne relationship foreignKey must be a string, got ${typeof relDef.foreignKey}`
    }
  }

  return { valid: true }
}

/**
 * Require the pivot table and both explicit foreign-key mappings.
 * @param {Object} relDef
 * @param {string} relName
 * @param {string} scopeName
 * @returns {Object} Validation result with valid and an optional error
 */
const validateManyToManyRelationship = (relDef, relName, scopeName) => {
  const { through, foreignKey, otherKey } = relDef

  if (!through) {
    return {
      valid: false,
      error: 'manyToMany relationship requires \'through\' table to be specified'
    }
  }

  if (!foreignKey) {
    return {
      valid: false,
      error: 'manyToMany relationship requires foreignKey to be specified. Add foreignKey: \'<field_name>\' to the manyToMany configuration.'
    }
  }

  if (!otherKey) {
    return {
      valid: false,
      error: 'manyToMany relationship requires otherKey to be specified. Add otherKey: \'<field_name>\' to the manyToMany configuration.'
    }
  }

  if (typeof foreignKey !== 'string') {
    return {
      valid: false,
      error: `manyToMany relationship foreignKey must be a string, got ${typeof foreignKey}`
    }
  }

  if (typeof otherKey !== 'string') {
    return {
      valid: false,
      error: `manyToMany relationship otherKey must be a string, got ${typeof otherKey}`
    }
  }

  return { valid: true }
}
