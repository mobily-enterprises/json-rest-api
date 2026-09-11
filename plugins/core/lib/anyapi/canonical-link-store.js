import { whereInIdentifiers } from '../querying/identifier-query.js'
import { applyScopeFiltersToIncludeQuery } from '../querying/include-query-helpers.js'
import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { lockRelationshipTargets } from '../writing/relationship-processor.js'
import {
  assertVersionedRelationshipTransaction,
  hasVersionedInverse,
  invalidateManyToManyVersions,
} from '../writing/resource-version.js'
import { RELATIONSHIP_WRITE_BATCH_SIZE, RELATIONSHIP_READ_BATCH_SIZE } from '../querying-writing/knex-constants.js'
import { normalizeId } from './utils/descriptor-helpers.js'

const LINKS_TABLE = 'any_links'

// One instance per API; each operation supplies its own database/transaction.
export function createCanonicalLinkStore ({ api, getDescriptor, getScopeStorageAdapter }) {
  const canonicalizeLinkPair = ({
    tenantId,
    relationshipKey,
    inverseRelationshipKey,
    leftResource,
    leftId,
    rightResource,
    rightId,
  }) => {
    const normalizedLeftId = normalizeId(leftId)
    const normalizedRightId = normalizeId(rightId)

    if (normalizedLeftId == null || normalizedRightId == null) {
      return null
    }

    if (inverseRelationshipKey && inverseRelationshipKey < relationshipKey) {
      return {
        tenant_id: tenantId,
        relationship: inverseRelationshipKey,
        inverse_relationship: relationshipKey,
        left_resource: rightResource,
        left_id: normalizedRightId,
        right_resource: leftResource,
        right_id: normalizedLeftId,
      }
    }

    return {
      tenant_id: tenantId,
      relationship: relationshipKey,
      inverse_relationship: inverseRelationshipKey || null,
      left_resource: leftResource,
      left_id: normalizedLeftId,
      right_resource: rightResource,
      right_id: normalizedRightId,
    }
  }

  const findInverseManyToMany = ({ descriptor, relInfo }) => {
    if (!relInfo?.target) return null

    const targetDescriptor = getDescriptor(relInfo.target)

    const entries = Object.entries(targetDescriptor.manyToMany || {})
    for (const [candidateName, candidateInfo] of entries) {
      const candidateTarget = candidateInfo.target || descriptor.resource
      if (candidateTarget !== descriptor.resource) continue

      if (relInfo.through && candidateInfo.through && relInfo.through !== candidateInfo.through) {
        continue
      }

      if (
        relInfo.foreignKey && relInfo.otherKey &&
        candidateInfo.foreignKey && candidateInfo.otherKey
      ) {
        const foreignMatches = relInfo.foreignKey === candidateInfo.otherKey
        const otherMatches = relInfo.otherKey === candidateInfo.foreignKey
        if (!foreignMatches || !otherMatches) continue
      }

      const relationshipKey = candidateInfo.relationship ||
        `${targetDescriptor.tenant}:${targetDescriptor.resource}:${candidateName}`

      return {
        descriptor: targetDescriptor,
        relName: candidateName,
        relInfo: candidateInfo,
        relationshipKey,
      }
    }

    return null
  }

  const getManyToManyInfo = (scopeName, relName) => {
    const descriptor = getDescriptor(scopeName)
    const relInfo = Object.hasOwn(descriptor.manyToMany || {}, relName) ? descriptor.manyToMany[relName] : undefined
    if (!relInfo) return null
    const relationshipKey = relInfo.relationship || `${descriptor.tenant}:${descriptor.resource}:${relName}`
    const inverse = findInverseManyToMany({ descriptor, relInfo })
    const inverseRelationshipKey = inverse?.relationshipKey || null
    return { descriptor, relInfo, relationshipKey, inverseRelationshipKey }
  }

  const buildRelatedLinkQuery = ({ descriptor, relInfo, relationshipKey, parentIds, db, visibleTargets, allParents = false }) => {
    const forward = db(LINKS_TABLE).select({ parentId: 'left_id', childId: 'right_id' }).where({
      tenant_id: descriptor.tenant,
      relationship: relationshipKey,
      left_resource: descriptor.resource,
      right_resource: relInfo.target
    })
    const reverse = db(LINKS_TABLE).select({ parentId: 'right_id', childId: 'left_id' }).where({
      tenant_id: descriptor.tenant,
      inverse_relationship: relationshipKey,
      right_resource: descriptor.resource,
      left_resource: relInfo.target
    })
    if (!allParents) {
      forward.modify(whereInIdentifiers, 'left_id', parentIds)
      reverse.modify(whereInIdentifiers, 'right_id', parentIds)
    }
    if (visibleTargets) {
      forward.whereIn('right_id', visibleTargets.clone())
      reverse.whereIn('left_id', visibleTargets.clone())
    }
    return forward.union(reverse)
  }

  const buildVisibleLinkTargets = async ({ descriptor, relInfo, relationshipKey, parentIds, db, context }) => {
    const adapter = getScopeStorageAdapter(relInfo.target)
    if (!adapter) throw new RestApiResourceError(`Related resource '${relInfo.target}' not found`, { subtype: 'related_type_not_found' })
    const tableName = adapter.getTableName()
    const column = `${tableName}.${adapter.getIdColumn()}`
    const links = buildRelatedLinkQuery({ descriptor, relInfo, relationshipKey, parentIds, db })
    const query = adapter.buildBaseQuery({ transaction: context.transaction })
      .whereIn(column, db.select('childId').from(links.as('related_identifiers')))
      .distinct(column)
    return applyScopeFiltersToIncludeQuery({
      query,
      scopes: api.resources,
      scopeName: relInfo.target,
      requestContext: context,
      db,
      tableName,
      queryPurpose: 'relationship-identifiers'
    })
  }

  /** @type {import('../storage/storage-types.js').CanonicalDataRelatedIdsQuery} */
  const dataRelatedIdsQuery = async ({ context, scopeName }) => {
    const info = getManyToManyInfo(scopeName, context.relationshipName)
    const query = buildRelatedLinkQuery({ ...info, parentIds: [normalizeId(context.id)], db: context.db })
    return { query: context.db.select('childId').from(query.as('related_links')) }
  }

  const buildLinkMutationQuery = ({ descriptor, relInfo, relationshipKey, inverseRelationshipKey, leftId, db, allParents = false }, constrainIds) => {
    return db(LINKS_TABLE).where('tenant_id', descriptor.tenant).where(owner => {
      owner.where(forward => {
        forward.where({
          relationship: relationshipKey,
          left_resource: descriptor.resource,
          ...(allParents ? {} : { left_id: leftId }),
          right_resource: relInfo.target
        })
        constrainIds(forward, 'right_id')
      }).orWhere(reverse => {
        reverse.where({
          right_resource: descriptor.resource,
          ...(allParents ? {} : { right_id: leftId }),
          left_resource: relInfo.target
        }).where(keys => {
          keys.where('inverse_relationship', relationshipKey)
          // A canonical link can predate publication of its inverse metadata.
          if (inverseRelationshipKey) keys.orWhere('relationship', inverseRelationshipKey)
        })
        constrainIds(reverse, 'left_id')
      })
    })
  }

  const fetchLinksForParents = async ({ descriptor, relationshipKey, targetResource, parentIds, db, visibleTargets }) => {
    const normalizedIds = [...new Set(parentIds
      .map((id) => normalizeId(id))
      .filter((id) => id !== null))]

    if (normalizedIds.length === 0) return []

    const results = []
    for (let offset = 0; offset < normalizedIds.length; offset += RELATIONSHIP_READ_BATCH_SIZE) {
      const batchIds = normalizedIds.slice(offset, offset + RELATIONSHIP_READ_BATCH_SIZE)
      let afterId
      // One parent can have many links; bound returned rows as well as requested IDs.
      while (true) {
        const query = db(LINKS_TABLE)
          .where('tenant_id', descriptor.tenant)
          .andWhere((builder) => {
            builder
              .where((q) => {
                q.where('relationship', relationshipKey)
                  .andWhere('left_resource', descriptor.resource)
                  .andWhere('right_resource', targetResource)
                  .whereIn('left_id', batchIds)
                if (visibleTargets) q.whereIn('right_id', visibleTargets.clone())
              })
              .orWhere((q) => {
                q.where('inverse_relationship', relationshipKey)
                  .andWhere('right_resource', descriptor.resource)
                  .andWhere('left_resource', targetResource)
                  .whereIn('right_id', batchIds)
                if (visibleTargets) q.whereIn('left_id', visibleTargets.clone())
              })
          })
          .select('id', 'relationship', 'inverse_relationship', 'left_resource', 'left_id', 'right_resource', 'right_id')
          .orderBy('id').limit(RELATIONSHIP_READ_BATCH_SIZE + 1)
        if (afterId !== undefined) query.where('id', '>', afterId)
        const rows = await query
        for (const row of rows) {
          let parentId
          let childId
          let childType

          if (row.relationship === relationshipKey && row.left_resource === descriptor.resource) {
            parentId = normalizeId(row.left_id)
            childId = normalizeId(row.right_id)
            childType = row.right_resource
          } else if (row.inverse_relationship === relationshipKey && row.right_resource === descriptor.resource) {
            parentId = normalizeId(row.right_id)
            childId = normalizeId(row.left_id)
            childType = row.left_resource
          } else {
            continue
          }

          if (parentId == null || childId == null) continue

          results.push({ parentId, childId, childType })
        }
        if (rows.length <= RELATIONSHIP_READ_BATCH_SIZE) break
        afterId = rows.at(-1).id
      }
    }

    return results
  }

  const attachLinks = async (options) => {
    const { descriptor, relInfo, relationshipKey, inverseRelationshipKey, leftId, relData, db } = options
    const relArray = Array.isArray(relData) ? relData : []
    if (relArray.length === 0) return
    assertVersionedRelationshipTransaction(api, relInfo, db)

    await lockRelationshipTargets(api, db, relArray.map(identifier => ({ type: relInfo.target, id: identifier.id })))

    const ids = [...new Set(relArray.map(identifier => normalizeId(identifier.id)).filter(id => id !== null))]
    const readLinks = batchIds => buildLinkMutationQuery(options, (query, column) => query.whereIn(column, batchIds))
      .select('id', 'left_id', 'right_id', 'inverse_relationship', db.raw(
        'case when ?? = ? and ?? = ? and ?? = ? then 1 else 0 end as ??',
        ['relationship', relationshipKey, 'left_resource', descriptor.resource, 'left_id', leftId, 'owner_left']
      )).orderBy('id').forUpdate()
    for (let offset = 0; offset < ids.length; offset += RELATIONSHIP_WRITE_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + RELATIONSHIP_WRITE_BATCH_SIZE)
      const requested = new Set(batch)
      const existingById = new Map()
      let hasExistingRows = false
      let afterId
      // Duplicate stored edges must not turn a bounded target batch into an unbounded read.
      while (true) {
        const query = readLinks(batch).limit(RELATIONSHIP_READ_BATCH_SIZE + 1)
        if (afterId !== undefined) query.where('id', '>', afterId)
        const rows = await query
        hasExistingRows ||= rows.length > 0
        for (const row of rows) {
          const targetId = normalizeId(row.owner_left ? row.right_id : row.left_id)
          if (requested.has(targetId) && !existingById.has(targetId)) existingById.set(targetId, row)
        }
        if (rows.length <= RELATIONSHIP_READ_BATCH_SIZE) break
        afterId = rows.at(-1).id
      }
      let inserted = false
      for (const rightId of batch) {
        let existing = existingById.get(rightId)
        // Unmatched spellings can equal another existing/new ID under the database collation.
        if (!existing && (hasExistingRows || inserted)) {
          existing = await readLinks([rightId]).first()
        }
        if (existing) {
          const inverseKey = existing.owner_left ? inverseRelationshipKey : relationshipKey
          if (!existing.inverse_relationship && inverseKey) {
            await db(LINKS_TABLE).where({ id: existing.id }).update({
              inverse_relationship: inverseKey, updated_at: db.fn.now()
            })
            existing.inverse_relationship = inverseKey
          }
          continue
        }
        const canonical = canonicalizeLinkPair({
          tenantId: descriptor.tenant,
          relationshipKey,
          inverseRelationshipKey,
          leftResource: descriptor.resource,
          leftId,
          rightResource: relInfo.target,
          rightId,
        })
        if (!canonical) continue
        await db(LINKS_TABLE).insert({
          ...canonical,
          payload: null,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        inserted = true
      }
    }
    await invalidateManyToManyVersions(api, relInfo, ids, db)
  }

  /** @type {import('../storage/storage-types.js').CanonicalLinkHelpers} */
  const methods = {
    attachMany: async ({ context, scopeName, relName, relDef, relData }) => {
      const info = getManyToManyInfo(scopeName, relName)
      if (!info) {
        throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`)
      }
      const db = context.transaction || context.db || api.knex.instance
      const leftId = normalizeId(context.id)
      await attachLinks({
        descriptor: info.descriptor,
        relInfo: info.relInfo,
        relationshipKey: info.relationshipKey,
        inverseRelationshipKey: info.inverseRelationshipKey,
        leftId,
        relData,
        db,
      })
    },
    syncMany: async ({ context, scopeName, relName, relDef, relData, isUpdate }) => {
      const info = getManyToManyInfo(scopeName, relName)
      if (!info) {
        throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`)
      }
      const db = context.transaction || context.db || api.knex.instance
      const leftId = normalizeId(context.id)
      if (isUpdate) {
        await syncLinks({
          descriptor: info.descriptor,
          relInfo: info.relInfo,
          relationshipKey: info.relationshipKey,
          inverseRelationshipKey: info.inverseRelationshipKey,
          leftId,
          relData,
          db,
        })
      } else {
        await attachLinks({
          descriptor: info.descriptor,
          relInfo: info.relInfo,
          relationshipKey: info.relationshipKey,
          inverseRelationshipKey: info.inverseRelationshipKey,
          leftId,
          relData,
          db,
        })
      }
    },
    removeMany: async ({ context, scopeName, relName, relData }) => {
      const info = getManyToManyInfo(scopeName, relName)
      if (!info) {
        throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`)
      }
      const db = context.transaction || context.db || api.knex.instance
      const leftId = normalizeId(context.id)
      await removeLinks({
        descriptor: info.descriptor,
        relInfo: info.relInfo,
        relationshipKey: info.relationshipKey,
        inverseRelationshipKey: info.inverseRelationshipKey,
        leftId,
        relData,
        db,
      })
    },
    listMany: async ({ context, scopeName, relName }) => {
      const info = getManyToManyInfo(scopeName, relName)
      if (!info) {
        throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`)
      }
      const db = context.transaction || context.db || api.knex.instance
      const leftId = normalizeId(context.id)
      return listLinks({
        descriptor: info.descriptor,
        relInfo: info.relInfo,
        relationshipKey: info.relationshipKey,
        inverseRelationshipKey: info.inverseRelationshipKey,
        leftId,
        db,
        context
      })
    },
    fetchManyToManyRows: async ({ scopeName, relName, parentIds, context }) => {
      const info = getManyToManyInfo(scopeName, relName)
      if (!info) return []
      const db = context.db || context.transaction || api.knex.instance
      return fetchLinksForParents({
        descriptor: info.descriptor,
        relationshipKey: info.relationshipKey,
        targetResource: info.relInfo.target,
        parentIds,
        db,
      })
    },
  }

  const invalidateLinkQueryVersions = async ({ query, db, relDef, resolveId }) => {
    if (!hasVersionedInverse(api, relDef)) return
    let afterId
    while (true) {
      const page = query.clone().orderBy('id').limit(RELATIONSHIP_WRITE_BATCH_SIZE).forUpdate()
        .select('id', 'relationship', 'left_resource', 'left_id', 'right_id')
      if (afterId !== undefined) page.where('id', '>', afterId)
      const rows = await page
      if (!rows.length) break
      await invalidateManyToManyVersions(api, relDef, rows.map(resolveId), db)
      afterId = rows.at(-1).id
    }
  }

  const invalidateRemovedLinkVersions = (options, query) => invalidateLinkQueryVersions({
    query,
    db: options.db,
    relDef: options.relInfo,
    resolveId: row => row.relationship === options.relationshipKey && row.left_resource === options.descriptor.resource && normalizeId(row.left_id) === options.leftId ? row.right_id : row.left_id
  })

  const invalidateDeletedLinkTargets = async (scopeName, context) => {
    const relationships = []
    for (const [parentType, parent] of Object.entries(api.resources)) {
      if (!parent.vars.schemaInfo?.versionField) continue
      for (const [relName, relationship] of Object.entries(parent.vars.schemaInfo.schemaRelationships)) {
        if (relationship.type !== 'manyToMany' || relationship.target !== scopeName) continue
        const inverse = { target: parentType, through: relationship.through, foreignKey: relationship.otherKey, otherKey: relationship.foreignKey }
        relationships.push({ inverse, info: getManyToManyInfo(parentType, relName) })
      }
    }
    if (!relationships.length) return
    assertVersionedRelationshipTransaction(api, relationships[0].inverse, context.transaction)
    await lockRelationshipTargets(api, context.transaction, [{ type: scopeName, id: context.id }])
    const id = normalizeId(context.id)
    for (const { inverse, info } of relationships) {
      const query = buildLinkMutationQuery({ ...info, db: context.transaction, allParents: true }, (query, column) => query.where(column, id))
      await invalidateLinkQueryVersions({
        query,
        db: context.transaction,
        relDef: inverse,
        resolveId: row => row.left_resource === scopeName && normalizeId(row.left_id) === id ? row.right_id : row.left_id
      })
    }
  }

  const syncLinks = async (options) => {
    assertVersionedRelationshipTransaction(api, options.relInfo, options.db)
    const relArray = Array.isArray(options.relData) ? options.relData : []
    const ids = [...new Set(relArray.map(identifier => normalizeId(identifier.id)).filter(id => id !== null))]
    await attachLinks(options)
    // The entire keep-list belongs in one predicate, even when it exceeds a read batch.
    const removals = buildLinkMutationQuery(options, (query, column) => {
      query.whereNot(removed => removed.modify(whereInIdentifiers, column, ids))
    })
    await invalidateRemovedLinkVersions(options, removals)
    await removals.delete()
  }

  const removeLinks = async (options) => {
    assertVersionedRelationshipTransaction(api, options.relInfo, options.db)
    const relArray = Array.isArray(options.relData) ? options.relData : []
    const ids = [...new Set(relArray.map(identifier => normalizeId(identifier.id)).filter(id => id !== null))]
    for (let offset = 0; offset < ids.length; offset += RELATIONSHIP_WRITE_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + RELATIONSHIP_WRITE_BATCH_SIZE)
      const removals = buildLinkMutationQuery(options, (query, column) => query.whereIn(column, batch))
      await invalidateRemovedLinkVersions(options, removals)
      await removals.delete()
    }
  }

  const listLinks = async ({ descriptor, relInfo, relationshipKey, leftId, db, context }) => {
    if (leftId == null) return []
    const parentIds = [leftId]
    const { query: visibleTargets } = await buildVisibleLinkTargets({ descriptor, relInfo, relationshipKey, parentIds, db, context })
    const rows = await buildRelatedLinkQuery({ descriptor, relInfo, relationshipKey, parentIds, db, visibleTargets })
    return rows.map(row => ({ type: relInfo.target, id: normalizeId(row.childId) }))
  }

  const deleteResourceLinks = async ({ descriptor, scopeName, id, db }) => {
    await db(LINKS_TABLE).where('tenant_id', descriptor.tenant).where(query => {
      query.where({ left_resource: scopeName, left_id: id }).orWhere({ right_resource: scopeName, right_id: id })
    }).delete()
  }

  return {
    methods,
    dataRelatedIdsQuery,
    getManyToManyInfo,
    buildRelatedLinkQuery,
    buildVisibleLinkTargets,
    fetchLinksForParents,
    invalidateDeletedLinkTargets,
    deleteResourceLinks
  }
}
