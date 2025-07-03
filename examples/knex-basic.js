import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'jsonrestapi';
import knex from 'knex';
import express from 'express';

// Create a Knex instance (using SQLite for simplicity)
const db = knex({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create the API
const api = new Api({
  name: 'library-api',
  version: '1.0.0'
});

// Use plugins
api.use(RestApiPlugin);
api.use(RestApiKnexPlugin, {
  knex: { knex: db }  // Pass the knex instance
});
api.use(ExpressPlugin);

// Create the books table
await db.schema.createTable('books', (table) => {
  table.increments('id');
  table.string('title').notNullable();
  table.string('author').notNullable();
  table.integer('year');
  table.string('isbn');
});

// Define the books resource
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    isbn: { type: 'string' }
  }
});

// Insert some sample data
await db('books').insert([
  { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', year: 1925, isbn: '978-0-7432-7356-5' },
  { title: '1984', author: 'George Orwell', year: 1949, isbn: '978-0-452-28423-4' },
  { title: 'To Kill a Mockingbird', author: 'Harper Lee', year: 1960, isbn: '978-0-06-112008-4' }
]);

// Create Express app
const app = express();
api.express.mount(app);

// Start the server
app.listen(3000, () => {
  console.log('Library API with Knex running at http://localhost:3000/api');
  console.log('');
  console.log('Try these commands:');
  console.log('  curl http://localhost:3000/api/books');
  console.log('  curl http://localhost:3000/api/books/1');
  console.log('  curl -X POST http://localhost:3000/api/books -H "Content-Type: application/json" -d \'{"data":{"type":"books","attributes":{"title":"New Book","author":"New Author","year":2024}}}\'');
});