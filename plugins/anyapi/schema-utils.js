const STRING_SLOT_COUNT = 10;
const NUMBER_SLOT_COUNT = 10;
const BOOLEAN_SLOT_COUNT = 5;
const DATE_SLOT_COUNT = 5;
const JSON_SLOT_COUNT = 5;
const BELONGS_TO_SLOT_COUNT = 5;

export const SLOT_LIMITS = {
  string: STRING_SLOT_COUNT,
  number: NUMBER_SLOT_COUNT,
  boolean: BOOLEAN_SLOT_COUNT,
  date: DATE_SLOT_COUNT,
  json: JSON_SLOT_COUNT,
  belongsTo: BELONGS_TO_SLOT_COUNT,
};

export const DEFAULT_CANONICAL_CONFIG = {
  scopeName: 'anyapi_records',
  tableName: 'any_records',
  type: 'anyapi_records',
  tenantColumn: 'tenant_id',
  resourceColumn: 'resource',
  relationshipColumn: 'relationship',
  leftIdColumn: 'left_id',
  leftResourceColumn: 'left_resource',
  rightIdColumn: 'right_id',
  rightResourceColumn: 'right_resource',
};

const ensureTable = async (knex, tableName, tableBuilder) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await knex.schema.createTable(tableName, tableBuilder);
  }
};

const ensureIndex = async (knex, tableName, columns, indexName) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) return;
  const hasIndex = await knex.schema.withSchema('main').hasIndex?.(tableName, indexName);
  if (!hasIndex) {
    await knex.schema.table(tableName, (table) => {
      table.index(columns, indexName);
    });
  }
};

export const ensureAnyApiSchema = async (knex) => {
  await ensureTable(knex, 'any_records', (table) => {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('resource').notNullable();

    for (let index = 1; index <= STRING_SLOT_COUNT; index += 1) {
      table.text(`string_${index}`);
    }
    for (let index = 1; index <= NUMBER_SLOT_COUNT; index += 1) {
      table.double(`number_${index}`);
    }
    for (let index = 1; index <= BOOLEAN_SLOT_COUNT; index += 1) {
      table.boolean(`boolean_${index}`);
    }
    for (let index = 1; index <= DATE_SLOT_COUNT; index += 1) {
      table.dateTime(`date_${index}`);
    }
    for (let index = 1; index <= JSON_SLOT_COUNT; index += 1) {
      table.text(`json_${index}`);
    }

    for (let index = 1; index <= BELONGS_TO_SLOT_COUNT; index += 1) {
      table.string(`rel_${index}_id`);
      table.string(`rel_${index}_type`);
    }

    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('deleted_at');

    table.index(['tenant_id', 'resource']);
    table.index(['resource']);
  });

  await ensureTable(knex, 'any_links', (table) => {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('relationship').notNullable();
    table.string('left_resource').notNullable();
    table.string('left_id').notNullable();
    table.string('right_resource').notNullable();
    table.string('right_id').notNullable();
    table.text('payload');
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['tenant_id', 'relationship']);
    table.index(['tenant_id', 'left_resource']);
    table.index(['tenant_id', 'right_resource']);
    table.index(['relationship']);
  });

  await ensureTable(knex, 'any_resource_configs', (table) => {
    table.increments('id').primary();
    table.string('tenant_id').notNullable();
    table.string('resource').notNullable();
    table.text('schema_json').notNullable();
    table.text('relationships_json').notNullable();
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['tenant_id', 'resource']);
  });

  await ensureTable(knex, 'any_field_configs', (table) => {
    table.increments('id').primary();
    table.integer('resource_config_id').notNullable()
      .references('id').inTable('any_resource_configs').onDelete('CASCADE');
    table.string('field_name').notNullable();
    table.string('slot_type').notNullable();
    table.integer('slot_index').notNullable();
    table.string('slot_column').notNullable();
    table.boolean('nullable').defaultTo(false).notNullable();
    table.boolean('required').defaultTo(false).notNullable();
    table.string('target_resource');
    table.string('alias');
    table.text('meta_json');
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['resource_config_id', 'field_name']);
    table.index(['resource_config_id']);
  });

  await ensureTable(knex, 'any_relationship_configs', (table) => {
    table.increments('id').primary();
    table.integer('resource_config_id').notNullable()
      .references('id').inTable('any_resource_configs').onDelete('CASCADE');
    table.string('relationship_name').notNullable();
    table.string('relationship_type').notNullable();
    table.string('target_resource');
    table.integer('slot_index');
    table.string('id_column');
    table.string('type_column');
    table.string('relationship_key');
    table.string('through');
    table.string('foreign_key');
    table.string('other_key');
    table.string('alias');
    table.text('meta_json');
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['resource_config_id', 'relationship_name']);
    table.index(['resource_config_id']);
  });
};

export const SLOT_POOLS = {
  string: Array.from({ length: STRING_SLOT_COUNT }, (_, index) => `string_${index + 1}`),
  number: Array.from({ length: NUMBER_SLOT_COUNT }, (_, index) => `number_${index + 1}`),
  boolean: Array.from({ length: BOOLEAN_SLOT_COUNT }, (_, index) => `boolean_${index + 1}`),
  date: Array.from({ length: DATE_SLOT_COUNT }, (_, index) => `date_${index + 1}`),
  json: Array.from({ length: JSON_SLOT_COUNT }, (_, index) => `json_${index + 1}`),
  belongsTo: Array.from({ length: BELONGS_TO_SLOT_COUNT }, (_, index) => index + 1),
};

export const TYPE_TO_POOL = new Map([
  ['string', 'string'],
  ['text', 'string'],
  ['uuid', 'string'],
  ['email', 'string'],
  ['number', 'number'],
  ['integer', 'number'],
  ['float', 'number'],
  ['decimal', 'number'],
  ['boolean', 'boolean'],
  ['date', 'date'],
  ['datetime', 'date'],
  ['dateTime', 'date'],
  ['timestamp', 'date'],
  ['time', 'date'],
  ['json', 'json'],
  ['object', 'json'],
]);
