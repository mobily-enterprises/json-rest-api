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
const inspect = (obj) => util.inspect(obj, { depth: 5 })

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
    name: { type: 'string', required: true, max: 100, search: true, filterUsing: 'like' },
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
    name: { type: 'string', required: true, max: 100, search: { filterUsing: 'like' } },
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

**Available operators for `filterUsing`:**
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
        name: { filterUsing: '=', type: 'string' },
        nameLike: { filterUsing: 'like', type: 'string' }
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
    name: { type: 'string', filterUsing: '=' },
    code: { type: 'string', filterUsing: '=' },
    nameLike: { type: 'string', actualField: 'name', filterUsing: 'like' }
  }
});
```

Note that the definition above is functionally _identical_ to the one provided a few paragraphs above.

**Important: When you define a `searchSchema`, it completely replaces the search configuration from the main schema.** Only fields defined in the `searchSchema` are searchable.

The `searchSchema` gives you:

* complete control and isolation: With searchSchema, you define the search interface completely separately from the data schema. This can be cleaner when you have complex search requirements.
* No mixing of concerns: Your data schema stays focused on data validation and storage, while searchSchema handles search
  behavior.
* Easier to see all searchable fields at once: Everything is in one place rather than scattered across field definitions.
* Flexibility to completely diverge from the data schema: You might have 20 fields in your schema but only expose 3 for
  searching, or create 10 search fields from 3 data fields.


`searchSchema` also gives you the ability to define a search field that will search in multiple fields. For example:

```javascript
searchSchema: {
  search: {
    type: 'string',
    oneOf: ['name', 'code'],
    filterUsing: 'like'
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
      filterUsing: 'like',
      splitBy: ' ',      // Split search terms by space
      matchAll: true     // Require ALL terms to match (AND logic)
    }
  }
});
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
    filterUsing: 'like',
    splitBy: ',',       // Split by comma
    matchAll: false     // OR logic (default) - match ANY term
  },
  
  // Exact match with AND logic
  codes: {
    type: 'string',
    oneOf: ['primary_code', 'secondary_code'],
    filterUsing: '=',   // Exact match
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
    name: { type: 'string', filterUsing: '=' },
    code: { type: 'string', filterUsing: '=' },
    
    // Custom search using a function
    nameOrCode: {
      type: 'string',
      filterUsing: function(query, filterValue) {
        // Custom SQL logic: case-insensitive search in name OR exact match on code
        query.where(function() {
          this.whereRaw('LOWER(name) LIKE LOWER(?)', [`%${filterValue}%`])
              .orWhereRaw('LOWER(code) = LOWER(?)', [filterValue]);
        });
      }
    }
  }
});
```

When `filterUsing` is a function instead of an operator string, it receives:
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

The function approach is powerful for:
- Case-insensitive searches
- Complex conditions combining multiple fields
- Database-specific functions
- Custom business logic in searches







The JSON:API response will contain an array of matching resources.

#### Sparse Fieldsets

The JSON:API specification includes a powerful feature called "sparse fieldsets" that allows you to request only specific fields from a resource. This is essential for optimizing API performance by reducing payload sizes and network traffic.

**How Sparse Fieldsets Work:**

By default, API responses include all fields defined in the schema. With sparse fieldsets, you can specify exactly which fields you want returned. The `id` field is always included automatically as it's required by JSON:API.

Let's work with our countries table:

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true }
  }
});

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
// Output: { id: '1', name: 'France', code: 'FR' }

// Fetch only the name field
const nameOnly = await api.resources.countries.get({ 
  id: '1',
  fields: { countries: ['name'] }
});
console.log('Name only:', inspect(nameOnly));
// Output: { id: '1', name: 'France' }

// Fetch only the code field
const codeOnly = await api.resources.countries.get({ 
  id: '1',
  fields: { countries: ['code'] }
});
console.log('Code only:', inspect(codeOnly));
// Output: { id: '1', code: 'FR' }
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
    fields: { countries: ['name'] }
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
    fields: { countries: ['code'] }
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
      filterUsing: 'like',
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
    fields: { countries: ['name', 'population'] }
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




## belongsTo records

### Search (belongsTo)

### Sparse fields (belongsTo)

### Computed and hidden fields




## hasMany records

### Search (hasMany)

### Sparse fields (hasMany)

### Computed and hidden fields




## hasMany records (polymorphic)

### Search (hasMany)

### Sparse fields (hasMany)

### Computed and hidden fields




## Many to many (hasMany with through records)

### Search (many to many)

### Sparse fields (many to many)

### Computed and hidden fields


## Next Steps

- [Schema Definition Guide](docs/schemas.md) - Learn about all field types and validation rules
- [Relationships Guide](docs/relationships.md) - Deep dive into relationship configuration
- [Querying Guide](docs/querying.md) - Advanced filtering, sorting, and pagination
- [File Uploads Guide](docs/file-uploads.md) - Handle file uploads with various storage backends
- [Authentication Guide](docs/authentication.md) - Add authentication and authorization
- [Testing Guide](docs/testing.md) - Write tests for your API

## License

GPL-3.0-or-later
