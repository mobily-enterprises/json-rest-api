# Answer to User's Question

## Question
"if I have a table people, and a table offices (with personId) and office has a foreign key to countryId (linking to countries), can you confirm that if you get a person and automatically all of the offices associated to them, the offices record will have a query such that the offices records have the country OBJECT automatically in there???"

"But if the non-compliant extra plugin is used, the object should be there right?"

## Answer: YES ✅

When you configure eager loading on the countryId field in the offices schema:

```javascript
countryId: {
  type: 'id',
  refs: {
    resource: 'countries',
    join: {
      eager: true,  // This enables automatic loading
      fields: ['id', 'name', 'code']
    }
  }
}
```

Then when you fetch a person with their offices included:

### In JSON:API Compliant Mode (default):
- The country data IS automatically loaded via SQL JOIN
- But it's placed in the `included` section of the response
- Each office has a `relationships.country` reference
- The office.attributes.countryId remains a string ID

### In Non-Compliant Mode (jsonApiCompliant: false):
- The country OBJECT is embedded directly in the office
- It appears as `office.attributes.country` (not countryId)
- The original `countryId` field is preserved as a string
- No need for an `included` section

### With SimplifiedRecordsPlugin:
- Transforms JSON:API responses to embed relationships
- Flattens the response structure
- Embeds related objects directly where they're referenced

## Key Points:
1. Eager loading DOES work through nested relationships (people → offices → countries)
2. The SQL query automatically includes the JOIN to fetch country data
3. The difference is only in how the data is formatted in the response
4. In all cases, the country data is loaded in a single query (no N+1 problem)