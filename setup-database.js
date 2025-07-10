import knexLib from 'knex';

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

async function setupDatabase() {
  console.log('Creating database tables...');

  // Create countries table
  await knex.schema.createTable('countries', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.string('code', 2).unique();
  });
  console.log('✓ Created countries table');

  // Create publishers table
  await knex.schema.createTable('publishers', (table) => {
    table.increments('id').primary();
    table.string('name', 200).notNullable();
    table.integer('country_id').references('id').inTable('countries');
  });
  console.log('✓ Created publishers table');

  // Create authors table
  await knex.schema.createTable('authors', (table) => {
    table.increments('id').primary();
    table.string('name', 200).notNullable();
  });
  console.log('✓ Created authors table');

  // Create books table
  await knex.schema.createTable('books', (table) => {
    table.increments('id').primary();
    table.string('title', 300).notNullable();
    table.integer('country_id').notNullable().references('id').inTable('countries');
    table.integer('publisher_id').references('id').inTable('publishers');
  });
  console.log('✓ Created books table');

  // Create book_authors pivot table
  await knex.schema.createTable('book_authors', (table) => {
    table.increments('id').primary();
    table.integer('book_id').notNullable().references('id').inTable('books');
    table.integer('author_id').notNullable().references('id').inTable('authors');
    // Add unique constraint to prevent duplicate author-book relationships
    table.unique(['book_id', 'author_id']);
  });
  console.log('✓ Created book_authors table');

  console.log('Database setup complete!');
  return knex;
}

export { setupDatabase };