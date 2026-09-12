// @ts-check
/** @import {
 * EnrichmentArguments, Field, LifecycleContext, LifecycleResource, LifecycleSchema
 * } from './lifecycle-types.js' */
import { filterHiddenFields, getResourceFieldset, parseFieldset } from '../lib/querying-writing/field-utils.js'
import { wrapUnexpectedError } from '../../../lib/error-context.js'
import { getFieldDependencyClosure } from '../lib/querying-writing/schema-helpers.js'
import { getRequestedComputedFields } from '../lib/querying-writing/knex-field-helpers.js'

// Resolve field dependencies before filtering and running resource enrichment hooks.
/** @param {EnrichmentArguments} args */
export default async function enrichAttributesMethod ({ context, params, runHooks, scopeName, scopes, api, helpers }) {
  const { id, attributes, parentContext, requestedComputedFields, isMainResource } = params || {}

  if (!attributes) {
    return {}
  }

  const schemaInfo = scopes[scopeName]?.vars?.schemaInfo || /** @type {Partial<LifecycleSchema>} */ ({})
  const schemaStructure = schemaInfo.schemaStructure || {}
  const computedFields = schemaInfo.computed || {}
  const fieldGetters = schemaInfo.fieldGetters || {}
  const sortedGetterFields = schemaInfo.sortedGetterFields || []

  const transformedAttributes = { ...attributes }
  const resourceFieldset = getResourceFieldset(parentContext?.queryParams?.fields, scopeName)
  const requestedFields = parseFieldset(resourceFieldset)
  const selectedComputedFields = requestedComputedFields ?? getRequestedComputedFields(
    scopeName, resourceFieldset, computedFields
  )
  const selectedVirtualFields = Object.keys(schemaStructure).filter(name => {
    const definition = /** @type {Field} */ (schemaStructure[name])
    return definition.virtual === true && definition.hidden !== true &&
      (requestedFields === null ? definition.normallyHidden !== true : requestedFields.includes(name))
  })
  const neededFields = getFieldDependencyClosure(schemaInfo, [
    ...Object.keys(attributes), ...selectedComputedFields, ...selectedVirtualFields
  ])

  // Virtual input belongs only to the resource that was written.
  const inputData = parentContext?.inputRecord?.data
  if (isMainResource !== false && inputData?.type === scopeName &&
      inputData.id !== undefined && String(inputData.id) === String(id) && inputData.attributes) {
    const inputAttrs = inputData.attributes
    Object.entries(schemaStructure).forEach(([fieldName, fieldDef]) => {
      if (fieldDef.virtual === true && neededFields.has(fieldName) && Object.hasOwn(inputAttrs, fieldName) && inputAttrs[fieldName] !== undefined && inputAttrs[fieldName] !== null) {
        if (!Object.hasOwn(transformedAttributes, fieldName)) {
          transformedAttributes[fieldName] = inputAttrs[fieldName]
        }
      }
    })
  }

  const originalAttributes = { ...transformedAttributes }
  // Getters run in dependency order while hidden dependencies are still available.
  for (const fieldName of sortedGetterFields) {
    if (Object.hasOwn(transformedAttributes, fieldName)) {
      const getterInfo = /** @type {NonNullable<LifecycleSchema['fieldGetters'][string]>} */ (fieldGetters[fieldName])
      try {
        const getterContext = {
          id,
          attributes: transformedAttributes,
          fieldName,
          originalValue: originalAttributes[fieldName],
          originalAttributes,
          record: transformedAttributes,
          parentContext,
          scopeName,
          api,
          helpers,
          isMainResource: isMainResource !== false
        }

        transformedAttributes[fieldName] = await getterInfo.getter(
          transformedAttributes[fieldName],
          getterContext
        )
      } catch (error) {
        throw wrapUnexpectedError(error, {
          message: `Getter for field '${fieldName}' failed`,
          context: { scopeName, fieldName, phase: 'getter' }
        })
      }
    }
  }

  const fieldsToCompute = (schemaInfo.sortedComputedFields || []).filter(field => neededFields.has(field))

  // Computations receive getter-transformed values and earlier computed results.
  const computeContext = {
    id,
    attributes: transformedAttributes,
    record: { ...transformedAttributes },
    context: parentContext,
    helpers,
    api,
  }

  for (const fieldName of fieldsToCompute) {
    const fieldDef = computedFields[fieldName]
    if (fieldDef && fieldDef.compute) {
      try {
        const value = await fieldDef.compute(computeContext)
        transformedAttributes[fieldName] = value
        computeContext.record[fieldName] = value
      } catch (error) {
        throw wrapUnexpectedError(error, {
          message: `Computation for field '${fieldName}' failed`,
          context: { scopeName, fieldName, phase: 'computed' }
        })
      }
    }
  }

  // Remove private fields and values fetched only for computation.
  const finalAttributes = filterHiddenFields(
    transformedAttributes,
    { structure: schemaInfo.outputFields },
    requestedFields
  )
  if (requestedFields !== null) {
    const allowed = new Set(requestedFields)
    Object.keys(finalAttributes).forEach((key) => {
      if (!allowed.has(key)) {
        delete finalAttributes[key]
      }
    })
  }

  Object.assign(context, {
    parentContext,
    attributes: finalAttributes,
    computedFields,
    requestedComputedFields: selectedComputedFields,
    scopeName,
    helpers,
    api
  })

  await runHooks('enrichAttributes')

  return /** @type {import('../lib/storage/storage-types.js').StorageRow} */ (context.attributes)
}

// Preserve include order and each resource's enrichment hooks and fieldset.
/** @param {LifecycleContext} context @param {Record<string, LifecycleResource>} scopes */
export async function enrichIncludedAttributes (context, scopes) {
  for (const entry of (context.record?.included || [])) {
    const entryScope = /** @type {LifecycleResource} */ (scopes[entry.type])
    const entryComputed = entryScope.vars.schemaInfo?.computed || {}
    const entryRequestedFields = getResourceFieldset(context.queryParams?.fields, entry.type)
    const entryRequestedComputed = getRequestedComputedFields(
      entry.type,
      entryRequestedFields,
      entryComputed
    )

    entry.attributes = await entryScope.enrichAttributes({
      id: entry.id,
      attributes: entry.attributes,
      parentContext: context,
      requestedComputedFields: entryRequestedComputed,
      isMainResource: false,
      computedDependencies: entry.__$jsonrestapi_computed_deps$__
    })
  }
}
