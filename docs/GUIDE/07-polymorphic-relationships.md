---
title: "Polymorphic relationships"
chapter: 7
chapter_label: "07"
---

# 07. Polymorphic relationships

A review can belong to a publisher or an author. Its relationship identity has
two parts: the resource type and ID. A publisher and an author can share an ID
without sharing reviews.

The child declares `belongsToPolymorphic` with allowed target types and the two
logical storage fields. Each parent declares a reverse `hasMany` with `via`
pointing to that child relationship. Insert these blocks in order into the
[starting script](03-running-example.md), using a fresh database.

## Define the relationships and filters

```javascript
await api.addResource('publishers', {
  schema: { name: { type: 'string', required: true, indexed: true } },
  relationships: { reviews: { type: 'hasMany', target: 'reviews', via: 'reviewable' } },
  searchSchema: {
    reviewComment: { type: 'string', actualField: 'reviews.comment', filterOperator: 'contains' }
  }
})
await api.addResource('authors', {
  schema: { name: { type: 'string', required: true, indexed: true } },
  relationships: { reviews: { type: 'hasMany', target: 'reviews', via: 'reviewable' } },
  searchSchema: {
    reviewComment: { type: 'string', actualField: 'reviews.comment', filterOperator: 'contains' }
  }
})
await api.addResource('reviews', {
  schema: {
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', required: true, indexed: true },
    reviewable_type: { type: 'string', required: true },
    reviewable_id: { type: 'id', required: true }
  },
  relationships: {
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'],
        typeField: 'reviewable_type',
        idField: 'reviewable_id'
      }
    }
  },
  searchSchema: {
    reviewableName: {
      type: 'string',
      polymorphicField: 'reviewable',
      targetFields: { publishers: 'name', authors: 'name' },
      filterOperator: 'contains'
    }
  }
})
await api.resources.publishers.createKnexTable()
await api.resources.authors.createKnexTable()
await api.resources.reviews.createKnexTable()
```

Target name and review comment fields declare `indexed: true` for cross-table
filtering. `reviewableName` explicitly maps each allowed target type to its
search field. The two reverse `reviewComment` filters search only reviews of
the corresponding parent type.

## Write plain records and JSON:API documents

```javascript
const publisher = await api.resources.publishers.post({
  inputRecord: { id: '1', name: 'French Books' }
})
const author = await api.resources.authors.post({
  inputRecord: { id: '1', name: 'Victor Hugo' }
})
const publisherReview = await api.resources.reviews.post({
  inputRecord: {
    rating: 4, comment: 'Reliable publisher',
    reviewable: { _type: 'publishers', id: publisher.id }
  }
})
const authorReviewDocument = await api.resources.reviews.post({
  format: 'jsonapi',
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: { rating: 5, comment: 'Excellent author' },
      relationships: {
        reviewable: { data: { type: 'authors', id: author.id } }
      }
    }
  }
})
```

Plain polymorphic input uses `{ _type, id }` under the relationship alias.
JSON:API uses `{ type, id }` under `data.relationships.reviewable.data`.
Do not write `reviewable_type` or `reviewable_id` as public attributes. Those
logical fields describe storage; the public relationship represents them together.
Plain output uses `_type` to identify the related resource type as well.

## Include either direction

```javascript
const publisherWithReviews = await api.resources.publishers.get({
  id: publisher.id, queryParams: { include: ['reviews'] }
})
const authorWithReviews = await api.resources.authors.get({
  id: author.id, queryParams: { include: ['reviews'] }
})
const reviewsWithTargets = await api.resources.reviews.query({
  queryParams: { include: ['reviewable'], sort: ['id'] }
})
const reviewDocument = await api.resources.reviews.query({
  format: 'jsonapi',
  queryParams: { include: ['reviewable'], sort: ['id'] }
})
console.log('Publisher reviews:', publisherWithReviews.reviews)
console.log('Author reviews:', authorWithReviews.reviews)
console.log('Embedded targets:', reviewsWithTargets.data)
console.log('JSON:API targets:', reviewDocument.included)
```

Each parent has exactly its own review, despite both having ID `1`. Plain
included targets contain `_type`, ID and selected attributes. The JSON:API
`included` array contains both target resources, distinguished by `type` and
`id`; it must not merge them merely because their IDs match.

## Filter forward and backward

```javascript
const reviewsOfVictor = await api.resources.reviews.query({
  queryParams: { filters: { reviewableName: 'Victor' } }
})
const reliablePublishers = await api.resources.publishers.query({
  queryParams: { filters: { reviewComment: 'Reliable' } }
})
const reliableAuthors = await api.resources.authors.query({
  queryParams: { filters: { reviewComment: 'Reliable' } }
})
console.log('Reviews of Victor:', reviewsOfVictor.data)
console.log('Reliable publishers:', reliablePublishers.data)
console.log('Reliable authors:', reliableAuthors.data)
```

The forward filter finds the author review. The reverse filter finds French
Books; the same filter on authors returns no records. These are declared search
contracts, not arbitrary client-selected SQL paths. Filtering does not itself
request included resource attributes.

## Move a review to a different target type

```javascript
await api.resources.reviews.patchRelationship({
  id: publisherReview.id,
  relationshipName: 'reviewable',
  relationshipData: { type: 'authors', id: author.id }
})
const publisherLinkage = await api.resources.publishers.getRelationship({
  id: publisher.id, relationshipName: 'reviews'
})
const authorLinkage = await api.resources.authors.getRelationship({
  id: author.id, relationshipName: 'reviews'
})
console.log('Publisher linkage after move:', publisherLinkage.data)
console.log('Author linkage after move:', authorLinkage.data)
```

The target ID stays `1` but its type changes. The publisher then has no reviews,
and the author has both. Relationship-only writes take `relationshipData` and
return undefined. Because this schema makes the type and ID fields required,
the relationship cannot be cleared to null. Use a nullable relationship design
when reviews are allowed to remain unassigned.

## HTTP representation

For a server running the completed example, read either side with:

```bash
curl --globoff 'http://localhost:3000/api/authors/1?include=reviews'
curl --globoff 'http://localhost:3000/api/reviews?include=reviewable'
curl --globoff 'http://localhost:3000/api/reviews?filter[reviewableName]=Victor'
```

HTTP uses JSON:API type/ID linkage. To move a review, PATCH
`/api/reviews/{id}/relationships/reviewable` with a body such as
`{"data":{"type":"publishers","id":"1"}}` and content type
`application/vnd.api+json`. Use returned IDs for an existing database.
