import { DEFAULT_CANONICAL_CONFIG, SLOT_LIMITS, SLOT_POOLS, TYPE_TO_POOL } from './schema-utils.js';

const clone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const SUPPORTED_TYPES = new Set([...TYPE_TO_POOL.keys(), 'id']);

const BELONGS_TO_ALIAS = (fieldName, fieldDef) => {
  if (fieldDef.as) return fieldDef.as;
  if (fieldName.endsWith('_id')) {
    return fieldName.slice(0, -3);
  }
  return fieldName;
};

export class YouapiRegistry {
  constructor({ knex, log } = {}) {
    if (!knex) {
      throw new Error('YouapiRegistry requires a knex instance');
    }
    this.knex = knex;
    this.log = log || console;
    this.cache = new Map();
  }

  #key(tenant, resource) {
    return `${tenant}::${resource}`;
  }

  async registerResource(definition, options = {}) {
    this.#validateDefinition(definition);
    const descriptor = await this.#register(definition, options.transaction);
    const key = this.#key(descriptor.tenant, descriptor.resource);
    this.cache.set(key, descriptor);
    return clone(descriptor);
  }

  async allocateField({ tenant, resource, fieldName, definition }, options = {}) {
    if (!tenant || !resource || !fieldName || !definition) {
      throw new Error('allocateField requires tenant, resource, fieldName, and definition');
    }

    const descriptor = await this.getDescriptor(tenant, resource, { bypassCache: true });
    if (!descriptor) {
      throw new Error(`Resource '${resource}' not registered for tenant '${tenant}'`);
    }

    const trx = options.transaction || await this.knex.transaction();
    const managed = !options.transaction;

    try {
      const resourceRow = await trx('any_resource_configs')
        .where({ tenant_id: tenant, resource })
        .first();

      if (!resourceRow) {
        throw new Error(`Resource '${resource}' not found in metadata`);
      }

      const fieldSlot = this.#assignFieldSlot({ ...definition, fieldName }, descriptor.slotState);
      const meta = definition.meta ? JSON.stringify(definition.meta) : null;

      await trx('any_field_configs').insert({
        resource_config_id: resourceRow.id,
        field_name: fieldName,
        slot_type: fieldSlot.slotType,
        slot_index: fieldSlot.slotIndex,
        slot_column: fieldSlot.slotColumn,
        nullable: definition.nullable === true,
        required: definition.required === true,
        target_resource: definition.belongsTo || null,
        alias: definition.as || null,
        meta_json: meta,
      });

      if (fieldSlot.relationshipRow) {
        const relationshipRow = {
          resource_config_id: resourceRow.id,
          relationship_name: fieldSlot.relationshipRow.name,
          relationship_type: fieldSlot.relationshipRow.type,
          target_resource: fieldSlot.relationshipRow.target,
          slot_index: fieldSlot.relationshipRow.slotIndex,
          id_column: fieldSlot.relationshipRow.idColumn,
          type_column: fieldSlot.relationshipRow.typeColumn,
          relationship_key: fieldSlot.relationshipRow.relationshipKey,
          through: fieldSlot.relationshipRow.through,
          foreign_key: fieldSlot.relationshipRow.foreignKey,
          other_key: fieldSlot.relationshipRow.otherKey,
          alias: fieldSlot.relationshipRow.alias,
          meta_json: fieldSlot.relationshipRow.meta ? JSON.stringify(fieldSlot.relationshipRow.meta) : null,
        };
        await trx('any_relationship_configs').insert(relationshipRow);
      }

      if (managed) {
        await trx.commit();
      }

      descriptor.fields[fieldName] = {
        slot: fieldSlot.slotColumn,
        slotType: fieldSlot.slotType,
        slotIndex: fieldSlot.slotIndex,
        nullable: definition.nullable === true,
        required: definition.required === true,
        target: definition.belongsTo || null,
        alias: definition.as || null,
      };

      if (fieldSlot.belongsToInfo) {
        descriptor.belongsTo[fieldSlot.belongsToInfo.alias] = fieldSlot.belongsToInfo;
      }

      descriptor.slotState = fieldSlot.updatedState;
      this.cache.set(this.#key(tenant, resource), descriptor);
      return clone(descriptor);
    } catch (error) {
      if (managed) {
        await trx.rollback();
      }
      throw error;
    }
  }

  async getDescriptor(tenant, resource, options = {}) {
    if (!tenant || !resource) return null;
    const key = this.#key(tenant, resource);
    if (!options.bypassCache && this.cache.has(key)) {
      return clone(this.cache.get(key));
    }

    const descriptor = await this.#loadDescriptor(tenant, resource, options.transaction);
    if (!descriptor) return null;

    this.cache.set(key, descriptor);
    return clone(descriptor);
  }

  async listResources(tenant) {
    const query = this.knex('any_resource_configs');
    if (tenant) {
      query.where({ tenant_id: tenant });
    }
    const rows = await query.select('tenant_id', 'resource');
    return rows.map((row) => ({ tenant: row.tenant_id, resource: row.resource }));
  }

  invalidateDescriptor(tenant, resource) {
    this.cache.delete(this.#key(tenant, resource));
  }

  #validateDefinition(definition) {
    const { tenant, resource, schema } = definition || {};
    if (!tenant || typeof tenant !== 'string') {
      throw new Error('YouapiRegistry.registerResource requires a tenant string');
    }
    if (!resource || typeof resource !== 'string') {
      throw new Error('YouapiRegistry.registerResource requires a resource string');
    }
    if (!schema || typeof schema !== 'object') {
      throw new Error('YouapiRegistry.registerResource requires a schema object');
    }
  }

  async #register(definition, externalTrx) {
    const { tenant, resource, schema, relationships = {} } = definition;
    const trx = externalTrx || await this.knex.transaction();
    const managed = !externalTrx;

    try {
      const now = this.knex.fn.now();
      let resourceRow = await trx('any_resource_configs')
        .where({ tenant_id: tenant, resource })
        .first();

      const schemaJson = JSON.stringify(schema);
      const relationshipsJson = JSON.stringify(relationships || {});

      if (resourceRow) {
        await trx('any_resource_configs')
          .where({ id: resourceRow.id })
          .update({
            schema_json: schemaJson,
            relationships_json: relationshipsJson,
            updated_at: now,
          });
      } else {
        const [insertedId] = await trx('any_resource_configs').insert({
          tenant_id: tenant,
          resource,
          schema_json: schemaJson,
          relationships_json: relationshipsJson,
          created_at: now,
          updated_at: now,
        });

        resourceRow = {
          id: insertedId,
          tenant_id: tenant,
          resource,
          schema_json: schemaJson,
          relationships_json: relationshipsJson,
        };
      }

      await trx('any_field_configs').where({ resource_config_id: resourceRow.id }).delete();
      await trx('any_relationship_configs').where({ resource_config_id: resourceRow.id }).delete();

      const slotState = this.#initializeSlotState();
      const fieldInserts = [];
      const relationshipInserts = [];

      for (const [fieldName, fieldDef] of Object.entries(schema)) {
        if (fieldName === 'id') continue;
      const allocation = this.#assignFieldSlot({ ...fieldDef, fieldName }, slotState);
        if (!allocation) continue;

        const meta = fieldDef.meta ? JSON.stringify(fieldDef.meta) : null;
        fieldInserts.push({
          resource_config_id: resourceRow.id,
          field_name: fieldName,
          slot_type: allocation.slotType,
          slot_index: allocation.slotIndex,
          slot_column: allocation.slotColumn,
          nullable: fieldDef.nullable === true,
          required: fieldDef.required === true,
          target_resource: fieldDef.belongsTo || null,
          alias: fieldDef.as || null,
          meta_json: meta,
          created_at: this.knex.fn.now(),
          updated_at: this.knex.fn.now(),
        });

        if (allocation.relationshipRow) {
          const relationshipRow = {
            resource_config_id: resourceRow.id,
            relationship_name: allocation.relationshipRow.name,
            relationship_type: allocation.relationshipRow.type,
            target_resource: allocation.relationshipRow.target,
            slot_index: allocation.relationshipRow.slotIndex,
            id_column: allocation.relationshipRow.idColumn,
            type_column: allocation.relationshipRow.typeColumn,
            relationship_key: allocation.relationshipRow.relationshipKey,
            through: allocation.relationshipRow.through,
            foreign_key: allocation.relationshipRow.foreignKey,
            other_key: allocation.relationshipRow.otherKey,
            alias: allocation.relationshipRow.alias,
            meta_json: allocation.relationshipRow.meta ? JSON.stringify(allocation.relationshipRow.meta) : null,
            created_at: this.knex.fn.now(),
            updated_at: this.knex.fn.now(),
          };
          relationshipInserts.push(relationshipRow);
        }
      }

      for (const [relName, relDef] of Object.entries(relationships || {})) {
        if (relDef?.type === 'manyToMany') {
          relationshipInserts.push({
            resource_config_id: resourceRow.id,
            relationship_name: relName,
            relationship_type: 'manyToMany',
            target_resource: relDef.target,
            relationship_key: relDef.relationship || `${tenant}:${resource}:${relName}`,
            through: relDef.through,
            foreign_key: relDef.foreignKey,
            other_key: relDef.otherKey,
            alias: relDef.as || relName,
            meta_json: JSON.stringify(relDef.meta || {}),
            created_at: this.knex.fn.now(),
            updated_at: this.knex.fn.now(),
          });
        }
      }

      if (fieldInserts.length > 0) {
        await trx('any_field_configs').insert(fieldInserts);
      }
      if (relationshipInserts.length > 0) {
        await trx('any_relationship_configs').insert(relationshipInserts);
      }

      const descriptor = await this.#loadDescriptor(tenant, resource, trx);

      if (managed) {
        await trx.commit();
      }

      return descriptor;
    } catch (error) {
      if (managed) {
        await trx.rollback();
      }
      throw error;
    }
  }

  async #loadDescriptor(tenant, resource, trx) {
    const query = (trx || this.knex)('any_resource_configs')
      .where({ tenant_id: tenant, resource })
      .first();

    const resourceRow = await query;
    if (!resourceRow) return null;

    const fieldRows = await (trx || this.knex)('any_field_configs')
      .where({ resource_config_id: resourceRow.id })
      .select();

    const relationshipRows = await (trx || this.knex)('any_relationship_configs')
      .where({ resource_config_id: resourceRow.id })
      .select();

    const slotState = this.#initializeSlotState();
    for (const row of fieldRows) {
      if (row.slot_type === 'belongsTo') {
        slotState.belongsTo = Math.max(slotState.belongsTo, row.slot_index);
      } else if (row.slot_type in slotState) {
        slotState[row.slot_type] = Math.max(slotState[row.slot_type], row.slot_index);
      }
    }

    return this.#buildDescriptor({
      tenant,
      resource,
      schema: JSON.parse(resourceRow.schema_json),
      relationships: JSON.parse(resourceRow.relationships_json || '{}'),
      slotState,
      fieldRows,
      relationshipRows,
    });
  }

  #buildDescriptor({ tenant, resource, schema, relationships, slotState, fieldRows, relationshipRows }) {
    const fields = {};
    const reverseAttributes = {};
    const belongsTo = {};
    const manyToMany = {};

    for (const row of fieldRows) {
      fields[row.field_name] = {
        slot: row.slot_column,
        slotType: row.slot_type,
        slotIndex: row.slot_index,
        nullable: row.nullable === 1 || row.nullable === true,
        required: row.required === 1 || row.required === true,
        target: row.target_resource,
        alias: row.alias,
        meta: row.meta_json ? JSON.parse(row.meta_json) : undefined,
      };

      reverseAttributes[row.slot_column] = row.field_name;
    }

    for (const row of relationshipRows) {
      if (row.relationship_type === 'belongsTo') {
        const alias = row.alias || row.relationship_name;
        belongsTo[alias] = {
          alias,
          field: fields[row.relationship_name]?.field || row.relationship_name,
          target: row.target_resource,
          slotIndex: row.slot_index,
          idColumn: row.id_column,
          typeColumn: row.type_column,
        };
      } else if (row.relationship_type === 'manyToMany') {
        manyToMany[row.relationship_name] = {
          alias: row.alias || row.relationship_name,
          relationship: row.relationship_key,
          target: row.target_resource,
          through: row.through,
          foreignKey: row.foreign_key,
          otherKey: row.other_key,
          meta: row.meta_json ? JSON.parse(row.meta_json) : undefined,
        };
      }
    }

    return {
      tenant,
      resource,
      schema,
      relationships,
      canonical: DEFAULT_CANONICAL_CONFIG,
      fields,
      belongsTo,
      manyToMany,
      reverseAttributes,
      slotState,
    };
  }

  #initializeSlotState() {
    return {
      string: 0,
      number: 0,
      boolean: 0,
      date: 0,
      json: 0,
      belongsTo: 0,
    };
  }

  #assignFieldSlot(fieldDef, slotState) {
    if (fieldDef.belongsTo) {
      return this.#assignBelongsTo(fieldDef, slotState);
    }

    const { type } = fieldDef;
    if (!type || type === 'id') {
      return null;
    }
    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error(`Unsupported field type '${type}'`);
    }

    const pool = TYPE_TO_POOL.get(type);
    if (!pool) {
      throw new Error(`No slot pool defined for type '${type}'`);
    }

    const nextIndex = slotState[pool] + 1;
    if (nextIndex > SLOT_LIMITS[pool]) {
      throw new Error(`No available ${pool} slots remaining`);
    }

    slotState[pool] = nextIndex;
    const slotColumn = SLOT_POOLS[pool][nextIndex - 1];

    return {
      slotType: pool,
      slotIndex: nextIndex,
      slotColumn,
      updatedState: slotState,
    };
  }

  #assignBelongsTo(fieldDef, slotState) {
    const nextIndex = slotState.belongsTo + 1;
    if (nextIndex > SLOT_LIMITS.belongsTo) {
      throw new Error('No available belongsTo slots remaining');
    }

    slotState.belongsTo = nextIndex;
    const alias = BELONGS_TO_ALIAS(fieldDef.fieldName || '', fieldDef);
    const relationshipKey = fieldDef.relationshipKey || null;

    return {
      slotType: 'belongsTo',
      slotIndex: nextIndex,
      slotColumn: `rel_${nextIndex}_id`,
      relationshipRow: {
        name: alias,
        type: 'belongsTo',
        target: fieldDef.belongsTo,
        slotIndex: nextIndex,
        idColumn: `rel_${nextIndex}_id`,
        typeColumn: `rel_${nextIndex}_type`,
        relationshipKey,
        alias,
      },
      belongsToInfo: {
        alias,
        target: fieldDef.belongsTo,
        slotIndex: nextIndex,
        idColumn: `rel_${nextIndex}_id`,
        typeColumn: `rel_${nextIndex}_type`,
        nullable: fieldDef.nullable === true,
      },
      updatedState: slotState,
    };
  }
}
