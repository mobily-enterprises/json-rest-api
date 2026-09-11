import { createSchema } from 'json-rest-schema'
import { ensureSearchFieldsAreIndexed, generateSearchSchemaFromSchema, compileFieldDependencies, snapshotResourceConfiguration } from './schema-helpers.js'
import { buildStorageInfo, normalizeStorageConfig } from '../storage/storage-mapping.js'
import { compileQueryFields } from './query-field-helpers.js'
import { buildEffectiveSortList } from '../querying/query-field-sort-helpers.js'
import { assertScalarQueryField, assertFieldNameMap } from './field-utils.js'
import { validateRelationshipFieldNames, validateSchemaFieldNames } from './scope-validations.js'

/**
 * Compile one resource and publish its completed metadata in vars.schemaInfo.
 * Raw configuration is snapshotted; computed fields are kept out of the
 * writable schema. Plugins enrich attribute, search and computed definitions
 * before callback dependencies, output membership and storage mappings compile.
 * schema:compiled runs before the completed metadata snapshot is published.
 *
 * @param {Object} scope
 * @param {Object} scope.scopeOptions - Resource configuration
 * @param {Object} scope.vars - Receives the compiled schemaInfo
 * @param {Object} deps
 * @param {Object} deps.context
 * @param {string} deps.context.scopeName - Resource name
 * @param {Function} deps.runHooks - Awaited schema enrichment/publication hooks
 * @returns {Promise<void>}
 * @example
 * // A title field remains in schemaInfo.schemaStructure and is validated by
 * // schemaInfo.schemaInstance. A computed wordCount instead lives in
 * // schemaInfo.computed; schemaInfo.outputFields contains both definitions.
 * // The search schema, dependency orders and storageInfo share this publication.
 */
export async function compileSchemas (scope, deps) {
  // Extract scopeName from context
  const { context, runHooks } = deps
  const scopeName = context.scopeName

  const scopeOptions = snapshotResourceConfiguration(scope.scopeOptions || {})

  // Get raw schema
  const rawFields = scopeOptions.schema || {}
  validateSchemaFieldNames(rawFields, scopeName)
  validateRelationshipFieldNames(scopeOptions.relationships, scopeName)

  // Extract computed fields from schema and build enriched schema
  const computedFields = {}
  const enrichedFields = {}

  for (const [fieldName, fieldDef] of Object.entries(snapshotResourceConfiguration(rawFields))) {
    if (fieldDef.computed === true) {
      // Extract computed field - copy entire definition
      computedFields[fieldName] = { ...fieldDef }

      // Don't include computed fields in the validation schema
    } else {
      enrichedFields[fieldName] = { ...fieldDef }
    }
  }

  // Default enrichment: Add type to belongsTo fields
  for (const [, fieldDef] of Object.entries(enrichedFields)) {
    if (fieldDef.belongsTo && !fieldDef.type) {
      fieldDef.type = 'id'
    }
  }

  // Hook: schema:enrich
  const schemaContext = {
    fields: enrichedFields,    // Mutable
    originalFields: rawFields,  // Read-only
    queryFields: {},
    scopeName,
    scopeOptions
  }
  await runHooks('schema:enrich', schemaContext)
  validateSchemaFieldNames(schemaContext.fields, scopeName)
  assertFieldNameMap(schemaContext.queryFields, `query fields in '${scopeName}'`)

  // Create schema object
  const schemaObject = createSchema(schemaContext.fields)

  // Generate searchSchema by merging explicit searchSchema with fields marked search:true.
  // This allows two ways to define searchable fields: either mark fields with search:true
  // in the main schema, or provide an explicit searchSchema with more control over filtering.
  // The explicit searchSchema takes precedence when there are conflicts - it can override
  // fields marked with search:true. Fields with search:true that are NOT in the explicit
  // searchSchema will be added automatically.
  // Example: title: {search: true} auto-generates a searchable field with sensible defaults,
  // while searchSchema can specify filterOperator: 'contains' or complex join configurations.
  const rawSearchFields = generateSearchSchemaFromSchema(
    schemaContext.fields,
    scopeOptions.searchSchema
  ) || {}

  const searchSchemaContext = {
    fields: snapshotResourceConfiguration(Object.fromEntries(Object.entries(rawSearchFields).map(([name, definition]) => [name, { ...definition }]))),
    originalFields: rawSearchFields,
    scopeName
  }
  await runHooks('searchSchema:enrich', searchSchemaContext)
  assertFieldNameMap(searchSchemaContext.fields, `search schema in '${scopeName}'`)
  ensureSearchFieldsAreIndexed(searchSchemaContext.fields)
  const searchSchemaObject = createSchema(searchSchemaContext.fields)

  // Derived fields must be rebuilt from the current candidate before publication.
  const idProperty = scopeOptions.idProperty || scope.vars.idProperty || 'id'
  const schemaRelationships = { ...(scopeOptions.relationships || {}) }
  const computedSchemaContext = {
    fields: snapshotResourceConfiguration(Object.fromEntries(Object.entries(computedFields).map(([name, definition]) => [name, { ...definition }]))),
    originalFields: computedFields,
    schemaStructure: schemaObject.structure,
    searchSchemaStructure: searchSchemaObject.structure,
    schemaRelationships,
    idProperty,
    scopeName,
    scopeOptions
  }
  await runHooks('computedSchema:enrich', computedSchemaContext)
  assertFieldNameMap(computedSchemaContext.fields, `computed fields in '${scopeName}'`)
  validateRelationshipFieldNames(schemaRelationships, scopeName)
  for (const [fieldName, fieldDef] of Object.entries(computedSchemaContext.fields)) {
    if (fieldDef?.computed !== true) {
      throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' must set computed: true`)
    }
    if (!fieldDef.type) {
      throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' must have a type`)
    }
    if (fieldDef.compute !== undefined && typeof fieldDef.compute !== 'function') {
      throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' has invalid compute function`)
    }
    if (Object.hasOwn(schemaObject.structure, fieldName)) {
      throw new Error(`Computed field '${fieldName}' in scope '${scopeName}' conflicts with an attribute field`)
    }
  }

  // Each public relationship name has one declaration.
  const relationshipNames = new Set(Object.keys(schemaRelationships))
  for (const [fieldName, fieldDef] of Object.entries(schemaContext.fields)) {
    if (fieldDef.belongsToPolymorphic !== undefined) {
      throw new Error(`Field '${fieldName}' in resource '${scopeName}' cannot declare belongsToPolymorphic; declare it in relationships`)
    }
    if (fieldDef.belongsTo && fieldDef.as) {
      if (relationshipNames.has(fieldDef.as)) {
        throw new Error(`Relationship name '${fieldDef.as}' in resource '${scopeName}' is declared more than once`)
      }
      relationshipNames.add(fieldDef.as)
    }
    // Validate that belongsTo fields have 'as' property
    if (fieldDef.belongsTo && !fieldDef.as) {
      throw new Error(
        `Field '${fieldName}' in resource '${scopeName}' has belongsTo: '${fieldDef.belongsTo}' but is missing the required 'as' property. ` +
        'The \'as\' property defines the relationship name used in JSON:API payloads. ' +
        `Example: ${fieldName}: { type: 'number', belongsTo: '${fieldDef.belongsTo}', as: '${fieldName.replace(/_id$/, '')}' }`
      )
    }
  }

  const queryFields = compileQueryFields(schemaContext.queryFields, {
    scopeName,
    schemaStructure: schemaObject.structure,
    computed: computedSchemaContext.fields,
    schemaRelationships,
    idProperty
  })
  for (const [kind, definitions] of [['Computed', computedSchemaContext.fields], ['Query', queryFields]]) {
    for (const [name, definition] of Object.entries(definitions)) {
      if (definition.belongsTo !== undefined || definition.belongsToPolymorphic !== undefined) {
        throw new Error(`${kind} field '${name}' in scope '${scopeName}' cannot declare relationships; use a stored backing field or the resource relationships map`)
      }
    }
  }
  const fieldDependencies = compileFieldDependencies({
    schemaStructure: schemaObject.structure,
    computedFields: computedSchemaContext.fields,
    queryFields,
    schemaRelationships,
    idProperty,
    scopeName
  })

  const identityFields = new Set([...fieldDependencies.foreignKeyFields, 'id', idProperty])
  for (const fieldName of identityFields) {
    if (schemaObject.structure[fieldName]?.storage?.serialize !== undefined) {
      throw new Error(`Field '${fieldName}' in scope '${scopeName}' cannot use storage.serialize: identity fields must preserve resource IDs and relationship types. Use normalizeId for resource ID canonicalization.`)
    }
  }

  const querySchema = { schemaStructure: schemaObject.structure, searchSchemaStructure: searchSchemaObject.structure, queryFields }
  for (const [filterName, definition] of Object.entries(searchSchemaObject.structure)) {
    if (typeof definition.applyFilter === 'function' && !definition.oneOf) continue
    for (const target of definition.oneOf || [definition.actualField || filterName]) {
      assertScalarQueryField(schemaObject.structure[target] || queryFields[target], target, 'filter')
    }
  }
  buildEffectiveSortList(scopeOptions.sortableFields, { schemaInfo: querySchema })
  buildEffectiveSortList([], { defaultSort: scopeOptions.defaultSort, schemaInfo: querySchema })
  for (const [fieldName, definition] of Object.entries(queryFields)) {
    if (definition.sortable) buildEffectiveSortList([fieldName], { schemaInfo: querySchema })
  }

  const storage = normalizeStorageConfig(scopeOptions.storage)
  const storageInfo = buildStorageInfo({
    schemaStructure: schemaObject.structure,
    idProperty,
    storage
  })

  const outputFields = { ...schemaObject.structure, ...computedSchemaContext.fields, ...queryFields }
  const outputRelationships = { ...schemaRelationships }
  for (const definition of Object.values(schemaObject.structure)) {
    if (definition.as && definition.belongsTo) {
      outputRelationships[definition.as] = definition
    }
  }

  const versionField = scopeOptions.versionField
  if (versionField !== undefined) {
    const definition = typeof versionField === 'string' && Object.hasOwn(schemaObject.structure, versionField)
      ? schemaObject.structure[versionField]
      : undefined
    if (!versionField || versionField === idProperty || !definition || definition.type !== 'string' ||
      definition.computed || definition.virtual || definition.belongsTo || definition.getter || definition.setter || definition.storage?.serialize) {
      throw new Error(`versionField in '${scopeName}' must name a stored string attribute without getters, setters, serializers or relationships, distinct from the primary ID`)
    }
  }

  // Cache everything
  const schemaInfo = {

    schemaInstance: schemaObject,
    schemaStructure: schemaObject.structure,

    searchSchemaInstance: searchSchemaObject,
    searchSchemaStructure: searchSchemaObject.structure,

    computed: computedSchemaContext.fields,
    queryFields,
    schemaRelationships,
    outputFields,
    outputRelationships,
    ...(versionField === undefined ? {} : { versionField }),
    tableName: scopeOptions.tableName || scopeName,
    idProperty,
    storage,
    storageInfo,
    indexes: Array.isArray(scopeOptions.indexes) ? [...scopeOptions.indexes] : [],
    foreignKeys: Array.isArray(scopeOptions.foreignKeys) ? [...scopeOptions.foreignKeys] : [],
    checkConstraints: Array.isArray(scopeOptions.checkConstraints) ? [...scopeOptions.checkConstraints] : [],
    ...fieldDependencies
  }
  await runHooks('schema:compiled', { scopeName, scopeOptions, schemaInfo })
  scope.vars.schemaInfo = snapshotResourceConfiguration(schemaInfo)
}
