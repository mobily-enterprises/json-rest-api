# Joined Field Search Feature

## Overview

The JSON REST API now supports searching on joined fields using dot notation. This allows you to filter records based on properties of related resources without manually performing joins.

## Usage

### Basic Joined Field Search

```javascript
// Find all people who have a puppy named "Spot"
const result = await api.resources.people.query({
  filter: { 'puppyId.name': 'Spot' }
});

// Find all people with Beagle puppies
const result = await api.resources.people.query({
  filter: { 
    'puppyId.breed': { operator: '$like', value: '%Beagle%' }
  }
});
```

### Combining Regular and Joined Filters

```javascript
// Find people with email from example.com who have puppies aged 2 or more
const result = await api.resources.people.query({
  filter: { 
    email: { operator: '$like', value: '%example.com' },
    'puppyId.age': { operator: '$gte', value: 2 }
  }
});
```

### Null Checks on Joined Fields

```javascript
// Find people who have a puppy with no name set
const result = await api.resources.people.query({
  filter: { 'puppyId.name': null }
});
```

## Searchable Fields Configuration

You can restrict which fields (including joined fields) can be searched by providing a `searchableFields` array:

```javascript
const result = await api.resources.people.query({
  filter: { 
    'puppyId.name': 'Spot',      // This will be applied
    'puppyId.breed': 'Beagle'    // This will be ignored
  }
}, {
  searchableFields: ['name', 'email', 'puppyId.name'] // Only these fields are searchable
});
```

## How It Works

1. **Automatic Join Detection**: When a filter field contains a dot (e.g., `puppyId.name`), the system:
   - Splits it into the join field (`puppyId`) and target field (`name`)
   - Validates that the join field has a `refs` definition in the schema
   - Automatically adds a LEFT JOIN if not already present

2. **Query Generation**: The filter is applied to the joined table:
   ```sql
   LEFT JOIN puppies ON puppies.id = people.puppyId
   WHERE puppies.name = 'Spot'
   ```

3. **Validation**: The system validates that:
   - The field before the dot is a reference field (has `refs` in schema)
   - The field is in the `searchableFields` list (if provided)

## Important Notes

1. **MySQL Only**: This feature is currently implemented only in the MySQL plugin. The Memory plugin does not support joined field searches.

2. **Performance**: Joins are only added when needed. If you search on `puppyId.name`, only the puppies table is joined.

3. **Security**: Use `searchableFields` to prevent users from searching on sensitive joined fields.

4. **Single Level**: Currently supports only one level of joining (e.g., `puppyId.name`). Nested joins like `person.company.address.city` are not yet supported.

5. **Reference Fields Only**: The field before the dot must be a reference field (have `refs` in the schema). You cannot use dot notation on regular fields.

## Error Handling

If you try to search on an invalid joined field:
```javascript
// This will throw a ValidationError
await api.resources.people.query({
  filter: { 'email.domain': 'example.com' } // email is not a reference field
});
```

## Future Enhancements

Potential improvements could include:
- Multi-level joins (e.g., `person.company.address.city`)
- Support for array relationships
- Aggregation functions on joined fields
- Memory plugin support