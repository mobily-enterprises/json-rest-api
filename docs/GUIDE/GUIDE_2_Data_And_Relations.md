# Data and relations

* Power is in relations
* Not an ORM: a JSON:API compliant API
* Defining dataset and explaining all possible relations

## The starting point

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api'; // Added: ExpressPlugin
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express'; // Added: Express

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 8 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({ name: 'book-catalog-api', version: '1.0.0' });

// Install plugins
await api.use(RestApiPlugin, { publicBaseUrl: '/api/1.0' });
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Added: Express Plugin

/// *** ...programmatic calls here... ***

// Createthe express server and add the API's routes 
const app = express();
app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);

app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
});
```

Note that every time we provide a snippet of code, it will be assumed that

(1) The script is edited in the section `/// *** ...programmatic calls here... ***`
(2) The code is stopped with CTRL-C and then restarted. 
(3) The core proposed in each snippet _replaces_ the code provided earlier.

This will ensure that each example has a fresh start.

Each example will be introduced programmatically first, and then via HTTP. The HTTP calls will be run assuming that the API calls (and any data created with them) stay. The use of the in-memory database will be assumed, which means that the data will start afresh each time.

## Manipulating and searching tables with no relationships

### Setting up the schema

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

### Adding data

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

### Manipulating data

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


### Search (Filtering)

The API supports powerful filtering capabilities out of the box for any fields you've marked as `search: true` in your schema.

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
const searchAustr = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Austr'
    }
  }
});
console.log('Search for "Australia":', inspect(searchAustralia))
console.log('Search for "Austr":', inspect(searchAustr))
```

The result will be:

```
Search for Australia: [ { id: '4', name: 'Australia', code: 'AU' } ]
Search for "Austr": []
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
const searchAustr = await api.resources.countries.query({
  queryParams: {
    filters: {
      nameLike: 'Austr'
    }
  }
});
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
console.log('Search for "ge":', inspect(searchGe))
```

Will return:

```
Search for "ge": [
  { id: '3', name: 'Georgia', code: 'GE' },
  { id: '6', name: 'Germany', code: 'DE' }
]
```

This common pattern will give you the ability to create "global" search fields that will look in multiple fields.

#### Multi-word Search with AND Logic

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
console.log('Found:', results);
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
// Returns: [{ name: 'South Africa', code: 'ZA' }]

// Search for "united arab" - finds only United Arab Emirates
const uae = await api.resources.countries.query({
  queryParams: { filters: { search: 'united arab' } }
});
// Returns: [{ name: 'United Arab Emirates', code: 'AE' }]

// Single word searches still work normally
const allUnited = await api.resources.countries.query({
  queryParams: { filters: { search: 'united' } }
});
// Returns all countries with "united" in name or code
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

#### Custom Search Functions

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

#### Sparse Fieldsets

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
console.log('Full records:', inspect(fullRecords));
// Output: [
//   { id: '4', name: 'United Kingdom', code: 'UK' },
//   { id: '5', name: 'United States', code: 'US' }
// ]

// Query with only names returned
const namesOnly = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' },
    fields: { countries: 'name' }
  }
});
console.log('Names only:', inspect(namesOnly));
// Output: [
//   { id: '4', name: 'United Kingdom' },
//   { id: '5', name: 'United States' }
// ]

// Query with only codes returned
const codesOnly = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' },
    fields: { countries: 'code' }
  }
});
console.log('Codes only:', inspect(codesOnly));
// Output: [
//   { id: '4', code: 'UK' },
//   { id: '5', code: 'US' }
// ]
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
    fields: { countries: 'name,population'] }
  }
});
console.log('Sparse search result:', inspect(sparseSearch));
// Output: [{ id: '1', name: 'South Africa', population: 59308690 }]
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



## `belongsTo` Relationships

`belongsTo` relationships represent a one-to-one or many-to-one association where the current resource "belongs to" another resource. For example, a `book` belongs to an `author`, or an `author` belongs to a `country`. These relationships are typically managed by a **foreign key** on the "belonging" resource's table.

Let's expand our schema definitions to include `publishers` and link them to `countries`. These schemas will be defined **once** here and reused throughout this section.

```javascript
// Define countries resource
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true, indexed: true },
  }
});
await api.resources.countries.createKnexTable();

// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255 },
    country_id: { type: 'id', belongsTo: 'countries', as: 'country', nullable: true }
  },
  // searchSchema completely defines all filterable fields for this resource
  searchSchema: {
    name: { type: 'string' },
    country: { type: 'id', actualField: 'country_id', nullable: true },
    countryCode: { type: 'string', actualField: 'countries.code' }
  }
});
await api.resources.publishers.createKnexTable();
```

Now, let's add some data. Notice the flexibility of using either the foreign key field `country_id` or the relationship alias `country` when linking a publisher to a country in simplified mode.

```javascript
const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

// Create a publisher linking via the relationship alias (simplified syntax)
const frenchPublisher = await api.resources.publishers.post({
  name: 'French Books Inc.',
  country: france.id
});

// Create a publisher linking via the foreign key field directly
const germanPublisher = await api.resources.publishers.post({
  name: 'German Press GmbH',
  country_id: germany.id
});

const ukPublisher = await api.resources.publishers.post({
  name: 'UK Books Ltd.',
  country: uk.id
});

const internationalPublisher = await api.resources.publishers.post({
  name: 'Global Publishing',
  country_id: null
});


console.log('Added French Publisher:', inspect(frenchPublisher));
console.log('Added German Publisher:', inspect(germanPublisher));
console.log('Added UK Publisher:', inspect(ukPublisher));
console.log('Added International Publisher:', inspect(internationalPublisher));
```

**Explanation of Interchangeability (`country_id` vs. `country`):**

When defining a `belongsTo` relationship with an `as` alias (e.g., `country_id: { ..., as: 'country' }`), `json-rest-api` provides flexibility in how you provide the related resource's ID during `post`, `put`, or `patch` operations in **simplified mode**:

* You can use the **relationship alias** (the `as` value) directly with the ID of the related resource (e.g., `country: france.id`). This is generally recommended for clarity and aligns with the relationship concept.
* You can use the direct **foreign key field name** (e.g., `country_id: germany.id`). The system is flexible enough to recognize this as a foreign key and process it correctly.

Both approaches achieve the same result of setting the underlying foreign key in the database.

**Expected Output (Illustrative, IDs may vary):**

```text
Added French Publisher: { id: '1', name: 'French Books Inc.', country_id: '1' }
Added German Publisher: { id: '2', name: 'German Press GmbH', country_id: '2' }
Added UK Publisher: { id: '3', name: 'UK Books Ltd.', country_id: '3' }
Added International Publisher: { id: '4', name: 'Global Publishing', country_id: null }
```

### Including `belongsTo` Records (`include`)

To retrieve related `belongsTo` resources, use the `include` query parameter.

When fetching data programmatically, `simplified` mode is `true` by default. This means that instead of a separate `included` array (as in full JSON:API), related `belongsTo` resources are **denormalized and embedded directly** within the main resource's object structure, providing a very convenient and flat data structure for immediate use.

#### Programmatic Usage:

```javascript
// Re-add data for a fresh start (schemas are reused from above)
const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

await api.resources.publishers.post({ name: 'French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'Another French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'UK Books Ltd.', country: uk.id });
await api.resources.publishers.post({ name: 'German Press GmbH', country_id: germany.id });
await api.resources.publishers.post({ name: 'Global Publishing', country_id: null });


// Get a publisher and include its country (simplified mode output)
const publisherWithCountry = await api.resources.publishers.get({
  id: '1', // ID of French Books Inc.
  queryParams: {
    include: ['country'] // Use the 'as' alias defined in the schema
  }
});
console.log('Publisher with Country:', inspect(publisherWithCountry));

// Query all publishers and include their countries (simplified mode output)
const allPublishersWithCountries = await api.resources.publishers.query({
  queryParams: {
    include: ['country']
  }
});
console.log('All Publishers with Countries:', inspect(allPublishersWithCountries));

// Query all publishers and include their countries (simplified mode output)
const allPublishersWithCountriesNotSimplified = await api.resources.publishers.query({
  queryParams: {
    include: ['country']
  },
  simplified: false
});
console.log('All Publishers with Countries (not simplified):', inspect(allPublishersWithCountriesNotSimplified));
```

Here is the expected output. Notice how the last call shows the non-simplified version of the response, which is muc more verbose. However, it has one _major_ advantage: it only includes the information about France _once_. It might seem like a small gain here, but when you have complex queries where the `belongsTo` table has a lot of data, the saving is much more evident.

**Expected Output**

```text
Publisher with Country: {
  id: '1',
  name: 'French Books Inc.',
  country_id: '1',
  country: { id: '1', name: 'France', code: 'FR' }
}
All Publishers with Countries: [
  {
    id: '1',
    name: 'French Books Inc.',
    country_id: '1',
    country: { id: '1', name: 'France', code: 'FR' }
  },
  {
    id: '2',
    name: 'Another French Books Inc.',
    country_id: '1',
    country: { id: '1', name: 'France', code: 'FR' }
  },
  {
    id: '3',
    name: 'UK Books Ltd.',
    country_id: '3',
    country: { id: '3', name: 'United Kingdom', code: 'UK' }
  },
  {
    id: '4',
    name: 'German Press GmbH',
    country_id: '2',
    country: { id: '2', name: 'Germany', code: 'DE' }
  },
  { id: '5', name: 'Global Publishing' }
]
All Publishers with Countries (not simplified): {
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc.' },
      relationships: {
        country: {
          data: { type: 'countries', id: '1' },
          links: {
            self: '/api/1.0/publishers/1/relationships/country',
            related: '/api/1.0/publishers/1/country'
          }
        }
      },
      links: { self: '/api/1.0/publishers/1' }
    },
    {
      type: 'publishers',
      id: '2',
      attributes: { name: 'Another French Books Inc.' },
      relationships: {
        country: {
          data: { type: 'countries', id: '1' },
          links: {
            self: '/api/1.0/publishers/2/relationships/country',
            related: '/api/1.0/publishers/2/country'
          }
        }
      },
      links: { self: '/api/1.0/publishers/2' }
    },
    {
      type: 'publishers',
      id: '3',
      attributes: { name: 'UK Books Ltd.' },
      relationships: {
        country: {
          data: { type: 'countries', id: '3' },
          links: {
            self: '/api/1.0/publishers/3/relationships/country',
            related: '/api/1.0/publishers/3/country'
          }
        }
      },
      links: { self: '/api/1.0/publishers/3' }
    },
    {
      type: 'publishers',
      id: '4',
      attributes: { name: 'German Press GmbH' },
      relationships: {
        country: {
          data: { type: 'countries', id: '2' },
          links: {
            self: '/api/1.0/publishers/4/relationships/country',
            related: '/api/1.0/publishers/4/country'
          }
        }
      },
      links: { self: '/api/1.0/publishers/4' }
    },
    {
      type: 'publishers',
      id: '5',
      attributes: { name: 'Global Publishing' },
      relationships: {
        country: {
          data: null,
          links: {
            self: '/api/1.0/publishers/5/relationships/country',
            related: '/api/1.0/publishers/5/country'
          }
        }
      },
      links: { self: '/api/1.0/publishers/5' }
    }
  ],
  included: [
    {
      type: 'countries',
      id: '1',
      attributes: { name: 'France', code: 'FR' },
      relationships: {},
      links: { self: '/api/1.0/countries/1' }
    },
    {
      type: 'countries',
      id: '3',
      attributes: { name: 'United Kingdom', code: 'UK' },
      relationships: {},
      links: { self: '/api/1.0/countries/3' }
    },
    {
      type: 'countries',
      id: '2',
      attributes: { name: 'Germany', code: 'DE' },
      relationships: {},
      links: { self: '/api/1.0/countries/2' }
    }
  ],
  links: { self: '/api/1.0/publishers?include=country' }
}
```

---

### Sparse Fieldsets with `belongsTo` Relations

You can apply **sparse fieldsets** not only to the primary resource but also to the included `belongsTo` resources. This is powerful for fine-tuning your API responses and reducing payload sizes.

#### Programmatic Usage:

```javascript
// Re-add data for a fresh start (schemas are reused from above)

const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

await api.resources.publishers.post({ name: 'French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'UK Books Ltd.', country: uk.id });
await api.resources.publishers.post({ name: 'German Press GmbH', country_id: germany.id });
await api.resources.publishers.post({ name: 'Global Publishing', country_id: null });


// Get a publisher, include its country, but only retrieve publisher name and country code
const sparsePublisher = await api.resources.publishers.get({
  id: '1',
  queryParams: {
    include: ['country'],
    fields: {
      publishers: 'name',       // Only name for publishers
      countries: 'code'         // Only code for countries
    }
  }
  // simplified: true is default for programmatic fetches
});
console.log('Sparse Publisher and Country:', inspect(sparsePublisher));


// Query all publishers, include their countries, but only retrieve publisher name and country code
const sparsePublishersQuery = await api.resources.publishers.query({
  queryParams: {
    include: ['country'],
    fields: {
      publishers: 'name',       // Only name for publishers
      countries: 'code,name'    // BOTH code and name for countries
    }
  }
  // simplified: true is default for programmatic fetches
});
console.log('Sparse Publishers Query (all results):', inspect(sparsePublishersQuery));
```

Note that you can specify multiple fields for countries, and that they need to be comma separated.

**Important Note on Sparse Fieldsets for Related Resources:**
When you specify `fields: { countries: ['code'] }`, this instruction applies to *all* `country` resources present in the API response, whether `country` is the primary resource you are querying directly, or if it's included as a related resource. This ensures consistent data representation across the entire response.

**Expected Output (Sparse Publisher and Country - Illustrative, IDs may vary):**

```text
{
  id: '1',
  name: 'French Books Inc.',
  country_id: '1',
  country: { id: '1', code: 'FR' }
}
Sparse Publishers Query (all results): [
  {
    id: '1',
    name: 'French Books Inc.',
    country_id: '1',
    country: { id: '1', code: 'FR', name: 'France' }
  },
  {
    id: '2',
    name: 'UK Books Ltd.',
    country_id: '3',
    country: { id: '3', code: 'UK', name: 'United Kingdom' }
  },
  {
    id: '3',
    name: 'German Press GmbH',
    country_id: '2',
    country: { id: '2', code: 'DE', name: 'Germany' }
  },
  { id: '4', name: 'Global Publishing' }
]
```

### Filtering by `belongsTo` Relationships

You can filter resources based on conditions applied to their `belongsTo` relationships. This is achieved by defining filterable fields in the `searchSchema` that map to either the foreign key or fields on the related resource.

The `searchSchema` offers a clean way to define filters, abstracting away the underlying database structure and relationship navigation from the client. Clients simply use the filter field names defined in `searchSchema` (e.g., `countryCode` instead of `country.code`).

#### Programmatic Usage:

```javascript
// Re-add data for a fresh start (schemas are reused from above)
const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

await api.resources.publishers.post({ name: 'French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'UK Books Ltd.', country: uk.id });
await api.resources.publishers.post({ name: 'German Press GmbH', country_id: germany.id });
await api.resources.publishers.post({ name: 'Global Publishing', country_id: null });


// Programmatic search: Find publishers from France using the country ID alias in searchSchema
const publishersFromFrance = await api.resources.publishers.query({
  queryParams: {
    filters: {
      country: france.id // Using 'country' filter field defined in searchSchema
    }
  }
  // simplified: true is default for programmatic fetches
});
console.log('Publishers from France (by country ID):', inspect(publishersFromFrance));

// Programmatic search: Find publishers with no associated country
const publishersNoCountry = await api.resources.publishers.query({
  queryParams: {
    filters: {
      country: null // Filtering by null for the 'country' ID filter
    }
  }
  // simplified: true is default for programmatic fetches
});
console.log('Publishers with No Country (by country ID: null):', inspect(publishersNoCountry));

// Programmatic search: Find publishers where the associated country's code is 'UK'
const publishersFromUK = await api.resources.publishers.query({
  queryParams: {
    filters: {
      countryCode: 'UK' // Using 'countryCode' filter field defined in searchSchema
    }
  }
  // simplified: true is default for programmatic fetches
});
console.log('Publishers from UK (by countryCode):', inspect(publishersFromUK));
```

**Expected Output**

```text
Publishers from France (by country ID): [ { id: '1', name: 'French Books Inc.', country_id: '1' } ]
Publishers with No Country (by country ID: null): [ { id: '4', name: 'Global Publishing' } ]
Publishers from UK (by countryCode): [ { id: '2', name: 'UK Books Ltd.', country_id: '3' } ]
```

## hasMany records

`hasMany` relationships represent a one-to-many association, where one resource can have multiple associated resources. For example, a `publisher` can have many `authors` (if we consider authors working for specific publishers). Unlike `belongsTo` relationships, the foreign key for a `hasMany` relationship resides on the *related* resource's table, not the primary resource.

This is why when defining a schema the `belongsTo` keys are in the main schema, whereas `hasMany` belongs to the `relationships` paramter. This is a design decision that marks the distinction between the two types of relationships. 

To demonstrate `hasMany` relationships with just two tables, we'll use `publishers` as our "one" side and `authors` as our "many" side, assuming authors are directly associated with a single publisher.

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true },
  },
  relationships: {
    // A publisher has many authors
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
  },
  searchSchema: { // Adding search schema for publishers
    name: { type: 'string', filterOperator: 'like' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource, which belongs to a publisher
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: { // Adding search schema for authors
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
  }
});
await api.resources.authors.createKnexTable();
```

Now, let's add some data to reflect these `hasMany` connections. We'll create publishers and then associate authors with them using the `publisher_id` foreign key.

```javascript
// Re-add publishers for a fresh start
const frenchPublisher = await api.resources.publishers.post({ name: 'French Books Inc.' });
const germanPublisher = await api.resources.publishers.post({ name: 'German Press GmbH' });
const internationalPublisher = await api.resources.publishers.post({ name: 'Global Publishing' });

// Add authors, linking them to publishers
const frenchAuthor1 = await api.resources.authors.post({ name: 'Victor', surname: 'Hugo', publisher: frenchPublisher.id });
const frenchAuthor2 = await api.resources.authors.post({ name: 'Émile', surname: 'Zola', publisher: frenchPublisher.id });
const germanAuthor = await api.resources.authors.post({ name: 'Johann', surname: 'Goethe', publisher: germanPublisher.id });
const unassignedAuthor = await api.resources.authors.post({ name: 'Unknown', surname: 'Author', publisher: null });


console.log('Added French Publisher:', inspect(frenchPublisher));
console.log('Added Victor Hugo:', inspect(frenchAuthor1));
console.log('Added Émile Zola:', inspect(frenchAuthor2));
console.log('Added German Publisher:', inspect(germanPublisher));

// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorIdss = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  }
});
console.log('French publisher  Authors (ids only):', inspect(allPublishersWithAuthorIds));

const frenchPublisherWithAuthorIds = await api.resources.publishers.get({ id: frenchPublisher.id, });
console.log('French publisher  Authors (author ids only, simplified):', inspect(frenchPublisherWithAuthorIds));

const frenchPublisherWithAuthorIdsFull = await api.resources.publishers.get({ id: frenchPublisher.id, simplified: false });
console.log('French publisher  Authors (author ids only, NOT simplified):', inspect(frenchPublisherWithAuthorIdsFull));
```

The output:

```text
Added French Publisher: { id: '1', name: 'French Books Inc.', authors_ids: [] }
Added Victor Hugo: { id: '1', name: 'Victor', surname: 'Hugo', publisher_id: '1' }
Added Émile Zola: { id: '2', name: 'Émile', surname: 'Zola', publisher_id: '1' }
Added German Publisher: { id: '2', name: 'German Press GmbH', authors_ids: [] }
French publisher  Authors (ids only, simplified): { id: '1', name: 'French Books Inc.', authors_ids: [ '1', '2' ] }
French publisher  Authors (ids only, NOT simplified): {
  data: {
    type: 'publishers',
    id: '1',
    attributes: { name: 'French Books Inc.' },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ]
      }
    },
    links: { self: '/api/1.0/publishers/1' }
  },
  links: { self: '/api/1.0/publishers/1' }
}
```

Note that the fresh publisher has the IDs of the French authors, both in simplified and non-simplified mode. This is a very important feature. `json-rest-api` will minimise the number of queries needed to fetch the extra IDS, but having the relation will incur an extra computational cost; however, it will enable discoverability.


### Including `hasMany` Records (`include`)

To retrieve related `hasMany` resources, you'll use the `include` query parameter from the "one" side of the one-to-many relationship (e.g., fetching a publisher and including its authors).

When fetching data programmatically in **simplified mode** (which is the default), `hasMany` relationships will appear as **arrays of child objects** embedded directly within the parent resource. This denormalized structure is convenient for immediate use in your application code.

#### Programmatic Usage:

Using the exact same data as before, you can change the query to `include` countries:

```javascript
// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorInfo = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  }
});
console.log('French publisher Authors (with authors, only, simplified):', inspect(frenchPublisherWithAuthorInfo));

// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorInfoFull = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  },
  simplified: false
});
console.log('French publisher  Authors (with authors, NOT simplified):', inspect(frenchPublisherWithAuthorInfoFull));
```

This is the result:

```text
French publisher  Authors (with authors, NOT simplified): {
  data: {
    type: 'publishers',
    id: '1',
    attributes: { name: 'French Books Inc.' },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ],
        links: {
          self: '/api/1.0/publishers/1/relationships/authors',
          related: '/api/1.0/publishers/1/authors'
        }
      }
    },
    links: { self: '/api/1.0/publishers/1' }
  },
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor', surname: 'Hugo' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Émile', surname: 'Zola' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/2' }
    }
  ],
  links: { self: '/api/1.0/publishers/1' }
}
```



```javascript

// Query all publishers and include their authors (simplified mode output)
const allPublishersWithAuthors = await api.resources.publishers.query({
  queryParams: {
    include: ['authors']
  }
});
console.log('All Publishers with Authors:', inspect(allPublishersWithAuthors));

// Query all publishers and include their authors (non-simplified, full JSON:API output)
const allPublishersWithAuthorsNotSimplified = await api.resources.publishers.query({
  queryParams: {
    include: ['authors']
  },
  simplified: false
});
console.log('All Publishers with Authors (not simplified):', inspect(allPublishersWithAuthorsNotSimplified));
```

**Expected Output:**

```text
All Publishers with Authors: [
  {
    id: '1',
    name: 'French Books Inc.',
    authors_ids: [ '1', '2' ],
    authors: [
      { id: '1', name: 'Victor', surname: 'Hugo' },
      { id: '2', name: 'Émile', surname: 'Zola' }
    ]
  },
  {
    id: '2',
    name: 'German Press GmbH',
    authors_ids: [ '3' ],
    authors: [ { id: '3', name: 'Johann', surname: 'Goethe' } ]
  },
  { id: '3', name: 'Global Publishing', authors_ids: [] }
]
All Publishers with Authors (not simplified): {
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc.' },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: '1' },
            { type: 'authors', id: '2' }
          ],
          links: {
            self: '/api/1.0/publishers/1/relationships/authors',
            related: '/api/1.0/publishers/1/authors'
          }
        }
      },
      links: { self: '/api/1.0/publishers/1' }
    },
    {
      type: 'publishers',
      id: '2',
      attributes: { name: 'German Press GmbH' },
      relationships: {
        authors: {
          data: [ { type: 'authors', id: '3' } ],
          links: {
            self: '/api/1.0/publishers/2/relationships/authors',
            related: '/api/1.0/publishers/2/authors'
          }
        }
      },
      links: { self: '/api/1.0/publishers/2' }
    },
    {
      type: 'publishers',
      id: '3',
      attributes: { name: 'Global Publishing' },
      relationships: {
        authors: {
          data: [],
          links: {
            self: '/api/1.0/publishers/3/relationships/authors',
            related: '/api/1.0/publishers/3/authors'
          }
        }
      },
      links: { self: '/api/1.0/publishers/3' }
    }
  ],
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor', surname: 'Hugo' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Émile', surname: 'Zola' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/1.0/authors/2' }
    },
    {
      type: 'authors',
      id: '3',
      attributes: { name: 'Johann', surname: 'Goethe' },
      relationships: { publisher: { data: { type: 'publishers', id: '2' } } },
      links: { self: '/api/1.0/authors/3' }
    }
  ],
  links: { self: '/api/1.0/publishers?include=authors' }
}
```


**Important Note on `hasMany` in Non-Simplified Mode:**

In non-simplified (full JSON:API) mode, `hasMany` relationships in the `data` section of the parent resource only contain an empty `data` array or `links` to the related endpoint (e.g., `authors: { links: { related: '/api/1.0/publishers/1/authors' } }`). The actual related `author` resources are placed in the top-level `included` array. This is standard JSON:API behavior to avoid duplicating large amounts of data. The `included` array ensures that each included resource appears only once, even if referenced by multiple parent resources.

### Filtering by `hasMany` Relationships

Filtering resources based on conditions applied to their `hasMany` relationships is a common requirement. For example, finding all publishers that have an author whose surname starts with 'Hu'. This is achieved by leveraging the `searchSchema` and defining fields that traverse the relationship to the child resource.

The `RestApiKnexPlugin` handles the necessary SQL `JOIN` operations automatically when you define `actualField` in your `searchSchema` to point to a field on a related `hasMany` table.

#### Programmatic Usage:

```javascript

// Filter authors by publisher name (cross-table search defined in authors' searchSchema)
const authorsFromGermanPress = await api.resources.authors.query({
  queryParams: {
    filters: {
      publisherName: 'German' // Using the alias 'publisherName' from authors' searchSchema
    }
  }
});
console.log('Authors from German Press:', inspect(authorsFromGermanPress));
```

The output will be:

```text
Authors from German Press: [ { id: '3', name: 'Johann', surname: 'Goethe', publisher_id: '2' } ]
```

Once again, the search logic is always define on the `schema` -- that is, it's handled by the server -- and not by the client.

This is the part of the searchSchema that does the trick:

```javascript
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
```

The query will automatically add all of the necessary joins to the query so that `publishers.name` will be searched.

The difference with a normal serach on a field of the main table is in the fact that we provided the full path (`publisher.name`). All of the other search options ( `oneOf`, `filterOperator`, `splitBy`) are available


## hasMany records (polymorphic)

Polymorphic relationships are a special type of one-to-many association where a single resource can belong to *one of several different* resource types. For example, a `review` might be associated with an `author` *or* a `publisher*. This differs from a standard `belongsTo` where a resource belongs to only one specific type.

To implement this, the "belonging" resource (e.g., `review`) needs two foreign key fields:
1.  An **`idField`** (e.g., `reviewable_id`) to store the ID of the related resource.
2.  A **`typeField`** (e.g., `reviewable_type`) to store the *type* of the related resource (e.g., 'authors' or 'publishers').

`json-rest-api` supports polymorphic relationships via the **`belongsToPolymorphic`** definition on the *child* resource. To establish the reverse `hasMany` link from the parent, you simply use the **`via`** keyword, pointing to the name of the `belongsToPolymorphic` field on the child.

For this section, we'll use our existing `publishers` and `authors` tables, and introduce a new `reviews` table that can give reviews to both authors and publishers.

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true},
  },
  relationships: {
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
  searchSchema: {
    name: { type: 'string', filterOperator: 'like' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  relationships: {
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
  searchSchema: {
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' }
  }
});
await api.resources.authors.createKnexTable();

// Define reviews resource with a polymorphic relationship
await api.addResource('reviews', {
  schema: {
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', max: 500, nullable: true },
    // These two fields store the polymorphic relationship data in the database
    reviewable_type: { type: 'string', max: 50 }, 
    reviewable_id: { type: 'id' }, 
  },
  relationships: {
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'], // The possible resource types this review can belong to
        typeField: 'reviewable_type', // The field in 'reviews' schema storing the parent's type
        idField: 'reviewable_id'      // The field in 'reviews' schema storing the parent's ID
      }
    }
  },
  searchSchema: {
    rating: { type: 'number', filterOperator: '=' },
    comment: { type: 'string', filterOperator: 'like' },
    reviewableType: { type: 'string', actualField: 'reviewable_type' }, // Allows filtering by parent type
    reviewableId: { type: 'id', actualField: 'reviewable_id' },         // Allows filtering by parent ID
    reviewableName: {
      type: 'string',
      oneOf: ['publishers.name', 'authors.name'],
      filterOperator: 'like'
    }
  }
});
await api.resources.reviews.createKnexTable();
```

Now, let's add some data to reflect these `hasMany` connections. We'll create publishers and authors, and then create reviews, linking them polymorphically to both.

---

### Creating Reviews (Simplified vs. Non-Simplified Input)

`json-rest-api` provides flexibility in how you provide data for polymorphic relationships when creating new records, depending on whether you're using the simplified API mode (default for programmatic calls) or the strict JSON:API format.

#### Programmatic Usage (Simplified Input)

In **simplified mode**, you can pass the `reviewable_type` and `reviewable_id` directly as attributes, and the library automatically handles the mapping to the polymorphic relationship. This is often more convenient for internal application logic.

```javascript
const frenchPublisher_ns = await api.resources.publishers.post({ name: 'French Books Inc. (NS)' });
const germanPublisher_ns = await api.resources.publishers.post({ name: 'German Press GmbH (NS)' });

const frenchAuthor1_ns = await api.resources.authors.post({ name: 'Victor (NS)', surname: 'Hugo (NS)', publisher: frenchPublisher_ns.id });
const germanAuthor_ns = await api.resources.authors.post({ name: 'Johann (NS)', surname: 'Goethe (NS)', publisher: germanPublisher_ns.id });

// Add reviews using non-simplified (JSON:API standard) input with relationships object
const review3_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 3,
        comment: 'Decent publisher, some good titles (NS).'
      },
      relationships: { // Explicitly define the polymorphic relationship here
        reviewable: {
          data: { type: 'publishers', id: frenchPublisher_ns.id } // Resource identifier object
        }
      }
    }
  },
  simplified: false // Ensure non-simplified mode for this call
});

const review4_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 5,
        comment: 'Hugo is a master storyteller! (NS)'
      },
      relationships: {
        reviewable: {
          data: { type: 'authors', id: frenchAuthor1_ns.id }
        }
      }
    }
  },
  simplified: false
});

console.log('Added Publisher Review (Non-Simplified Input):', inspect(review3_non_simplified));
console.log('Added Author Review (Non-Simplified Input):', inspect(review4_non_simplified));

```

**Expected Output (Simplified Input):**

```text
Added Publisher Review (Non-Simplified Input): {
  data: {
    type: 'reviews',
    id: '1',
    attributes: {
      rating: 3,
      comment: 'Decent publisher, some good titles (NS).',
      reviewable_type: 'publishers',
      reviewable_id: 1
    },
    links: { self: '/api/1.0/reviews/1' }
  },
  links: { self: '/api/1.0/reviews/1' }
}
Added Author Review (Non-Simplified Input): {
  data: {
    type: 'reviews',
    id: '2',
    attributes: {
      rating: 5,
      comment: 'Hugo is a master storyteller! (NS)',
      reviewable_type: 'authors',
      reviewable_id: 1
    },
    links: { self: '/api/1.0/reviews/2' }
  },
  links: { self: '/api/1.0/reviews/2' }
}
All reviews in database: [
  {
    id: 1,
    rating: 3,
    comment: 'Decent publisher, some good titles (NS).',
    reviewable_type: 'publishers',
    reviewable_id: 1
  },
  {
    id: 2,
    rating: 5,
    comment: 'Hugo is a master storyteller! (NS)',
    reviewable_type: 'authors',
    reviewable_id: 1
  }
]

=== Testing Simplified Mode ===
Added review in simplified mode: {
  id: '3',
  rating: 4,
  comment: 'Great German author! (Simplified)',
  reviewable_type: 'authors',
  reviewable_id: 2
}
Final reviews in database: [
  {
    id: 1,
    rating: 3,
    comment: 'Decent publisher, some good titles (NS).',
    reviewable_type: 'publishers',
    reviewable_id: 1
  },
  {
    id: 2,
    rating: 5,
    comment: 'Hugo is a master storyteller! (NS)',
    reviewable_type: 'authors',
    reviewable_id: 1
  },
  {
    id: 3,
    rating: 4,
    comment: 'Great German author! (Simplified)',
    reviewable_type: 'authors',
    reviewable_id: 2
  }
]
```

#### Programmatic Usage (Non-Simplified / JSON:API Standard Input)

For strict **JSON:API compliance**, you define the polymorphic relationship within the **`relationships` object** of your `inputRecord`. This is the recommended approach for API clients interacting with your HTTP endpoints.

```javascript
// Re-add data for a fresh start (schemas are reused from above)
const frenchPublisher_ns = await api.resources.publishers.post({ name: 'French Books Inc. (NS)' });
const germanPublisher_ns = await api.resources.publishers.post({ name: 'German Press GmbH (NS)' });

const frenchAuthor1_ns = await api.resources.authors.post({ name: 'Victor (NS)', surname: 'Hugo (NS)', publisher: frenchPublisher_ns.id });
const germanAuthor_ns = await api.resources.authors.post({ name: 'Johann (NS)', surname: 'Goethe (NS)', publisher: germanPublisher_ns.id });

// Add reviews using non-simplified (JSON:API standard) input with relationships object
const review3_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 3,
        comment: 'Decent publisher, some good titles (NS).'
      },
      relationships: { // Explicitly define the polymorphic relationship here
        reviewable: {
          data: { type: 'publishers', id: frenchPublisher_ns.id } // Resource identifier object
        }
      }
    }
  },
  simplified: false // Ensure non-simplified mode for this call
});

const review4_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 5,
        comment: 'Hugo is a master storyteller! (NS)'
      },
      relationships: {
        reviewable: {
          data: { type: 'authors', id: frenchAuthor1_ns.id }
        }
      }
    }
  },
  simplified: false
});

console.log('Added Publisher Review (Non-Simplified Input):', inspect(review3_non_simplified));
console.log('Added Author Review (Non-Simplified Input):', inspect(review4_non_simplified));
```

**Explanation of Input Formats:**

* **Simplified Mode:** `json-rest-api` automatically recognizes `reviewable_type` and `reviewable_id` attributes as foreign keys for polymorphic relationships defined with `belongsToPolymorphic`. This provides a flattened, convenient syntax for programmatic use.
* **Non-Simplified Mode (JSON:API Standard):** This adheres to the JSON:API specification, where relationships are explicitly defined in the `relationships` object with a resource identifier object (`{ type: 'resourceType', id: 'resourceId' }`). This is typically used when interacting with the API via HTTP or when strict JSON:API compliance is required.

**Expected Output (Non-Simplified Input):**

```text
Added Publisher Review (Non-Simplified Input): {
  data: {
    type: 'reviews',
    id: '3',
    attributes: { rating: 3, comment: 'Decent publisher, some good titles (NS).' },
    relationships: {
      reviewable: {
        data: { type: 'publishers', id: '1' }, // ID will match frenchPublisher_ns.id
        links: {
          self: '/api/1.0/reviews/3/relationships/reviewable',
          related: '/api/1.0/reviews/3/reviewable'
        }
      }
    },
    links: { self: '/api/1.0/reviews/3' }
  },
  links: { self: '/api/1.0/reviews/3' }
}
Added Author Review (Non-Simplified Input): {
  data: {
    type: 'reviews',
    id: '4',
    attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
    relationships: {
      reviewable: {
        data: { type: 'authors', id: '1' }, // ID will match frenchAuthor1_ns.id
        links: {
          self: '/api/1.0/reviews/4/relationships/reviewable',
          related: '/api/1.0/reviews/4/reviewable'
        }
      }
    },
    links: { self: '/api/1.0/reviews/4' }
  },
  links: { self: '/api/1.0/reviews/4' }
}
```

---

### Including Polymorphic Records (`include`)

To retrieve related polymorphic `` resources (e.g., getting a publisher and including all its reviews, or getting an author and including all their reviews), you'll use the **`include` query parameter** from the "one" side of the polymorphic relationship.

The output format (simplified vs. non-simplified) will depend on the `simplified` parameter of your `get` or `query` call, or the default `simplifiedApi` setting.

#### Programmatic Usage (Simplified Output)

When fetching data programmatically in **simplified mode** (which is the default), polymorphic `hasMany` relationships will appear as **arrays of child objects** embedded directly within the parent resource, just like regular `hasMany` relationships.

```javascript
// Re-add data for a fresh start (schemas and data from previous sections)
const frenchPublisher = await api.resources.publishers.post({ name: 'French Books Inc.' });
const germanPublisher = await api.resources.publishers.post({ name: 'German Press GmbH' });
const frenchAuthor1 = await api.resources.authors.post({ name: 'Victor', surname: 'Hugo', publisher: frenchPublisher.id });
const germanAuthor = await api.resources.authors.post({ name: 'Johann', surname: 'Goethe', publisher: germanPublisher.id });

await api.resources.reviews.post({ rating: 5, comment: 'Excellent publisher, great selection!', reviewable_type: 'publishers', reviewable_id: frenchPublisher.id });
await api.resources.reviews.post({ rating: 4, comment: 'Goethe is a profound thinker.', reviewable_type: 'authors', reviewable_id: germanAuthor.id });
await api.resources.reviews.post({ rating: 3, comment: 'Decent publisher, some good titles.', reviewable_type: 'publishers', reviewable_id: germanPublisher.id });
await api.resources.reviews.post({ rating: 5, comment: 'Hugo is a master storyteller!', reviewable_type: 'authors', reviewable_id: frenchAuthor1.id });


// Get the French publisher and include its reviews (simplified mode output)
const frenchPublisherWithReviews_simplified = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['reviews'] // Use the relationship name 'reviews' defined in the publishers schema
  }
});
console.log('French Publisher with Reviews (Simplified Output):', inspect(frenchPublisherWithReviews_simplified));

// Get the German author and include their reviews (simplified mode output)
const germanAuthorWithReviews_simplified = await api.resources.authors.get({
  id: germanAuthor.id,
  queryParams: {
    include: ['reviews'] // Use the relationship name 'reviews' defined in the authors schema
  }
});
console.log('German Author with Reviews (Simplified Output):', inspect(germanAuthorWithReviews_simplified));
```

**Expected Output (Simplified Output - Illustrative, IDs and content may vary based on `post` order):**

```text
French Publisher with Reviews (Simplified Output): {
  id: '1',
  name: 'French Books Inc.',
  // Note: authors_ids and authors array come from the 'hasMany authors' relationship defined on publishers
  authors_ids: [ '1', '2' ],
  authors: [
    { id: '1', name: 'Victor', surname: 'Hugo', publisher_id: '1' },
    { id: '2', name: 'Émile', surname: 'Zola', publisher_id: '1' }
  ],
  reviews: [
    {
      id: '1',
      rating: 5,
      comment: 'Excellent publisher, great selection!',
      reviewable_type: 'publishers',
      reviewable_id: '1'
    }
  ]
}
German Author with Reviews (Simplified Output): {
  id: '2',
  name: 'Johann',
  surname: 'Goethe',
  publisher_id: '2',
  publisher: { id: '2', name: 'German Press GmbH' },
  reviews: [
    {
      id: '2',
      rating: 4,
      comment: 'Goethe is a profound thinker.',
      reviewable_type: 'authors',
      reviewable_id: '2'
    }
  ]
}
```

#### Programmatic Usage (Non-Simplified / JSON:API Standard Output)

When you explicitly request **non-simplified output**, the polymorphic `hasMany` relationships will appear in the **`included` array** at the top level of the JSON:API document. The parent resource's `relationships` object will contain links to the related endpoint but not the full related data itself.

```javascript
// Re-add data for a fresh start (schemas and data from previous sections)
const frenchPublisher = await api.resources.publishers.post({ name: 'French Books Inc.' });
const germanPublisher = await api.resources.publishers.post({ name: 'German Press GmbH' });
const frenchAuthor1 = await api.resources.authors.post({ name: 'Victor', surname: 'Hugo', publisher: frenchPublisher.id });
const germanAuthor = await api.resources.authors.post({ name: 'Johann', surname: 'Goethe', publisher: germanPublisher.id });

await api.resources.reviews.post({ rating: 5, comment: 'Excellent publisher, great selection!', reviewable_type: 'publishers', reviewable_id: frenchPublisher.id });
await api.resources.reviews.post({ rating: 4, comment: 'Goethe is a profound thinker.', reviewable_type: 'authors', reviewable_id: germanAuthor.id });
await api.resources.reviews.post({ rating: 3, comment: 'Decent publisher, some good titles.', reviewable_type: 'publishers', reviewable_id: germanPublisher.id });
await api.resources.reviews.post({ rating: 5, comment: 'Hugo is a master storyteller!', reviewable_type: 'authors', reviewable_id: frenchAuthor1.id });


// Query all publishers and include their reviews (non-simplified, full JSON:API output)
const allPublishersWithReviewsNotSimplified = await api.resources.publishers.query({
  queryParams: {
    include: ['reviews']
  },
  simplified: false
});
console.log('All Publishers with Reviews (Non-Simplified Output):', inspect(allPublishersWithReviewsNotSimplified));

// Query all authors and include their reviews (non-simplified, full JSON:API output)
const allAuthorsWithReviewsNotSimplified = await api.resources.authors.query({
  queryParams: {
    include: ['reviews']
  },
  simplified: false
});
console.log('All Authors with Reviews (Non-Simplified Output):', inspect(allAuthorsWithReviewsNotSimplified));
```

**Important Note on Polymorphic `hasMany` in Non-Simplified Mode:**

In non-simplified (full JSON:API) mode, the `reviews` in the `data` section of the parent resource (publisher or author) will only contain links to their related endpoints. The actual `review` resources will be found in the top-level `included` array. This is standard JSON:API behavior to avoid duplicating large amounts of data. The `included` array ensures that each included resource appears only once, even if referenced by multiple parent resources.

**Expected Output (Non-Simplified Output - Illustrative, IDs and content may vary based on `post` order):**

```text
All Publishers with Reviews (Non-Simplified Output): {
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc.' },
      relationships: {
        authors: { links: { related: '/api/1.0/publishers/1/authors' } },
        reviews: { links: { related: '/api/1.0/publishers/1/reviews' } }
      },
      links: { self: '/api/1.0/publishers/1' }
    },
    {
      type: 'publishers',
      id: '2',
      attributes: { name: 'German Press GmbH' },
      relationships: {
        authors: { links: { related: '/api/1.0/publishers/2/authors' } },
        reviews: { links: { related: '/api/1.0/publishers/2/reviews' } }
      },
      links: { self: '/api/1.0/publishers/2' }
    },
    {
      type: 'publishers',
      id: '3',
      attributes: { name: 'Global Publishing' },
      relationships: {
        authors: { links: { related: '/api/1.0/publishers/3/authors' } },
        reviews: { links: { related: '/api/1.0/publishers/3/reviews' } }
      },
      links: { self: '/api/1.0/publishers/3' }
    }
  ],
  included: [
    {
      type: 'reviews',
      id: '1',
      attributes: { rating: 5, comment: 'Excellent publisher, great selection!' },
      relationships: {
        reviewable: { data: { type: 'publishers', id: '1' } }
      },
      links: { self: '/api/1.0/reviews/1' }
    },
    {
      type: 'reviews',
      id: '3',
      attributes: { rating: 3, comment: 'Decent publisher, some good titles.' },
      relationships: {
        reviewable: { data: { type: 'publishers', id: '2' } }
      },
      links: { self: '/api/1.0/reviews/3' }
    }
  ],
  links: { self: '/api/1.0/publishers?include=reviews' }
}
All Authors with Reviews (Non-Simplified Output): {
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor', surname: 'Hugo' },
      relationships: {
        publisher: { data: { type: 'publishers', id: '1' } },
        reviews: { links: { related: '/api/1.0/authors/1/reviews' } }
      },
      links: { self: '/api/1.0/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Émile', surname: 'Zola' },
      relationships: {
        publisher: { data: { type: 'publishers', id: '1' } },
        reviews: { links: { related: '/api/1.0/authors/2/reviews' } }
      },
      links: { self: '/api/1.0/authors/2' }
    },
    {
      type: 'authors',
      id: '3',
      attributes: { name: 'Johann', surname: 'Goethe' },
      relationships: {
        publisher: { data: { type: 'publishers', id: '2' } }
      },
      links: { self: '/api/1.0/authors/3' }
    },
    {
      type: 'authors',
      id: '4',
      attributes: { name: 'Unknown', surname: 'Author' },
      relationships: {
        publisher: { data: null },
        reviews: { links: { related: '/api/1.0/authors/4/reviews' } }
      },
      links: { self: '/api/1.0/authors/4' }
    }
  ],
  included: [
    {
      type: 'reviews',
      id: '4',
      attributes: { rating: 5, comment: 'Hugo is a master storyteller!' },
      relationships: {
        reviewable: { data: { type: 'authors', id: '1' } }
      },
      links: { self: '/api/1.0/reviews/4' }
    },
    {
      type: 'reviews',
      id: '2',
      attributes: { rating: 4, comment: 'Goethe is a profound thinker.' },
      relationships: {
        reviewable: { data: { type: 'authors', id: '3' } }
      },
      links: { self: '/api/1.0/reviews/2' }
    }
  ],
  links: { self: '/api/1.0/authors?include=reviews' }
}
```

---

### Filtering by Polymorphic Relationships

Filtering resources based on conditions applied to their polymorphic `hasMany` relationships is a powerful capability. You can filter reviews by their `reviewable_type` or `reviewable_id`, or even filter the parent resources (publishers/authors) based on properties of their associated reviews. You can also filter reviews by properties of the *polymorphic parent* (e.g., filter reviews for entities named 'French Books Inc.').

The `RestApiKnexPlugin` handles the necessary SQL `JOIN` operations automatically when you define `actualField` in your `searchSchema` to point to a field on a related polymorphic table.

#### Programmatic Usage:

```javascript
// Re-add data for a fresh start (schemas and data from previous sections)
const frenchPublisher = await api.resources.publishers.post({ name: 'French Books Inc.' });
const germanPublisher = await api.resources.publishers.post({ name: 'German Press GmbH' });
const internationalPublisher = await api.resources.publishers.post({ name: 'Global Publishing' });

const frenchAuthor1 = await api.resources.authors.post({ name: 'Victor', surname: 'Hugo', publisher: frenchPublisher.id });
const germanAuthor = await api.resources.authors.post({ name: 'Johann', surname: 'Goethe', publisher: germanPublisher.id });

await api.resources.reviews.post({ rating: 5, comment: 'Excellent publisher, great selection!', reviewable_type: 'publishers', reviewable_id: frenchPublisher.id });
await api.resources.reviews.post({ rating: 4, comment: 'Goethe is a profound thinker.', reviewable_type: 'authors', reviewable_id: germanAuthor.id });
await api.resources.reviews.post({ rating: 3, comment: 'Decent publisher, some good titles.', reviewable_type: 'publishers', reviewable_id: germanPublisher.id });
await api.resources.reviews.post({ rating: 5, comment: 'Hugo is a master storyteller!', reviewable_type: 'authors', reviewable_id: frenchAuthor1.id });


// Filter reviews to find only those for publishers
const reviewsForPublishers = await api.resources.reviews.query({
  queryParams: {
    filters: {
      reviewableType: 'publishers' // Filter by the reviewable_type field
    }
  }
});
console.log('Reviews for Publishers:', inspect(reviewsForPublishers));

// Filter reviews to find those for a specific author (e.g., Goethe)
const reviewsForGoethe = await api.resources.reviews.query({
  queryParams: {
    filters: {
      reviewableId: germanAuthor.id, // Filter by the reviewable_id field
      reviewableType: 'authors' // Always combine with type for specificity
    }
  }
});
console.log('Reviews for Goethe:', inspect(reviewsForGoethe));

// Filter publishers to find those with reviews having a rating of 5
const publishersWithFiveStarReviews = await api.resources.publishers.query({
  queryParams: {
    filters: {
      'reviews.rating': 5 // Filter on a field of the hasMany polymorphic relationship
    }
  }
});
console.log('Publishers with 5-star reviews:', inspect(publishersWithFiveStarReviews));

// Filter authors to find those with reviews containing "master storyteller"
const authorsWithSpecificReviewComment = await api.resources.authors.query({
  queryParams: {
    filters: {
      'reviews.comment': '%master storyteller%' // Filter on a field of the hasMany polymorphic relationship
    }
  }
});
console.log('Authors with "master storyteller" review:', inspect(authorsWithSpecificReviewComment));

// Filter reviews by the name of the reviewable entity (using reviewableName from reviews' searchSchema)
const reviewsForFrenchEntities = await api.resources.reviews.query({
  queryParams: {
    filters: {
      reviewableName: 'French%' // Filters reviews where the associated publisher or author name starts with 'French'
    }
  }
});
console.log('Reviews for "French" entities:', inspect(reviewsForFrenchEntities));
```

**Explanation of Filtering Polymorphic Relationships:**

* **Filtering the polymorphic resource itself (e.g., `reviews`):**
    * You can directly filter by `reviewable_type` and `reviewable_id` if these fields are exposed in the `reviews`' `searchSchema`.
    * For cross-table filtering based on the *name* of the `reviewable` entity, the `reviews`' `searchSchema` defines `reviewableName` with `oneOf: ['publishers.name', 'authors.name']`. This tells `RestApiKnexPlugin` to perform a `LEFT JOIN` to both `publishers` and `authors` tables, and then apply the filter to their respective `name` columns. The `oneOf` ensures that a match in *either* related table will return the review.

* **Filtering the parent resource (e.g., `publishers` or `authors`) by its polymorphic `hasMany` children (`reviews`):**
    * You can filter `publishers` by `reviews.rating` or `authors` by `reviews.comment`. The system automatically handles the necessary `JOIN` to the `reviews` table and applies the filter.

**Expected Output (Illustrative, IDs may vary):**

```text
Reviews for Publishers: [
  {
    id: '1',
    rating: 5,
    comment: 'Excellent publisher, great selection!',
    reviewable_type: 'publishers',
    reviewable_id: '1'
  },
  {
    id: '3',
    rating: 3,
    comment: 'Decent publisher, some good titles.',
    reviewable_type: 'publishers',
    reviewable_id: '2'
  }
]
Reviews for Goethe: [
  {
    id: '2',
    rating: 4,
    comment: 'Goethe is a profound thinker.',
    reviewable_type: 'authors',
    reviewable_id: '3' // Assuming Goethe's ID is 3 from previous data
  }
]
Publishers with 5-star reviews: [
  {
    id: '1',
    name: 'French Books Inc.'
  }
]
Authors with "master storyteller" review: [
  {
    id: '1', // Victor Hugo's ID
    name: 'Victor',
    surname: 'Hugo',
    publisher_id: '1'
  }
]
Reviews for "French" entities: [
  {
    id: '1',
    rating: 5,
    comment: 'Excellent publisher, great selection!',
    reviewable_type: 'publishers',
    reviewable_id: '1'
  },
  {
    id: '4',
    rating: 5,
    comment: 'Hugo is a master storyteller!',
    reviewable_type: 'authors',
    reviewable_id: '1'
  }
]
```

## Many to many (hasMany with through records)



### Search (many to many)



## Pagination on queries





## Next Steps

- [Schema Definition Guide](docs/schemas.md) - Learn about all field types and validation rules
- [Relationships Guide](docs/relationships.md) - Deep dive into relationship configuration
- [Querying Guide](docs/querying.md) - Advanced filtering, sorting, and pagination
- [File Uploads Guide](docs/file-uploads.md) - Handle file uploads with various storage backends
- [Authentication Guide](docs/authentication.md) - Add authentication and authorization
- [Testing Guide](docs/testing.md) - Write tests for your API

## License

GPL-3.0-or-later
