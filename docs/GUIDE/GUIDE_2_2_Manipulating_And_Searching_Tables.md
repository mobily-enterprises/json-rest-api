# 2.2 Manipulating and searching tables with no relationships

## Setting up the schema

First of all, define a resource with a schema:

```javascript
// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
await api.resources.countries.createKnexTable()
```

## Adding data

Note that we create the database table at the same time.
This resource has just two fields, name and code, both searchable.

Programmatically you can `post` and `get` easily:

```javascript
const addedFrance = await api.resources.countries.post({ name: 'France', code: 'FR' });
console.log('Added record    :', inspect(addedFrance))

const fetchedFrance = await api.resources.countries.get({ id: addedFrance.id });
console.log('Refetched record:', inspect(fetchedFrance))
```

After the logging messages, you will see:

```text
Added record    : { id: '1', name: 'France', code: 'FR' }
Refetched record: { id: '1', name: 'France', code: 'FR' }
Express server started on port 3000. API available at http://localhost:3000/api
```

You can do the same thing talking to the server directly (although you will be dealing with JSON:API results).
Leaving the code as it is, you will add nother country:


```bash
$ curl -i -X POST -H "Content-Type: application/vnd.api+json" -d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    }
  }
}' http://localhost:3000/api/countries
```
```text
HTTP/1.1 204 No Content
X-Powered-By: Express
Location: /api/1.0/countries/2
ETag: W/"a-bAsFyilMr4Ra1hIU5PyoyFRunpI"
Date: Wed, 23 Jul 2025 07:54:09 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```
```bash
$ curl -i -X GET http://localhost:3000/api/countries/2
```
```txt
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/vnd.api+json; charset=utf-8
Content-Length: 169
ETag: W/"a9-lnEVXaZ/V6qra0YgjpoEBUTZ3EY"
Date: Wed, 23 Jul 2025 07:54:12 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":{"type":"countries","id":"2","attributes":{"name":"United Kingdom","code":"UK"},"links":{"self":"/api/1.0/countries/2"}},"links":{"self":"/api/1.0/countries/2"}}
```

Note that in "transport" mode after the POST the record was not returned to the client: instead, a status `204 No Content` was returned. However, the client will be aware of the ID of the newly created record thanks to the `Location` header.

## Manipulating data

Replace the data commands with these:

```javascript
await api.addResource('countries', {
  schema: {
    id: { type: 'string' },
    name: { type: 'string', required: true, max: 100, search: true, filterOperator: 'like' },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
await api.resources.countries.createKnexTable()

const fr = await api.resources.countries.post({ name: 'France', code: 'FR' });
const it = await api.resources.countries.post({ name: 'Italyy', code: 'IT' }); // Typo intentional
const de = await api.resources.countries.post({ name: 'Germ', code: 'DE' }); // Typo intentional

// Patching Germany. It will only change the name
await api.resources.countries.patch({id: de.id, name: 'Germany' })
let deFromDb = await api.resources.countries.get({ id: de.id });

// Putting  France. Note that this will actually reset any attributes that were not passed
await api.resources.countries.put({id: it.id, name: 'Italy' })
let itFromDb = await api.resources.countries.get({ id: it.id });

console.log('Patched record (Germany):', inspect(deFromDb))
console.log('Put record: (Italy)', inspect(itFromDb))
```

The result will be:

```text
Patched record (Germany): { id: '3', name: 'Germany', code: 'DE' }
Put record: (Italy) { id: '2', name: 'Italy', code: null }
```

As you can see, using PUT on Italy was a problem: since put didn't include the `code` field, and since PUT assumes a FULL record, the `code` field was reset to null. On the other hand, since the method PATCH assumes a partial update, the update for Germany did not _not_ overwrite the `code` field. This is a very important distinction, and it's the reason why most clients avoid PUT calls.


## Search (Filtering)

The API supports powerful filtering capabilities out of the box for any fields you've marked as `search: true` in your schema.

**Important Note about Query Results in Simplified Mode:**

When using `query()` in simplified mode (the default for programmatic access), the return value is an object containing:
- `data`: The array of matching records
- `meta`: Metadata about the results (e.g., pagination info)
- `links`: Links for pagination and related resources

For example:
```javascript
const result = await api.resources.countries.query({ /* ... */ });
// result is: { data: [...], meta: {...}, links: {...} }
// To access the records: result.data
```

**Programmatic Example: Searching for countries**

Change the code to add some countries:

```javascript
const fr = await api.resources.countries.post({ name: 'France', code: 'FR' });
const it = await api.resources.countries.post({ name: 'Italy', code: 'IT' });
const de = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const au = await api.resources.countries.post({ name: 'Australia', code: 'AU' });
const at = await api.resources.countries.post({ name: 'Austria', code: 'AT' });
const ge = await api.resources.countries.post({ name: 'Georgia', code: 'GE' });

const searchAustralia = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Australia'
    }
  }
});
// HTTP: GET /api/countries?filter[name]=Australia
// Returns: {
//   data: [{ id: '2', name: 'Australia', code: 'AU' }]
// }

const searchAustr = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Austr'
    }
  }
});
// HTTP: GET /api/countries?filter[name]=Austr
// Returns: {
//   data: []
// }

console.log('Search for "Australia":', inspect(searchAustralia))
console.log('Search for "Austr":', inspect(searchAustr))
// Note: searchAustralia and searchAustr contain { data, meta, links } objects
```

The result will be:

```
Search for Australia: { data: [ { id: '4', name: 'Australia', code: 'AU' } ], meta: {...}, links: {...} }
Search for "Austr": { data: [], meta: {...}, links: {...} }
```

It's clear that the search is only matching precise results.


There are two ways to enable search on a field in your schema. The first one is the one we are currently using, with `search: true`.
As seen above, the only time filtering works is when there is an exact match.
However, rather than `true` or `false`, `search` can also be an object.
Changing the definition of `name` in the `countries` resource to this:

```javascript
    name: { type: 'string', required: true, max: 100, search: { filterOperator: 'like' } },
```

Will give you the expected results:

```text
Search for Australia: [ { id: '4', name: 'Australia', code: 'AU' } ]
Search for "Austr": [
  { id: '4', name: 'Australia', code: 'AU' },
  { id: '5', name: 'Austria', code: 'AT' }
]
```

This is the 

**Available operators for `filterOperator`:**
- `'='` - Exact match (default)
- `'like'` - Partial match with % wildcards automatically added on both sides
- `'>'`, `'>='`, `'<'`, `'<='` - Comparison operators for numeric/date fields
- Other SQL operators are passed through directly (e.g., `'!='`, `'<>'`)

Note: Only `'like'` receives special handling (automatic % wildcards). All other operators are passed directly to the SQL query.

You can also define multiple search patterns from a single field:

```javascript
await api.addResource('countries', {
  schema: {
    name: {
      type: 'string', required: true, search: {
        name: { filterOperator: '=', type: 'string' },
        nameLike: { filterOperator: 'like', type: 'string' }
      }
    },
    code: { type: 'string', unique: true, search: true }
  }
});
await api.resources.countries.createKnexTable()

await api.resources.countries.post({ name: 'Georgia', code: 'GE' });
await api.resources.countries.post({ name: 'France', code: 'FR' });
await api.resources.countries.post({ name: 'Italy', code: 'IT' });
await api.resources.countries.post({ name: 'Germany', code: 'DE' });
await api.resources.countries.post({ name: 'Australia', code: 'AU' });
await api.resources.countries.post({ name: 'Austria', code: 'AT' });

const searchAustralia = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Australia'
    }
  }
});
// HTTP: GET /api/countries?filter[name]=Australia
// Returns: {
//   data: [{ id: '2', name: 'Australia', code: 'AU' }]
// }

const searchAustr = await api.resources.countries.query({
  queryParams: {
    filters: {
      nameLike: 'Austr'
    }
  }
});
// HTTP: GET /api/countries?filter[nameLike]=Austr
// Returns: {
//   data: [{ id: '2', name: 'Australia', code: 'AU' }, { id: '3', name: 'Austria', code: 'AT' }]
// }

console.log('Search for "Australia":', inspect(searchAustralia))
console.log('Search for "Austr":', inspect(searchAustr))
```

This is very powerful in that it allows you to define multiple ways of filtering a field depending on needs.

There is another, even more powerful way to define how to search in a resource: define a whole searchSchema that is completely independent to the main schema.

Under the hood, `rest-api-plugin` actually creates a `searchSchema` object based on the option on the default schema. However, it's very possible for an attribute to define a `searchSchema` directly: 


```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true }
  },
  searchSchema: {
    // Define searchable fields explicitly
    name: { type: 'string', filterOperator: '=' },
    code: { type: 'string', filterOperator: '=' },
    nameLike: { type: 'string', actualField: 'name', filterOperator: 'like' }
  }
});
await api.resources.countries.createKnexTable()
```

Note that the definition above is functionally _identical_ to the one provided a few paragraphs above.

**Important: When you define a `searchSchema`, it completely replaces the search configuration from the main schema.** Only fields defined in the `searchSchema` are searchable if `searchSchema` is defined.

The `searchSchema` gives you:

* complete control and isolation: With searchSchema, you define the search interface completely separately from the data schema. This can be cleaner when you have complex search requirements.
* No mixing of concerns: Your data schema stays focused on data validation and storage, while searchSchema handles search behavior.
* Easier to see all searchable fields at once: Everything is in one place rather than scattered across field definitions.
* Flexibility to completely diverge from the data schema: You might have 20 fields in your schema but only expose 3 for searching, or create 10 search fields from 3 data fields.

`searchSchema` also gives you the ability to define a search field that will search in multiple fields. For example:

```javascript
searchSchema: {
  search: {
    type: 'string',
    oneOf: ['name', 'code'],
    filterOperator: 'like'
  }
}

const searchGe = await api.resources.countries.query({
  queryParams: {
    filters: {
      search: 'ge'
    }
  }
});
// HTTP: GET /api/countries?filter[search]=ge
// Returns: {
//   data: [{ id: '3', name: 'Georgia', code: 'GE' }, { id: '6', name: 'Germany', code: 'DE' }]
// }

console.log('Search for "ge":', inspect(searchGe))
```

Will return:

```
Search for "ge": { data: [
  { id: '3', name: 'Georgia', code: 'GE' },
  { id: '6', name: 'Germany', code: 'DE' }
], meta: {...}, links: {...} }
```

This common pattern will give you the ability to create "global" search fields that will look in multiple fields.

### Multi-word Search with AND Logic

The `oneOf` search feature becomes even more powerful when combined with `splitBy` and `matchAll` options. This allows you to search for multiple words where ALL must appear somewhere in the specified fields.

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true },
    code: { type: 'string', unique: true }
  },
  searchSchema: {
    search: {
      type: 'string',
      oneOf: ['name', 'code'],
      filterOperator: 'like',
      splitBy: ' ',      // Split search terms by space
      matchAll: true     // Require ALL terms to match (AND logic)
    }
  }
});
await api.resources.countries.createKnexTable()
```

With this configuration, searching becomes much more precise:

```javascript
// Add some countries
await api.resources.countries.post({ name: 'United States', code: 'US' });
await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });
await api.resources.countries.post({ name: 'United Arab Emirates', code: 'AE' });
await api.resources.countries.post({ name: 'South Africa', code: 'ZA' });

// Search for "united states" - both words must appear
const results = await api.resources.countries.query({
  queryParams: {
    filters: {
      search: 'united states'
    }
  }
});
// HTTP: GET /api/countries?filter[search]=united%20states
// Returns: {
//   data: [{ id: '1', name: 'United States', code: 'US' }]
// }

console.log('Found:', results);
// Note: results contains { data, meta, links } - access results.data for the array
// Note: results now contains { data, meta, links } - access results.data for the array
// Returns: [{ id: '1', name: 'United States', code: 'US' }]
// Does NOT return United Kingdom or United Arab Emirates
```

**How it works:**

1. The search term "united states" is split by space into ["united", "states"]
2. With `matchAll: true`, the query requires BOTH terms to appear
3. Each term can appear in ANY of the fields listed in `oneOf`
4. The SQL generated looks like:

```sql
WHERE (
  (countries.name LIKE '%united%' OR countries.code LIKE '%united%')
  AND
  (countries.name LIKE '%states%' OR countries.code LIKE '%states%')
)
```

**More examples:**

```javascript
// Search for "south africa" - finds only South Africa
const southAfrica = await api.resources.countries.query({
  queryParams: { filters: { search: 'south africa' } }
});
// HTTP: GET /api/countries?filter[search]=south%20africa
// Returns: {
//   data: [{ id: '4', name: 'South Africa', code: 'ZA' }]
// }

// Search for "united arab" - finds only United Arab Emirates
const uae = await api.resources.countries.query({
  queryParams: { filters: { search: 'united arab' } }
});
// HTTP: GET /api/countries?filter[search]=united%20arab
// Returns: {
//   data: [{ id: '3', name: 'United Arab Emirates', code: 'AE' }]
// }

// Single word searches still work normally
const allUnited = await api.resources.countries.query({
  queryParams: { filters: { search: 'united' } }
});
// HTTP: GET /api/countries?filter[search]=united
// Returns: {
//   data: [
//   { id: '1', name: 'United States', code: 'US' },
//   { id: '2', name: 'United Kingdom', code: 'UK' },
//   { id: '3', name: 'United Arab Emirates', code: 'AE' }
// ]
// }
```

**Alternative configurations:**

You can also use different separators and OR logic:

```javascript
searchSchema: {
  // Comma-separated OR search
  tags: {
    type: 'string',
    oneOf: ['tags', 'categories', 'keywords'],
    filterOperator: 'like',
    splitBy: ',',       // Split by comma
    matchAll: false     // OR logic (default) - match ANY term
  },
  
  // Exact match with AND logic
  codes: {
    type: 'string',
    oneOf: ['primary_code', 'secondary_code'],
    filterOperator: '=',   // Exact match
    splitBy: ' ',
    matchAll: true      // All codes must match exactly
  }
}
```

This feature is particularly useful for:
- Full-text search functionality where users type multiple words
- Tag or keyword searches where all terms must be present
- Product searches matching multiple criteria
- Finding records that match complex multi-word queries

### Custom Search Functions

If you need even more complex searches, you can use `searchSchema` to define search fields with custom query logic:

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true },
    code: { type: 'string', unique: true }
  },
  searchSchema: {
    // Standard fields
    name: { type: 'string', filterOperator: '=' },
    code: { type: 'string', filterOperator: '=' },
    
    // Custom search using a function
    nameOrCode: {
      type: 'string',
      applyFilter: function(query, filterValue) {
        // Custom SQL logic: case-insensitive search in name OR exact match on code
        query.where(function() {
          this.whereRaw('LOWER(name) LIKE LOWER(?)', [`%${filterValue}%`])
              .orWhereRaw('LOWER(code) = LOWER(?)', [filterValue]);
        });
      }
    }
  }
});
await api.resources.countries.createKnexTable()

await api.resources.countries.post({ name: 'United States', code: 'US' });
await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });
await api.resources.countries.post({ name: 'United Arab Emirates', code: 'AE' });
await api.resources.countries.post({ name: 'South Africa', code: 'ZA' });
```

When `filterOperator` is a function instead of an operator string, it receives:
- `query` - The Knex query builder instance
- `filterValue` - The search value from the user
- `fieldName` - The name of the search field (optional third parameter)

This gives you complete control over the SQL generated for that search field.

**Example usage:**

```javascript
// This custom search will find both:
// - Countries with "at" in the name (United States, United Kingdom, United Arab Emirates)
// - Countries with code "at"
const results = await api.resources.countries.query({
  queryParams: {
    filters: {
      nameOrCode: 'at'
    }
  }
});
// HTTP: GET /api/countries?filter[nameOrCode]=at
// Returns: {
//   data: [
//   { id: '1', name: 'United States', code: 'US' },
//   { id: '2', name: 'United Kingdom', code: 'UK' },
//   { id: '3', name: 'United Arab Emirates', code: 'AE' },
//   { id: '5', name: 'Austria', code: 'AT' }
// ]
// }
```

The result is:

```text
Query results: [
  { id: '1', name: 'United States', code: 'US' },
  { id: '3', name: 'United Arab Emirates', code: 'AE' }
]
```

The function approach is powerful for:
- Case-insensitive searches
- Complex conditions combining multiple fields
- Database-specific functions
- Custom business logic in searches

Since `applyFilter` functions tend to be database-dependent, it's best to avoid using it unless necessary.

### Sparse Fieldsets

The JSON:API specification includes a powerful feature called "sparse fieldsets" that allows you to request only specific fields from a resource. This is essential for optimizing API performance by reducing payload sizes and network traffic.

**How Sparse Fieldsets Work:**

By default, API responses include all fields defined in the schema. With sparse fieldsets, you can specify exactly which fields you want returned. The `id` field is always included automatically as it's required by JSON:API.

Let's work with our countries table:

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }
  }
});
await api.resources.countries.createKnexTable()

// Add some test data
await api.resources.countries.post({ name: 'France', code: 'FR' });
await api.resources.countries.post({ name: 'Germany', code: 'DE' });
await api.resources.countries.post({ name: 'Italy', code: 'IT' });
await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });
await api.resources.countries.post({ name: 'United States', code: 'US' });
```

**Sparse Fieldsets with `get()` - Single Record:**

```javascript
// Fetch a single country with all fields (default behavior)
const fullCountry = await api.resources.countries.get({ id: '1' });
console.log('Full record:', inspect(fullCountry));

// Fetch only the name field
const nameOnly = await api.resources.countries.get({ 
  id: '1',
  queryParams: { fields: { countries: 'name' } }
});
console.log('Name only:', inspect(nameOnly));

// Fetch only the code field
const codeOnly = await api.resources.countries.get({ 
  id: '1',
  queryParams: { fields: { countries: 'code' } }
});
console.log('Code only:', inspect(codeOnly));
```

The output will be:

```text
Full record: { id: '1', name: 'France', code: 'FR' }
Name only: { id: '1', name: 'France' }
Code only: { id: '1', code: 'FR' }
```

**Sparse Fieldsets with `query()` - Multiple Records:**

Sparse fieldsets become even more valuable when fetching collections, as they can significantly reduce the response size:

```javascript
// Query all countries starting with 'United' - full records
const fullRecords = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' }
  }
});
// HTTP: GET /api/countries?filter[name]=United
// Returns: {
//   data: [
//   { id: '4', name: 'United Kingdom', code: 'UK' },
//   { id: '5', name: 'United States', code: 'US' }
// ]
// }

console.log('Full records:', inspect(fullRecords));
// Note: fullRecords contains { data, meta, links }

// Query with only names returned
const namesOnly = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' },
    fields: { countries: 'name' }
  }
});
// HTTP: GET /api/countries?filter[name]=United&fields[countries]=name
// Returns: {
//   data: [
//   { id: '4', name: 'United Kingdom' },
//   { id: '5', name: 'United States' }
// ]
// }

console.log('Names only:', inspect(namesOnly));
// Note: namesOnly contains { data, meta, links }

// Query with only codes returned
const codesOnly = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' },
    fields: { countries: 'code' }
  }
});
// HTTP: GET /api/countries?filter[name]=United&fields[countries]=code
// Returns: {
//   data: [
//   { id: '4', code: 'UK' },
//   { id: '5', code: 'US' }
// ]
// }

console.log('Codes only:', inspect(codesOnly));
// Note: codesOnly contains { data, meta, links }
```

**Combining Sparse Fieldsets with Complex Searches:**

Sparse fieldsets work seamlessly with all search features, including our new multi-word search:

```javascript
// Define a countries resource with multi-word search
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true },
    code: { type: 'string', unique: true },
    population: { type: 'integer' },
    continent: { type: 'string' }
  },
  searchSchema: {
    search: {
      type: 'string',
      oneOf: ['name', 'continent'],
      filterOperator: 'like',
      splitBy: ' ',
      matchAll: true
    }
  }
});

// Add countries with more fields
await api.resources.countries.post({ 
  name: 'South Africa', 
  code: 'ZA', 
  population: 59308690,
  continent: 'Africa'
});
await api.resources.countries.post({ 
  name: 'South Korea', 
  code: 'KR', 
  population: 51269185,
  continent: 'Asia'
});

// Search for "south africa" but return only name and population
const sparseSearch = await api.resources.countries.query({
  queryParams: {
    filters: { search: 'south africa' },
    fields: { countries: 'name,population' }
  }
});
// HTTP: GET /api/countries?filter[search]=south%20africa&fields[countries]=name,population
// Returns: {
//   data: [{ id: '1', name: 'South Africa', population: 59308690 }]
// }

console.log('Sparse search result:', inspect(sparseSearch));
// Note: sparseSearch contains { data, meta, links }
```

**Important Notes:**

1. **The `id` field is always included** - This is required by the JSON:API specification
2. **Field names must match schema** - Requesting non-existent fields will be ignored
3. **Improves performance** - Especially important for large records or when fetching many records
4. **Works with relationships** - When we cover relationships, you'll see how to apply sparse fieldsets to related resources too

**HTTP API Usage:**

When using the HTTP API, sparse fieldsets are specified as comma-separated values:

```
GET /api/countries?fields[countries]=name,code
GET /api/countries/1?fields[countries]=name
GET /api/countries?filter[search]=united+states&fields[countries]=code
```

---

[Previous: 2.1 The starting point](./GUIDE_2_1_The_Starting_Point.md) | [Back to Guide](./README.md) | [Next: 2.3 `belongsTo` Relationships](./GUIDE_2_3_BelongsTo_Relationships.md)