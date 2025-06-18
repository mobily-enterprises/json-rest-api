/**
 * Query Builder with JSON:API Response Structure
 * 
 * Shows how the query builder works with JSON:API formatted responses
 * including compound documents with included resources
 */

import { createApi, Schema } from '../index.js';

// Setup
const api = createApi({
  storage: 'mysql',
  mysql: { connection: dbConfig }
});

// Define schemas with relationships
const articleSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  body: { type: 'string' },
  authorId: { type: 'id', refs: { resource: 'people' } },
  categoryId: { type: 'id', refs: { resource: 'categories' } },
  tagIds: { type: 'array', items: { type: 'id', refs: { resource: 'tags' } } },
  createdAt: { type: 'timestamp' }
});

const personSchema = new Schema({
  id: { type: 'id' },
  firstName: { type: 'string' },
  lastName: { type: 'string' },
  email: { type: 'string' },
  avatar: { type: 'string' }
});

const categorySchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string' },
  slug: { type: 'string' }
});

api.addResource('articles', articleSchema);
api.addResource('people', personSchema);
api.addResource('categories', categorySchema);

// ============================================================
// BASIC QUERY WITH RELATIONSHIPS
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'articles') {
    // Parse JSON:API include parameter
    const includes = context.params.include?.split(',') || [];
    
    for (const rel of includes) {
      if (rel === 'author') {
        // Map JSON:API relationship name to schema field
        context.query.includeRelated('authorId', ['firstName', 'lastName', 'email']);
      } else if (rel === 'category') {
        context.query.includeRelated('categoryId', ['name', 'slug']);
      }
    }
  }
});

/*
Request:
  GET /api/articles?include=author,category

Response:
{
  "data": [{
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "JSON:API paints my bikeshed!",
      "body": "The shortest article. Ever.",
      "createdAt": "2025-01-15T09:30:00Z"
    },
    "relationships": {
      "author": {
        "data": { "type": "people", "id": "9" }
      },
      "category": {
        "data": { "type": "categories", "id": "2" }
      }
    }
  }],
  "included": [
    {
      "type": "people",
      "id": "9",
      "attributes": {
        "firstName": "Dan",
        "lastName": "Gebhardt",
        "email": "dgeb@jsonapi.org"
      }
    },
    {
      "type": "categories",
      "id": "2",
      "attributes": {
        "name": "JSON:API",
        "slug": "json-api"
      }
    }
  ]
}
*/

// ============================================================
// SPARSE FIELDSETS WITH QUERY BUILDER
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'articles') {
    // JSON:API sparse fieldsets
    const fields = context.params.fields || {};
    
    // Handle main resource fields
    if (fields.articles) {
      const requestedFields = fields.articles.split(',');
      context.query.clearSelect();
      
      // Always include id for JSON:API
      context.query.select('articles.id');
      
      // Add requested fields
      requestedFields.forEach(field => {
        if (field !== 'id') {
          context.query.select(`articles.${field}`);
        }
      });
    }
    
    // Handle related resource fields
    if (fields.people && context.params.include?.includes('author')) {
      const peopleFields = fields.people.split(',');
      context.query.includeRelated('authorId', peopleFields);
    }
  }
});

/*
Request:
  GET /api/articles?include=author&fields[articles]=title,authorId&fields[people]=firstName,lastName

Response includes only requested fields!
*/

// ============================================================
// FILTERING WITH CLEAN SYNTAX
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'articles') {
    const filters = context.params.filter || {};
    
    // Filter by author name (requires join)
    if (filters.authorName) {
      context.query
        .leftJoin('authorId')  // Smart join!
        .where('people.firstName LIKE ? OR people.lastName LIKE ?', 
               `%${filters.authorName}%`, 
               `%${filters.authorName}%`);
    }
    
    // Filter by category
    if (filters.category) {
      context.query
        .leftJoin('categoryId')  // Smart join!
        .where('categories.slug = ?', filters.category);
    }
    
    // Date range filter
    if (filters.publishedAfter) {
      context.query.where('articles.createdAt > ?', filters.publishedAfter);
    }
  }
});

/*
Request:
  GET /api/articles?filter[authorName]=Dan&filter[category]=json-api

The query builder automatically handles the joins!
*/

// ============================================================
// SORTING WITH RELATED FIELDS
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'articles') {
    const sort = context.params.sort?.split(',') || [];
    
    for (const sortField of sort) {
      const desc = sortField.startsWith('-');
      const field = desc ? sortField.slice(1) : sortField;
      
      if (field === 'author.name') {
        // Need to join to sort by author name
        context.query
          .leftJoin('authorId')
          .orderBy('people.lastName', desc ? 'DESC' : 'ASC')
          .orderBy('people.firstName', desc ? 'DESC' : 'ASC');
      } else if (field === 'category.name') {
        context.query
          .leftJoin('categoryId')
          .orderBy('categories.name', desc ? 'DESC' : 'ASC');
      } else {
        // Direct field on articles
        context.query.orderBy(`articles.${field}`, desc ? 'DESC' : 'ASC');
      }
    }
  }
});

/*
Request:
  GET /api/articles?sort=-author.name,title

Articles sorted by author name (descending) then title (ascending)
*/

// ============================================================
// COMPOUND DOCUMENTS WITH SMART LOADING
// ============================================================

api.hook('beforeSend', async (context) => {
  if (context.options.type === 'articles' && context.result?.data) {
    const includes = context.params.include?.split(',') || [];
    
    if (includes.length > 0) {
      // Collect all needed IDs
      const authorIds = new Set();
      const categoryIds = new Set();
      
      const articles = Array.isArray(context.result.data) 
        ? context.result.data 
        : [context.result.data];
      
      articles.forEach(article => {
        if (article.authorId) authorIds.add(article.authorId);
        if (article.categoryId) categoryIds.add(article.categoryId);
      });
      
      // Fetch related resources using query builder
      context.result.included = [];
      
      if (includes.includes('author') && authorIds.size > 0) {
        const peopleQuery = api.createQuery('people')
          .where('id IN (?)', Array.from(authorIds));
        
        // Apply sparse fieldsets if requested
        if (context.params.fields?.people) {
          peopleQuery.clearSelect();
          peopleQuery.select('id'); // Always need id
          context.params.fields.people.split(',').forEach(field => {
            peopleQuery.select(field);
          });
        }
        
        const people = await api.executeQuery(peopleQuery);
        context.result.included.push(...people);
      }
      
      if (includes.includes('category') && categoryIds.size > 0) {
        const categoryQuery = api.createQuery('categories')
          .where('id IN (?)', Array.from(categoryIds));
        
        const categories = await api.executeQuery(categoryQuery);
        context.result.included.push(...categories);
      }
    }
  }
});

// ============================================================
// PAGINATION WITH QUERY BUILDER
// ============================================================

api.hook('modifyQuery', async (context) => {
  const page = context.params.page || {};
  
  if (page.limit || page.offset) {
    const limit = parseInt(page.limit) || 25;
    const offset = parseInt(page.offset) || 0;
    
    context.query.limit(limit, offset);
    
    // Also create count query for pagination metadata
    context.countQuery = context.query.clone()
      .clearSelect()
      .select('COUNT(*) as total');
  }
});

// ============================================================
// COMPLEX REAL-WORLD EXAMPLE
// ============================================================

api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'articles' && context.params.view === 'dashboard') {
    // Dashboard view needs a lot of related data
    context.query
      // Include author info with custom aliases for cleaner response
      .includeRelated('authorId', {
        firstName: 'authorFirstName',
        lastName: 'authorLastName',
        avatar: 'authorAvatar'
      })
      
      // Include category
      .includeRelated('categoryId', ['name', 'slug'])
      
      // Add computed fields
      .select(`(
        SELECT COUNT(*) 
        FROM comments 
        WHERE comments.articleId = articles.id
      ) as commentCount`)
      
      .select(`(
        SELECT AVG(rating) 
        FROM ratings 
        WHERE ratings.articleId = articles.id
      ) as averageRating`)
      
      // Only published articles
      .where('articles.status = ?', 'published')
      
      // Order by popularity
      .orderBy('commentCount', 'DESC')
      .orderBy('articles.createdAt', 'DESC')
      
      // Limit to recent articles
      .limit(10);
  }
});

/*
This single query efficiently loads:
- Article data
- Author information
- Category information  
- Comment counts
- Average ratings

All with proper joins and optimized SQL!
*/

// ============================================================
// THE POWER OF ABSTRACTION
// ============================================================

/*
The query builder abstracts away SQL complexity while still giving you:

1. **Type Safety** (with TypeScript)
2. **Relationship Awareness** (via schema refs)
3. **JSON:API Compliance** (proper response structure)
4. **Performance** (efficient queries, no N+1)
5. **Flexibility** (can still write raw SQL when needed)

Compare the clean JavaScript code above to the raw SQL it generates - 
the difference in maintainability is huge!
*/