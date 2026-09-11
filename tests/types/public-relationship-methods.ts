import type { RelationshipMethods, ToManyRelationship, ToOneRelationship } from '../../types/relationship-methods.js'
import type { JsonApiDocument, ResourceIdentifier } from '../../types/representations.js'
interface Relations {
  children: ToManyRelationship<{ name: string }, 'items'>
  owner: ToOneRelationship<{ displayName: string }, 'users'>
}
declare const groups: RelationshipMethods<Relations>
declare const dynamic: RelationshipMethods
await dynamic.getRelated({ id: '1', relationshipName: 'configured-at-runtime', queryParams: { page: { size: 10 } } })
await dynamic.patchRelationship({ id: '1', relationshipName: 'configured-at-runtime', relationshipData: [{ type: 'items', id: '2' }] })
const children = await groups.getRelated({ id: '1', relationshipName: 'children', queryParams: { page: { size: 10 } } })
const childName: string | undefined = children.data[0]?.name
const owner = await groups.getRelated({ id: '1', relationshipName: 'owner' })
const displayName: string | undefined = owner?.displayName
const linkage: JsonApiDocument<ResourceIdentifier<'users'> | null> = await groups.getRelationship({ id: '1', relationshipName: 'owner', format: 'plain' })
const none: void = await groups.patchRelationship({ id: '1', relationshipName: 'owner', relationshipData: null, expectedVersion: 'token' })
await groups.postRelationship({ id: '1', relationshipName: 'children', relationshipData: [{ type: 'items', id: 2 }] })
await groups.deleteRelationship({ id: '1', relationshipName: 'children', relationshipData: [], expectedVersion: 'token' })
void [childName, displayName, linkage, none]

// @ts-expect-error Unknown relationship names do not widen the declared map.
await groups.getRelated({ id: '1', relationshipName: 'missing' })
// @ts-expect-error To-one relationships cannot be appended to.
await groups.postRelationship({ id: '1', relationshipName: 'owner', relationshipData: [] })
// @ts-expect-error To-one relationships are cleared with PATCH, not DELETE linkage.
await groups.deleteRelationship({ id: '1', relationshipName: 'owner', relationshipData: [] })
// @ts-expect-error To-many replacement requires an array rather than null.
await groups.patchRelationship({ id: '1', relationshipName: 'children', relationshipData: null })
// @ts-expect-error To-one replacement requires an identifier rather than an array.
await groups.patchRelationship({ id: '1', relationshipName: 'owner', relationshipData: [] })
// @ts-expect-error Linkage must identify the configured target type.
await groups.postRelationship({ id: '1', relationshipName: 'children', relationshipData: [{ type: 'users', id: '2' }] })
// @ts-expect-error Related to-one reads do not accept collection pagination.
await groups.getRelated({ id: '1', relationshipName: 'owner', queryParams: { page: { size: 10 } } })
// @ts-expect-error To-one plain output is nullable.
owner.displayName
