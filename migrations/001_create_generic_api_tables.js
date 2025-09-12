/**
 * Migration: Create Generic API Tables
 * 
 * Creates the database tables needed for the Generic API plugin.
 * Uses a hybrid storage approach (EAV + JSONB + indexed columns).
 */

export async function up(knex) {
  const tablePrefix = 'gen_api';
  
  // Create tables table
  await knex.schema.createTableIfNotExists(`${tablePrefix}_tables`, table => {
    table.increments('id').primary();
    table.string('table_name', 100).notNullable().unique();
    table.string('api_name', 100).notNullable().unique();
    table.string('description', 500);
    table.boolean('is_active').defaultTo(true);
    table.enum('storage_mode', ['eav', 'jsonb', 'hybrid']).defaultTo('hybrid');
    table.jsonb('config');
    table.timestamps(true, true);
    
    table.index('is_active');
    table.index('created_at');
  });
  
  // Create fields table
  await knex.schema.createTableIfNotExists(`${tablePrefix}_fields`, table => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable();
    table.string('field_name', 100).notNullable();
    table.string('data_type', 50).notNullable();
    table.enum('storage_type', ['eav', 'jsonb', 'indexed']).defaultTo('jsonb');
    table.boolean('is_required').defaultTo(false);
    table.boolean('is_hidden').defaultTo(false);
    table.boolean('is_unique').defaultTo(false);
    table.boolean('is_indexed').defaultTo(false);
    table.boolean('is_searchable').defaultTo(true);
    table.boolean('is_sortable').defaultTo(true);
    table.boolean('is_computed').defaultTo(false);
    table.text('computed_expression');
    table.integer('index_position');
    table.integer('max_length');
    table.decimal('min_value');
    table.decimal('max_value');
    table.text('default_value');
    table.text('enum_values');
    table.text('validation_rules');
    table.integer('sort_order').defaultTo(0);
    table.timestamps(true, true);
    
    table.foreign('table_id').references('id').inTable(`${tablePrefix}_tables`).onDelete('CASCADE');
    table.unique(['table_id', 'field_name']);
    table.index('table_id');
    table.index('field_name');
    table.index('is_indexed');
  });
  
  // Create relationships table
  await knex.schema.createTableIfNotExists(`${tablePrefix}_relationships`, table => {
    table.increments('id').primary();
    table.integer('source_table_id').unsigned().notNullable();
    table.integer('target_table_id').unsigned().notNullable();
    table.string('relationship_name', 100).notNullable();
    table.enum('relationship_type', ['belongsTo', 'hasMany', 'hasOne', 'manyToMany']).notNullable();
    table.string('foreign_key_field', 100);
    table.string('other_key_field', 100);
    table.string('junction_table', 100);
    table.boolean('cascade_delete').defaultTo(false);
    table.boolean('cascade_update').defaultTo(false);
    table.text('config');
    table.timestamps(true, true);
    
    table.foreign('source_table_id').references('id').inTable(`${tablePrefix}_tables`).onDelete('CASCADE');
    table.foreign('target_table_id').references('id').inTable(`${tablePrefix}_tables`).onDelete('CASCADE');
    table.unique(['source_table_id', 'relationship_name']);
    table.index('source_table_id');
    table.index('target_table_id');
  });
  
  // Create main data table (hybrid storage with JSONB and indexed columns)
  await knex.schema.createTableIfNotExists(`${tablePrefix}_data`, table => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable();
    
    // JSONB storage for flexible data
    table.jsonb('data');
    
    // Indexed columns for frequently queried/sorted fields
    // String fields (up to 3)
    table.string('indexed_string_1', 255);
    table.string('indexed_string_2', 255);
    table.string('indexed_string_3', 255);
    
    // Number fields (up to 3)
    table.decimal('indexed_number_1');
    table.decimal('indexed_number_2');
    table.decimal('indexed_number_3');
    
    // Date fields (up to 2)
    table.datetime('indexed_date_1');
    table.datetime('indexed_date_2');
    
    // Boolean fields (up to 2)
    table.boolean('indexed_bool_1');
    table.boolean('indexed_bool_2');
    
    // Metadata
    table.timestamps(true, true);
    table.integer('created_by');
    table.integer('updated_by');
    
    // Indexes
    table.foreign('table_id').references('id').inTable(`${tablePrefix}_tables`).onDelete('CASCADE');
    table.index(['table_id', 'created_at']);
    table.index(['table_id', 'updated_at']);
    
    // Indexes for indexed columns (only if they might be used)
    table.index(['table_id', 'indexed_string_1']);
    table.index(['table_id', 'indexed_string_2']);
    table.index(['table_id', 'indexed_string_3']);
    table.index(['table_id', 'indexed_number_1']);
    table.index(['table_id', 'indexed_number_2']);
    table.index(['table_id', 'indexed_number_3']);
    table.index(['table_id', 'indexed_date_1']);
    table.index(['table_id', 'indexed_date_2']);
    table.index(['table_id', 'indexed_bool_1']);
    table.index(['table_id', 'indexed_bool_2']);
    
    // PostgreSQL specific: GIN index for JSONB
    if (knex.client.config.client === 'pg') {
      knex.raw(`CREATE INDEX "${tablePrefix}_data_jsonb_idx" ON "${tablePrefix}_data" USING GIN (data)`);
    }
  });
  
  // Create EAV values table (for fields that don't fit in indexed columns)
  await knex.schema.createTableIfNotExists(`${tablePrefix}_data_values`, table => {
    table.increments('id').primary();
    table.integer('data_id').unsigned().notNullable();
    table.integer('field_id').unsigned().notNullable();
    
    // Multiple value columns for different data types
    table.text('value_text');
    table.decimal('value_number');
    table.datetime('value_date');
    table.jsonb('value_json');
    table.boolean('value_boolean');
    
    table.timestamps(true, true);
    
    table.foreign('data_id').references('id').inTable(`${tablePrefix}_data`).onDelete('CASCADE');
    table.foreign('field_id').references('id').inTable(`${tablePrefix}_fields`).onDelete('CASCADE');
    table.unique(['data_id', 'field_id']);
    table.index('data_id');
    table.index('field_id');
    
    // Indexes for value columns
    table.index('value_text');
    table.index('value_number');
    table.index('value_date');
    table.index('value_boolean');
  });
  
  // Create audit log table (optional)
  await knex.schema.createTableIfNotExists(`${tablePrefix}_audit_log`, table => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable();
    table.integer('data_id').unsigned();
    table.string('action', 20).notNullable();
    table.jsonb('old_values');
    table.jsonb('new_values');
    table.integer('user_id');
    table.string('ip_address', 45);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.foreign('table_id').references('id').inTable(`${tablePrefix}_tables`).onDelete('CASCADE');
    table.index('table_id');
    table.index('data_id');
    table.index('action');
    table.index('created_at');
    table.index('user_id');
  });
  
  // Create metrics table (optional)
  await knex.schema.createTableIfNotExists(`${tablePrefix}_metrics`, table => {
    table.increments('id').primary();
    table.integer('table_id').unsigned();
    table.string('operation', 20);
    table.integer('response_time');
    table.boolean('cache_hit').defaultTo(false);
    table.integer('result_count');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.foreign('table_id').references('id').inTable(`${tablePrefix}_tables`).onDelete('CASCADE');
    table.index('table_id');
    table.index('operation');
    table.index('created_at');
    table.index(['table_id', 'created_at']);
  });
  
  console.log('Generic API tables created successfully');
}

export async function down(knex) {
  const tablePrefix = 'gen_api';
  
  // Drop tables in reverse order due to foreign key constraints
  await knex.schema.dropTableIfExists(`${tablePrefix}_metrics`);
  await knex.schema.dropTableIfExists(`${tablePrefix}_audit_log`);
  await knex.schema.dropTableIfExists(`${tablePrefix}_data_values`);
  await knex.schema.dropTableIfExists(`${tablePrefix}_data`);
  await knex.schema.dropTableIfExists(`${tablePrefix}_relationships`);
  await knex.schema.dropTableIfExists(`${tablePrefix}_fields`);
  await knex.schema.dropTableIfExists(`${tablePrefix}_tables`);
  
  console.log('Generic API tables dropped successfully');
}

export default { up, down };