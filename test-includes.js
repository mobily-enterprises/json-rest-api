import { test } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';

test('PATCH with includes', async () => {
  resetGlobalRegistryForTesting();
  const knex = knexConfig({
    client: 'sqlite3',
    connection: ':memory:',
    useNullAsDefault: true
  });
  
  await knex.raw('PRAGMA foreign_keys = ON');
  
  // Create tables
  await knex.schema.createTable('authors', table => {
    table.increments('id');
    table.string('name');
  });
  
  await knex.schema.createTable('tags', table => {
    table.increments('id');
    table.string('name');
  });
  
  await knex.schema.createTable('articles', table => {
    table.increments('id');
    table.string('title');
    table.integer('author_id');
  });
  
  await knex.schema.createTable('article_tags', table => {
    table.increments('id');
    table.integer('article_id').references('id').inTable('articles').onDelete('CASCADE');
    table.integer('tag_id').references('id').inTable('tags').onDelete('CASCADE');
    table.string('relevance');
  });
  
  // Insert test data
  await knex('authors').insert({ id: 1, name: 'Author 1' });
  await knex('tags').insert([
    { id: 1, name: 'Tag 1' },
    { id: 2, name: 'Tag 2' },
    { id: 3, name: 'Tag 3' }
  ]);
  await knex('articles').insert({ id: 1, title: 'Article 1', author_id: 1 });
  await knex('article_tags').insert([
    { article_id: 1, tag_id: 1, relevance: 'high' }
  ]);
  
  const api = new Api({ name: 'test-api' });
  await api.use(RestApiPlugin);
  await api.use(RestApiKnexPlugin, { knex });
  
  api.addResource('authors', {
    schema: { id: { type: 'id' }, name: { type: 'string' } }
  });
  
  api.addResource('tags', {
    schema: { id: { type: 'id' }, name: { type: 'string' } }
  });
  
  api.addResource('articles', {
    schema: { 
      id: { type: 'id' }, 
      title: { type: 'string' },
      author_id: { 
        belongsTo: 'authors', 
        as: 'author',
        sideLoad: true
      }
    },
    relationships: {
      tags: { 
        manyToMany: { 
          through: 'article_tags', 
          foreignKey: 'article_id', 
          otherKey: 'tag_id' 
        } 
      }
    }
  });
  
  api.addResource('article_tags', {
    schema: {
      id: { type: 'id' },
      article_id: { type: 'number', required: true },
      tag_id: { type: 'number', required: true },
      relevance: { type: 'string' }
    },
    searchSchema: {
      article_id: { type: 'number' },
      tag_id: { type: 'number' }
    }
  });
  
  try {
    const result = await api.resources.articles.patch({
      id: '1',
      inputRecord: {
        data: {
          type: 'articles',
          id: '1',
          relationships: {
            tags: {
              data: [
                { type: 'tags', id: '2' },
                { type: 'tags', id: '3' }
              ]
            }
          }
        }
      },
      queryParams: {
        include: ['tags', 'author']
      }
    });
    
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('Success!');
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Error code:', error.code);
    console.log('Stack:', error.stack);
  }
  
  await knex.destroy();
});