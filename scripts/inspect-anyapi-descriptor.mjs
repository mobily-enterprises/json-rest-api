import knexLib from 'knex';
import { createCustomIdPropertyApi } from '../tests/fixtures/api-configs.js';

async function run() {
  const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const api = await createCustomIdPropertyApi(knex);
  const descriptor = await api.anyapi.registry.getDescriptor('default', 'reviews');
  console.log(JSON.stringify({
    idProperty: descriptor.idProperty,
    fields: descriptor.fields,
    canonicalFieldMap: descriptor.canonicalFieldMap,
    reverseAttributes: descriptor.reverseAttributes,
  }, null, 2));
  await knex.destroy();
}

run().catch((err) => {
  console.error('Failed to inspect descriptor', err);
});
