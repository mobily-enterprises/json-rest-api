# Investigation: sideLoad on Pivot Table Fields

## Question
Does `sideLoad` on pivot table fields have meaning even without parent relationships? Is it only relevant for parent→pivot→related chains, or does it also affect direct queries to pivot tables?

## Answer
**YES, `sideLoad` on pivot table fields IS meaningful for direct queries!**

## Key Findings

### 1. Direct Pivot Table Queries
When querying a pivot table directly (e.g., `GET /book_authors?include=author,book`), the `sideLoad` setting on each field determines whether that related resource can be included in the response.

### 2. How It Works
Looking at `relationship-includes.js` line 783:
```javascript
if (fieldDef.as === includeName && fieldDef.belongsTo && fieldDef.sideLoad) {
  // Only processes the include if sideLoad is true
}
```

The logic checks three conditions:
1. The field has an `as` property matching the requested include name
2. The field has a `belongsTo` relationship
3. The field has `sideLoad: true`

If any condition is false, the relationship won't be loaded.

### 3. Test Results

#### Configuration 1: Both fields have sideLoad
```javascript
book_id: { 
  belongsTo: 'books',
  as: 'book',
  sideLoad: true  // ENABLED
},
author_id: {
  belongsTo: 'people',
  as: 'author',
  sideLoad: true  // ENABLED
}
```
Query: `GET /book_authors/1?include=author,book`
- ✓ Author included
- ✓ Book included

#### Configuration 2: Only author has sideLoad
```javascript
book_id: { 
  belongsTo: 'books',
  as: 'book'
  // NO sideLoad
},
author_id: {
  belongsTo: 'people',
  as: 'author',
  sideLoad: true  // ENABLED
}
```
Query: `GET /book_authors/1?include=author,book`
- ✓ Author included
- ✗ Book NOT included (warning: "Relationship not found or not configured for sideLoad")

## Use Cases

### 1. Direct Pivot Table Queries
When pivot tables are exposed as full resources (common in many-to-many relationships with attributes), users may query them directly:
- `GET /project_members?include=user,project`
- `GET /user_skills?include=user,skill`
- `GET /team_members?include=team,user`

### 2. Nested Includes Through Parents
When querying through parent relationships:
- `GET /books/1?include=authors.author`
- The chain requires sideLoad at each step:
  - books→authors (relationship needs sideLoad)
  - authors.author_id (field needs sideLoad)

## Practical Implications

1. **API Design**: If you expose pivot tables as resources, consider which relationships users will need when querying them directly.

2. **Performance**: Set `sideLoad: false` on relationships you don't want to expose through direct pivot queries, even if they're needed for parent chains.

3. **Security**: The `sideLoad` flag can act as a simple access control for what data can be included in responses.

## Example: Real-World Pivot Table
```javascript
api.addResource('project_members', {
  schema: {
    id: { type: 'id' },
    project_id: { 
      type: 'number',
      belongsTo: 'projects',
      as: 'project',
      sideLoad: true  // Allow including project details
    },
    user_id: {
      type: 'number', 
      belongsTo: 'users',
      as: 'user',
      sideLoad: true  // Allow including user details
    },
    role: { type: 'string' },
    hours_allocated: { type: 'number' },
    joined_at: { type: 'date' }
  }
});
```

This configuration allows:
- `GET /project_members?include=user,project` - Returns pivot records with full user and project details
- Useful for admin dashboards, reports, or detailed member listings

## Conclusion
The `sideLoad` setting on pivot table fields is meaningful and functional for direct queries, not just for parent→pivot→related chains. It provides fine-grained control over what related data can be included when querying pivot tables as first-class resources.