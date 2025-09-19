import { ensureAnyApiSchema } from '../anyapi/schema-utils.js';
import { YouapiRegistry } from '../anyapi/youapi-registry.js';

const DEFAULT_TENANT = 'default';
const LINKS_TABLE = 'any_links';

const normalizeId = (value) => (value === null || value === undefined ? null : String(value));

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

    const getManyToManyInfo = async (scopeName, relName) => {
      const descriptor = await getDescriptor(scopeName);
      const relInfo = descriptor.manyToMany?.[relName];
      if (!relInfo) return null;
      const relationshipKey = relInfo.relationship || `${descriptor.tenant}:${descriptor.resource}:${relName}`;
      return { descriptor, relInfo, relationshipKey };
    };

    const ensureTargetsExist = async ({ relInfo, relData, transaction }) => {
      if (!relData || relData.length === 0) return;
      const targetScope = api.resources[relInfo.target];
      if (!targetScope) {
        throw new Error(`Target resource '${relInfo.target}' not found`);
      }
      for (const identifier of relData) {
        if (!identifier?.id) {
          throw new Error('Relationship data requires resource identifier with id');
        }
        if (identifier.type && identifier.type !== relInfo.target) {
          throw new Error(`Relationship expects type '${relInfo.target}' but received '${identifier.type}'`);
        }
        await targetScope.get({ id: identifier.id, transaction, simplified: false });
      }
    };

    const attachLinks = async ({ descriptor, relInfo, relationshipKey, leftId, relData, db }) => {
      if (relData.length === 0) return;

      const existingRows = await db(LINKS_TABLE)
        .where({
          tenant_id: descriptor.tenant,
          relationship: relationshipKey,
          left_resource: descriptor.resource,
          left_id: leftId,
        })
        .select('right_id');

      const existing = new Set(existingRows.map((row) => String(row.right_id)));
      const rowsToInsert = [];

      for (const identifier of relData) {
        const rightId = normalizeId(identifier.id);
        if (rightId == null || existing.has(rightId)) continue;
        rowsToInsert.push({
          tenant_id: descriptor.tenant,
          relationship: relationshipKey,
          left_resource: descriptor.resource,
          left_id: leftId,
          right_resource: relInfo.target,
          right_id: rightId,
          payload: null,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
      }

      if (rowsToInsert.length > 0) {
        await db(LINKS_TABLE).insert(rowsToInsert);
      }
    };

    api.youapi.links = {
      attachMany: async ({ context, scopeName, relName, relDef, relData }) => {
        const info = await getManyToManyInfo(scopeName, relName);
        if (!info) {
          throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`);
        }
        const db = context.transaction || context.db || api.knex.instance;
        const leftId = normalizeId(context.id);
        await ensureTargetsExist({ relInfo: info.relInfo, relData, transaction: context.transaction });
        await attachLinks({
          descriptor: info.descriptor,
          relInfo: info.relInfo,
          relationshipKey: info.relationshipKey,
          leftId,
          relData,
          db,
        });
      },
      syncMany: async ({ context, scopeName, relName, relDef, relData, isUpdate }) => {
        const info = await getManyToManyInfo(scopeName, relName);
        if (!info) {
          throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`);
        }
        const db = context.transaction || context.db || api.knex.instance;
        const leftId = normalizeId(context.id);
        await ensureTargetsExist({ relInfo: info.relInfo, relData, transaction: context.transaction });
        if (isUpdate) {
          await syncLinks({
            descriptor: info.descriptor,
            relInfo: info.relInfo,
            relationshipKey: info.relationshipKey,
            leftId,
            relData,
            db,
          });
        } else {
          await attachLinks({
            descriptor: info.descriptor,
            relInfo: info.relInfo,
            relationshipKey: info.relationshipKey,
            leftId,
            relData,
            db,
          });
        }
      },
      removeMany: async ({ context, scopeName, relName, relData }) => {
        const info = await getManyToManyInfo(scopeName, relName);
        if (!info) {
          throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`);
        }
        const db = context.transaction || context.db || api.knex.instance;
        const leftId = normalizeId(context.id);
        await removeLinks({
          descriptor: info.descriptor,
          relInfo: info.relInfo,
          relationshipKey: info.relationshipKey,
          leftId,
          relData,
          db,
        });
      },
      listMany: async ({ context, scopeName, relName }) => {
        const info = await getManyToManyInfo(scopeName, relName);
        if (!info) {
          throw new Error(`Many-to-many relationship '${relName}' not found on '${scopeName}'`);
        }
        const db = context.transaction || context.db || api.knex.instance;
        const leftId = normalizeId(context.id);
        return listLinks({
          descriptor: info.descriptor,
          relInfo: info.relInfo,
          relationshipKey: info.relationshipKey,
          leftId,
          db,
        });
      },
      fetchManyToManyRows: async ({ scopeName, relName, parentIds, context }) => {
        const info = await getManyToManyInfo(scopeName, relName);
        if (!info) return [];
        const db = context.db || context.transaction || api.knex.instance;
        return fetchLinkedRecords({
          descriptor: info.descriptor,
          relInfo: info.relInfo,
          relationshipKey: info.relationshipKey,
          leftIds: parentIds,
          db,
        });
      },
    };

    const syncLinks = async ({ descriptor, relInfo, relationshipKey, leftId, relData, db }) => {
      const existingRows = await db(LINKS_TABLE)
        .where({
          tenant_id: descriptor.tenant,
          relationship: relationshipKey,
          left_resource: descriptor.resource,
          left_id: leftId,
        })
        .select('right_id');

      const existing = new Set(existingRows.map((row) => String(row.right_id)));
      const desired = new Set(relData.map((identifier) => normalizeId(identifier.id)).filter((id) => id !== null));

      const toAdd = [...desired].filter((id) => !existing.has(id));
      const toRemove = [...existing].filter((id) => !desired.has(id));

      if (toAdd.length > 0) {
        const data = toAdd.map((id) => ({ id }));
        await attachLinks({ descriptor, relInfo, relationshipKey, leftId, relData: data, db });
      }

      if (toRemove.length > 0) {
        await db(LINKS_TABLE)
          .where({
            tenant_id: descriptor.tenant,
            relationship: relationshipKey,
            left_resource: descriptor.resource,
            left_id: leftId,
          })
          .whereIn('right_id', toRemove)
          .delete();
      }
    };

    const removeLinks = async ({ descriptor, relInfo, relationshipKey, leftId, relData, db }) => {
      const idsToRemove = relData
        .map((identifier) => normalizeId(identifier.id))
        .filter((id) => id !== null);

      if (idsToRemove.length === 0) return;

      await db(LINKS_TABLE)
        .where({
          tenant_id: descriptor.tenant,
          relationship: relationshipKey,
          left_resource: descriptor.resource,
          left_id: leftId,
        })
        .whereIn('right_id', idsToRemove)
        .delete();
    };

    const listLinks = async ({ descriptor, relInfo, relationshipKey, leftId, db }) => {
      const rows = await db(LINKS_TABLE)
        .where({
          tenant_id: descriptor.tenant,
          relationship: relationshipKey,
          left_resource: descriptor.resource,
          left_id: leftId,
        })
        .select('right_id');

      return rows.map((row) => ({ type: relInfo.target, id: String(row.right_id) }));
    };

    const fetchLinkedRecords = async ({ descriptor, relInfo, relationshipKey, leftIds, db }) => {
      if (leftIds.length === 0) return [];

      const rows = await db(LINKS_TABLE)
        .where({
          tenant_id: descriptor.tenant,
          relationship: relationshipKey,
          left_resource: descriptor.resource,
        })
        .whereIn('left_id', leftIds)
        .select('left_id', 'right_id');

      return rows;
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

        const belongsToInfo = descriptor.belongsTo?.[path];
        if (belongsToInfo) {
          const ids = [...new Set(parentResources
            .map((resource) => resource.relationships?.[path]?.data?.id)
            .filter((id) => id !== undefined && id !== null))];

          if (ids.length === 0) continue;

          const targetDescriptor = await registry.getDescriptor(DEFAULT_TENANT, belongsToInfo.target);
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
          continue;
        }

        const manyInfo = descriptor.manyToMany?.[path];
        if (manyInfo) {
          const info = await getManyToManyInfo(descriptor.resource, path);
          if (!info) continue;
          const leftIds = parentResources.map((resource) => resource.id);
          const linkRows = await fetchLinkedRecords({
            descriptor: info.descriptor,
            relInfo: info.relInfo,
            relationshipKey: info.relationshipKey,
            leftIds,
            db: context.db || context.transaction || api.knex.instance,
          });

          const rightIds = [...new Set(linkRows.map((row) => row.right_id))];
          if (rightIds.length === 0) continue;

          const targetDescriptor = await registry.getDescriptor(DEFAULT_TENANT, info.relInfo.target);
          if (!targetDescriptor) continue;

          const rows = await context.db(targetDescriptor.canonical.tableName)
            .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
            .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
            .whereIn('id', rightIds);

          for (const row of rows) {
            const includeKey = `${targetDescriptor.resource}:${row.id}`;
            if (seen.has(includeKey)) continue;
            seen.add(includeKey);
            const translated = translateRecordFromStorage(row, targetDescriptor);
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
      }

      return includes;
    };

    const attachManyToManyRelationships = async ({ resources, descriptor, context }) => {
      if (!resources || resources.length === 0) return;
      const manyEntries = Object.entries(descriptor.manyToMany || {});
      if (manyEntries.length === 0) return;

      const db = context.db || context.transaction || api.knex.instance;
      const parentIds = resources.map((resource) => resource.id);

      for (const [relName, relInfo] of manyEntries) {
        const info = await getManyToManyInfo(descriptor.resource, relName);
        if (!info) continue;
        const rows = await fetchLinkedRecords({
          descriptor: info.descriptor,
          relInfo: info.relInfo,
          relationshipKey: info.relationshipKey,
          leftIds: parentIds,
          db,
        });

        const grouped = rows.reduce((acc, row) => {
          const key = String(row.left_id);
          acc[key] = acc[key] || [];
          acc[key].push({ type: info.relInfo.target, id: String(row.right_id) });
          return acc;
        }, {});

        for (const resource of resources) {
          const related = grouped[resource.id] || [];
          resource.relationships = resource.relationships || {};
          resource.relationships[relName] = { data: related };
        }
      }
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

      await attachManyToManyRelationships({
        resources: [data],
        descriptor,
        context,
      });

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

      await attachManyToManyRelationships({
        resources: data,
        descriptor,
        context,
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
