// @ts-check
/** @import { DataRelatedIdsQuery, DataQueryCount, RelatedQueryRequest, CanonicalLinkHelpers } from '../../plugins/core/lib/storage/storage-types.js' */

/**
 * @param {DataRelatedIdsQuery} related
 * @param {DataQueryCount} count
 * @param {RelatedQueryRequest} request
 * @param {CanonicalLinkHelpers} links
 */
export async function checkRelationshipStorage (related, count, request, links) {
  const { query } = await related(request)
  query.clone().clearOrder().toSQL()
  ;(await count(request)).toFixed()
  ;(await count({ scopeName: 'items', context: { db: request.context.db, queryParams: {} } })).toFixed()
  const mutation = { scopeName: request.scopeName, relName: request.context.relationshipName, context: request.context, relData: [{ type: 'groups', id: '1' }] }
  await links.attachMany(mutation)
  await links.syncMany({ ...mutation, isUpdate: true })
  await links.removeMany(mutation)
  for (const row of await links.listMany(mutation)) if (row.id !== null) row.id.toUpperCase()
  const rows = await links.fetchManyToManyRows({ ...mutation, parentIds: ['1', 2] })
  rows.map(row => `${row.parentId}:${row.childType}:${row.childId}`)
  // @ts-expect-error The result wraps a deferred query, not an array of identifiers.
  ;(await related(request)).map(row => row.id)
  // @ts-expect-error Pivot joins require both declared key names.
  related({ ...request, relDef: { through: 'memberships', foreignKey: 'itemId' } })
  // @ts-expect-error A relationship query requires its parent identity.
  related({ ...request, context: { db: request.context.db, relationshipName: 'groups' } })
  // @ts-expect-error Count helpers return numbers, not pagination documents.
  const invalidCount = (await count(request)).meta.total
  // @ts-expect-error Replacement versus initial attachment must be explicit.
  links.syncMany(mutation)
  // @ts-expect-error Mutation helpers return no linkage document.
  const invalidMutation = (await links.attachMany(mutation)).data
  // @ts-expect-error Raw listed link IDs must be checked for null.
  ;(await links.listMany(mutation))[0]?.id.toUpperCase()
  // @ts-expect-error Multi-parent fetching requires an explicit parent list.
  links.fetchManyToManyRows(mutation)
  return { invalidCount, invalidMutation }
}
