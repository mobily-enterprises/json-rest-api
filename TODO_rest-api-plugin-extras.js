
X (1) Make the user submit "country", not "country_id" in the POST/PUT/PATCH calls.

X (2) Have simplifiedTransport and simplifiedApi instead of just simplified.

X (3) Check what API calls are used in helpers, and most definitely use knex for deletes

X (4) Check that type: 'id' is not mandatory in schema

X (5) Maybe make the POST call support the return of the ID, but HTTPSERVER will need to ignore it as a non-resource



X (6) Have an option to hide fields (hidden: yes, normallyHidden: yes)
(Diffence being that normallyHidden CAN be made visible with field:...)

X (7) Computed/Virtual fields. They must be in schema at all times but not always whole record available. Support in sparse fieldsets
  
-------------------------------------------------

X (8) Check that limit/default order is maintained in sub queries in dataQuery


(10)
Query Depth Protection - Prevent malicious deep includes
  - Max depth limit for ?include=author.articles.author...


(11)
- Auto-format dates to ISO 8601

(12)
- Boolean coercion from SQLite

(14)
Check if post and put logic when zapping are correct



(13) 
Link and meta info in returned document

(9)
1. Relationship Endpoints - Separate endpoints for relationship manipulation
- GET /articles/1/relationships/comments
- POST/PUT/DELETE for relationship updates


(15)
Bulk operations












/**
 * Fetches the collection of full "child" resource objects belonging to a parent.
 * This function calls the related resource link (e.g., GET /api/articles/1/comments).
 * @param {string} parentType - The type of the parent resource (e.g., "articles").
 * @param {(string|number)} parentId - The ID of the parent resource.
 * @param {string} relationshipName - The name of the relationship to fetch (e.g., "comments").
 * @param {object} [queryParams={}] - Optional. An object to filter, sort, or paginate the **returned child resources**.
 * @returns {Promise<object>} A Promise that resolves to the JSON:API collection response for the related resources.
 *
 * @example
 * // Get the 10 newest comments for article "123", including each comment's author
 * const commentsResponse = await api.getRelated('articles', '123', 'comments', {
 * include: 'author',
 * sort: '-created-at',
 * page: { "number": 1, "size": 10 }
 * });
 * @see GET /api/articles/123/comments?include=author&sort=-created-at&page[number]=1&page[size]=10
 * // Example Return Value for commentsResponse:
 * // {
 * //   "links": { "self": "/api/articles/123/comments?..." },
 * //   "data": [
 * //     { "type": "comments", "id": "456", "attributes": { ... }, "relationships": { ... } }
 * //   ],
 * //   "included": [{ "type": "people", "id": "9", "attributes": { ... } }]
 * // }
 */
async function getRelated(parentType, parentId, relationshipName, queryParams = {}) {
  // Implementation calls GET /api/{parentType}/{parentId}/{relationshipName}
  console.log(`GET /api/${parentType}/${parentId}/${relationshipName}`, { queryParams });
  return Promise.resolve({});
}

/**
 * Fetches the linkage data only (the `type` and `id` identifiers) for a relationship.
 * This function calls the relationship link (e.g., GET /api/articles/1/relationships/comments).
 * @param {string} parentType - The type of the parent resource (e.g., "articles").
 * @param {(string|number)} parentId - The ID of the parent resource.
 * @param {string} relationshipName - The name of the relationship to fetch (e.g., "comments").
 * @returns {Promise<object>} A Promise that resolves to the JSON:API relationship linkage object.
 *
 * @example
 * // Get the linkage data for the author of article "123"
 * const authorLinkageResponse = await api.getRelationship('articles', '123', 'author');
 * @see GET /api/articles/123/relationships/author
 * // Example Return Value for authorLinkageResponse:
 * // {
 * //   "links": {
 * //     "self": "/api/articles/123/relationships/author",
 * //     "related": "/api/articles/123/author"
 * //   },
 * //   "data": { "type": "people", "id": "9" }
 * // }
 */
async function getRelationship(parentType, parentId, relationshipName) {
  // Implementation calls GET /api/{parentType}/{parentId}/relationships/{relationshipName}
  console.log(`GET /api/${parentType}/${parentId}/relationships/${relationshipName}`);
  return Promise.resolve({});
}


/**
 * Adds one or more links to an existing to-many relationship. This links existing resources; it does not create new ones.
 * This function sends a POST request to the relationship link.
 * @param {string} parentType - The type of the parent resource.
 * @param {(string|number)} parentId - The ID of the parent resource.
 * @param {string} relationshipName - The name of the relationship to modify.
 * @param {object[]} linkage - An array of resource identifier objects ({ type, id }) to add to the relationship.
 * @returns {Promise<void>} A Promise that resolves when the addition is complete. Server returns 204 No Content.
 *
 * @example
 * // Add tags with IDs "5" and "8" to article "123"
 * await api.postRelationship('articles', '123', 'tags', [
 * { "type": "tags", "id": "5" },
 * { "type": "tags", "id": "8" }
 * ]);
 * @see POST /api/articles/123/relationships/tags
 */
async function postRelationship(parentType, parentId, relationshipName, linkage) {
  // Implementation calls POST /api/{parentType}/{parentId}/relationships/{relationshipName}
  console.log(`POST /api/${parentType}/${parentId}/relationships/${relationshipName}`, { data: linkage });
  return Promise.resolve();
}

/**
 * Completely replaces the links in a relationship with a new set of links.
 * This function sends a PATCH request to the relationship link.
 * @param {string} parentType - The type of the parent resource.
 * @param {(string|number)} parentId - The ID of the parent resource.
 * @param {string} relationshipName - The name of the relationship to modify.
 * @param {object|object[]|null} linkage - The new, complete set of resource identifier objects ({ type, id }) for the relationship.
 * @returns {Promise<void>} A Promise that resolves when the replacement is complete. Server returns 204 No Content.
 *
 * @example
 * // Set the tags for article "123" to be ONLY tag "5"
 * await api.patchRelationship('articles', '123', 'tags', [
 * { "type": "tags", "id": "5" }
 * ]);
 * @see PATCH /api/articles/123/relationships/tags
 */
async function patchRelationship(parentType, parentId, relationshipName, linkage) {
  // Implementation calls PATCH /api/{parentType}/{parentId}/relationships/{relationshipName}
  console.log(`PATCH /api/${parentType}/${parentId}/relationships/${relationshipName}`, { data: linkage });
  return Promise.resolve();
}

/**
 * Removes one or more links from a to-many relationship. This does not delete the resources themselves.
 * This function sends a DELETE request to the relationship link.
 * @param {string} parentType - The type of the parent resource.
 * @param {(string|number)} parentId - The ID of the parent resource.
 * @param {string} relationshipName - The name of the relationship to modify.
 * @param {object[]} linkage - An array of resource identifier objects ({ type, id }) to remove from the relationship.
 * @returns {Promise<void>} A Promise that resolves when the removal is complete. Server returns 204 No Content.
 *
 * @example
 * // Remove the tag with ID "7" from article "123"
 * await api.deleteRelationship('articles', '123', 'tags', [
 * { "type": "tags", "id": "7" }
 * ]);
 * @see DELETE /api/articles/123/relationships/tags
 */
async function deleteRelationship(parentType, parentId, relationshipName, linkage) {
  // Implementation calls DELETE /api/{parentType}/{parentId}/relationships/{relationshipName}
  console.log(`DELETE /api/${parentType}/${parentId}/relationships/${relationshipName}`, { data: linkage });
  return Promise.resolve();
}




