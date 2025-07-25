import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from './index.js'; // Added: ExpressPlugin
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
const api = new Api({ name: 'book-catalog-api', version: '1.0.0', logLevel: 'trace' });

// Install plugins
await api.use(RestApiPlugin, { publicBaseUrl: '/api/1.0', logLevel: 'trace' });
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Added: Express Plugin

/// *** ...programmatic calls here... ***
















// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true },
  },
  relationships: {
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
  searchSchema: {
    name: { type: 'string', filterUsing: 'like' }
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
    name: { type: 'string', filterUsing: 'like' },
    surname: { type: 'string', filterUsing: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterUsing: 'like' }
  }
});
await api.resources.authors.createKnexTable();

// Define reviews resource with a polymorphic relationship
await api.addResource('reviews', {
  schema: {
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', max: 500, nullable: true },
    // These two fields store the polymorphic relationship data in the database
    reviewable_type: { type: 'string', max: 50 }, // Stores 'publishers' or 'authors' - not required when using relationships
    reviewable_id: { type: 'id' }, // Stores the ID of the publisher or author - not required when using relationships
    // This defines the polymorphic relationship for API consumption
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
    rating: { type: 'number', filterUsing: '=' },
    comment: { type: 'string', filterUsing: 'like' },
    reviewableType: { type: 'string', actualField: 'reviewable_type' }, // Allows filtering by parent type
    reviewableId: { type: 'id', actualField: 'reviewable_id' },         // Allows filtering by parent ID
    // Allows filtering reviews by the name of the associated publisher or author.
    // 'oneOf' with dot notation enables cross-table polymorphic search.
    reviewableName: {
      type: 'string',
      oneOf: ['publishers.name', 'authors.name'],
      filterUsing: 'like'
    }
  }
});
await api.resources.reviews.createKnexTable();


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

// Test simplified mode
console.log('\n=== Testing Simplified Mode ===');
const review5_simplified = await api.resources.reviews.post({
  rating: 4,
  comment: 'Great German author! (Simplified)',
  reviewable_type: 'authors',
  reviewable_id: germanAuthor_ns.id
});

console.log('Added review in simplified mode:', inspect(review5_simplified));


const germanAuthorWithReviews = await api.resources.authors.get({
    id: germanAuthor_ns.id,
    queryParams: {
      include: ['reviews']
    },
    simplified: false
})

console.log('German author with reviews (not simplified):', inspect(germanAuthorWithReviews))

const germanAuthorWithReviewsSimplified = await api.resources.authors.get({
    id: germanAuthor_ns.id,
    queryParams: {
      // include: ['reviews']
    },
    simplified: true
})

console.log('German author with reviews (simplified):', inspect(germanAuthorWithReviewsSimplified))





// Createthe express server and add the API's routes 
const app = express();
app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);

await knex.destroy();


//app.listen(3000, () => {
//  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
//});
