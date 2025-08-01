# 2.3 `belongsTo` Relationships

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

## Including `belongsTo` Records (`include`)

To retrieve related `belongsTo` resources, use the `include` query parameter.

When fetching data programmatically, `simplified` mode is `true` by default. This means that instead of a separate `included` array (as in full JSON:API), related `belongsTo` resources are **denormalized and embedded directly** within the main resource's object structure, providing a very convenient and flat data structure for immediate use.

### Programmatic Usage:

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

await api.resources.publishers.post({ 
  name: 'UK Books Ltd.', 
  country: uk.id 
});


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
// HTTP: GET /api/publishers?include=country
// Returns (simplified): [
//   { id: '1', name: 'French Books Inc.', country_id: '1', country: { id: '1', name: 'France', code: 'FR' } },
//   { id: '2', name: 'German Press GmbH', country_id: '2', country: { id: '2', name: 'Germany', code: 'DE' } },
//   { id: '3', name: 'UK Books Ltd.', country_id: '3', country: { id: '3', name: 'United Kingdom', code: 'UK' } },
//   { id: '4', name: 'Global Publishing', country_id: null, country: null }
// ]

console.log('All Publishers with Countries:', inspect(allPublishersWithCountries));
// Note: allPublishersWithCountries contains { data, meta, links }

// Query all publishers and include their countries (JSON:API format)
const allPublishersWithCountriesNotSimplified = await api.resources.publishers.query({
  queryParams: {
    include: ['country']
  },
  simplified: false
});
// HTTP: GET /api/publishers?include=country
// Returns (JSON:API): {
//   data: [
//     { type: 'publishers', id: '1', attributes: { name: 'French Books Inc.' }, 
//       relationships: { country: { data: { type: 'countries', id: '1' } } } },
//     { type: 'publishers', id: '2', attributes: { name: 'German Press GmbH' }, 
//       relationships: { country: { data: { type: 'countries', id: '2' } } } },
//     { type: 'publishers', id: '3', attributes: { name: 'UK Books Ltd.' }, 
//       relationships: { country: { data: { type: 'countries', id: '3' } } } },
//     { type: 'publishers', id: '4', attributes: { name: 'Global Publishing' }, 
//       relationships: { country: { data: null } } }
//   ],
//   included: [
//     { type: 'countries', id: '1', attributes: { name: 'France', code: 'FR' } },
//     { type: 'countries', id: '2', attributes: { name: 'Germany', code: 'DE' } },
//     { type: 'countries', id: '3', attributes: { name: 'United Kingdom', code: 'UK' } }
//   ]
// }

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
All Publishers with Countries: {
  data: [
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
  ],
  meta: {...},
  links: {...}
}
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

## Sparse Fieldsets with `belongsTo` Relations

You can apply **sparse fieldsets** not only to the primary resource but also to the included `belongsTo` resources. This is powerful for fine-tuning your API responses and reducing payload sizes.

### Programmatic Usage:

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
// HTTP: GET /api/publishers?include=country&fields[publishers]=name&fields[countries]=code,name
// Returns (simplified): [
//   { id: '1', name: 'French Books Inc.', country: { id: '1', code: 'FR', name: 'France' } },
//   { id: '2', name: 'German Press GmbH', country: { id: '2', code: 'DE', name: 'Germany' } },
//   { id: '3', name: 'UK Books Ltd.', country: { id: '3', code: 'UK', name: 'United Kingdom' } },
//   { id: '4', name: 'Global Publishing', country: null }
// ]
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
Sparse Publishers Query (all results): {
  data: [
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
  ],
  meta: {...},
  links: {...}
}
```

## Filtering by `belongsTo` Relationships

You can filter resources based on conditions applied to their `belongsTo` relationships. This is achieved by defining filterable fields in the `searchSchema` that map to either the foreign key or fields on the related resource.

The `searchSchema` offers a clean way to define filters, abstracting away the underlying database structure and relationship navigation from the client. Clients simply use the filter field names defined in `searchSchema` (e.g., `countryCode` instead of `country.code`).

### Programmatic Usage:

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
// HTTP: GET /api/publishers?filter[country]=1
// Returns: {
//   data: [{ id: '1', name: 'French Books Inc.', country_id: '1' }]
// }

console.log('Publishers from France (by country ID):', inspect(publishersFromFrance));
// Note: publishersFromFrance contains { data, meta, links }
// Note: publishersFromFrance contains { data, meta, links } - access publishersFromFrance.data for the array

// Programmatic search: Find publishers with no associated country
const publishersNoCountry = await api.resources.publishers.query({
  queryParams: {
    filters: {
      country: null // Filtering by null for the 'country' ID filter
    }
  }
  // simplified: true is default for programmatic fetches
});
// HTTP: GET /api/publishers?filter[country]=null
// Returns: {
//   data: [{ id: '4', name: 'Global Publishing', country_id: null }]
// }

console.log('Publishers with No Country (by country ID: null):', inspect(publishersNoCountry));
// Note: publishersNoCountry contains { data, meta, links }

// Programmatic search: Find publishers where the associated country's code is 'UK'
const publishersFromUK = await api.resources.publishers.query({
  queryParams: {
    filters: {
      countryCode: 'UK' // Using 'countryCode' filter field defined in searchSchema
    }
  }
  // simplified: true is default for programmatic fetches
});
// HTTP: GET /api/publishers?filter[countryCode]=UK
// Returns: {
//   data: [{ id: '3', name: 'UK Books Ltd.', country_id: '3' }]
// }

console.log('Publishers from UK (by countryCode):', inspect(publishersFromUK));
```

**Expected Output**

```text
Publishers from France (by country ID): [ { id: '1', name: 'French Books Inc.', country_id: '1' } ]
Publishers with No Country (by country ID: null): [ { id: '4', name: 'Global Publishing' } ]
Publishers from UK (by countryCode): [ { id: '2', name: 'UK Books Ltd.', country_id: '3' } ]
```

---

[Previous: 2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md) | [Back to Guide](./README.md) | [Next: 2.4 hasMany records](./GUIDE_2_4_HasMany_Records.md)