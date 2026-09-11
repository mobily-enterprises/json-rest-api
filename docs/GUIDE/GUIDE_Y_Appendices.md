# Appendices: Date and Time Handling

## Overview

This document explains how the JSON REST API handles date and time values throughout the system, from database storage to API responses. Understanding this behavior is crucial for developers working with temporal data.

## Supported Date/Time Types

The API supports three string temporal types and two numeric epoch types in schemas:

### 1. `date`
- **Format**: `YYYY-MM-DD`
- **Example**: `2024-01-15`
- **Usage**: Birth dates, due dates, or any date without time component
- **Database Storage**: DATE column type
- **JSON Output**: ISO 8601 date string

### 2. `dateTime`
- **Format**: RFC 3339 with seconds and an explicit `Z` or `±HH:MM` offset
- **Example Input**: `2024-01-15T14:30:00Z`
- **Example Output**: `2024-01-15T14:30:00.000Z`
- **Usage**: Timestamps, created/updated times, or any date with time
- **Database Storage**: DATETIME (MySQL) or TIMESTAMP (PostgreSQL)
- **JSON Output**: Full ISO 8601 datetime string with timezone

### 3. `time`
- **Format**: `HH:MM:SS`
- **Example**: `14:30:00`
- **Usage**: Time of day without date context (e.g., business hours)
- **Database Storage**: TIME column type
- **JSON Output**: ISO 8601 time string

### 4. `epochMilliseconds` and `epochSeconds`
- **Format**: An integer number or canonical base-10 integer string
- **Example**: `1767323045000` (`epochMilliseconds`) or `1767323045` (`epochSeconds`)
- **Usage**: Systems whose temporal contract is explicitly a Unix epoch value
- **Database Storage**: BIGINT for table-backed resources
- **JSON Output**: Integer number in the same unit declared by the schema type

## Schema Definition

The following three executable blocks form one scenario. Add them to the
[starting script](GUIDE_2_1_The_Starting_Point.md) after installing storage and
before starting the server, on a fresh database. Other snippets are illustrative
payloads or configuration fragments.

```javascript
await api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true },
    publishedDate: { type: 'date', required: true, search: true },
    createdAt: { type: 'dateTime', temporalPrecision: 3, required: true },
    dailyPostTime: { type: 'time', nullable: true },
    publishedEpoch: { type: 'epochMilliseconds', required: true }
  },
  searchSchema: {
    createdBetween: { type: 'array', actualField: 'createdAt', filterOperator: 'between' }
  }
})
await api.resources.articles.createKnexTable()
```

`Date.prototype.toISOString()` always emits three fractional-second digits, so
use it directly with unspecified precision or `temporalPrecision: 3` (or
higher). A lower precision requires a producer that returns no more than the
configured number of digits. Validation rejects excess input precision rather
than silently truncating it.

## Input Validation

### On Write Operations (POST/PUT/PATCH)

The API validates and normalizes date/time inputs:

```javascript
const januaryArticle = await api.resources.articles.post({
  inputRecord: {
    title: 'January', publishedDate: '2024-01-15',
    createdAt: '2024-01-15T22:30:00+08:00', dailyPostTime: '14:30:00',
    publishedEpoch: '1705329000000'
  }
})
await api.resources.articles.post({
  inputRecord: {
    title: 'February', publishedDate: '2024-02-01',
    createdAt: '2024-02-01T00:00:00Z', dailyPostTime: null,
    publishedEpoch: 1706745600000
  }
})
console.log(januaryArticle)
```

The first result retains date `2024-01-15` and time `14:30:00`, normalizes
createdAt to `2024-01-15T14:30:00.000Z`, and returns publishedEpoch as the number
`1705329000000`. Its dateTime offset describes the same instant as UTC; callers
are not required to send only `Z` inputs.

**Accepted Input Formats:**
- **date**: a real calendar date in `YYYY-MM-DD` form
- **dateTime**: an RFC 3339 string with seconds and an explicit timezone, such as `2024-01-15T14:30:00Z` or `2024-01-15T22:30:00+08:00`
- **time**: an offset-free `HH:MM[:SS[.fraction]]` string

JavaScript `Date` objects, SQL datetime strings, Unix timestamps, locale text, and other values accepted by `Date.parse()` are not valid JSON temporal inputs. Use `epochMilliseconds` or `epochSeconds` schema fields for Unix timestamps.

**Storage Format:**
Schema validation preserves valid JSON temporal strings exactly. The built-in storage adapters convert `date` and `dateTime` strings to database-native `Date` values at the database boundary, while `time` remains a string. A custom field-level `storage.serialize` function receives the validated string and owns any custom database conversion.

The built-in `dateTime` conversion supports millisecond precision. A value such
as `2026-09-01T10:20:30.123456Z` fails with HTTP 422 before the write, because
converting it to `Date` would lose information. Trailing zeroes beyond three
digits are accepted (`.123000Z` represents exactly `.123Z`). To retain finer
precision in table-backed storage, use a custom `storage.serialize` function
and a database column and driver that preserve it. The same serializer is used
for filters and cursor comparisons, with `operation: 'filter'` and `context: null`.

Response normalization preserves fractional digits returned as strings by
storage, up to the field's declared precision, including during conversion of
timezone offsets to UTC. It also converts valid epoch strings and `bigint`
values from database drivers to JSON numbers, rejecting invalid or out-of-range
epoch data.

## Output Normalization

### Database to API Response

All date/time values are normalized when returned from the API:

```js
// GET /api/articles/123
{
  "data": {
    "type": "articles",
    "id": "123",
    "attributes": {
      "publishedDate": "2024-01-15",                    // date type
      "createdAt": "2024-01-15T14:30:00.000Z",         // dateTime type
      "updatedAt": "2024-01-15T16:45:30.000Z",         // dateTime type
      "dailyPostTime": "14:30:00"                      // time type
    }
  }
}
```

### Key Normalization Behaviors:

1. **Boolean Normalization**: Database values of `1`/`0` are converted to `true`/`false`
2. **JSON Temporal Values**: `date`, `dateTime`, and `time` attributes are returned as strings that match the same public schema contract accepted on input
3. **UTC Assumption**: MySQL DATETIME values (which lack timezone info) are assumed to be UTC

Normalization runs once after the database read and again at the final response
boundary. The final pass covers getters, computed fields, query projections,
and finishing hooks that produce native `Date` values, including nested
relationships in plain write responses. A malformed non-null temporal value is not
reported as `null`; it fails with `REST_API_TEMPORAL_DATA_INVALID` and HTTP 500
so stored-data or enrichment defects remain visible.

## Database-Specific Handling

### MySQL
- **Issue**: DATE and DATETIME types don't store timezone information
- **Solution**: The API assumes all MySQL dates are stored in UTC
- **Example**: `2024-01-15 14:30:00` in database → `2024-01-15T14:30:00.000Z` in API

### PostgreSQL
- **Recommended**: Use `TIMESTAMPTZ` (timestamp with timezone) for dateTime fields
- **Behavior**: PostgreSQL handles timezone conversion automatically
- **Storage**: Always stores in UTC, converts based on session timezone

## Best Practices

### 1. Always Store in UTC
```js
// Good: Store timestamps in UTC
const article = {
  createdAt: new Date().toISOString() // "2024-01-15T14:30:00.000Z"
};

// Bad: Store in local timezone
const article = {
  createdAt: new Date().toString() // "Mon Jan 15 2024 09:30:00 GMT-0500 (EST)"
};
```

### 2. Use Appropriate Types
- Use `date` for dates without time significance
- Use `dateTime` for timestamps and audit fields
- Use `time` for recurring daily events

### 3. Timezone Handling
- Send dateTime values with an explicit timezone; UTC is convenient, and valid offsets are accepted
- The API always returns dateTime values in UTC (with 'Z' suffix)
- Handle timezone conversion in your client application

### 4. Filtering and Querying

Declare public filter names in the schema or search schema, then use
`queryParams.filters` in programmatic calls. Temporal filter values use the
same declared field conversion as writes.

```javascript
const onDate = await api.resources.articles.query({
  queryParams: { filters: { publishedDate: '2024-01-15' } }
})
const inJanuary = await api.resources.articles.query({
  queryParams: {
    filters: { createdBetween: ['2024-01-01T00:00:00Z', '2024-01-31T23:59:59.999Z'] }
  }
})
console.log(onDate.data.map(article => article.title), inJanuary.data.map(article => article.title))
```

Both queries return January only. `between` includes both boundaries. The
corresponding HTTP equality query uses the singular `filter` key:

```http
GET /api/articles?filter[publishedDate]=2024-01-15
```

Use declared aliases such as `createdBetween`; arbitrary `$gte`/`$lt` objects
are not the public filter grammar. See
[searching](GUIDE_2_2_Manipulating_And_Searching_Tables.md) for custom ranges and
[backend limits](BACKEND_CAPABILITIES.md#temporal-values) for precision rules.

## Migration Considerations

### From Existing Systems

If migrating from a system that stores dates differently:

1. **Local Time Storage**: Convert all dates to UTC before importing
2. **String Storage**: Ensure strings match expected formats
3. **Numeric Timestamps**: Use `epochMilliseconds` or `epochSeconds`, matching the producer's actual unit

### Database Configuration

For optimal date handling, configure your database connection:

**MySQL** (in Knex config):
```js
{
  client: 'mysql2',
  connection: {
    // ... other config
    timezone: 'Z'
  }
}
```

**PostgreSQL** (in Knex config):
```js
{
  client: 'pg',
  connection: {
    // ... other config
  }
  // PostgreSQL handles timezones well by default
}
```

## Common Issues and Solutions

### Issue 1: Dates Shifting by Timezone Offset
**Symptom**: A date like `2024-01-15` becomes `2024-01-14` or `2024-01-16`  
**Cause**: Timezone conversion during parsing  
**Solution**: The API handles this by parsing date-only values at UTC midnight

### Issue 2: MySQL Dates Appear Wrong
**Symptom**: Stored `14:30:00` appears as `19:30:00` or `09:30:00`  
**Cause**: MySQL DATETIME interpreted in local timezone  
**Solution**: The API assumes MySQL dates are UTC and adds 'Z' suffix

### Issue 3: Time Values Need Date Context
**Symptom**: Can't perform date arithmetic on time-only values  
**Cause**: Time values intentionally have no date or timezone context
**Solution**: Keep recurring wall-clock values as `time`; use `dateTime` when an instant is required

## Technical Implementation Details

The date/time handling is implemented in two key areas:

1. **Input Validation** (`json-rest-schema`):
   - Validates strict JSON temporal strings on write operations
   - Preserves accepted strings exactly
   - Rejects JavaScript `Date` objects and permissive legacy date formats

2. **Storage and Output Normalization** (`storage` adapters and `database-value-normalizers.js`):
   - Converts validated `date` and `dateTime` strings at the database boundary
   - Uses the same database-native representation for writes and query comparisons
   - Handles database-specific quirks (MySQL timezone issues)
   - Parses database date values before emitting schema-valid JSON strings
   - Fixes MySQL datetime strings by assuming UTC
   - Maintains consistency across different database engines

This separation keeps the public JSON contract strict and serializable while still giving database drivers native values at the storage boundary.
