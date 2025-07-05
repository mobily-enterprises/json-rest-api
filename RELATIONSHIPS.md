# Hooked API REST Plugin - Relationship Schema Guide

This guide provides a comprehensive explanation of how relationships work in the Hooked API REST plugin, with detailed examples showing exactly what happens at the database level.

## Table of Contents
1. [Core Concepts](#core-concepts)
2. [Example Database Schema](#example-database-schema)
3. [Schema Definitions](#schema-definitions)
4. [Understanding belongsTo Relationships](#understanding-belongsTo-relationships)
5. [Understanding hasMany Relationships](#understanding-hasmany-relationships)
6. [Understanding hasOne Relationships](#understanding-hasone-relationships)
7. [Many-to-Many Relationships Deep Dive](#many-to-many-relationships-deep-dive)
8. [Complete API Request Examples](#complete-api-request-examples)
9. [Storage Plugin Implementation](#storage-plugin-implementation)

## Core Concepts

The Hooked API REST plugin follows these fundamental principles:

1. **Schema = Table Structure**: A schema defines ONLY the columns that physically exist in that database table
2. **Explicit Relationships**: Virtual relationships (hasMany, hasOne) are defined separately from the schema
3. **Column-First Design**: We work with actual database column names, not abstract concepts
4. **No Magic**: Every relationship must be explicitly configured

### Key Terms

- **belongsTo**: A relationship where the foreign key is IN THIS table
- **hasMany**: A relationship where the foreign key is in ANOTHER table (expects multiple related records)
- **hasOne**: A relationship where the foreign key is in ANOTHER table (expects one related record)
- **through**: Specifies a join table for many-to-many relationships

## Example Database Schema

Let's work with a blog system that has articles, authors (people), comments, and tags. Here's our complete database structure with sample data:

### 1. people table (authors, editors, users)
```sql
id | name             | email                    | bio
---|------------------|--------------------------|----------------------------------
1  | Alice Johnson    | alice@techblog.com      | Senior tech writer and editor
2  | Bob Smith        | bob@techblog.com        | Freelance journalist
3  | Carol White      | carol@techblog.com      | Technology enthusiast
4  | David Lee        | david@techblog.com      | Chief Editor
5  | Eve Brown        | eve@readers.com         | Regular reader and commenter
```

### 2. articles table
```sql
id | title                      | slug                    | body                          | published_at        | author_id | editor_id | view_count
---|----------------------------|-------------------------|-------------------------------|---------------------|-----------|-----------|------------
1  | Understanding JavaScript   | understanding-js        | JavaScript is a versatile...  | 2024-01-15 10:00:00 | 1         | 4         | 1250
2  | REST API Best Practices    | rest-api-practices      | When designing REST APIs...   | 2024-01-20 14:30:00 | 2         | 4         | 890
3  | Database Design Patterns   | database-patterns       | Proper database design...     | 2024-01-25 09:15:00 | 1         | NULL      | 2100
4  | Intro to GraphQL          | intro-graphql           | GraphQL is a query language...| NULL                | 3         | 4         | 0
```

### 3. comments table
```sql
id | body                                    | article_id | user_id | created_at          | parent_comment_id
---|-----------------------------------------|------------|---------|---------------------|-------------------
1  | Great article! Very helpful.            | 1          | 5       | 2024-01-16 08:30:00 | NULL
2  | I have a question about closures...     | 1          | 3       | 2024-01-16 10:15:00 | NULL
3  | Thanks! Let me explain closures...      | 1          | 1       | 2024-01-16 11:00:00 | 2
4  | This clarifies REST principles nicely   | 2          | 5       | 2024-01-21 09:00:00 | NULL
5  | What about GraphQL vs REST?             | 2          | 3       | 2024-01-21 14:20:00 | NULL
```

### 4. tags table
```sql
id | name         | slug         | description
---|--------------|--------------|----------------------------------------
1  | JavaScript   | javascript   | All things JavaScript
2  | API Design   | api-design   | API design patterns and best practices
3  | Database     | database     | Database design and optimization
4  | Tutorial     | tutorial     | Step-by-step guides
5  | Advanced     | advanced     | Advanced technical topics
```

### 5. article_tags table (join table for many-to-many)
```sql
article_id | tag_id | created_at
-----------|--------|---------------------
1          | 1      | 2024-01-15 10:00:00
1          | 4      | 2024-01-15 10:00:00
2          | 2      | 2024-01-20 14:30:00
2          | 4      | 2024-01-20 14:30:00
3          | 3      | 2024-01-25 09:15:00
3          | 5      | 2024-01-25 09:15:00
4          | 2      | 2024-01-30 11:00:00
```

### 6. images table (for hasOne example)
```sql
id | url                          | alt_text               | featured_article_id | uploaded_by
---|------------------------------|------------------------|---------------------|-------------
1  | /uploads/js-header.jpg       | JavaScript logo        | 1                   | 1
2  | /uploads/rest-diagram.png    | REST API diagram       | 2                   | 2
3  | /uploads/db-schema.jpg       | Database schema example| 3                   | 1
4  | /uploads/profile-alice.jpg   | Alice Johnson profile  | NULL                | 1
5  | /uploads/profile-bob.jpg     | Bob Smith profile      | NULL                | 2
```

## Schema Definitions

Now let's define the schemas for each table. Remember, schemas contain ONLY the columns that exist in that specific table:

### people schema
```javascript
const peopleSchema = {
  // Regular columns
  id: { type: 'id' },
  name: { type: 'string', required: true, max: 100 },
  email: { type: 'string', required: true, unique: true },
  bio: { type: 'string', nullable: true }
  
  // Note: No relationships defined here! People table has no foreign keys.
}
```

### articles schema
```javascript
const articlesSchema = {
  // Regular columns
  id: { type: 'id' },
  title: { type: 'string', required: true, max: 200 },
  slug: { type: 'string', required: true, unique: true },
  body: { type: 'string', required: true },
  published_at: { type: 'dateTime', nullable: true },
  view_count: { type: 'number', default: 0 },
  
  // Foreign key columns (belongsTo relationships)
  author_id: { belongsTo: 'people', as: 'author' },
  editor_id: { belongsTo: 'people', as: 'editor', nullable: true }
}
```

### comments schema
```javascript
const commentsSchema = {
  // Regular columns
  id: { type: 'id' },
  body: { type: 'string', required: true },
  created_at: { type: 'dateTime', default: 'CURRENT_TIMESTAMP' },
  
  // Foreign key columns (belongsTo relationships)
  article_id: { belongsTo: 'articles' },
  user_id: { belongsTo: 'people', as: 'user' },
  parent_comment_id: { belongsTo: 'comments', as: 'parent', nullable: true }
}
```

### tags schema
```javascript
const tagsSchema = {
  // Regular columns only
  id: { type: 'id' },
  name: { type: 'string', required: true, max: 50 },
  slug: { type: 'string', required: true, unique: true },
  description: { type: 'string', nullable: true }
}
```

### images schema
```javascript
const imagesSchema = {
  // Regular columns
  id: { type: 'id' },
  url: { type: 'string', required: true },
  alt_text: { type: 'string', nullable: true },
  
  // Foreign key columns
  featured_article_id: { belongsTo: 'articles', as: 'featured_article', nullable: true },
  uploaded_by: { belongsTo: 'people', as: 'uploader' }
}
```

## Using Different Table Names

Sometimes your database table name doesn't match your scope name. You can specify a custom table name in the schema:

```javascript
// If your database table is named 'blog_posts' but you want the API endpoint to be 'articles'
const articlesSchema = {
  tableName: 'blog_posts',  // <-- Specify the actual database table name
  
  // Regular columns
  id: { type: 'id' },
  title: { type: 'string', required: true, max: 200 },
  // ... rest of schema
}

// The API will use 'articles' as the scope name
api.scope('articles', {
  schema: articlesSchema,  // Contains tableName: 'blog_posts'
  relationships: { /* ... */ }
})

// API endpoint: GET /articles
// Database query: SELECT * FROM blog_posts
```

## Relationship Configuration

Virtual relationships (hasMany, hasOne) are configured separately when defining scopes:

```javascript
// Articles scope with relationships
api.scope('articles', {
  schema: articlesSchema,
  relationships: {
    // hasMany - foreign key is in the comments table
    comments: { hasMany: 'comments' },
    
    // hasOne - foreign key is in the images table
    featured_image: { hasOne: 'images', foreignKey: 'featured_article_id' },
    
    // Many-to-many - through join table
    tags: { hasMany: 'tags', through: 'article_tags' }
  }
})

// People scope with relationships
api.scope('people', {
  schema: peopleSchema,
  relationships: {
    // hasMany - foreign key is in articles table
    authored_articles: { hasMany: 'articles', foreignKey: 'author_id' },
    edited_articles: { hasMany: 'articles', foreignKey: 'editor_id' },
    comments: { hasMany: 'comments', foreignKey: 'user_id' },
    uploaded_images: { hasMany: 'images', foreignKey: 'uploaded_by' }
  }
})

// Comments scope with relationships
api.scope('comments', {
  schema: commentsSchema,
  relationships: {
    // hasMany - self-referential for nested comments
    replies: { hasMany: 'comments', foreignKey: 'parent_comment_id' }
  }
})

// Tags scope with relationships
api.scope('tags', {
  schema: tagsSchema,
  relationships: {
    // Many-to-many - through join table
    articles: { hasMany: 'articles', through: 'article_tags' }
  }
})
```

## Explicit Keys for Through Relationships

When using many-to-many relationships with a join table, you can explicitly specify the foreign key columns:

```javascript
// Basic through relationship (uses conventions)
tags: { hasMany: 'tags', through: 'article_tags' }
// Assumes: article_tags.article_id and article_tags.tag_id

// Explicit keys for non-standard column names
categories: { 
  hasMany: 'categories', 
  through: 'post_categories',
  foreignKey: 'post_id',      // Column in join table pointing to THIS table
  otherKey: 'category_id'     // Column in join table pointing to OTHER table
}

// Example with a more complex join table
api.scope('users', {
  schema: usersSchema,
  relationships: {
    // User's roles with metadata in join table
    roles: { 
      hasMany: 'roles', 
      through: 'user_roles',
      foreignKey: 'user_id',
      otherKey: 'role_id'
    }
  }
})

// The join table might have additional columns:
// user_roles table:
// | user_id | role_id | assigned_at | assigned_by |
// |---------|---------|-------------|-------------|
// | 1       | 3       | 2024-01-15  | 5           |
```

## Understanding belongsTo Relationships

A `belongsTo` relationship means the foreign key is IN THIS table. Let's examine how this works:

### Example: Article belongs to Author

In the articles schema:
```javascript
author_id: { belongsTo: 'people', as: 'author' }
```

This tells us:
- The `articles` table has a column called `author_id`
- This column contains the ID of a record in the `people` table
- In JSON:API, this will show as a relationship called `author`

### Database Query Process

When you request `GET /articles/1`:

1. **First query - Get the article:**
```sql
SELECT * FROM articles WHERE id = 1;
-- Returns: {id: 1, title: "Understanding JavaScript", author_id: 1, editor_id: 4, ...}
```

2. **The storage plugin sees:**
   - `author_id = 1` (this is Alice Johnson)
   - `editor_id = 4` (this is David Lee)

3. **JSON:API output:**
```json
{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "Understanding JavaScript",
      "slug": "understanding-js",
      "body": "JavaScript is a versatile...",
      "published_at": "2024-01-15T10:00:00Z",
      "view_count": 1250
    },
    "relationships": {
      "author": {
        "data": { "type": "people", "id": "1" }
      },
      "editor": {
        "data": { "type": "people", "id": "4" }
      }
    }
  }
}
```

### With Includes

When you request `GET /articles/1?include=author,editor`:

1. **Get the article** (same as above)
2. **Get the related people:**
```sql
SELECT * FROM people WHERE id IN (1, 4);
```
3. **Add to included section:**
```json
{
  "data": { ... },
  "included": [
    {
      "type": "people",
      "id": "1",
      "attributes": {
        "name": "Alice Johnson",
        "email": "alice@techblog.com",
        "bio": "Senior tech writer and editor"
      }
    },
    {
      "type": "people",
      "id": "4",
      "attributes": {
        "name": "David Lee",
        "email": "david@techblog.com",
        "bio": "Chief Editor"
      }
    }
  ]
}
```

## Understanding hasMany Relationships

A `hasMany` relationship means the foreign key is in ANOTHER table. Let's see how this works:

### Example: Article has many Comments

In the articles scope configuration:
```javascript
relationships: {
  comments: { hasMany: 'comments' }
}
```

This tells us:
- The `comments` table has a foreign key pointing to articles
- By convention, it looks for `article_id` in the comments table
- Multiple comments can belong to one article

### Database Query Process

When you request `GET /articles/1?include=comments`:

1. **Get the article:**
```sql
SELECT * FROM articles WHERE id = 1;
```

2. **Get all related comments:**
```sql
SELECT * FROM comments WHERE article_id = 1;
-- Returns 3 comments: IDs 1, 2, and 3
```

3. **JSON:API output:**
```json
{
  "data": {
    "type": "articles",
    "id": "1",
    "relationships": {
      "comments": {
        "data": [
          { "type": "comments", "id": "1" },
          { "type": "comments", "id": "2" },
          { "type": "comments", "id": "3" }
        ]
      }
    }
  },
  "included": [
    {
      "type": "comments",
      "id": "1",
      "attributes": {
        "body": "Great article! Very helpful.",
        "created_at": "2024-01-16T08:30:00Z"
      },
      "relationships": {
        "article_id": { "data": { "type": "articles", "id": "1" } },
        "user": { "data": { "type": "people", "id": "5" } }
      }
    },
    // ... more comments
  ]
}
```

## Understanding hasOne Relationships

A `hasOne` relationship is like `hasMany` but expects only one related record:

### Example: Article has one Featured Image

In the articles scope configuration:
```javascript
relationships: {
  featured_image: { hasOne: 'images', foreignKey: 'featured_article_id' }
}
```

### Database Query Process

When you request `GET /articles/1?include=featured_image`:

1. **Get the article** (as before)
2. **Get the featured image:**
```sql
SELECT * FROM images WHERE featured_article_id = 1 LIMIT 1;
-- Returns: {id: 1, url: "/uploads/js-header.jpg", ...}
```

3. **JSON:API output:**
```json
{
  "data": {
    "type": "articles",
    "id": "1",
    "relationships": {
      "featured_image": {
        "data": { "type": "images", "id": "1" }
      }
    }
  },
  "included": [
    {
      "type": "images",
      "id": "1",
      "attributes": {
        "url": "/uploads/js-header.jpg",
        "alt_text": "JavaScript logo"
      }
    }
  ]
}
```

### Important Note on hasOne

The `hasOne` relationship expects that `featured_article_id` is unique (only one image per article). If your database doesn't enforce this with a UNIQUE constraint, multiple images could have the same `featured_article_id`. The storage plugin should:
- Return only the first result
- Optionally warn if multiple results exist

## Many-to-Many Relationships Deep Dive

Many-to-many relationships are the most complex but also very powerful. They use a join table to connect two tables where each record in one table can be related to multiple records in another table, and vice versa.

### Example: Articles and Tags

An article can have multiple tags, and a tag can be applied to multiple articles. This is accomplished through the `article_tags` join table.

#### Configuration

In articles scope:
```javascript
relationships: {
  tags: { hasMany: 'tags', through: 'article_tags' }
}
```

In tags scope:
```javascript
relationships: {
  articles: { hasMany: 'articles', through: 'article_tags' }
}
```

### How the Join Table Works

The `article_tags` table is simple but crucial:
```sql
article_id | tag_id | created_at
-----------|--------|---------------------
1          | 1      | 2024-01-15 10:00:00  -- Article 1 has tag "JavaScript"
1          | 4      | 2024-01-15 10:00:00  -- Article 1 has tag "Tutorial"
2          | 2      | 2024-01-20 14:30:00  -- Article 2 has tag "API Design"
2          | 4      | 2024-01-20 14:30:00  -- Article 2 has tag "Tutorial"
```

### Database Query Process for Many-to-Many

When you request `GET /articles/1?include=tags`:

1. **Get the article:**
```sql
SELECT * FROM articles WHERE id = 1;
```

2. **Get the relationships from the join table:**
```sql
SELECT * FROM article_tags WHERE article_id = 1;
-- Returns: [{article_id: 1, tag_id: 1}, {article_id: 1, tag_id: 4}]
```

3. **Get the actual tags:**
```sql
SELECT * FROM tags WHERE id IN (1, 4);
-- Returns: JavaScript and Tutorial tags
```

4. **JSON:API output:**
```json
{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "Understanding JavaScript"
    },
    "relationships": {
      "tags": {
        "data": [
          { "type": "tags", "id": "1" },
          { "type": "tags", "id": "4" }
        ]
      }
    }
  },
  "included": [
    {
      "type": "tags",
      "id": "1",
      "attributes": {
        "name": "JavaScript",
        "slug": "javascript",
        "description": "All things JavaScript"
      }
    },
    {
      "type": "tags",
      "id": "4",
      "attributes": {
        "name": "Tutorial",
        "slug": "tutorial",
        "description": "Step-by-step guides"
      }
    }
  ]
}
```

### Creating Many-to-Many Relationships

When you POST a new article with tags:

```json
POST /articles
{
  "data": {
    "type": "articles",
    "attributes": {
      "title": "New Article",
      "body": "Content..."
    },
    "relationships": {
      "tags": {
        "data": [
          { "type": "tags", "id": "1" },
          { "type": "tags", "id": "3" }
        ]
      }
    }
  }
}
```

The storage plugin must:
1. Insert the article into the `articles` table
2. Get the new article's ID (let's say it's 5)
3. Insert records into `article_tags`:
```sql
INSERT INTO article_tags (article_id, tag_id) VALUES (5, 1), (5, 3);
```

### Updating Many-to-Many Relationships

When updating tags for an article, the storage plugin typically:
1. Deletes all existing relationships:
```sql
DELETE FROM article_tags WHERE article_id = 1;
```
2. Inserts the new relationships:
```sql
INSERT INTO article_tags (article_id, tag_id) VALUES (1, 2), (1, 5);
```

## Complete API Request Examples

Let's walk through some complete examples showing the full data flow:

### Example 1: Get Article with All Relationships

Request: `GET /articles/1?include=author,editor,comments.user,tags,featured_image`

#### Step 1: Get the main article
```sql
SELECT * FROM articles WHERE id = 1;
```
Result: Article #1 with author_id=1, editor_id=4

#### Step 2: Process belongsTo relationships
The storage plugin identifies:
- author_id = 1 → Will need to fetch person #1
- editor_id = 4 → Will need to fetch person #4

#### Step 3: Process hasMany relationships
```sql
-- Get comments
SELECT * FROM comments WHERE article_id = 1;
-- Returns comments #1, #2, #3

-- Get tag relationships
SELECT * FROM article_tags WHERE article_id = 1;
-- Returns tag_ids: 1, 4
```

#### Step 4: Process hasOne relationship
```sql
SELECT * FROM images WHERE featured_article_id = 1 LIMIT 1;
-- Returns image #1
```

#### Step 5: Get all related records
```sql
-- Get people (for author, editor, and comment users)
SELECT * FROM people WHERE id IN (1, 4, 5, 3);

-- Get tags
SELECT * FROM tags WHERE id IN (1, 4);
```

#### Step 6: Build JSON:API response
```json
{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "Understanding JavaScript",
      "slug": "understanding-js",
      "body": "JavaScript is a versatile...",
      "published_at": "2024-01-15T10:00:00Z",
      "view_count": 1250
    },
    "relationships": {
      "author": {
        "data": { "type": "people", "id": "1" }
      },
      "editor": {
        "data": { "type": "people", "id": "4" }
      },
      "comments": {
        "data": [
          { "type": "comments", "id": "1" },
          { "type": "comments", "id": "2" },
          { "type": "comments", "id": "3" }
        ]
      },
      "tags": {
        "data": [
          { "type": "tags", "id": "1" },
          { "type": "tags", "id": "4" }
        ]
      },
      "featured_image": {
        "data": { "type": "images", "id": "1" }
      }
    }
  },
  "included": [
    {
      "type": "people",
      "id": "1",
      "attributes": {
        "name": "Alice Johnson",
        "email": "alice@techblog.com",
        "bio": "Senior tech writer and editor"
      }
    },
    {
      "type": "people",
      "id": "4",
      "attributes": {
        "name": "David Lee",
        "email": "david@techblog.com",
        "bio": "Chief Editor"
      }
    },
    {
      "type": "comments",
      "id": "1",
      "attributes": {
        "body": "Great article! Very helpful.",
        "created_at": "2024-01-16T08:30:00Z"
      },
      "relationships": {
        "article_id": {
          "data": { "type": "articles", "id": "1" }
        },
        "user": {
          "data": { "type": "people", "id": "5" }
        }
      }
    },
    // ... more included resources
  ]
}
```

### Example 2: Create Article with Relationships

Request:
```json
POST /articles
{
  "data": {
    "type": "articles",
    "attributes": {
      "title": "Getting Started with TypeScript",
      "slug": "getting-started-typescript",
      "body": "TypeScript adds static typing to JavaScript..."
    },
    "relationships": {
      "author": {
        "data": { "type": "people", "id": "2" }
      },
      "tags": {
        "data": [
          { "type": "tags", "id": "1" },
          { "type": "tags", "id": "4" }
        ]
      }
    }
  }
}
```

Storage plugin process:

1. **Validate the relationships exist:**
```sql
SELECT id FROM people WHERE id = 2;  -- Verify author exists
SELECT id FROM tags WHERE id IN (1, 4);  -- Verify tags exist
```

2. **Insert the article:**
```sql
INSERT INTO articles (title, slug, body, author_id, view_count) 
VALUES ('Getting Started with TypeScript', 'getting-started-typescript', 
        'TypeScript adds static typing...', 2, 0);
-- Returns new ID: 5
```

3. **Create many-to-many relationships:**
```sql
INSERT INTO article_tags (article_id, tag_id, created_at) 
VALUES (5, 1, NOW()), (5, 4, NOW());
```

4. **Return the created article with relationships**

## Storage Plugin Implementation

Storage plugins receive helper functions that have access to the full API context, including scopes, schemas, and relationships. Here's how to access this configuration:

### Accessing Scope Configuration

```javascript
// In your storage plugin's helper functions
helpers.dataGet = async function({ scopeName, id, queryParams, idProperty }) {
  // Access scope configuration
  const scope = this.scopes[scopeName];
  const schema = scope.schema;
  const relationships = scope.relationships;
  const tableName = schema.tableName || scopeName;
  
  // Now you can use this information for your queries
  const query = `SELECT * FROM ${tableName} WHERE ${idProperty} = ?`;
  const article = await db.query(query, [id]);
  
  // ... rest of implementation
};
```

### For belongsTo Relationships

```javascript
// When fetching an article
const scope = this.scopes[scopeName];
const schema = scope.schema;
const tableName = schema.tableName || scopeName;

const article = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [id]);

// The belongsTo columns are already in the result
// article.author_id = 1
// article.editor_id = 4

// For includes, collect all the IDs
const peopleIds = [article.author_id, article.editor_id].filter(Boolean);
const people = await db.query('SELECT * FROM people WHERE id IN (?)', [peopleIds]);
```

### For hasMany Relationships

```javascript
// Get all comments for an article
const comments = await db.query(
  'SELECT * FROM comments WHERE article_id = ?', 
  [articleId]
);

// For nested includes (e.g., comments.user)
const userIds = comments.map(c => c.user_id);
const users = await db.query('SELECT * FROM people WHERE id IN (?)', [userIds]);
```

### For Many-to-Many Relationships

```javascript
// Get relationship configuration
const relationship = scope.relationships.tags;
const throughTable = relationship.through;
const foreignKey = relationship.foreignKey || `${scopeName.slice(0, -1)}_id`; // Default: article_id
const otherKey = relationship.otherKey || `${relationship.hasMany.slice(0, -1)}_id`; // Default: tag_id

// Get tags for an article using explicit keys
const tagRelations = await db.query(
  `SELECT ${otherKey} FROM ${throughTable} WHERE ${foreignKey} = ?`,
  [articleId]
);
const tagIds = tagRelations.map(r => r[otherKey]);
const tags = await db.query('SELECT * FROM tags WHERE id IN (?)', [tagIds]);

// Creating new relationships with explicit keys
await db.query(`DELETE FROM ${throughTable} WHERE ${foreignKey} = ?`, [articleId]);
for (const tagId of newTagIds) {
  await db.query(
    `INSERT INTO ${throughTable} (${foreignKey}, ${otherKey}) VALUES (?, ?)`,
    [articleId, tagId]
  );
}
```

### For hasOne Relationships

```javascript
// Get featured image for an article
const image = await db.query(
  'SELECT * FROM images WHERE featured_article_id = ? LIMIT 1',
  [articleId]
);

// Verify it's actually one-to-one
const count = await db.query(
  'SELECT COUNT(*) as count FROM images WHERE featured_article_id = ?',
  [articleId]
);
if (count > 1) {
  console.warn(`hasOne relationship returned ${count} results`);
}
```

### Complete Storage Plugin Example

Here's a complete example of a storage plugin helper that uses all the configuration:

```javascript
// Example storage plugin
export const MySQLStoragePlugin = {
  name: 'mysql-storage',
  
  install({ helpers, apiOptions }) {
    helpers.dataQuery = async function({ scopeName, queryParams, idProperty }) {
      // Access full scope configuration
      const scope = this.scopes[scopeName];
      const schema = scope.schema;
      const relationships = scope.relationships || {};
      const tableName = schema.tableName || scopeName;
      
      // Build base query
      let query = `SELECT * FROM ${tableName}`;
      const params = [];
      
      // Handle filters if searchSchema is defined
      if (queryParams.filters && scope.searchSchema) {
        const whereConditions = [];
        for (const [field, value] of Object.entries(queryParams.filters)) {
          if (scope.searchSchema[field]) {
            whereConditions.push(`${field} = ?`);
            params.push(value);
          }
        }
        if (whereConditions.length > 0) {
          query += ` WHERE ${whereConditions.join(' AND ')}`;
        }
      }
      
      // Handle sorting
      if (queryParams.sort && queryParams.sort.length > 0) {
        const sortClauses = queryParams.sort.map(field => {
          const desc = field.startsWith('-');
          const fieldName = desc ? field.substring(1) : field;
          return `${fieldName} ${desc ? 'DESC' : 'ASC'}`;
        });
        query += ` ORDER BY ${sortClauses.join(', ')}`;
      }
      
      // Handle pagination
      if (queryParams.page) {
        const limit = queryParams.page.size || 20;
        const offset = ((queryParams.page.number || 1) - 1) * limit;
        query += ` LIMIT ${limit} OFFSET ${offset}`;
      }
      
      // Execute query
      const records = await db.query(query, params);
      
      // Convert to JSON:API format
      return {
        data: records.map(record => ({
          type: scopeName,
          id: String(record[idProperty]),
          attributes: this.filterAttributes(record, schema),
          relationships: this.buildRelationships(record, relationships)
        }))
      };
    };
  }
};
```

## Best Practices

1. **Always validate foreign keys exist** before creating relationships
2. **Use transactions** when creating/updating multiple related records
3. **Consider indexes** on foreign key columns for performance
4. **Use UNIQUE constraints** for hasOne relationships
5. **Be consistent** with naming conventions (e.g., always use `_id` suffix)
6. **Document non-standard foreign keys** clearly in your schema
7. **Use the tableName property** when your database table names don't match API scope names
8. **Leverage the context object** (`this`) in storage plugins to access all scope configurations

## Summary

The Hooked API REST plugin's relationship system:
- Keeps schemas focused on actual database columns
- Makes relationships explicit and configurable
- Supports all common relationship types
- Maps cleanly to JSON:API output
- Gives storage plugins all the information they need

By separating table structure (schema) from relationships (configuration), we achieve a clean, maintainable system that accurately reflects your database while providing a powerful API.