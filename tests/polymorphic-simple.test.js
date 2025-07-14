import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { createExtendedApi } from './fixtures/api-configs.js';
import {
  validateJsonApiStructure,
  cleanTables,
  createJsonApiDocument,
  createRelationship
} from './helpers/test-utils.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance
let api;

describe('Polymorphic Relationships - Basic Tests', () => {
  before(async () => {
    // Initialize API
    api = await createExtendedApi(knex);
  });

  after(async () => {
    // Close database connection
    await knex.destroy();
  });

  beforeEach(async () => {
    // Clean all tables before each test
    await cleanTables(knex, [
      'ext_countries', 'ext_publishers', 'ext_authors', 'ext_books', 
      'ext_book_authors', 'ext_reviews'
    ]);
  });

  it('should create and retrieve a review for a book', async () => {
    // Create a country first
    const country = await api.resources.countries.post({
      inputRecord: createJsonApiDocument('countries', {
        name: 'USA',
        code: 'US'
      })
    });

    // Create a book
    const book = await api.resources.books.post({
      inputRecord: createJsonApiDocument('books', {
        title: 'Test Book'
      }, {
        country: createRelationship({ type: 'countries', id: country.data.id })
      })
    });

    // Create a review for the book
    const review = await api.resources.reviews.post({
      inputRecord: createJsonApiDocument('reviews', {
        rating: 5,
        title: 'Great book!',
        content: 'This is an excellent book about testing.',
        reviewer_name: 'John Doe',
        reviewable_type: 'books',
        reviewable_id: book.data.id
      })
    });

    validateJsonApiStructure(review);
    assert.equal(review.data.type, 'reviews');
    assert.equal(review.data.attributes.rating, 5);
    
    // Get the review back
    const retrievedReview = await api.resources.reviews.get({
      id: review.data.id
    });
    
    validateJsonApiStructure(retrievedReview);
    assert.equal(retrievedReview.data.attributes.reviewable_type, 'books');
    assert.equal(String(retrievedReview.data.attributes.reviewable_id), String(book.data.id));
  });

  it('should query all reviews', async () => {
    // Create test data
    const country = await api.resources.countries.post({
      inputRecord: createJsonApiDocument('countries', {
        name: 'UK',
        code: 'GB'
      })
    });

    const book = await api.resources.books.post({
      inputRecord: createJsonApiDocument('books', {
        title: 'Book 1'
      }, {
        country: createRelationship({ type: 'countries', id: country.data.id })
      })
    });

    const author = await api.resources.authors.post({
      inputRecord: createJsonApiDocument('authors', {
        name: 'Author 1'
      })
    });

    // Create reviews
    await api.resources.reviews.post({
      inputRecord: createJsonApiDocument('reviews', {
        rating: 5,
        title: 'Great book',
        content: 'Love it',
        reviewer_name: 'Reader 1',
        reviewable_type: 'books',
        reviewable_id: book.data.id
      })
    });

    await api.resources.reviews.post({
      inputRecord: createJsonApiDocument('reviews', {
        rating: 4,
        title: 'Good author',
        content: 'Nice writing',
        reviewer_name: 'Reader 2',
        reviewable_type: 'authors',
        reviewable_id: author.data.id
      })
    });

    // Query all reviews
    const result = await api.resources.reviews.query({});
    
    validateJsonApiStructure(result, true);
    assert.equal(result.data.length, 2);
    
    // Check we have one of each type
    const bookReview = result.data.find(r => r.attributes.reviewable_type === 'books');
    const authorReview = result.data.find(r => r.attributes.reviewable_type === 'authors');
    
    assert(bookReview, 'Should have a book review');
    assert(authorReview, 'Should have an author review');
  });
});