# Appendices: Date and Time Handling

## Overview

This document explains how the JSON REST API handles date and time values throughout the system, from database storage to API responses. Understanding this behavior is crucial for developers working with temporal data.

## Supported Date/Time Types

The API supports three temporal data types in schemas:

### 1. `date`
- **Format**: `YYYY-MM-DD`
- **Example**: `2024-01-15`
- **Usage**: Birth dates, due dates, or any date without time component
- **Database Storage**: DATE column type
- **JSON Output**: ISO 8601 date string

### 2. `dateTime`
- **Format**: `YYYY-MM-DD HH:MM:SS` (input) / ISO 8601 (output)
- **Example Input**: `2024-01-15 14:30:00`
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

## Schema Definition

Define date/time fields in your schema like this:

```javascript
const articleSchema = {
  publishedDate: { type: 'date', required: true },
  createdAt: { type: 'dateTime', defaultTo: 'now()' },
  updatedAt: { type: 'dateTime', defaultTo: 'now()' },
  dailyPostTime: { type: 'time', nullable: true }
};
```

## Input Validation

### On Write Operations (POST/PUT/PATCH)

The API validates and normalizes date/time inputs:

```javascript
// POST /api/articles
{
  "data": {
    "type": "articles",
    "attributes": {
      "publishedDate": "2024-01-15",           // Valid date
      "createdAt": "2024-01-15T14:30:00Z",     // Valid dateTime (ISO 8601)
      "dailyPostTime": "14:30:00"              // Valid time
    }
  }
}
```

**Accepted Input Formats:**
- **date**: 
  - `YYYY-MM-DD` (parsed at UTC midnight)
  - ISO 8601 date strings
  - Any JavaScript Date parseable string
- **dateTime**: 
  - ISO 8601 strings (`2024-01-15T14:30:00Z`) - recommended
  - `YYYY-MM-DD HH:MM:SS` (assumed UTC)
  - JavaScript Date parseable strings
  - Unix timestamps (as numbers)
- **time**: 
  - `HH:MM:SS` or `HH:MM`
  - Extracted from datetime strings

**Storage Format:**
All date/time values are converted to JavaScript Date objects before storage, allowing the database driver to handle the appropriate formatting for each database system.

## Output Normalization

### Database to API Response

All date/time values are normalized when returned from the API:

```javascript
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
2. **Date Objects**: All date/time values are returned as JavaScript Date objects internally, then serialized to ISO 8601 strings in JSON responses
3. **UTC Assumption**: MySQL DATETIME values (which lack timezone info) are assumed to be UTC

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
```javascript
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
- Send all dateTime values to the API in UTC
- The API always returns dateTime values in UTC (with 'Z' suffix)
- Handle timezone conversion in your client application

### 4. Filtering and Querying
When filtering by dates, use ISO 8601 format:

```javascript
// Filter articles published after a date
GET /api/articles?filters[publishedDate][$gte]=2024-01-01

// Filter by datetime range
GET /api/articles?filters[createdAt][$gte]=2024-01-01T00:00:00Z&filters[createdAt][$lt]=2024-02-01T00:00:00Z
```

## Migration Considerations

### From Existing Systems

If migrating from a system that stores dates differently:

1. **Local Time Storage**: Convert all dates to UTC before importing
2. **String Storage**: Ensure strings match expected formats
3. **Numeric Timestamps**: Use `timestamp` type for Unix timestamps

### Database Configuration

For optimal date handling, configure your database connection:

**MySQL** (in Knex config):
```javascript
{
  client: 'mysql2',
  connection: {
    // ... other config
    timezone: 'UTC'
  }
}
```

**PostgreSQL** (in Knex config):
```javascript
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
**Cause**: Time values lack date context  
**Solution**: The API attaches times to epoch date (1970-01-01) in UTC

## Technical Implementation Details

The date/time handling is implemented in two key areas:

1. **Input Validation** (`json-rest-schema`):
   - Validates format on write operations
   - Converts all date inputs to JavaScript Date objects
   - Ensures date-only values parse at UTC midnight
   - Returns Date objects for storage (Knex handles DB-specific formatting)

2. **Output Normalization** (`database-value-normalizers.js`):
   - Handles database-specific quirks (MySQL timezone issues)
   - Ensures Date objects are properly created from database values
   - Fixes MySQL datetime strings by assuming UTC
   - Maintains consistency across different database engines

This two-stage approach ensures data integrity on input and consistent formatting on output, regardless of the underlying database system. The key insight is that JavaScript Date objects are used as the common format throughout the pipeline, with database drivers handling the conversion to/from their native formats.