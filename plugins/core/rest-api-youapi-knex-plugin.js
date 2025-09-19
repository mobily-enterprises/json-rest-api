import { ensureAnyApiSchema } from '../anyapi/schema-utils.js';
import { YouapiRegistry } from '../anyapi/youapi-registry.js';

const DEFAULT_TENANT = 'default';

export const RestApiYouapiKnexPlugin = {
  name: 'rest-api-youapi-knex',
  dependencies: ['rest-api'],

  async install({ helpers, vars, pluginOptions, api, log, addHook, addScopeMethod, scopes }) {
    const options = pluginOptions || {};
    const knex = options.knex;

    if (!knex) {
      throw new Error('YouapiKnexPlugin requires a knex instance');
    }

    await ensureAnyApiSchema(knex);

    const registry = new YouapiRegistry({ knex, log });

    api.youapi = api.youapi || {};
    api.youapi.registry = registry;
    api.knex = {
      instance: knex,
      helpers: {},
    };

    helpers.newTransaction = async () => knex.transaction();

    addHook('release', 'youapi-knex-release', {}, async ({ api }) => {
      if (api.knex?.instance) {
        await api.knex.instance.destroy();
      }
    });

    const getDescriptor = async (scopeName) => {
      const descriptor = await registry.getDescriptor(DEFAULT_TENANT, scopeName);
      if (!descriptor) {
        throw new Error(`Descriptor not found for resource '${scopeName}'`);
      }
      return descriptor;
    };

    helpers.dataExists = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const id = context.id;

      const row = await context.db(canonical.tableName)
        .select('id')
        .where(canonical.tenantColumn, descriptor.tenant)
        .where(canonical.resourceColumn, descriptor.resource)
        .where('id', id)
        .first();

      return !!row;
    };

    helpers.dataPost = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const attributes = context.inputRecord?.data?.attributes || {};
      const row = translateAttributesForStorage(attributes, descriptor);
      row[canonical.tenantColumn] = descriptor.tenant;
      row[canonical.resourceColumn] = descriptor.resource;

      const result = await context.db(canonical.tableName)
        .insert(row)
        .returning('id');

      const inserted = Array.isArray(result) ? result[0] : result;
      if (inserted && typeof inserted === 'object' && 'id' in inserted) {
        return inserted.id;
      }
      return inserted;
    };

    helpers.dataPut = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const id = context.id;
      const attributes = context.inputRecord?.data?.attributes || {};
      const row = translateAttributesForStorage(attributes, descriptor);

      row[canonical.resourceColumn] = descriptor.resource;
      row[canonical.tenantColumn] = descriptor.tenant;

      const result = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .update(row);

      return result;
    };

    helpers.dataPatch = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const id = context.id;
      const attributes = context.inputRecord?.data?.attributes || {};
      const row = translateAttributesForStorage(attributes, descriptor);

      const result = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .update(row);

      return result;
    };

    helpers.dataDelete = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const id = context.id;

      const result = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .delete();

      return result;
    };

    helpers.dataGetMinimal = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const id = context.id;

      const row = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .first();

      if (!row) return null;
      const translated = translateRecordFromStorage(row, descriptor);
      return {
        type: descriptor.resource,
        id: String(row.id),
        attributes: translated.attributes,
        relationships: translated.relationships,
      };
    };

    const buildIncludes = async ({ parentResources, descriptor, context }) => {
      const includeParam = context.queryParams?.include;
      if (!includeParam) return [];

      const includeList = Array.isArray(includeParam)
        ? includeParam.flatMap((item) => item.split(',').map((part) => part.trim()).filter(Boolean))
        : String(includeParam).split(',').map((part) => part.trim()).filter(Boolean);

      if (includeList.length === 0) return [];

      const includes = [];
      const seen = new Set();

      for (const path of includeList) {
        if (!path || path.includes('.')) {
          // Nested includes not yet supported
          continue;
        }

        const relInfo = descriptor.belongsTo?.[path];
        if (!relInfo) {
          continue;
        }

        const ids = [...new Set(parentResources
          .map((resource) => resource.relationships?.[path]?.data?.id)
          .filter((id) => id !== undefined && id !== null))];

        if (ids.length === 0) continue;

        const targetDescriptor = await registry.getDescriptor(DEFAULT_TENANT, relInfo.target);
        if (!targetDescriptor) continue;

        const rows = await context.db(targetDescriptor.canonical.tableName)
          .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
          .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
          .whereIn('id', ids);

        for (const row of rows) {
          const translated = translateRecordFromStorage(row, targetDescriptor);
          const includeKey = `${targetDescriptor.resource}:${row.id}`;
          if (seen.has(includeKey)) continue;
          seen.add(includeKey);

          const includeResource = {
            type: targetDescriptor.resource,
            id: String(row.id),
            attributes: translated.attributes,
          };

          if (translated.relationships && Object.keys(translated.relationships).length > 0) {
            includeResource.relationships = translated.relationships;
          }

          includes.push(includeResource);
        }
      }

      return includes;
    };

    helpers.dataGet = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const id = context.id;

      const row = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .first();

      if (!row) return null;

      const record = translateRecordFromStorage(row, descriptor);
      const data = {
        type: descriptor.resource,
        id: String(row.id),
        attributes: record.attributes,
      };

      if (record.relationships && Object.keys(record.relationships).length > 0) {
        data.relationships = record.relationships;
      }

      const included = await buildIncludes({
        parentResources: [data],
        descriptor,
        context,
      });

      const response = { data };
      if (included.length > 0) {
        response.included = included;
      }

      return response;
    };

    helpers.dataQuery = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const query = context.db(canonical.tableName)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant);

      const rows = await query.select();
      const data = rows.map((row) => {
        const translated = translateRecordFromStorage(row, descriptor);
        const resource = {
          type: descriptor.resource,
          id: String(row.id),
          attributes: translated.attributes,
        };
        if (translated.relationships && Object.keys(translated.relationships).length > 0) {
          resource.relationships = translated.relationships;
        }
        return resource;
      });

      const included = await buildIncludes({
        parentResources: data,
        descriptor,
        context,
      });

      const response = { data };
      if (included.length > 0) {
        response.included = included;
      }

      return response;
    };

    helpers.dataQueryCount = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const [{ count }] = await context.db(canonical.tableName)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .count({ count: '*' });
      return Number(count);
    };

    addHook('scope:added', 'youapi-register-resource', {}, async ({ context }) => {
      const { scopeName } = context;
      const scope = api.scopes?.[scopeName] || scopes?.[scopeName];
      const schema = scope?.scopeOptions?.schema || {};
      const relationships = scope?.scopeOptions?.relationships || {};
      await registry.registerResource({
        tenant: DEFAULT_TENANT,
        resource: scopeName,
        schema,
        relationships,
      });
    });

    addScopeMethod('createKnexTable', async ({ scopeName, scopeOptions }) => {
      await registry.registerResource({
        tenant: DEFAULT_TENANT,
        resource: scopeName,
        schema: scopeOptions.schema || {},
        relationships: scopeOptions.relationships || {},
      });
    });

    addScopeMethod('addKnexFields', async ({ scopeName, params }) => {
      if (!params?.fields) return;
      for (const [fieldName, definition] of Object.entries(params.fields)) {
        await registry.allocateField({
          tenant: DEFAULT_TENANT,
          resource: scopeName,
          fieldName,
          definition,
        });
      }
    });

    addScopeMethod('alterKnexFields', async () => {
      throw new Error('alterKnexFields is not supported by YouAPI Knex plugin yet');
    });
  },
};

const translateAttributesForStorage = (attributes, descriptor) => {
  const row = {};
  for (const [fieldName, value] of Object.entries(attributes)) {
    const slot = descriptor.fields[fieldName];
    if (!slot) continue;

    if (slot.slotType === 'belongsTo') {
      row[slot.slot] = value == null ? null : String(value);
    } else {
      row[slot.slot] = value;
    }

    if (slot.slotType === 'belongsTo') {
      const alias = slot.alias || descriptor.fields[fieldName]?.alias;
      const belongsToInfo = alias ? descriptor.belongsTo?.[alias] : null;
      if (belongsToInfo) {
        row[belongsToInfo.typeColumn] = value == null ? null : belongsToInfo.target;
      }
    }
  }
  return row;
};

const translateRecordFromStorage = (row, descriptor) => {
  const attributes = {};
  for (const [slot, logical] of Object.entries(descriptor.reverseAttributes)) {
    if (slot in row) {
      attributes[logical] = row[slot];
    }
  }

  const relationships = {};
  for (const [alias, info] of Object.entries(descriptor.belongsTo || {})) {
    const idValue = row[info.idColumn];
    const relationshipData = idValue == null
      ? null
      : { type: info.target, id: String(idValue) };

    relationships[alias] = { data: relationshipData };
  }

  return { attributes, relationships };
};
