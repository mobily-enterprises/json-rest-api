import { Api } from 'hooked-api'
import {
  AutoFilterPlugin,
  FastifyPlugin,
  FileHandlingPlugin,
  LabelPlugin,
  QueryProjectionsPlugin,
  RestApiAnyapiKnexPlugin,
  RestApiKnexPlugin,
  RestApiPlugin,
  RowPolicyPlugin,
  SocketIOPlugin
} from '../../index.js'
import { ExpressPlugin } from '../../plugins/core/connectors/express-plugin.js'
import express from 'express'
import { createServer } from 'http'
import { once } from 'node:events'
import { ensureAnyApiSchema } from '../../plugins/core/lib/anyapi/schema-utils.js'
import { storageMode } from '../helpers/storage-mode.js'
import { createStorageAdapter } from '../../plugins/core/lib/storage/storage-adapter.js'

async function useStoragePlugin (api, knex, { tenantId, storage = storageMode.mode } = {}) {
  if (storage === 'anyapi') {
    await ensureAnyApiSchema(knex)
    const sanitizedName = api?.name ? api.name.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase() : 'tenant'
    const effectiveTenantId = tenantId || api?.anyapi?.tenantId || `${sanitizedName}_tenant`
    api.anyapi = api.anyapi || {}
    api.anyapi.tenantId = effectiveTenantId
    await api.use(RestApiAnyapiKnexPlugin, { knex, tenantId: effectiveTenantId })
    storageMode.setCurrentTenant(effectiveTenantId)
  } else if (storage === 'knex') {
    await api.use(RestApiKnexPlugin, { knex })
  } else {
    throw new Error(`Unknown fixture storage '${storage}'`)
  }
}

function mapTable (knex, api, tableName, resourceName) {
  if (api.anyapi) {
    storageMode.registerTable(knex, tableName, resourceName, api.anyapi?.tenantId)
  }
}

export async function createConformanceApi (knex, { storage = storageMode.mode, itemOptions = {}, groupOptions = {}, groupFieldOptions = {}, itemNameOptions = {}, queryProjections = false, labelOptions, includeExpress = false, ...options } = {}) {
  const api = new Api({ name: 'conformance', log: { level: 'error' } })
  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    queryDefaultLimit: 20,
    queryMaxLimit: 50,
    ...options
  })
  if (queryProjections) await api.use(QueryProjectionsPlugin)
  if (labelOptions) await api.use(LabelPlugin, labelOptions)
  await useStoragePlugin(api, knex, { storage, tenantId: 'conformance' })
  if (includeExpress) await api.use(ExpressPlugin, { mountPath: '/api' })
  await api.addResource('groups', {
    schema: { id: { type: 'id' }, name: { type: 'string', required: true } },
    relationships: { items: { type: 'hasMany', target: 'items', foreignKey: 'groupId' } },
    tableName: 'conformance_groups',
    ...groupOptions
  })
  await api.resources.groups.createKnexTable()
  mapTable(knex, api, 'conformance_groups', 'groups')
  await api.addResource('items', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, maxLength: 60, search: true, ...itemNameOptions },
      note: { type: 'string', nullable: true },
      rank: { type: 'number', nullable: true, search: true },
      active: { type: 'boolean', defaultTo: true, search: true },
      score: { type: 'number', defaultTo: 0 },
      secret: { type: 'string', hidden: true },
      internal: { type: 'string', normallyHidden: true },
      transient: { type: 'string', virtual: true },
      groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true, search: true, ...groupFieldOptions }
    },
    sortableFields: ['id', 'name', 'rank', 'active'],
    tableName: 'conformance_items',
    ...itemOptions
  })
  await api.resources.items.createKnexTable()
  mapTable(knex, api, 'conformance_items', 'items')
  return api
}

export async function createFieldDependenciesApi (knex, { storage = storageMode.mode, onCall = () => {} } = {}) {
  const options = resourceType => ({
    idProperty: 'record_key',
    sortableFields: ['id', 'name'],
    queryFields: {
      projected: { type: 'string', normallyHidden: true, select: ({ knex, column }) => knex.raw('upper(??)', [column('base')]) }
    },
    schema: {
      record_key: { type: 'id' },
      name: { type: 'string', required: true },
      final: {
        type: 'string',
        computed: true,
        dependencies: ['middle', 'upperSource', 'projected'],
        compute: async ({ id, attributes }) => {
          await onCall({ resourceType, id, field: 'final' })
          return `${attributes.middle}|${attributes.upperSource}|${attributes.projected}`
        }
      },
      middle: {
        type: 'string',
        computed: true,
        normallyHidden: true,
        dependencies: ['upperSource'],
        compute: async ({ id, attributes }) => {
          await onCall({ resourceType, id, field: 'middle' })
          return `<${attributes.upperSource}>`
        }
      },
      side: {
        type: 'string',
        computed: true,
        dependencies: ['upperSource'],
        compute: async ({ id, attributes }) => {
          await onCall({ resourceType, id, field: 'side' })
          return attributes.upperSource
        }
      },
      upperSource: {
        type: 'string',
        runGetterAfter: ['suffix'],
        getter: async (value, { id, attributes }) => {
          await onCall({ resourceType, id, field: 'upperSource' })
          return `${attributes.suffix}:${value}`
        }
      },
      suffix: {
        type: 'string',
        normallyHidden: true,
        runGetterAfter: ['base', 'projected'],
        getter: async (value, { id, attributes }) => {
          await onCall({ resourceType, id, field: 'suffix' })
          return `${attributes.base}:${value}:${attributes.projected}`
        }
      },
      base: { type: 'string', normallyHidden: true, storage: { column: 'source_text' } },
      secret: { type: 'string', hidden: true },
      hiddenIntermediate: {
        type: 'string',
        computed: true,
        hidden: true,
        dependencies: ['secret'],
        compute: async ({ id, attributes }) => {
          await onCall({ resourceType, id, field: 'hiddenIntermediate' })
          return String(attributes.secret?.length ?? 0)
        }
      },
      secretLength: {
        type: 'string',
        computed: true,
        normallyHidden: true,
        dependencies: ['hiddenIntermediate'],
        compute: ({ attributes }) => attributes.hiddenIntermediate
      },
      identity: { type: 'string', computed: true, normallyHidden: true, dependencies: ['id', 'record_key'], compute: ({ id }) => id },
      ...(resourceType === 'items' ? { groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true } } : {})
    }
  })
  return createConformanceApi(knex, {
    storage,
    queryProjections: true,
    groupOptions: options('groups'),
    itemOptions: options('items')
  })
}

export async function createQueryConformanceApi (knex, { storage = storageMode.mode, counts = true, includeExpress = false, groupOptions = {}, pivotOnDelete, membershipOptions = {} } = {}) {
  const api = await createConformanceApi(knex, {
    storage,
    includeExpress,
    queryProjections: true,
    itemNameOptions: { indexed: true },
    enablePaginationCounts: counts,
    queryDefaultLimit: 2,
    queryMaxLimit: 3,
    groupOptions: {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true, indexed: true } },
      queryFields: {
        sortLabel: {
          type: 'string',
          nullable: true,
          sortable: true,
          normallyHidden: true,
          select: ({ knex, column }) => knex.raw('CASE WHEN ?? = ? THEN NULL ELSE upper(??) END', [column('name'), 'First', column('name')])
        }
      },
      searchSchema: { childName: { type: 'string', actualField: 'items.name', filterOperator: 'contains' } },
      relationships: {
        items: { type: 'hasMany', target: 'items', foreignKey: 'groupId' },
        members: { type: 'manyToMany', target: 'items', through: 'memberships', foreignKey: 'groupId', otherKey: 'itemId' }
      },
      ...groupOptions
    },
    itemOptions: {
      defaultSort: ['rank'],
      relationships: {
        collections: { type: 'manyToMany', target: 'groups', through: 'memberships', foreignKey: 'itemId', otherKey: 'groupId' }
      },
      searchSchema: {
        nameContains: { type: 'string', actualField: 'name', filterOperator: 'contains' },
        nameStarts: { type: 'string', actualField: 'name', filterOperator: 'startsWith' },
        nameEnds: { type: 'string', actualField: 'name', filterOperator: 'endsWith' },
        above: { type: 'number', actualField: 'rank', filterOperator: '>' },
        range: { type: 'array', actualField: 'rank', filterOperator: 'between' },
        ranks: { type: 'array', actualField: 'rank', filterOperator: 'in' },
        otherRank: { type: 'number', nullable: true, actualField: 'rank', filterOperator: '!=' },
        eitherText: { type: 'string', oneOf: ['name', 'note'], filterOperator: 'contains' },
        allWords: { type: 'string', oneOf: ['name', 'note'], filterOperator: 'contains', splitBy: ',', matchAll: true },
        anyWords: { type: 'string', oneOf: ['name', 'note'], filterOperator: 'contains', splitBy: ',', matchAll: false },
        relatedWords: { type: 'string', oneOf: ['name', 'groups.name'], filterOperator: 'contains', splitBy: ',', matchAll: false },
        relatedAllWords: { type: 'string', oneOf: ['name', 'groups.name'], filterOperator: 'contains', splitBy: ',', matchAll: true },
        eitherRange: { type: 'array', oneOf: ['rank', 'score'], filterOperator: 'between' },
        customRank: { type: 'number', applyFilter: (query, input, { column, value }) => query.where(column('rank'), '>=', value('rank', input)) }
      },
      queryFields: {
        displayName: {
          type: 'string',
          sortable: true,
          select: ({ knex, column }) => knex.raw(
            knex.client.config.client === 'mysql2' ? 'concat(lower(??), ?)' : 'lower(??) || ?', [column('name'), ' ·']
          )
        },
        doubleRank: { type: 'number', sortable: true, select: ({ knex, column }) => knex.raw('?? * ?', [column('rank'), 2]) },
        privateRank: { type: 'number', hidden: true, select: ({ knex, column }) => knex.raw('??', [column('rank')]) },
        internalRank: { type: 'number', normallyHidden: true, select: ({ knex, column }) => knex.raw('??', [column('rank')]) }
      }
    }
  })
  await api.addResource('memberships', {
    tableName: 'conformance_memberships',
    schema: {
      id: { type: 'id' },
      groupId: { type: 'id', required: true, belongsTo: 'groups', as: 'group', storage: { column: 'parent_key' } },
      itemId: { type: 'id', required: true, belongsTo: 'items', as: 'item', storage: { column: 'child_key' } }
    },
    ...membershipOptions
  })
  await api.resources.memberships.createKnexTable()
  if (pivotOnDelete && storage === 'knex') {
    await knex.schema.alterTable('conformance_memberships', table => {
      table.foreign('child_key').references('id').inTable('conformance_items').onDelete(pivotOnDelete)
    })
  }
  mapTable(knex, api, 'conformance_memberships', 'memberships')
  if (storage === 'anyapi') {
    const items = await api.anyapi.registry.getDescriptor(api.anyapi.tenantId, 'items')
    const groups = await api.anyapi.registry.getDescriptor(api.anyapi.tenantId, 'groups')
    storageMode.registerLink(knex, 'conformance_memberships', 'items', 'collections', items.manyToMany.collections.relationship, groups.manyToMany.members.relationship, api.anyapi.tenantId)
  }
  return api
}

export async function createSearchPolicyApi (knex, { storage = storageMode.mode, app, connector, referenceSortDefaults = false, referenceSortCollisions = false } = {}) {
  const api = new Api({ name: 'search-policy', log: { level: 'silent' } })
  await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full', sortableFields: ['id', 'name'], enablePaginationCounts: true })
  await useStoragePlugin(api, knex, { storage, tenantId: 'search_policy' })
  if (referenceSortCollisions) await api.use(QueryProjectionsPlugin)
  if (connector) await api.use(connector === 'fastify' ? FastifyPlugin : ExpressPlugin, { ...(connector === 'fastify' ? { app } : {}), mountPath: '/api' })
  await api.use(RowPolicyPlugin, {
    policies: {
      visible: ({ query, context, column, value }) => {
        if (context.visibility?.all) return true
        if (!context.visibility?.groups?.length) return false
        query.whereIn(column('access_group'), context.visibility.groups.map(group => value('access_group', group)))
        return true
      }
    }
  })
  await api.use(AutoFilterPlugin, {
    resolvers: { workspace: ({ context }) => context.scopeValues?.workspaceId },
    presets: { workspace: { filters: [{ field: 'workspace_id', resolver: 'workspace' }] } }
  })
  for (const [type, extra] of [
    ['teams', {
      sortableFields: ['id', 'name', 'parent', 'parent_id'],
      schema: { parent_id: { type: 'id', nullable: true, search: true, belongsTo: 'teams', as: 'parent', storage: { column: 'parent_ref' } } },
      relationships: { groups: { type: 'hasMany', target: 'groups', foreignKey: 'team_id' } },
      searchSchema: { groupName: { type: 'string', actualField: 'groups.name' } }
    }],
    ['groups', {
      schema: { team_id: { type: 'id', nullable: true, indexed: true, belongsTo: 'teams', as: 'team', storage: { column: 'team_ref' } } },
      relationships: { items: { type: 'hasMany', target: 'items', foreignKey: 'group_id' } },
      searchSchema: { itemName: { type: 'string', actualField: 'items.name' } }
    }],
    ['items', {
      sortableFields: ['id', 'name', 'group', 'group_id', 'groupRef'],
      ...(referenceSortDefaults ? { defaultSort: ['group_id', 'group', 'groupRef'] } : {}),
      ...(referenceSortCollisions
        ? {
            queryFields: { __jra_sort_value_2: { type: 'string', select: ({ knex, column }) => knex.raw('??', [column('name')]) } }
          }
        : {}),
      schema: {
        group_id: { type: 'id', nullable: true, search: true, belongsTo: 'groups', as: 'group', storage: { column: 'group_ref' } },
        ...(referenceSortCollisions ? { __jra_sort_value_0: { type: 'string', nullable: true, storage: { column: '__jra_sort_value_1' } } } : {})
      },
      searchSchema: {
        groupName: { type: 'string', actualField: 'groups.name' },
        groupNote: { type: 'string', nullable: true, actualField: 'groups.note' },
        eitherName: { type: 'string', oneOf: ['name', 'groups.name'], filterOperator: 'contains' },
        teamName: { type: 'string', actualField: 'groups.teams.name' },
        groupRef: { type: 'id', nullable: true, actualField: 'group_id' },
        groupRefNot: { type: 'id', nullable: true, actualField: 'group_id', filterOperator: '!=' },
        groupContains: { type: 'string', actualField: 'group_id', filterOperator: 'contains' },
        groupStarts: { type: 'string', actualField: 'group_id', filterOperator: 'startsWith' },
        groupEnds: { type: 'string', actualField: 'group_id', filterOperator: 'endsWith' },
        groupLike: { type: 'string', actualField: 'group_id', filterOperator: 'like' },
        teamContains: { type: 'string', actualField: 'groups.team_id', filterOperator: 'contains' },
        groupRefs: { type: 'array', actualField: 'group_id', filterOperator: 'in' },
        groupRange: { type: 'array', actualField: 'group_id', filterOperator: 'between' },
        eitherReference: { type: 'string', oneOf: ['name', 'group_id'], filterOperator: 'contains' },
        eitherJoinedReference: { type: 'string', oneOf: ['name', 'group_id', 'groups.name'], filterOperator: 'contains' },
        teamRef: { type: 'id', nullable: true, actualField: 'groups.team_id' }
      }
    }],
    ['notes', {
      sortableFields: ['id', 'name', 'subject_id', 'subject_type'],
      schema: {
        subject_id: { type: 'id', nullable: true, indexed: true, search: true, storage: { column: 'subject_ref' } },
        subject_type: { type: 'string', nullable: true, indexed: true, search: true, storage: { column: 'kind' } },
        external_id: { type: 'id', nullable: true, indexed: true, search: true, storage: { column: 'external_ref' } }
      },
      relationships: { subject: { belongsToPolymorphic: { types: ['items', 'groups'], typeField: 'subject_type', idField: 'subject_id' } } },
      searchSchema: {
        subjectName: { type: 'string', polymorphicField: 'subject', targetFields: { items: 'name', groups: 'name' } },
        subjectNote: { type: 'string', nullable: true, polymorphicField: 'subject', targetFields: { items: 'note', groups: 'note' } },
        subjectTeam: { type: 'string', polymorphicField: 'subject', targetFields: { items: 'group.team.name', groups: 'team.name' } },
        subjectTeamRef: { type: 'id', nullable: true, polymorphicField: 'subject', targetFields: { items: 'group.team_id', groups: 'team_id' } },
        subjectReferenceText: { type: 'string', polymorphicField: 'subject', targetFields: { items: 'group_id', groups: 'team_id' }, filterOperator: 'contains' },
        eitherSubject: { type: 'string', oneOf: ['name', 'subject_type'], filterOperator: 'contains' }
      }
    }]
  ]) {
    await api.addResource(type, {
      ...extra,
      idProperty: `${type}_key`,
      schema: {
        id: { type: 'id', storage: { column: `${type}_key` } },
        name: { type: 'string', required: true, indexed: true, search: true, storage: { column: 'label' } },
        note: { type: 'string', nullable: true, indexed: true, storage: { column: 'memo' } },
        access_group: { type: 'string', required: true, storage: { column: 'access_key' } },
        workspace_id: { type: 'string', required: true, storage: { column: 'workspace_key' } },
        ...extra.schema
      },
      rowPolicy: 'visible',
      autofilter: 'workspace',
      tableName: `search_policy_${type}`
    })
    await api.resources[type].createKnexTable()
    mapTable(knex, api, `search_policy_${type}`, type)
  }
  if (connector === 'express') api.http.express.mount(app)
  return api
}

export async function createManagedTransactionApi (knex, options = {}) {
  await knex.schema.createTable('managed_transaction_audit', table => {
    table.increments('id')
    table.string('message').notNullable()
  })
  return createIdConformanceApi(knex, { ...options, bulk: true })
}

export async function createIdConformanceApi (knex, { storage = storageMode.mode, idType = 'integer', idColumnType, generatedIds = false, mappedIds = true, idCaseInsensitive = false, app, connector, bulk = false, membershipPolicy, manyToManyInclude, referenceCollation, collectionInclude, reversePolymorphicInclude = collectionInclude, polymorphicTargets = ['groups'], resourcePolicy, includeProjection = false, projectionSelect, inverseMembership = false, pivotCaseInsensitive = false, fieldCallback, relationshipSetter, computedDependencies = ['name'], queryMaxLimit } = {}) {
  const api = new Api({ name: 'id-conformance', log: { level: 'silent' } })
  await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full', sortableFields: ['id', 'name'], ...(queryMaxLimit === undefined ? {} : { queryMaxLimit }) })
  await useStoragePlugin(api, knex, { storage, tenantId: 'conformance' })
  let referenceColumnType
  if (storage === 'knex' && (referenceCollation === 'case-insensitive' || idCaseInsensitive || pivotCaseInsensitive)) {
    const client = knex.client.config.client
    if (client === 'pg') {
      await knex.raw("CREATE COLLATION jra_case_insensitive (provider = icu, locale = 'und-u-ks-level2', deterministic = false)")
      referenceColumnType = 'text collate jra_case_insensitive'
    } else referenceColumnType = client === 'mysql2' ? 'varchar(255) collate utf8mb4_unicode_ci' : 'text collate nocase'
  }
  if (membershipPolicy || resourcePolicy) await api.use(RowPolicyPlugin)
  if (includeProjection) await api.use(QueryProjectionsPlugin)
  if (bulk) {
    const { BulkOperationsPlugin } = await import('../../plugins/core/bulk-operations-plugin.js')
    await api.use(BulkOperationsPlugin, bulk === true ? {} : bulk)
  }
  if (connector) {
    await api.use(connector === 'fastify' ? FastifyPlugin : ExpressPlugin, {
      ...(connector === 'fastify' ? { app } : {}), mountPath: '/api'
    })
  }
  for (const type of ['groups', 'items']) {
    const idProperty = mappedIds ? `${type}_key` : 'id'
    await api.addResource(type, {
      idProperty,
      tableName: `conformance_${type}`,
      ...(referenceCollation && type === 'items' ? { sortableFields: ['id', 'name', 'group', 'groupId'] } : {}),
      ...(resourcePolicy ? { rowPolicy: resourcePolicy } : {}),
      ...(includeProjection ? { queryFields: { displayName: { type: 'string', sortable: true, select: projectionSelect || (({ knex, column }) => knex.raw('upper(??)', [column('name')])) } } } : {}),
      schema: {
        id: { type: idType, required: !generatedIds, storage: { column: idProperty } },
        name: {
          type: 'string',
          required: true,
          search: true,
          storage: { column: 'display_name' },
          ...(fieldCallback
            ? {
                setter: (value, context) => fieldCallback('setter', type, value, context),
                getter: (value, context) => fieldCallback('getter', type, value, context)
              }
            : {})
        },
        ...(fieldCallback
          ? {
              derivedName: {
                type: 'string',
                computed: true,
                dependencies: computedDependencies,
                compute: context => fieldCallback('computed', type, context.attributes.name, context)
              }
            }
          : {}),
        ...(type === 'items'
          ? {
              active: { type: 'boolean', defaultTo: true },
              score: { type: 'number', defaultTo: 0 },
              groupId: { type: idType, nullable: true, belongsTo: 'groups', as: 'group', search: true, storage: { column: 'group_key' }, ...(relationshipSetter ? { setter: relationshipSetter } : {}) },
              subjectType: { type: 'string', nullable: true, storage: { column: 'subject_type' } },
              subjectId: { type: idType, nullable: true, storage: { column: 'subject_key' } }
            }
          : {})
      },
      relationships: type === 'groups'
        ? {
            items: { type: 'hasMany', target: 'items', foreignKey: 'groupId', ...(collectionInclude ? { include: collectionInclude } : {}) },
            firstItem: { type: 'hasOne', target: 'items', foreignKey: 'groupId' },
            ...(inverseMembership ? { members: { type: 'manyToMany', target: 'items', through: 'memberships', foreignKey: 'groupId', otherKey: 'itemId', ...(manyToManyInclude ? { include: manyToManyInclude } : {}) } } : {}),
            mentions: { type: 'hasMany', target: 'items', via: 'subject', ...(reversePolymorphicInclude ? { include: reversePolymorphicInclude } : {}) }
          }
        : {
            subject: { belongsToPolymorphic: { types: polymorphicTargets, typeField: 'subjectType', idField: 'subjectId' } },
            groups: { type: 'manyToMany', through: 'memberships', foreignKey: 'itemId', otherKey: 'groupId', ...(manyToManyInclude ? { include: manyToManyInclude } : {}) }
          }
    })
    if (storage === 'anyapi') {
      await api.resources[type].createKnexTable()
    } else {
      await knex.schema.createTable(`conformance_${type}`, table => {
        if (generatedIds) table.bigIncrements(idProperty)
        else if (idColumnType || idCaseInsensitive) table.specificType(idProperty, idColumnType || referenceColumnType).primary()
        else table[idType](idProperty).primary()
        table.string('display_name').notNullable()
        if (type === 'items') {
          table.boolean('active')
          table.float('score')
          if (referenceColumnType || idColumnType) table.specificType('group_key', referenceColumnType || idColumnType).nullable()
          else table[idType]('group_key').nullable()
          table.string('subject_type').nullable()
          if (idColumnType) table.specificType('subject_key', idColumnType).nullable()
          else table[idType]('subject_key').nullable()
        }
      })
    }
    mapTable(knex, api, `conformance_${type}`, type)
  }
  await api.addResource('memberships', {
    tableName: 'conformance_memberships',
    ...(membershipPolicy ? { rowPolicy: membershipPolicy } : {}),
    schema: {
      id: { type: 'id' },
      itemId: { type: idType, required: true, belongsTo: 'items', as: 'item', storage: { column: 'item_key' } },
      groupId: { type: idType, required: true, belongsTo: 'groups', as: 'group', storage: { column: 'group_key' } }
    }
  })
  if (storage === 'knex' && (pivotCaseInsensitive || idColumnType)) {
    await knex.schema.createTable('conformance_memberships', table => {
      table.increments('id')
      table.specificType('item_key', pivotCaseInsensitive ? referenceColumnType : idColumnType).notNullable()
      table.specificType('group_key', pivotCaseInsensitive ? referenceColumnType : idColumnType).notNullable()
    })
  } else await api.resources.memberships.createKnexTable()
  mapTable(knex, api, 'conformance_memberships', 'memberships')
  if (connector === 'express') api.http.express.mount(app)
  if (storage === 'anyapi') {
    const descriptor = await api.anyapi.registry.getDescriptor(api.anyapi.tenantId, 'items')
    const groupsDescriptor = await api.anyapi.registry.getDescriptor(api.anyapi.tenantId, 'groups')
    storageMode.registerLink(knex, 'conformance_memberships', 'items', 'groups', descriptor.manyToMany.groups.relationship, groupsDescriptor.manyToMany?.members?.relationship, api.anyapi.tenantId)
  }
  return api
}

export async function createFastifySchemaApi (app) {
  const api = new Api({ name: 'fastify-schema-test', log: { level: 'silent' } })
  await api.use(RestApiPlugin, { format: 'jsonapi' })
  await api.use(FastifyPlugin, { app, mountPath: '/api' })
  await api.addResource('users', {
    schema: { id: { type: 'id' }, name: { type: 'string', required: true } }
  })
  await api.addResource('articles', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true },
      body: { type: 'string' },
      author_id: { type: 'id', belongsTo: 'users', as: 'author' },
      internal_summary: { type: 'string', computed: true }
    }
  })
  await api.addRoute({ method: 'POST', path: '/api/custom-endpoint', handler: async ({ body }) => ({ echo: body }) })
  return api
}

export async function createConnectorParityApi (knex, { app, connector, returning = 'none', publicBaseUrl = '', transportHooks = true, logging }) {
  const api = new Api({ name: `connector-${connector}-${returning}`, log: { level: 'silent' }, ...(logging ? { logging } : {}) })
  await api.use(RestApiPlugin, {
    format: 'plain', returning, sortableFields: ['id', 'name', 'rank'], queryDefaultLimit: 2, queryMaxLimit: 5
  })
  await useStoragePlugin(api, knex)
  await api.use(connector === 'fastify' ? FastifyPlugin : ExpressPlugin, {
    ...(connector === 'fastify' ? { app } : {}), mountPath: '/api', publicBaseUrl, requestSizeLimit: 1024
  })
  if (transportHooks) {
    await api.customize({
      hooks: {
        'transport:request': {
          functionName: 'connector-parity-request',
          handler: async ({ context }) => {
            const headers = context.transport.request.headers
            if (headers['x-use-public-url-override'] === 'yes') context.urlPrefixOverride = 'https://trusted.example/api'
            if (headers['x-block-request'] === 'yes') context.reject(401, 'Blocked by connector parity hook', { title: 'Unauthorized' })
            if (headers['x-throw-request'] === 'yes') {
              await Promise.resolve()
              throw new Error('Connector request hook failed')
            }
            context.marker = headers['x-marker']
          }
        },
        'transport:response': {
          functionName: 'connector-parity-response',
          handler: ({ context }) => {
            context.transport.response.headers['x-connector-test'] = 'enabled'
            context.transport.response.headers.Vary = 'Origin'
          }
        }
      }
    })
  }
  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, maxLength: 60, search: true },
      code: { type: 'string', maxLength: 2 },
      rank: { type: 'number', nullable: true, search: true },
      active: { type: 'boolean', defaultTo: true, search: true }
    },
    relationships: { cities: { type: 'hasMany', target: 'cities', foreignKey: 'country_id' } },
    tableName: 'connector_countries'
  })
  await api.resources.countries.createKnexTable()
  mapTable(knex, api, 'connector_countries', 'countries')
  await api.addResource('cities', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, search: true },
      country_id: { type: 'id', belongsTo: 'countries', as: 'country', nullable: true, storage: { column: 'country_ref' } }
    },
    tableName: 'connector_cities',
    format: 'jsonapi',
    returning: 'minimal'
  })
  await api.resources.cities.createKnexTable()
  mapTable(knex, api, 'connector_cities', 'cities')
  if (connector === 'express') api.http.express.mount(app)
  return api
}

async function withTenantContext (tenantId, fn) {
  if (!storageMode.isAnyApi()) {
    return await fn()
  }

  const previousTenant = storageMode.currentTenant
  storageMode.setCurrentTenant(tenantId || storageMode.defaultTenant)
  try {
    return await fn()
  } finally {
    storageMode.setCurrentTenant(previousTenant)
  }
}

export async function createRegularSchemaApi (knex, resourceOptions = {}) {
  const api = new Api({ name: 'regular-schema', log: { level: 'error' } })
  await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full' })
  await useStoragePlugin(api, knex, { storage: 'knex' })
  await api.addResource('items', { tableName: 'schema_records', idProperty: 'record_key', ...resourceOptions })
  return api
}

export async function createAnyApiFieldEvolutionApi (knex, { fields = {}, canonicalFieldsMap, searchSchema, createTable = true, tenantId = 'field_evolution' } = {}) {
  const api = new Api({ name: 'field-evolution', log: { level: 'error' } })
  await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full' })
  await useStoragePlugin(api, knex, { storage: 'anyapi', tenantId })
  await api.addResource('groups', { schema: { id: { type: 'id' }, name: { type: 'string', required: true } } })
  await api.addResource('items', {
    schema: { id: { type: 'id' }, name: { type: 'string', required: true }, ...fields },
    ...(canonicalFieldsMap ? { canonicalFieldsMap } : {}),
    ...(searchSchema ? { searchSchema } : {})
  })
  if (createTable) await api.resources.items.createKnexTable()
  return api
}

export async function createSchemaEnrichmentApi (knex, {
  storage = storageMode.mode, hooks = {}, fields = {}, searchSchema, resourceOptions = {},
  app, connector = 'express', label = false, projections = false, resourceName = 'items',
  autofilterOptions, rowPolicyOptions, logging, bulk = false, createTable = true, connectorOptions = {}
} = {}) {
  const api = new Api({ name: 'schema-enrichment', log: { level: 'error' }, ...(logging ? { logging } : {}) })
  await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full' })
  await useStoragePlugin(api, knex, { storage, tenantId: 'schema_enrichment' })
  if (autofilterOptions !== undefined) await api.use(AutoFilterPlugin, autofilterOptions)
  if (rowPolicyOptions !== undefined) await api.use(RowPolicyPlugin, rowPolicyOptions)
  if (label) await api.use(LabelPlugin, typeof label === 'object' ? label : {})
  if (projections) await api.use(QueryProjectionsPlugin)
  if (bulk) {
    const { BulkOperationsPlugin } = await import('../../plugins/core/bulk-operations-plugin.js')
    await api.use(BulkOperationsPlugin)
  }
  await api.customize({ hooks })
  if (app) {
    if (connector === 'fastify') await api.use(FastifyPlugin, { app, mountPath: '/api', ...connectorOptions })
    else {
      await api.use(ExpressPlugin, { mountPath: '/api', ...connectorOptions })
      api.http.express.mount(app)
    }
  }
  await api.addResource(resourceName, {
    schema: {
      name: { type: 'string', search: true },
      amount: { type: 'string', search: true },
      obsolete: { type: 'string', search: true },
      ...fields
    },
    searchSchema,
    tableName: 'schema_enrichment_items',
    ...resourceOptions
  })
  if (createTable) await api.resources[resourceName].createKnexTable()
  mapTable(knex, api, 'schema_enrichment_items', resourceName)
  return api
}

export async function createAnyApiTemporalMigrationApi (knex, { tenantId = 'migration_a' } = {}) {
  const api = new Api({ name: 'temporal-migration', log: { level: 'error' } })
  await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full', queryDefaultLimit: 2, queryMaxLimit: 5 })
  await useStoragePlugin(api, knex, { storage: 'anyapi', tenantId })
  await api.addResource('people', {
    schema: { id: { type: 'id' }, name: { type: 'string', required: true } },
    canonicalFieldsMap: { name: 'string_1' },
    relationships: { events: { type: 'hasMany', target: 'events', foreignKey: 'personId' } }
  })
  await api.resources.people.createKnexTable()
  await api.addResource('events', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      day: { type: 'date', nullable: true, search: true },
      atTime: { type: 'time', temporalPrecision: 6, nullable: true, search: true },
      occurredAt: { type: 'dateTime', nullable: true, search: true },
      personId: { type: 'id', belongsTo: 'people', as: 'person', nullable: true }
    },
    sortableFields: ['id', 'day', 'atTime', 'occurredAt'],
    canonicalFieldsMap: { name: 'string_1', day: 'string_8', atTime: 'string_10', occurredAt: 'date_3', personId: 'rel_1_id' },
    relationships: { guests: { type: 'manyToMany', target: 'people', through: 'attendance', foreignKey: 'eventId', otherKey: 'personId' } }
  })
  await api.resources.events.createKnexTable()
  return api
}

export async function seedLegacyAnyApiTemporalData (knex, { count = 4 } = {}) {
  const sqlite = knex.client.config.client === 'better-sqlite3'
  const timestamp = value => knex.client.config.client === 'pg' ? `${value}Z` : value
  for (const tenant of ['migration_a', 'migration_b']) {
    const config = await knex('any_resource_configs').where({ tenant_id: tenant, resource: 'events' }).first()
    for (const [field, index] of [['day', 1], ['atTime', 2]]) {
      await knex('any_field_configs').where({ resource_config_id: config.id, field_name: field })
        .update({ slot_type: 'date', slot_index: index, slot_column: `date_${index}` })
    }
    await knex('any_records').insert({ tenant_id: tenant, resource: 'people', logical_id: '1', string_1: tenant, date_1: timestamp('1999-01-01 00:00:00') })
    for (let index = 1; index <= count; index++) {
      const day = index < 3 ? '2024-02-29' : '2024-03-01'
      const isNull = index === 4
      await knex('any_records').insert({
        tenant_id: tenant,
        resource: 'events',
        logical_id: String(index),
        string_1: `${tenant} event ${index}`,
        date_1: isNull ? null : sqlite ? Date.parse(`${day}T00:00:00Z`) : timestamp(`${day} 00:00:00`),
        date_2: isNull ? null : sqlite ? '12:34:56.123' : timestamp('2000-01-01 12:34:56.123'),
        date_3: isNull ? null : timestamp('2024-02-29 23:59:59.987'),
        rel_1_id: '1',
        rel_1_type: 'people'
      })
    }
    await knex('any_links').insert({
      tenant_id: tenant,
      relationship: `${tenant}:events:guests`,
      left_resource: 'events',
      left_id: '1',
      right_resource: 'people',
      right_id: '1',
      payload: JSON.stringify({ note: tenant })
    })
  }
}

export async function createTemporalBoundaryApi (knex, { storage = storageMode.mode, transforms = false, onSerialize, collectionInclude } = {}) {
  const serializeTemporal = (value, details) => {
    onSerialize?.(value, details)
    if (knex.client.config.client === 'pg') return value
    return value == null ? null : value.replace('T', ' ').replace(/Z$/, '')
  }
  const api = new Api({ name: 'temporal-boundaries', log: { level: 'error' } })
  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    queryDefaultLimit: 2,
    queryMaxLimit: 3
  })
  await api.use(QueryProjectionsPlugin)
  await useStoragePlugin(api, knex, { storage })
  const producedAt = {
    type: 'dateTime',
    temporalPrecision: 0,
    computed: true,
    compute: () => new Date('2026-09-08T01:02:03.456Z')
  }
  await api.addResource('people', {
    schema: { id: { type: 'id' }, name: { type: 'string' }, producedAt },
    relationships: { events: { type: 'hasMany', target: 'events', foreignKey: 'personId', ...(collectionInclude ? { include: collectionInclude } : {}) } },
    tableName: 'temporal_people'
  })
  await api.resources.people.createKnexTable()
  mapTable(knex, api, 'temporal_people', 'people')
  await api.addResource('events', {
    sortableFields: ['id', 'name', 'occurredAt', 'day', 'atTime', 'observedAtMs', 'observedAtSeconds', 'serializedAt'],
    searchSchema: {
      serializedIn: { type: 'array', actualField: 'serializedAt', filterOperator: 'in' },
      occurredIn: { type: 'array', actualField: 'occurredAt', filterOperator: 'in' },
      daysIn: { type: 'array', actualField: 'day', filterOperator: 'in' },
      timesIn: { type: 'array', actualField: 'atTime', filterOperator: 'in' }
    },
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      occurredAt: { type: 'dateTime', temporalPrecision: 6, nullable: true, search: true },
      day: { type: 'date', nullable: true, search: true },
      atTime: { type: 'time', temporalPrecision: 3, nullable: true, search: true },
      defaultOccurredAt: { type: 'dateTime', nullable: true, search: true },
      defaultTime: { type: 'time', nullable: true, search: true },
      observedAtMs: { type: 'epochMilliseconds', nullable: true, search: true },
      observedAtSeconds: { type: 'epochSeconds', nullable: true, search: true },
      serializedAt: {
        type: 'dateTime',
        temporalPrecision: 6,
        nullable: true,
        search: true,
        storage: { serialize: serializeTemporal }
      },
      personId: { type: 'id', belongsTo: 'people', as: 'person', nullable: true },
      subjectId: { type: 'number', nullable: true },
      subjectType: { type: 'string', nullable: true },
      producedAt,
      ...(transforms
        ? {
            transformedAt: {
              type: 'dateTime',
              nullable: true,
              temporalPrecision: 3,
              setter: async value => value == null ? null : new Date(new Date(value).getTime() + 60000),
              getter: async value => value == null ? null : new Date(new Date(value).getTime() + 1000)
            },
            computedDay: { type: 'date', computed: true, compute: () => new Date('2024-02-29T23:59:59.987Z') },
            computedTime: { type: 'time', temporalPrecision: 2, computed: true, compute: () => new Date('2024-02-29T23:59:59.987Z') },
            computedEpoch: { type: 'epochMilliseconds', computed: true, compute: () => 1709251199987n }
          }
        : {})
    },
    queryFields: {
      projectedDay: {
        type: 'date',
        sortable: true,
        normallyHidden: true,
        select: ({ knex, column }) => knex.raw('??', [column('day')])
      },
      projectedTime: {
        type: 'time',
        temporalPrecision: 3,
        sortable: true,
        normallyHidden: true,
        select: ({ knex, column }) => knex.raw('??', [column('atTime')])
      },
      projectedSerializedAt: {
        type: 'dateTime',
        temporalPrecision: 6,
        sortable: true,
        normallyHidden: true,
        select: ({ knex, column }) => knex.raw('??', [column('serializedAt')])
      },
      projectedAt: {
        type: 'dateTime',
        temporalPrecision: 3,
        sortable: true,
        select: ({ knex, column }) => knex.raw('??', [column('occurredAt')])
      }
    },
    relationships: {
      subject: { belongsToPolymorphic: { types: ['people'], typeField: 'subjectType', idField: 'subjectId' } }
    },
    tableName: 'temporal_events'
  })
  await api.resources.events.createKnexTable()
  mapTable(knex, api, 'temporal_events', 'events')
  return api
}

/**
 * Creates a basic API configuration with Countries, Publishers, Authors, Books
 */
export async function createBasicApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'basic-test-api'
  const tablePrefix = pluginOptions.tablePrefix || 'basic'
  const api = new Api({
    ...(pluginOptions.logging ? { logging: pluginOptions.logging } : {}),
    name: apiName,
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const previousTenant = storageMode.currentTenant
  const tenantId = storageMode.isAnyApi()
    ? (pluginOptions.tenantId || `${tablePrefix}_tenant`)
    : storageMode.defaultTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  const restApiOptions = {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'name', 'code'],
    ...pluginOptions['rest-api']  // Merge any custom options for rest-api plugin
  }

  await api.use(RestApiPlugin, restApiOptions)
  await useStoragePlugin(api, knex, { tenantId })

  // Add Express plugin if requested
  if (pluginOptions.includeExpress) {
    await api.use(ExpressPlugin, {
      mountPath: '/api',  // Default mount path for tests
      ...(pluginOptions.express || {})
    })
  }

  try {
  // Countries table
    await api.addResource('countries', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 100, search: true },
        code: { type: 'string', max: 2, unique: true },
        ...pluginOptions.countryFields
      },
      relationships: {
        publishers: { type: 'hasMany', target: 'publishers', foreignKey: 'country_id' },
        books: { type: 'hasMany', target: 'books', foreignKey: 'country_id' }
      },
      tableName: `${tablePrefix}_countries`
    })
    await api.resources.countries.createKnexTable()
    mapTable(knex, api, `${tablePrefix}_countries`, 'countries')

    // Publishers table
    await api.addResource('publishers', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 200 },
        country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
      },
      relationships: {
        books: { type: 'hasMany', target: 'books', foreignKey: 'publisher_id' },
        authors: { type: 'hasMany', target: 'authors', foreignKey: 'publisher_id' }
      },
      tableName: `${tablePrefix}_publishers`
    })
    await api.resources.publishers.createKnexTable()
    mapTable(knex, api, `${tablePrefix}_publishers`, 'publishers')

    // Authors table
    await api.addResource('authors', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 200 },
        publisher_id: { type: 'number', nullable: true, belongsTo: 'publishers', as: 'publisher' }
      },
      relationships: {
        books: { type: 'manyToMany', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
      },
      tableName: `${tablePrefix}_authors`
    })
    await api.resources.authors.createKnexTable()
    mapTable(knex, api, `${tablePrefix}_authors`, 'authors')

    // Books table
    await api.addResource('books', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true, max: 300, search: true },
        country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
        publisher_id: { type: 'number', nullable: true, belongsTo: 'publishers', as: 'publisher', search: true }
      },
      relationships: {
        authors: { type: 'manyToMany', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
      },
      ...(pluginOptions.bookSearchSchema ? { searchSchema: pluginOptions.bookSearchSchema } : {}),
      tableName: `${tablePrefix}_books`
    })
    await api.resources.books.createKnexTable()
    mapTable(knex, api, `${tablePrefix}_books`, 'books')

    // Book-Authors pivot table
    await api.addResource('book_authors', {
      schema: {
        id: { type: 'id' },
        book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book', ...(pluginOptions.mappedPivot ? { storage: { column: 'volume_ref' } } : {}) },
        author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author', ...(pluginOptions.mappedPivot ? { storage: { column: 'writer_ref' } } : {}) }
      },
      tableName: `${tablePrefix}_book_authors`
    })
    await api.resources.book_authors.createKnexTable()
    mapTable(knex, api, `${tablePrefix}_book_authors`, 'book_authors')
    if (storageMode.isAnyApi()) {
      const descriptorTenant = api.anyapi?.tenantId || tenantId
      const booksDescriptor = await api.anyapi.registry.getDescriptor(descriptorTenant, 'books')
      const authorsDescriptor = await api.anyapi.registry.getDescriptor(descriptorTenant, 'authors')
      const relationshipKey = booksDescriptor?.manyToMany?.authors?.relationship
      const inverseRelationshipKey = authorsDescriptor?.manyToMany?.books?.relationship
      storageMode.registerLink(
        knex, `${tablePrefix}_book_authors`,
        'books',
        'authors',
        relationshipKey,
        inverseRelationshipKey, api.anyapi.tenantId
      )
    }

    return api
  } finally {
    if (storageMode.isAnyApi()) {
      storageMode.setCurrentTenant(previousTenant)
    }
  }
}

export async function createReturnRecordApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'return-record-test-api'
  const tablePrefix = pluginOptions.tablePrefix || 'return'

  const api = new Api({
    name: apiName,
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const previousTenant = storageMode.currentTenant
  const tenantId = storageMode.isAnyApi()
    ? (pluginOptions.tenantId || `${tablePrefix}_tenant`)
    : storageMode.defaultTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'name'],
    ...pluginOptions['rest-api']
  })
  await useStoragePlugin(api, knex, { tenantId })

  try {
    await api.addResource('global_items', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 100 },
        format: { type: 'string' },
        returning: { type: 'string' },
        queryParams: { type: 'string' },
        data: { type: 'object', getter: value => typeof value === 'string' ? JSON.parse(value) : value }
      },
      tableName: `${tablePrefix}_global_items`
    })
    await api.resources.global_items.createKnexTable()
    mapTable(knex, api, `${tablePrefix}_global_items`, 'global_items')

    await api.addResource('scope_items', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 100 },
        format: { type: 'string' },
        returning: { type: 'string' },
        queryParams: { type: 'string' },
        data: { type: 'object', getter: value => typeof value === 'string' ? JSON.parse(value) : value }
      },
      tableName: `${tablePrefix}_scope_items`,
      returning: 'minimal',

    })
    await api.resources.scope_items.createKnexTable()
    mapTable(knex, api, `${tablePrefix}_scope_items`, 'scope_items')
  } finally {
    if (storageMode.isAnyApi()) {
      storageMode.setCurrentTenant(previousTenant)
    }
  }

  return api
}

export async function createFixtureIsolationApis (sharedDb, separateDb) {
  const first = await createBasicApi(sharedDb, { tablePrefix: 'isolation_left', tenantId: 'isolation_first' })
  await first.resources.countries.post({
    format: 'jsonapi',
    inputRecord: { data: { type: 'countries', attributes: { name: 'Before another API' } } }
  })
  const second = await createBasicApi(sharedDb, { tablePrefix: 'isolation_right', tenantId: 'isolation_second' })
  const third = await createBasicApi(separateDb, { tablePrefix: 'isolation_left', tenantId: 'isolation_third' })
  const afterSetup = await first.resources.countries.query({ format: 'jsonapi' })
  return { first, second, third, afterSetup }
}

export async function seedFixtureIsolationApis ({ first, second, third }) {
  for (const [api, name] of [[first, 'First'], [second, 'Second'], [third, 'Third']]) {
    await api.resources.countries.post({
      format: 'jsonapi',
      inputRecord: { data: { type: 'countries', attributes: { name } } }
    })
  }
}

/**
 * Creates a small API that uses logical camelCase belongsTo fields with default snake_case storage mapping.
 * This reproduces the full JSON:API linkage path where storage column names differ from logical field names.
 */
export async function createCamelCaseBelongsToApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'camelcase-belongsto-test-api'
  const tablePrefix = pluginOptions.tablePrefix || 'camel_fk'

  const api = new Api({
    name: apiName,
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    ...(pluginOptions['rest-api'] || {})
  })

  await api.use(RestApiKnexPlugin, { knex })

  await api.addResource('countries', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 }
    },
    tableName: `${tablePrefix}_countries`
  })
  await api.resources.countries.createKnexTable()

  await api.addResource('publishers', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      countryId: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
    },
    tableName: `${tablePrefix}_publishers`
  })
  await api.resources.publishers.createKnexTable()

  return api
}

export async function seedCanonicalLinkRows (knex, rows) {
  for (let offset = 0; offset < rows.length; offset += 100) {
    await knex('any_links').insert(rows.slice(offset, offset + 100))
  }
}

export async function seedStorageAdapterRecords (knex, schemaInfo, records) {
  const adapter = createStorageAdapter({ knex, schemaInfo })
  const rows = records.map(({ id, ...attributes }) => {
    const row = { ...adapter.toStorageRow(attributes), [adapter.getIdColumn()]: id }
    const descriptor = schemaInfo.descriptor
    if (descriptor) {
      row[descriptor.canonical.tenantColumn] = descriptor.tenant
      row[descriptor.canonical.resourceColumn] = descriptor.resource
    }
    return row
  })
  await knex(adapter.getTableName()).insert(rows)
}

export async function seedUnqueriedIdConformanceApi (knex, api, ids = ['0', '1']) {
  const insert = (type, id, attributes) => seedStorageAdapterRecords(knex, api.resources[type].vars.schemaInfo, [{ id, ...attributes }])
  for (const id of ids) {
    await insert('groups', id, { name: `Group ${id}` })
    await insert('items', id, { name: `Item ${id}`, groupId: id, subjectType: 'groups', subjectId: id, active: true, score: 0 })
    if (api.anyapi) {
      await api.anyapi.links.attachMany({
        scopeName: 'items',
        relName: 'groups',
        context: { id, db: knex },
        relData: [{ type: 'groups', id }]
      })
    } else await insert('memberships', String(Number(id) + 1), { itemId: id, groupId: id })
  }
}

export async function createRelationshipIncludeStorageAdapterApi (knex) {
  const api = new Api({
    name: 'relationship-include-storage-adapter-test',
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  await api.use(RestApiPlugin, {
    format: 'jsonapi',

  })
  await api.use(RestApiKnexPlugin, { knex })

  await knex.schema.createTable('uninitialized_pets', table => {
    table.increments('id').primary()
    table.string('first_name').notNullable()
    table.string('last_name').notNullable()
  })
  await knex.schema.createTable('uninitialized_bookings', table => {
    table.increments('id').primary()
    table.string('reference').notNullable()
    table.integer('pet_id').notNullable()
  })

  await api.addResource('pets', {
    schema: {
      id: { type: 'id' },
      firstName: { type: 'string', required: true },
      lastName: { type: 'string', required: true }
    },
    tableName: 'uninitialized_pets'
  })

  await api.addResource('bookings', {
    schema: {
      id: { type: 'id' },
      reference: { type: 'string', required: true },
      petId: {
        type: 'id',
        required: true,
        belongsTo: 'pets',
        as: 'pet'
      }
    },
    tableName: 'uninitialized_bookings'
  })

  return api
}

export async function seedRelationshipIncludeStorageAdapterApi (knex) {
  await knex('uninitialized_pets').insert({
    id: 7,
    first_name: 'Coco',
    last_name: 'Spaniel'
  })
  await knex('uninitialized_bookings').insert({
    id: 41,
    reference: 'BOOK-41',
    pet_id: 7
  })
}

export async function createIncludeTraversalApi (knex) {
  const api = new Api({ name: 'include-traversal' })
  await api.use(RestApiPlugin, { format: 'jsonapi', includeDepthLimit: 5 })
  await useStoragePlugin(api, knex)
  const definitions = {
    countries: {},
    publishers: {
      schema: { countryId: { type: 'id', belongsTo: 'countries', as: 'country' } },
      relationships: { books: { type: 'hasMany', target: 'books', foreignKey: 'publisherId' } }
    },
    writers: {
      schema: { publisherId: { type: 'id', belongsTo: 'publishers', as: 'publisher' } },
      relationships: {
        profile: { type: 'hasOne', target: 'profiles', foreignKey: 'writerId' },
        comments: { type: 'hasMany', target: 'comments', via: 'subject' }
      }
    },
    profiles: {
      schema: {
        writerId: { type: 'id', belongsTo: 'writers', as: 'writer' },
        countryId: { type: 'id', belongsTo: 'countries', as: 'country' }
      }
    },
    books: { schema: { publisherId: { type: 'id', belongsTo: 'publishers', as: 'publisher' } } },
    comments: {
      schema: {
        subjectId: { type: 'number' },
        subjectType: { type: 'string' },
        reviewerId: { type: 'id', belongsTo: 'writers', as: 'reviewer' }
      },
      relationships: {
        subject: { belongsToPolymorphic: { types: ['writers', 'books'], typeField: 'subjectType', idField: 'subjectId' } }
      }
    }
  }
  for (const [name, definition] of Object.entries(definitions)) {
    await api.addResource(name, {
      ...definition,
      schema: { id: { type: 'id' }, name: { type: 'string', required: true }, ...definition.schema },
      tableName: `traversal_${name}`
    })
    await api.resources[name].createKnexTable()
    mapTable(knex, api, `traversal_${name}`, name)
  }
  return api
}

export async function seedIncludeTraversalApi (api) {
  const post = async (type, name, relationships = {}) => {
    const result = await api.resources[type].post({
      format: 'jsonapi',
      inputRecord: { data: { type, attributes: { name }, relationships } }
    })
    return { type, id: result.data.id }
  }
  const branches = []
  for (let i = 1; i <= 2; i++) {
    const country = await post('countries', `Country ${i}`)
    const publisher = await post('publishers', `Publisher ${i}`, { country: { data: country } })
    const writer = await post('writers', `Writer ${i}`, { publisher: { data: publisher } })
    const profile = await post('profiles', `Profile ${i}`, { writer: { data: writer }, country: { data: country } })
    const book = await post('books', `Book ${i}`, { publisher: { data: publisher } })
    const subject = i === 1 ? writer : book
    const comment = await post('comments', `Comment ${i}`, { subject: { data: subject }, reviewer: { data: writer } })
    branches.push({ country, publisher, writer, profile, book, comment })
  }
  return branches
}

export async function createReverseRelationshipApi (knex, { childIdProperty = 'id' } = {}) {
  const api = new Api({ name: 'reverse-relationships' })
  await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full', queryDefaultLimit: 2, queryMaxLimit: 3 })
  await useStoragePlugin(api, knex)
  const parentField = { type: 'id', belongsTo: 'parents', as: 'parent', nullable: true, storage: { column: 'parent_key' } }
  const definitions = {
    parents: {
      relationships: {
        children: { type: 'hasMany', target: 'children', foreignKey: 'parentId' },
        profile: { type: 'hasOne', target: 'profiles', foreignKey: 'parentId' },
        comments: { type: 'hasMany', target: 'comments', via: 'subject' },
        requiredChildren: { type: 'hasMany', target: 'requiredChildren', foreignKey: 'parentId' }
      }
    },
    others: {},
    children: { idProperty: childIdProperty, schema: { parentId: parentField } },
    profiles: { schema: { parentId: { ...parentField, unique: true } } },
    requiredChildren: { schema: { parentId: { ...parentField, nullable: false, required: true } } },
    comments: {
      schema: { subjectType: { type: 'string', nullable: true }, subjectId: { type: 'string', nullable: true } },
      relationships: { subject: { belongsToPolymorphic: { types: ['parents', 'others'], typeField: 'subjectType', idField: 'subjectId' } } }
    }
  }
  for (const [name, definition] of Object.entries(definitions)) {
    const idProperty = definition.idProperty || 'id'
    await api.addResource(name, {
      ...definition,
      schema: { [idProperty]: { type: 'id' }, name: { type: 'string', required: true }, ...definition.schema },
      tableName: `reverse_${name}`
    })
    await api.resources[name].createKnexTable()
    mapTable(knex, api, `reverse_${name}`, name)
  }
  return api
}

export async function seedReverseRelationshipRecord (api, type, name, relationships) {
  return (await api.resources[type].post({
    inputRecord: { data: { type, attributes: { name }, ...(relationships ? { relationships } : {}) } },
    format: 'jsonapi',
    returning: 'full'
  })).data
}

/**
 * Creates a small API focused on resource ID normalization behavior.
 */
export async function createIdNormalizationApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'id-normalization-test-api'
  const tablePrefix = pluginOptions.tablePrefix || 'id_norm'

  const api = new Api({
    name: apiName,
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const previousTenant = storageMode.currentTenant
  const tenantId = storageMode.isAnyApi()
    ? (pluginOptions.tenantId || `${tablePrefix}_tenant`)
    : storageMode.defaultTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    ...(pluginOptions['rest-api'] || {})
  })

  try {
    await withTenantContext(tenantId, async () => {
      await useStoragePlugin(api, knex, { tenantId })

      await api.addResource('countries', {
        schema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true, max: 100 }
        },
        tableName: `${tablePrefix}_countries`,
        ...(pluginOptions.countryResourceOptions || {})
      })
      await knex.schema.dropTableIfExists(`${tablePrefix}_countries`)
      await knex.schema.createTable(`${tablePrefix}_countries`, (table) => {
        table.string('id').primary()
        table.string('name').notNullable()
      })
      mapTable(knex, api, `${tablePrefix}_countries`, 'countries')

      await api.addResource('publishers', {
        schema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true, max: 100 },
          country_id: { type: 'string', nullable: true, belongsTo: 'countries', as: 'country' }
        },
        relationships: {
          tags: { type: 'manyToMany', through: 'publisher_tags', foreignKey: 'publisher_id', otherKey: 'tag_id' }
        },
        tableName: `${tablePrefix}_publishers`,
        ...(pluginOptions.publisherResourceOptions || {})
      })
      await knex.schema.dropTableIfExists(`${tablePrefix}_publishers`)
      await knex.schema.createTable(`${tablePrefix}_publishers`, (table) => {
        table.string('id').primary()
        table.string('name').notNullable()
        table.string('country_id').nullable()
      })
      mapTable(knex, api, `${tablePrefix}_publishers`, 'publishers')

      await api.addResource('tags', {
        schema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true, max: 100 }
        },
        tableName: `${tablePrefix}_tags`,
        ...(pluginOptions.tagResourceOptions || {})
      })
      await knex.schema.dropTableIfExists(`${tablePrefix}_tags`)
      await knex.schema.createTable(`${tablePrefix}_tags`, (table) => {
        table.string('id').primary()
        table.string('name').notNullable()
      })
      mapTable(knex, api, `${tablePrefix}_tags`, 'tags')

      await api.addResource('publisher_tags', {
        schema: {
          id: { type: 'id' },
          publisher_id: { type: 'string', required: true, belongsTo: 'publishers', as: 'publisher' },
          tag_id: { type: 'string', required: true, belongsTo: 'tags', as: 'tag' }
        },
        tableName: `${tablePrefix}_publisher_tags`
      })
      await knex.schema.dropTableIfExists(`${tablePrefix}_publisher_tags`)
      await knex.schema.createTable(`${tablePrefix}_publisher_tags`, (table) => {
        table.increments('id').primary()
        table.string('publisher_id').notNullable()
        table.string('tag_id').notNullable()
      })
      mapTable(knex, api, `${tablePrefix}_publisher_tags`, 'publisher_tags')
      if (storageMode.isAnyApi()) {
        const descriptorTenant = api.anyapi?.tenantId || tenantId
        const publishersDescriptor = await api.anyapi.registry.getDescriptor(descriptorTenant, 'publishers')
        const tagsDescriptor = await api.anyapi.registry.getDescriptor(descriptorTenant, 'tags')
        const relationshipKey = publishersDescriptor?.manyToMany?.tags?.relationship
        const inverseRelationshipKey = tagsDescriptor?.manyToMany?.publishers?.relationship
        storageMode.registerLink(
          knex, `${tablePrefix}_publisher_tags`,
          'publishers',
          'tags',
          relationshipKey,
          inverseRelationshipKey, api.anyapi.tenantId
        )
      }
    })

    return api
  } finally {
    if (storageMode.isAnyApi()) {
      storageMode.setCurrentTenant(previousTenant)
    }
  }
}

/**
 * Creates a basic API with bulk operations enabled
 */
export async function createBulkOperationsApi (knex, pluginOptions = {}) {
  const { BulkOperationsPlugin } = await import('../../plugins/core/bulk-operations-plugin.js')

  const api = await createBasicApi(knex, {
    ...pluginOptions,
    tenantId: pluginOptions.tenantId || 'bulk_ops_tenant'
  })

  // Add bulk operations plugin
  await api.use(BulkOperationsPlugin, {
    maxBulkOperations: 100,
    defaultAtomic: true,
    ...pluginOptions['bulk-operations']
  })

  return api
}

/**
 * Creates an extended API with additional fields for more complex testing
 */
export async function createExtendedApi (knex) {
  const api = new Api({
    name: 'extended-test-api',
  })

  const tenantId = storageMode.isAnyApi() ? 'extended_tenant' : storageMode.defaultTenant

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'price', 'language', 'population', 'name', 'code']
  })
  await withTenantContext(tenantId, async () => {
    await useStoragePlugin(api, knex, { tenantId })

    // Countries with extended fields
    await api.addResource('countries', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 100 },
        code: { type: 'string', max: 2, unique: true },
        capital: { type: 'string', max: 100 },
        population: { type: 'number' },
        currency: { type: 'string', max: 3 }
      },
      relationships: {
        publishers: { type: 'hasMany', target: 'publishers', foreignKey: 'country_id' },
        books: { type: 'hasMany', target: 'books', foreignKey: 'country_id' },
        authors: { type: 'hasMany', target: 'authors', foreignKey: 'nationality_id' }
      },
      tableName: 'ext_countries'
    })
    await api.resources.countries.createKnexTable()
    mapTable(knex, api, 'ext_countries', 'countries')

    // Publishers with extended fields
    await api.addResource('publishers', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 200 },
        country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' },
        founded_year: { type: 'number' },
        website: { type: 'string', max: 255 },
        active: { type: 'boolean', default: true }
      },
      relationships: {
        books: { type: 'hasMany', target: 'books', foreignKey: 'publisher_id' },
        reviews: {
          type: 'hasMany',
          target: 'reviews',
          via: 'reviewable'
        }
      },
      tableName: 'ext_publishers'
    })
    await api.resources.publishers.createKnexTable()
    mapTable(knex, api, 'ext_publishers', 'publishers')

    // Authors with extended fields
    await api.addResource('authors', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 200 },
        birth_date: { type: 'date' },
        biography: { type: 'string', max: 5000 },
        nationality_id: { type: 'number', belongsTo: 'countries', as: 'nationality' }
      },
      relationships: {
        books: { type: 'manyToMany', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' },
        reviews: {
          type: 'hasMany',
          target: 'reviews',
          via: 'reviewable'
        }
      },
      tableName: 'ext_authors'
    })
    await api.resources.authors.createKnexTable()
    mapTable(knex, api, 'ext_authors', 'authors')

    // Books with extended fields
    await api.addResource('books', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true, max: 300, search: true },
        isbn: { type: 'string', max: 13 },
        pages: { type: 'number' },
        price: { type: 'number', search: true }, // Store price as string for decimal precision
        published_date: { type: 'date' },
        language: { type: 'string', max: 2, default: 'en', search: true },
        country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
        publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
      },
      relationships: {
        authors: { type: 'manyToMany', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' },
        reviews: {
          type: 'hasMany',
          target: 'reviews',
          via: 'reviewable'
        }
      },
      tableName: 'ext_books'
    })
    await api.resources.books.createKnexTable()
    mapTable(knex, api, 'ext_books', 'books')

    // Book-Authors pivot with extended fields
    await api.addResource('book_authors', {
      schema: {
        id: { type: 'id' },
        book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
        author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
        contribution_type: { type: 'string', max: 50 },
        order: { type: 'number' }
      },
      tableName: 'ext_book_authors'
    })
    await api.resources.book_authors.createKnexTable()
    mapTable(knex, api, 'ext_book_authors', 'book_authors')
    if (storageMode.isAnyApi()) {
      const booksDescriptor = await api.anyapi.registry.getDescriptor(tenantId, 'books')
      const authorsDescriptor = await api.anyapi.registry.getDescriptor(tenantId, 'authors')
      const relationshipKey = booksDescriptor?.manyToMany?.authors?.relationship
      const inverseRelationshipKey = authorsDescriptor?.manyToMany?.books?.relationship
      storageMode.registerLink(knex, 'ext_book_authors', 'books', 'authors', relationshipKey, inverseRelationshipKey, api.anyapi.tenantId)
    }

    // Polymorphic reviews (can go on authors, books and publishers)
    await api.addResource('reviews', {
      schema: {
        id: { type: 'id' },
        rating: { type: 'number', required: true, min: 1, max: 5 },
        title: { type: 'string', max: 200 },
        content: { type: 'string', required: true, max: 5000 },
        reviewer_name: { type: 'string', required: true, max: 100 },
        review_date: { type: 'dateTime', temporalPrecision: 3, defaultTo: () => new Date().toISOString() },
        helpful_count: { type: 'number', default: 0 },
        reviewable_type: { type: 'string', required: true },
        reviewable_id: { type: 'number', required: true }
      },
      relationships: {
        reviewable: {
          belongsToPolymorphic: {
            types: ['books', 'authors', 'publishers'],
            typeField: 'reviewable_type',
            idField: 'reviewable_id'
          }
        }
      },
      tableName: 'ext_reviews'
    })
    await api.resources.reviews.createKnexTable()
    mapTable(knex, api, 'ext_reviews', 'reviews')
  })

  return api
}

/**
 * Creates an API with limited include depth for testing depth validation
 * Uses 'limited_' prefix for all tables to avoid conflicts
 */
export async function createLimitedDepthApi (knex) {
  const api = new Api({
    name: 'limited-depth-api',
  })

  const tenantId = storageMode.isAnyApi() ? 'limited_depth_tenant' : storageMode.defaultTenant

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'name', 'code'],
    includeDepthLimit: 2  // Key difference: limit is 2 instead of default 3
  })
  await withTenantContext(tenantId, async () => {
    await useStoragePlugin(api, knex, { tenantId })

    // Use different table names with 'limited_' prefix to avoid conflicts
    await api.addResource('countries', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 100 },
        code: { type: 'string', max: 2, unique: true }
      },
      relationships: {
        publishers: { type: 'hasMany', target: 'publishers', foreignKey: 'country_id' },
        books: { type: 'hasMany', target: 'books', foreignKey: 'country_id' }
      },
      tableName: 'limited_countries',
    })
    await api.resources.countries.createKnexTable()
    mapTable(knex, api, 'limited_countries', 'countries')

    await api.addResource('publishers', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 200 },
        country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
      },
      relationships: {
        books: { type: 'hasMany', target: 'books', foreignKey: 'publisher_id' },
        authors: { type: 'hasMany', target: 'authors', foreignKey: 'publisher_id' }
      },
      tableName: 'limited_publishers'
    })
    await api.resources.publishers.createKnexTable()
    mapTable(knex, api, 'limited_publishers', 'publishers')

    await api.addResource('authors', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 200 },
        publisher_id: { type: 'number', nullable: true, belongsTo: 'publishers', as: 'publisher' }
      },
      relationships: {
        books: { type: 'manyToMany', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
      },
      tableName: 'limited_authors'
    })
    await api.resources.authors.createKnexTable()
    mapTable(knex, api, 'limited_authors', 'authors')

    await api.addResource('books', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true, max: 300, search: true },
        country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
        publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
      },
      relationships: {
        authors: { type: 'manyToMany', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
      },
      tableName: 'limited_books'
    })
    await api.resources.books.createKnexTable()
    mapTable(knex, api, 'limited_books', 'books')

    await api.addResource('book_authors', {
      schema: {
        id: { type: 'id' },
        book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
        author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' }
      },
      tableName: 'limited_book_authors'
    })
    await api.resources.book_authors.createKnexTable()
    mapTable(knex, api, 'limited_book_authors', 'book_authors')
    if (storageMode.isAnyApi()) {
      const booksDescriptor = await api.anyapi.registry.getDescriptor(tenantId, 'books')
      const authorsDescriptor = await api.anyapi.registry.getDescriptor(tenantId, 'authors')
      const relationshipKey = booksDescriptor?.manyToMany?.authors?.relationship
      const inverseRelationshipKey = authorsDescriptor?.manyToMany?.books?.relationship
      storageMode.registerLink(knex, 'limited_book_authors', 'books', 'authors', relationshipKey, inverseRelationshipKey, api.anyapi.tenantId)
    }
  })

  return api
}

/**
 * Creates an API configuration for pagination testing
 */
export async function createPaginationApi (knex, options = {}) {
  const api = new Api({
    name: 'pagination-test-api',
  })

  const tenantId = storageMode.isAnyApi() ? 'pagination_tenant' : storageMode.defaultTenant

  const restApiOptions = {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'title', 'country_id', 'publisher_id', 'name', 'code'],
    ...options  // Allow overriding options likereturnBasePath, enablePaginationCounts
  }

  await api.use(RestApiPlugin, restApiOptions)
  await withTenantContext(tenantId, async () => {
    await useStoragePlugin(api, knex, { tenantId })

    // Countries table
    await api.addResource('countries', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 100 },
        code: { type: 'string', max: 2, unique: true }
      },
      relationships: {
        publishers: { type: 'hasMany', target: 'publishers', foreignKey: 'country_id' },
        books: { type: 'hasMany', target: 'books', foreignKey: 'country_id' }
      },
      tableName: 'pagination_countries'
    })
    await api.resources.countries.createKnexTable()
    mapTable(knex, api, 'pagination_countries', 'countries')

    // Publishers table
    await api.addResource('publishers', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 200 },
        country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
      },
      relationships: {
        books: { type: 'hasMany', target: 'books', foreignKey: 'publisher_id' }
      },
      tableName: 'pagination_publishers'
    })
    await api.resources.publishers.createKnexTable()
    mapTable(knex, api, 'pagination_publishers', 'publishers')

    // Books table
    await api.addResource('books', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true, max: 300, search: true },
        country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
        publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher', search: true }
      },
      tableName: 'pagination_books'
    })
    await api.resources.books.createKnexTable()
    mapTable(knex, api, 'pagination_books', 'books')
  })

  return api
}

/**
 * Creates an API with WebSocket/Socket.IO support for testing
 */
export async function createWebSocketApi (knex, pluginOptions = {}) {
  const { jwtVerify } = await import('jose')

  const { createApi = createBasicApi, startSockets = true, ...apiOptions } = pluginOptions
  const api = await createApi(knex, {
    ...apiOptions,
    tenantId: pluginOptions.tenantId || 'socketio_tenant',
    includeExpress: true,
    express: {
      port: 0 // Let OS assign a port
    }
  })

  const socketioOptions = { ...(pluginOptions['socketio'] || {}) }
  const authOptions = { ...(socketioOptions.auth || {}) }
  const sharedSecret = authOptions.sharedSecret || socketioOptions.sharedSecret || 'test-secret-key'

  if (!authOptions.authenticate) {
    authOptions.authenticate = async ({ socket }) => {
      const token = socket.handshake.auth?.token
      if (!token) {
        throw new Error('Authentication required')
      }

      const encoder = new TextEncoder()
      const key = encoder.encode(sharedSecret)
      const { payload } = await jwtVerify(token, key)

      const roles = Array.isArray(payload.roles)
        ? payload.roles
        : payload.role ? [payload.role] : []

      const authContext = {
        userId: payload.userId || payload.sub,
        roles,
        token: payload
      }

      if (!authContext.userId) {
        throw new Error('Token is missing required user identifier')
      }

      return authContext
    }
  }

  if (authOptions.requireAuth === undefined) {
    authOptions.requireAuth = true
  }

  socketioOptions.auth = authOptions

  await api.use(SocketIOPlugin, socketioOptions)

  // Create and start Express server
  const app = express()
  api.http.express.app = app

  // Mount the API routes
  api.http.express.mount(app)

  // Create HTTP server
  const server = createServer(app)

  try {
    if (startSockets) await api.startSocketServer(server)
    const listening = once(server, 'listening')
    server.listen(0)
    await listening
    return { api, server }
  } catch (error) {
    try {
      await closeWebSocketApi(api, server)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Socket fixture startup and cleanup failed', { cause: error })
    }
    throw error
  }
}

export async function closeWebSocketApi (api, server) {
  const errors = []
  const cleanup = async action => {
    try { await action() } catch (error) { errors.push(error) }
  }
  if (api?.vars.socketIO) {
    await cleanup(() => api.vars.socketIO.disconnectSockets(true))
    await cleanup(async () => {
      await new Promise((resolve, reject) => {
        api.vars.socketIO.close(error => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
          else resolve()
        })
      })
    })
  }
  for (const client of Object.values(api?.vars.socketIORedisClients || {})) {
    await cleanup(() => client.quit())
  }
  if (server?.listening) {
    await cleanup(async () => {
      const closing = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
      server.closeAllConnections()
      await closing
    })
  }
  if (api?.helpers?.auth?.cleanup) await cleanup(() => api.helpers.auth.cleanup())
  if (errors.length) throw new AggregateError(errors, 'Socket fixture cleanup failed')
}

/**
 * Creates an API with computed fields for testing
 */
export async function createComputedFieldsApi (knex, pluginOptions = {}) {
  const api = new Api({
    name: 'computed-fields-test-api',
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const tenantId = storageMode.isAnyApi() ? 'computed_fields_tenant' : storageMode.defaultTenant

  await api.use(RestApiPlugin, {
    format: 'plain',

  })

  await withTenantContext(tenantId, async () => {
    await useStoragePlugin(api, knex, { tenantId })

    // Products resource with computed fields
    await api.addResource('products', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 255 },
        price: { type: 'number', required: true, min: 0 },
        cost: { type: 'number', required: true, min: 0, normallyHidden: true },
        internal_notes: { type: 'string', normallyHidden: true },
        profit_margin: {
          type: 'number',
          computed: true,
          dependencies: ['price', 'cost'],
          compute: ({ attributes }) => {
            if (!attributes.price || attributes.price === 0) return 0
            return Number(((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2))
          }
        },
        profit_amount: {
          type: 'number',
          computed: true,
          dependencies: ['price', 'cost'],
          compute: ({ attributes }) => {
            return Number((attributes.price - attributes.cost).toFixed(2))
          }
        },
        calculated_at: {
          type: 'dateTime',
          temporalPrecision: 0,
          computed: true,
          compute: () => new Date('2026-08-25T23:45:01.987Z')
        },
        calculated_time: {
          type: 'time',
          temporalPrecision: 3,
          computed: true,
          compute: () => new Date('2026-08-25T23:45:01.987Z')
        }
      },
      relationships: {
        reviews: { type: 'hasMany', target: 'reviews', foreignKey: 'product_id' }
      },
      tableName: 'test_products'
    })
    await api.resources.products.createKnexTable()
    mapTable(knex, api, 'searchmerge_products', 'products')
    mapTable(knex, api, 'test_products', 'products')

    // Reviews resource with computed fields
    await api.addResource('reviews', {
      schema: {
        id: { type: 'id' },
        product_id: { type: 'number', required: true, belongsTo: 'products', as: 'product' },
        reviewer_name: { type: 'string', required: true },
        rating: { type: 'number', required: true, min: 1, max: 5 },
        comment: { type: 'string', max: 1000 },
        helpful_votes: { type: 'number', default: 0 },
        total_votes: { type: 'number', default: 0 },
        spam_score: { type: 'number', default: 0, normallyHidden: true },
        helpfulness_score: {
          type: 'number',
          computed: true,
          dependencies: ['helpful_votes', 'total_votes'],
          compute: ({ attributes }) => {
            if (attributes.total_votes === 0) return null
            return Number(((attributes.helpful_votes / attributes.total_votes) * 100).toFixed(0))
          }
        },
        is_helpful: {
          type: 'boolean',
          computed: true,
          dependencies: ['helpful_votes', 'total_votes', 'spam_score'],
          compute: ({ attributes }) => {
            if (attributes.total_votes < 10) return null
            const helpfulnessScore = (attributes.helpful_votes / attributes.total_votes) * 100
            return helpfulnessScore > 70 && attributes.spam_score < 0.5
          }
        },
        calculated_at: {
          type: 'dateTime',
          temporalPrecision: 0,
          computed: true,
          compute: () => new Date('2026-08-25T23:46:02.654Z')
        }
      },
      tableName: 'test_reviews'
    })
    await api.resources.reviews.createKnexTable()
    mapTable(knex, api, 'test_reviews', 'reviews')

    for (const [resource, field, compute] of [
      ['faulty_products', 'bad_compute', () => { throw new Error('Computation failed') }],
      ['failing_async_products', 'failing_async', async () => { throw new Error('Async computation failed') }]
    ]) {
      const tableName = `test_${resource}`
      await api.addResource(resource, {
        schema: {
          id: { type: 'id' },
          value: { type: 'number' },
          [field]: { type: 'string', computed: true, dependencies: ['value'], compute }
        },
        tableName
      })
      await api.resources[resource].createKnexTable()
      mapTable(knex, api, tableName, resource)
    }
  })

  return api
}

/**
 * Creates an API with field getters for testing
 */
export async function createFieldGettersApi (knex, pluginOptions = {}) {
  const api = new Api({
    name: 'field-getters-test-api',
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const tenantId = storageMode.isAnyApi() ? 'field_getters_tenant' : storageMode.defaultTenant
  const previousTenant = storageMode.currentTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  await api.use(RestApiPlugin, {
    format: 'plain',

  })

  await useStoragePlugin(api, knex, { tenantId })

  // Users resource with basic getters
  await api.addResource('users', {
    schema: {
      id: { type: 'id' },
      email: {
        type: 'string',
        nullable: true,
        getter: (value) => value?.toLowerCase().trim()
      },
      name: {
        type: 'string',
        nullable: true,
        getter: (value) => value?.trim()
      },
      phone: {
        type: 'string',
        nullable: true,
        getter: (value) => {
          if (!value) return null
          // Remove all non-digits and format
          const digits = value.replace(/\D/g, '')
          if (digits.length === 10) {
            return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
          }
          return value
        }
      },
      metadata_json: {
        type: 'string',
        nullable: true,
        getter: (value) => {
          if (!value) return {}
          try {
            return JSON.parse(value)
          } catch {
            return {}
          }
        }
      },
      tags_csv: {
        type: 'string',
        nullable: true,
        getter: (value) => {
          if (!value) return []
          return value.split(',').map(t => t.trim()).filter(t => t)
        }
      }
    },
    tableName: 'getter_users'
  })
  await api.resources.users.createKnexTable()
  mapTable(knex, api, 'searchmerge_users', 'users')
  mapTable(knex, api, 'getter_users', 'users')

  // Products resource with getters and computed fields
  await api.addResource('products', {
    schema: {
      id: { type: 'id' },
      name: {
        type: 'string',
        getter: (value) => value?.toUpperCase()
      },
      description: {
        type: 'string',
        getter: (value) => {
          // Truncate long descriptions
          if (!value) return ''
          return value.length > 50 ? value.substring(0, 47) + '...' : value
        }
      },
      price_str: {
        type: 'string',
        getter: (value) => parseFloat(value) || 0
      },
      tax_rate_str: {
        type: 'string',
        getter: (value) => parseFloat(value) || 0
      },
      total_price: {
        type: 'number',
        computed: true,
        dependencies: ['price_str', 'tax_rate_str'],
        compute: ({ attributes }) => {
          // Should see numbers from getters, not strings
          return attributes.price_str * (1 + attributes.tax_rate_str)
        }
      }
    },
    relationships: {
      reviews: { type: 'hasMany', target: 'reviews', foreignKey: 'product_id' }
    },
    tableName: 'getter_products'
  })
  await api.resources.products.createKnexTable()
  mapTable(knex, api, 'getter_products', 'products')

  // Reviews resource with getters
  await api.addResource('reviews', {
    schema: {
      id: { type: 'id' },
      product_id: { type: 'id', belongsTo: 'products', as: 'product' },
      content: {
        type: 'string',
        getter: (value) => `[REVIEW] ${value}`
      },
      rating: { type: 'number' }
    },
    tableName: 'getter_reviews'
  })
  await api.resources.reviews.createKnexTable()
  mapTable(knex, api, 'getter_reviews', 'reviews')

  // Resource with getter dependencies
  await api.addResource('formatted_data', {
    schema: {
      id: { type: 'id' },
      step1: {
        type: 'string',
        nullable: true,
        getter: (value) => value?.trim()
      },
      step2: {
        type: 'string',
        nullable: true,
        getter: (value, { attributes }) => {
          if (!value) return value // Return null/undefined as-is
          // Depends on step1 being trimmed first
          return `${value} [step1: ${attributes.step1}]`
        },
        runGetterAfter: ['step1']
      },
      step3: {
        type: 'string',
        getter: (value, { attributes }) => {
          if (!value) return value // Return null/undefined as-is
          // Depends on step2
          return `${value} [step2: ${attributes.step2}]`
        },
        runGetterAfter: ['step2']
      }
    },
    tableName: 'getter_formatted'
  })
  await api.resources.formatted_data.createKnexTable()
  mapTable(knex, api, 'getter_formatted', 'formatted_data')

  // Async getters example
  await api.addResource('encrypted_data', {
    schema: {
      id: { type: 'id' },
      secret: {
        type: 'string',
        nullable: true,
        getter: async (value) => {
          if (!value) return null
          // Simulate async decryption
          await new Promise(resolve => setTimeout(resolve, 5))
          return Buffer.from(value, 'base64').toString()
        }
      },
      data: {
        type: 'string',
        nullable: true,
        getter: async (value, context) => {
          if (!value) return null
          await new Promise(resolve => setTimeout(resolve, 5))
          const decrypted = Buffer.from(value, 'base64').toString()
          return `[${context.scopeName}] ${decrypted}`
        }
      }
    },
    tableName: 'getter_encrypted'
  })
  await api.resources.encrypted_data.createKnexTable()
  mapTable(knex, api, 'getter_encrypted', 'encrypted_data')

  await api.addResource('error_test', {
    schema: {
      id: { type: 'id' },
      good_field: { type: 'string', getter: value => value?.toUpperCase() },
      bad_field: { type: 'string', getter: () => { throw new Error('Getter failed!') } }
    },
    tableName: 'getter_errors'
  })
  await api.resources.error_test.createKnexTable()
  mapTable(knex, api, 'getter_errors', 'error_test')

  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(previousTenant)
  }

  return api
}

export async function createProjectedFieldsApi (knex, pluginOptions = {}) {
  const api = new Api({
    name: 'projected-fields-test-api',
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const tenantId = storageMode.isAnyApi() ? 'projected_fields_tenant' : storageMode.defaultTenant
  const previousTenant = storageMode.currentTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'first_name', 'last_name'],
    ...pluginOptions['rest-api']
  })
  await api.use(QueryProjectionsPlugin)

  await useStoragePlugin(api, knex, { tenantId })

  await api.addResource('authors', {
    schema: {
      id: { type: 'id' },
      first_name: { type: 'string', required: true, max: 100 },
      last_name: { type: 'string', required: true, max: 100 }
    },
    queryFields: {
      full_name: {
        type: 'string',
        sortable: true,
        select: ({ knex, column }) => knex.raw(
          "trim(coalesce(??, '') || ' ' || coalesce(??, ''))",
          [column('first_name'), column('last_name')]
        )
      },
      sort_name: {
        type: 'string',
        sortable: true,
        normallyHidden: true,
        select: ({ knex, column }) => knex.raw(
          "trim(coalesce(??, '') || ' ' || coalesce(??, ''))",
          [column('first_name'), column('last_name')]
        )
      }
    },
    relationships: {
      books: { type: 'hasMany', target: 'books', foreignKey: 'author_id' }
    },
    sortableFields: ['id', 'first_name', 'last_name'],
    defaultSort: ['full_name'],
    tableName: 'projected_authors'
  })
  await api.resources.authors.createKnexTable()
  mapTable(knex, api, 'projected_authors', 'authors')

  await api.addResource('books', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200 },
      author_id: { type: 'id', required: true, belongsTo: 'authors', as: 'author' }
    },
    tableName: 'projected_books'
  })
  await api.resources.books.createKnexTable()
  mapTable(knex, api, 'projected_books', 'books')

  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(previousTenant)
  }

  return api
}

/**
 * Creates an API with field setters for testing
 */
export async function createFieldSettersApi (knex, pluginOptions = {}) {
  const api = new Api({
    name: 'field-setters-test-api',
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const tenantId = storageMode.isAnyApi() ? 'field_setters_tenant' : storageMode.defaultTenant
  const previousTenant = storageMode.currentTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  await api.use(RestApiPlugin, {
    format: 'plain',
    returning: 'full'
  })

  await useStoragePlugin(api, knex, { tenantId })

  // Users resource with basic setters
  await api.addResource('users', {
    schema: {
      id: { type: 'id' },
      email: {
        type: 'string',
        required: true,
        setter: (value) => value?.toLowerCase().trim()
      },
      username: {
        type: 'string',
        required: true,
        setter: (value) => value?.toLowerCase().replace(/\s+/g, '')
      },
      tags: {
        type: 'string',  // Accepts string, stored as string
        setter: (value) => value  // Pass through
      },
      preferences: {
        type: 'string',  // Accepts string, stored as string
        setter: (value) => value  // Pass through
      }
    },
    tableName: 'setter_users'
  })
  await api.resources.users.createKnexTable()
  mapTable(knex, api, 'setter_users', 'users')

  // Products with type conversion setters
  await api.addResource('products', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      price: {
        type: 'number',
        required: true,
        min: 0,
        setter: (value) => {
          // Convert to cents and round
          return Math.round(value * 100)
        }
      },
      discount_percent: {
        type: 'number',
        min: 0,
        max: 100,
        setter: (value) => Math.round(value)
      },
      metadata: {
        type: 'object',
        setter: (value) => value || {}
      }
    },
    tableName: 'setter_products'
  })
  await api.resources.products.createKnexTable()
  mapTable(knex, api, 'setter_products', 'products')

  // Secure data with async setters
  await api.addResource('secure_data', {
    schema: {
      id: { type: 'id' },
      password: {
        type: 'string',
        required: true,
        min: 8,
        setter: async (value) => {
          // Simulate async password hashing
          await new Promise(resolve => setTimeout(resolve, 5))
          return `hashed:${value}`
        }
      },
      api_key: {
        type: 'string',
        setter: async (value) => {
          if (!value) return null
          // Simulate encryption
          await new Promise(resolve => setTimeout(resolve, 5))
          return Buffer.from(value).toString('base64')
        }
      },
      data: {
        type: 'string',
        setter: async (value) => {
          if (!value) return null
          return Buffer.from(value).toString('base64')
        }
      }
    },
    tableName: 'setter_secure'
  })
  await api.resources.secure_data.createKnexTable()
  mapTable(knex, api, 'setter_secure', 'secure_data')

  // Resource with setter dependencies
  await api.addResource('computed_data', {
    schema: {
      id: { type: 'id' },
      base_value: {
        type: 'number',
        setter: (value) => value || 0
      },
      multiplier: {
        type: 'number',
        setter: (value) => value || 1
      },
      adjustment: {
        type: 'number',
        setter: (value) => value || 0
      },
      calculated_value: {
        type: 'number',
        setter: (value, { attributes }) => {
          // Calculate based on other fields
          return (attributes.base_value || 0) * (attributes.multiplier || 1)
        },
        runSetterAfter: ['base_value', 'multiplier']
      },
      final_value: {
        type: 'number',
        setter: (value, { attributes }) => {
          // Depends on calculated_value
          return (attributes.calculated_value || 0) + (attributes.adjustment || 0)
        },
        runSetterAfter: ['calculated_value', 'adjustment']
      }
    },
    tableName: 'setter_computed'
  })
  await api.resources.computed_data.createKnexTable()
  mapTable(knex, api, 'setter_computed', 'computed_data')

  // Nullable fields handling
  await api.addResource('nullable_data', {
    schema: {
      id: { type: 'id' },
      field1: {
        type: 'string',
        nullable: true,
        setter: (value) => value === undefined ? null : value
      },
      field2: {
        type: 'string',
        nullable: true,
        setter: (value) => value === undefined ? null : value
      },
      field3: {
        type: 'string',
        setter: (value) => value === '' ? 'empty' : value
      },
      field4: {
        type: 'number',
        setter: (value) => value === 0 ? -1 : value
      }
    },
    tableName: 'setter_nullable'
  })
  await api.resources.nullable_data.createKnexTable()
  mapTable(knex, api, 'setter_nullable', 'nullable_data')

  // Validated data
  await api.addResource('validated_data', {
    schema: {
      id: { type: 'id' },
      email: {
        type: 'string',
        required: true,
        format: 'email',
        setter: (value) => value.toLowerCase().trim()
      },
      age: {
        type: 'number',
        min: 0,
        max: 120,
        setter: (value) => value // No transformation, just to verify it's a number
      },
      score: {
        type: 'number',
        min: 0,
        max: 100,
        setter: (value) => Math.ceil(value) // Round up
      }
    },
    tableName: 'setter_validated'
  })
  await api.resources.validated_data.createKnexTable()
  mapTable(knex, api, 'setter_validated', 'validated_data')

  await api.addResource('error_test', {
    schema: {
      id: { type: 'id' },
      good_field: { type: 'string', setter: value => value?.toLowerCase() },
      bad_field: {
        type: 'string',
        setter: () => { throw new Error('Setter failed!') }
      }
    },
    tableName: 'setter_errors'
  })
  await api.resources.error_test.createKnexTable()
  mapTable(knex, api, 'setter_errors', 'error_test')

  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(previousTenant)
  }

  return api
}

export async function createAutoFilterApi (knex, pluginOptions = {}) {
  const { AutoFilterPlugin } = await import('../../plugins/core/rest-api-autofilter-plugin.js')

  const api = new Api({
    name: 'autofilter-test-api',
  })

  const tenantId = storageMode.isAnyApi() ? 'autofilter_tenant' : storageMode.defaultTenant
  const previousTenant = storageMode.currentTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'title', 'name', 'workspace_id', 'user_id']
  })

  await useStoragePlugin(api, knex, { tenantId })

  // Add Express plugin if requested for transport testing
  if (pluginOptions.includeExpress) {
    await api.use(ExpressPlugin, pluginOptions.express || {})
  }

  const autofilterOptions = pluginOptions.autofilter || {}
  const workspaceField = pluginOptions.workspaceField || 'workspace_id'
  const userField = pluginOptions.userField || 'user_id'

  await api.use(AutoFilterPlugin, {
    ...autofilterOptions,
    resolvers: {
      workspace: ({ context }) => context.scopeValues?.workspaceId,
      user: ({ context }) => context.scopeValues?.userId,
      currentProject: ({ context }) => context.scopeValues?.projectId ?? null,
      ...(autofilterOptions.resolvers || {})
    },
    presets: {
      public: { filters: [] },
      workspace: {
        filters: [{ field: workspaceField, resolver: 'workspace' }]
      },
      user: {
        filters: [{ field: userField, resolver: 'user' }]
      },
      workspace_user: {
        filters: [
          { field: workspaceField, resolver: 'workspace' },
          { field: userField, resolver: 'user' }
        ]
      },
      ...(autofilterOptions.presets || {})
    }
  })

  await api.addResource('workspace_reports', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200 },
      workspace_id: { type: 'string', required: true }
    },
    autofilter: 'workspace',
    tableName: 'autofilter_workspace_reports'
  })
  await api.resources.workspace_reports.createKnexTable()
  mapTable(knex, api, 'autofilter_workspace_reports', 'workspace_reports')

  await api.addResource('user_notes', {
    schema: {
      id: { type: 'id' },
      body: { type: 'string', required: true, max: 500 },
      user_id: { type: 'number', required: true }
    },
    autofilter: 'user',
    tableName: 'autofilter_user_notes'
  })
  await api.resources.user_notes.createKnexTable()
  mapTable(knex, api, 'autofilter_user_notes', 'user_notes')

  await api.addResource('projects', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      description: { type: 'string', max: 1000 },
      status: { type: 'string', defaultTo: 'active' },
      workspace_id: { type: 'string', required: true },
      user_id: { type: 'number', required: true }
    },
    relationships: {
      tasks: { type: 'hasMany', target: 'tasks', foreignKey: 'project_id' }
    },
    autofilter: 'workspace_user',
    tableName: 'autofilter_projects'
  })
  await api.resources.projects.createKnexTable()
  mapTable(knex, api, 'autofilter_projects', 'projects')

  await api.addResource('tasks', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200 },
      completed: { type: 'boolean', defaultTo: false },
      project_id: { type: 'number', belongsTo: 'projects', as: 'project' },
      workspace_id: { type: 'string', required: true },
      user_id: { type: 'number', required: true }
    },
    autofilter: 'workspace_user',
    tableName: 'autofilter_tasks'
  })
  await api.resources.tasks.createKnexTable()
  mapTable(knex, api, 'autofilter_tasks', 'tasks')

  await api.addResource('optional_tasks', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200 },
      project_id: { type: 'number', belongsTo: 'projects', as: 'project', nullable: true }
    },
    autofilter: {
      filters: [{ field: 'project_id', resolver: 'currentProject' }]
    },
    tableName: 'autofilter_optional_tasks'
  })
  await api.resources.optional_tasks.createKnexTable()
  mapTable(knex, api, 'autofilter_optional_tasks', 'optional_tasks')

  await api.addResource('system_settings', {
    schema: {
      id: { type: 'id' },
      key: { type: 'string', required: true, unique: true },
      value: { type: 'string', required: true }
    },
    autofilter: 'public',
    tableName: 'autofilter_system_settings'
  })
  await api.resources.system_settings.createKnexTable()
  mapTable(knex, api, 'autofilter_system_settings', 'system_settings')

  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(previousTenant)
  }

  return api
}

export async function createRowPolicyApi (knex, pluginOptions = {}) {
  const api = new Api({
    name: 'row-policy-test-api',
  })

  const tenantId = storageMode.isAnyApi() ? 'row_policy_tenant' : storageMode.defaultTenant
  const previousTenant = storageMode.currentTenant
  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['id', 'name', 'title', 'access_group', 'project_id'],
    ...pluginOptions['rest-api']
  })

  await useStoragePlugin(api, knex, { tenantId })

  const rowPolicyOptions = pluginOptions.rowPolicy || {}
  if (pluginOptions.bulk) {
    const { BulkOperationsPlugin } = await import('../../plugins/core/bulk-operations-plugin.js')
    await api.use(BulkOperationsPlugin)
  }
  if (pluginOptions.connector) {
    await api.use(pluginOptions.connector === 'fastify' ? FastifyPlugin : ExpressPlugin, {
      ...(pluginOptions.connector === 'fastify' ? { app: pluginOptions.app } : {}), mountPath: '/api'
    })
  }
  await api.use(RowPolicyPlugin, {
    ...rowPolicyOptions,
    policies: {
      groupVisibility: ({ query, context, column, value, scopeName, queryPurpose }) => {
        pluginOptions.onPolicy?.({ scopeName, queryPurpose })

        if (context.visibility?.all === true) {
          return true
        }

        const groups = context.visibility?.groups
        if (!Array.isArray(groups) || groups.length === 0) {
          return false
        }

        query.where(function visibilityGrants () {
          this.whereRaw('1 = 0')
          this.orWhere(function groupVisibilityGrant () {
            this.whereIn(
              column('access_group'),
              groups.map((group) => value('access_group', group))
            )
          })
        })
        return true
      },
      ...(rowPolicyOptions.policies || {})
    }
  })

  await api.use(AutoFilterPlugin, {
    resolvers: {
      workspace: ({ context }) => context.scopeValues?.workspaceId
    },
    presets: {
      workspace: {
        filters: [{ field: 'workspace_id', resolver: 'workspace' }]
      }
    }
  })

  await api.addResource('policy_projects', {
    schema: {
      id: { type: 'id', ...(pluginOptions.searchIds ? { search: true } : {}) },
      name: { type: 'string', required: true, max: 200 },
      access_group: { type: 'string', required: true },
      workspace_id: { type: 'string', required: true }
    },
    relationships: {
      tasks: { type: 'hasMany', target: 'policy_tasks', foreignKey: 'project_id' },
      shared_tasks: {
        type: 'manyToMany',
        target: 'policy_tasks',
        through: 'policy_project_tasks',
        foreignKey: 'project_id',
        otherKey: 'task_id'
      },
      ...(pluginOptions.polymorphic
        ? {
            mentions: { type: 'hasMany', target: 'policy_tasks', via: 'subject' }
          }
        : {})
    },
    autofilter: 'workspace',
    rowPolicy: 'groupVisibility',
    tableName: 'row_policy_projects'
  })
  if (pluginOptions.createTables !== false) await api.resources.policy_projects.createKnexTable()
  mapTable(knex, api, 'row_policy_projects', 'policy_projects')

  await api.addResource('policy_tasks', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200, search: true },
      access_group: { type: 'string', required: true },
      workspace_id: { type: 'string', required: true },
      project_id: {
        type: 'number',
        nullable: true,
        belongsTo: 'policy_projects',
        as: 'project',
        search: true
      },
      ...(pluginOptions.polymorphic
        ? {
            subject_id: { type: 'number', nullable: true },
            subject_type: { type: 'string', nullable: true }
          }
        : {})
    },
    relationships: {
      shared_projects: {
        type: 'manyToMany',
        target: 'policy_projects',
        through: 'policy_project_tasks',
        foreignKey: 'task_id',
        otherKey: 'project_id'
      },
      ...(pluginOptions.polymorphic
        ? {
            subject: { belongsToPolymorphic: { types: ['policy_projects', 'policy_tasks'], typeField: 'subject_type', idField: 'subject_id' } }
          }
        : {})
    },
    autofilter: 'workspace',
    rowPolicy: 'groupVisibility',
    tableName: 'row_policy_tasks'
  })
  if (pluginOptions.createTables !== false) await api.resources.policy_tasks.createKnexTable()
  mapTable(knex, api, 'row_policy_tasks', 'policy_tasks')

  await api.addResource('policy_project_tasks', {
    schema: {
      id: { type: 'id' },
      project_id: { type: 'number', required: true, belongsTo: 'policy_projects', as: 'project' },
      task_id: { type: 'number', required: true, belongsTo: 'policy_tasks', as: 'task' }
    },
    tableName: 'row_policy_project_tasks'
  })
  if (pluginOptions.createTables !== false) await api.resources.policy_project_tasks.createKnexTable()
  mapTable(knex, api, 'row_policy_project_tasks', 'policy_project_tasks')

  if (storageMode.isAnyApi()) {
    const projectsDescriptor = await api.anyapi.registry.getDescriptor(tenantId, 'policy_projects')
    const tasksDescriptor = await api.anyapi.registry.getDescriptor(tenantId, 'policy_tasks')
    storageMode.registerLink(
      knex, 'row_policy_project_tasks',
      'policy_projects',
      'shared_tasks',
      projectsDescriptor?.manyToMany?.shared_tasks?.relationship,
      tasksDescriptor?.manyToMany?.shared_projects?.relationship, api.anyapi.tenantId
    )
  }

  await api.addResource('policy_broken', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true }
    },
    rowPolicy: () => undefined,
    tableName: 'row_policy_broken'
  })
  if (pluginOptions.createTables !== false) await api.resources.policy_broken.createKnexTable()
  mapTable(knex, api, 'row_policy_broken', 'policy_broken')

  if (pluginOptions.connector === 'express' && pluginOptions.app) api.http.express.mount(pluginOptions.app)

  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(previousTenant)
  }

  return api
}

export async function seedQueryPolicyApi (api, size) {
  const admin = { visibility: { all: true }, scopeValues: { workspaceId: 'workspace-a' } }
  const viewer = { visibility: { groups: ['group-a'] }, scopeValues: { workspaceId: 'workspace-a' } }
  const post = async (type, attributes, relationships) => (await api.resources[type].post({
    format: 'jsonapi', returning: 'full', inputRecord: { data: { type, attributes, relationships } }
  }, admin)).data
  const project = await post('policy_projects', { name: `Workload ${size}`, access_group: 'group-a' })
  const subject = await post('policy_tasks', { title: 'Task subject', access_group: 'group-a' })
  const linkage = ({ type, id }) => ({ type, id })
  const visible = []
  const hidden = []
  const foreign = []
  for (let index = 0; index < size; index++) {
    for (const [prefix, accessGroup, records] of [
      ['Visible', 'group-a', visible], ['Hidden', 'group-b', hidden], ['Foreign', 'group-a', foreign]
    ]) {
      records.push(await post('policy_tasks', {
        title: `${prefix} ${String(index).padStart(3, '0')}`, access_group: accessGroup
      }, {
        project: { data: linkage(project) },
        subject: { data: linkage(index % 2 === 0 ? project : subject) }
      }))
    }
  }
  await api.resources.policy_projects.postRelationship({
    id: project.id,
    relationshipName: 'shared_tasks',
    relationshipData: [...visible, ...hidden, ...foreign].map(linkage)
  }, admin)
  // Move linked rows after seeding so the viewer must filter existing membership.
  const adapter = api.knex.helpers.getStorageAdapter('policy_tasks')
  await adapter.buildBaseQuery().whereIn(adapter.getIdColumn(), foreign.map(row => row.id)).update({
    [adapter.translateColumn('workspace_id')]: 'workspace-b'
  })
  return { admin, viewer, project, subject, visible, hidden, foreign }
}

export async function seedPolicyConformanceApi (api, { hiddenBy = 'policy' } = {}) {
  const admin = { visibility: { all: true }, scopeValues: { workspaceId: 'workspace-a' } }
  const viewer = { visibility: { groups: ['group-a'] }, scopeValues: { workspaceId: 'workspace-a' } }
  const post = async (type, attributes, relationships) => (await api.resources[type].post({
    format: 'jsonapi', returning: 'full', inputRecord: { data: { type, attributes, ...(relationships ? { relationships } : {}) } }
  }, admin)).data
  const project = await post('policy_projects', { name: 'Visible parent', access_group: 'group-a' })
  const hiddenProject = await post('policy_projects', { name: 'Hidden parent', access_group: 'group-b' })
  const task = await post('policy_tasks', { title: 'Visible task', access_group: 'group-a' }, { project: { data: { type: project.type, id: project.id } } })
  const hiddenTask = await post('policy_tasks', { title: 'Hidden task', access_group: 'group-b' }, { project: { data: { type: project.type, id: project.id } } })
  const hiddenParentTask = await post('policy_tasks', { title: 'Visible task with hidden parent', access_group: 'group-a' }, { project: { data: { type: hiddenProject.type, id: hiddenProject.id } } })
  await api.resources.policy_projects.postRelationship({
    id: project.id,
    relationshipName: 'shared_tasks',
    relationshipData: [task, hiddenTask, hiddenParentTask].map(({ type, id }) => ({ type, id }))
  }, admin)
  if (api.resources.policy_tasks.vars.schemaInfo.schemaRelationships.subject) {
    for (const record of [hiddenTask, hiddenParentTask]) {
      await api.resources.policy_tasks.patch({
        id: record.id,
        inputRecord: { data: { type: record.type, id: record.id, relationships: { subject: { data: { type: hiddenProject.type, id: hiddenProject.id } } } } }
      }, admin)
    }
  }
  if (hiddenBy === 'workspace') {
    for (const record of [hiddenProject, hiddenTask]) {
      const adapter = api.knex.helpers.getStorageAdapter(record.type)
      await adapter.buildBaseQuery().where(adapter.getIdColumn(), record.id).update({
        [adapter.translateColumn('access_group')]: 'group-a',
        [adapter.translateColumn('workspace_id')]: 'workspace-b'
      })
    }
  }
  return { admin, viewer, project, hiddenProject, task, hiddenTask, hiddenParentTask }
}

/**
 * Creates an API with positioning support for testing
 */
export async function createPositioningApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'positioning-test-api'
  const tablePrefix = pluginOptions.tablePrefix || 'positioning'
  const api = new Api({
    name: apiName,
  })

  const restApiOptions = {
    format: 'plain',  // Changed to true to allow simplified API calls in tests
    returning: 'full',
    sortableFields: ['id', 'title', 'name', 'position', 'sort_order', 'category_id', 'project_id', 'status'],
    ...pluginOptions['rest-api']
  }

  await api.use(RestApiPlugin, restApiOptions)
  await useStoragePlugin(api, knex)

  // Categories (for grouping tasks)
  await api.addResource('categories', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 }
    },
    tableName: `${tablePrefix}_categories`
  })
  await api.resources.categories.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_categories`, 'categories')

  // Tasks (main positioning test resource)
  await api.addResource('tasks', {
    schema: {
      id: { type: 'id' },
      title: { type: 'string', required: true, max: 200 },
      category_id: { type: 'number', nullable: true, belongsTo: 'categories', as: 'category', search: true },
      position: { type: 'string', max: 255, nullable: true },
      beforeId: { type: 'string', virtual: true }, // Virtual field for positioning
      deleted_at: { type: 'dateTime', nullable: true, search: true }, // For soft delete tests
      version: { type: 'number', defaultTo: 1, search: true } // For versioning tests
    },
    tableName: `${tablePrefix}_tasks`
  })
  await api.resources.tasks.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_tasks`, 'tasks')

  // Projects (for multi-filter testing)
  await api.addResource('projects', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 100 }
    },
    tableName: `${tablePrefix}_projects`
  })
  await api.resources.projects.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_projects`, 'projects')

  // Items (flexible resource for various positioning tests)
  await api.addResource('items', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200 },
      project_id: { type: 'number', nullable: true, belongsTo: 'projects', as: 'project', search: true },
      status: { type: 'string', defaultTo: 'active', nullable: true, search: true },
      position: { type: 'string', max: 255, nullable: true },
      sort_order: { type: 'string', max: 255, nullable: true }, // Alternative position field
      beforeId: { type: 'string', virtual: true },
      priority: { type: 'string', defaultTo: 'medium', search: true } // For multi-filter tests
    },
    tableName: `${tablePrefix}_items`
  })
  await api.resources.items.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_items`, 'items')

  return api
}

/**
 * Creates an API with custom idProperty for all resources to test idProperty functionality
 * Uses 'custom_id_' prefix for all tables to avoid conflicts
 */
export async function createCustomIdPropertyApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'custom-id-test-api'
  const tablePrefix = pluginOptions.tablePrefix || 'custom_id'
  const api = new Api({
    name: apiName,
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const restApiOptions = {
    format: 'jsonapi',
    returning: 'full',
    sortableFields: ['country_id', 'publisher_id', 'author_id', 'book_id', 'title', 'name', 'code'],
    ...pluginOptions['rest-api']  // Merge any custom options for rest-api plugin
  }

  await api.use(RestApiPlugin, restApiOptions)
  await useStoragePlugin(api, knex)

  // Countries table with custom idProperty
  await api.addResource('countries', {
    schema: {
      // NO id: { type: 'id' } - this is key!
      name: { type: 'string', required: true, max: 100, search: true },
      code: { type: 'string', max: 2, unique: true }
    },
    relationships: {
      publishers: { type: 'hasMany', target: 'publishers', foreignKey: 'country_id' },
      books: { type: 'hasMany', target: 'books', foreignKey: 'country_id' }
    },
    tableName: `${tablePrefix}_countries`,
    idProperty: 'country_id'  // Custom ID property
  })
  await api.resources.countries.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_countries`, 'countries')

  // Publishers table with custom idProperty
  await api.addResource('publishers', {
    schema: {
      name: { type: 'string', required: true, max: 200 },
      country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
    },
    relationships: {
      books: { type: 'hasMany', target: 'books', foreignKey: 'publisher_id' },
      reviews: {
        type: 'hasMany',
        target: 'reviews',
        via: 'reviewable'
      }
    },
    tableName: `${tablePrefix}_publishers`,
    idProperty: 'publisher_id'
  })
  await api.resources.publishers.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_publishers`, 'publishers')

  // Authors table with custom idProperty
  await api.addResource('authors', {
    schema: {
      name: { type: 'string', required: true, max: 200 },
      biography: { type: 'string', max: 5000 },
      country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
    },
    relationships: {
      books: { type: 'manyToMany', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' },
      reviews: {
        type: 'hasMany',
        target: 'reviews',
        via: 'reviewable'
      }
    },
    tableName: `${tablePrefix}_authors`,
    idProperty: 'author_id'
  })
  await api.resources.authors.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_authors`, 'authors')

  // Books table with custom idProperty
  await api.addResource('books', {
    schema: {
      title: { type: 'string', required: true, max: 300, search: true },
      isbn: { type: 'string', max: 13 },
      pages: { type: 'number' },
      published_date: { type: 'date' },
      country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country', search: true },
      publisher_id: { type: 'number', nullable: true, belongsTo: 'publishers', as: 'publisher', search: true }
    },
    relationships: {
      authors: { type: 'manyToMany', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' },
      reviews: {
        type: 'hasMany',
        target: 'reviews',
        via: 'reviewable'
      }
    },
    tableName: `${tablePrefix}_books`,
    idProperty: 'book_id'
  })
  await api.resources.books.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_books`, 'books')

  // Book-Authors pivot table with custom idProperty
  await api.addResource('book_authors', {
    schema: {
      book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
      author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
      contribution_type: { type: 'string', max: 50 },
      order: { type: 'number' }
    },
    tableName: `${tablePrefix}_book_authors`,
    idProperty: 'book_author_id'
  })
  await api.resources.book_authors.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_book_authors`, 'book_authors')

  // Polymorphic reviews with custom idProperty
  await api.addResource('reviews', {
    schema: {
      rating: { type: 'number', required: true, min: 1, max: 5 },
      title: { type: 'string', max: 200 },
      content: { type: 'string', required: true, max: 5000 },
      reviewer_name: { type: 'string', required: true, max: 100 },
      review_date: { type: 'dateTime', temporalPrecision: 3, defaultTo: () => new Date().toISOString() },
      reviewable_type: { type: 'string', required: true, search: true },
      reviewable_id: { type: 'number', required: true }
    },
    relationships: {
      reviewable: {
        belongsToPolymorphic: {
          types: ['books', 'authors', 'publishers'],
          typeField: 'reviewable_type',
          idField: 'reviewable_id'
        }
      }
    },
    tableName: `${tablePrefix}_reviews`,
    idProperty: 'review_id'
  })
  await api.resources.reviews.createKnexTable()
  mapTable(knex, api, `${tablePrefix}_reviews`, 'reviews')

  if (storageMode.isAnyApi()) {
    const tenant = api.anyapi.tenantId
    const booksDescriptor = await api.anyapi.registry.getDescriptor(tenant, 'books')
    const authorsDescriptor = await api.anyapi.registry.getDescriptor(tenant, 'authors')
    const relationshipKey = booksDescriptor?.manyToMany?.authors?.relationship
    const inverseRelationshipKey = authorsDescriptor?.manyToMany?.books?.relationship
    storageMode.registerLink(
      knex, `${tablePrefix}_book_authors`,
      'books',
      'authors',
      relationshipKey,
      inverseRelationshipKey, api.anyapi.tenantId
    )
  }

  return api
}

/**
 * Creates an API configuration for multi-field cursor pagination testing
 * Uses 'cursor_' prefix for all tables to avoid conflicts
 */
export async function createCursorPaginationApi (knex) {
  const api = new Api({
    name: 'cursor-pagination-test-api',
  })

  const restApiOptions = {
    format: 'jsonapi',
    responseFormat: {
      post: 'full',
      put: 'full',
      patch: 'minimal'
    },
    sortableFields: ['id', 'name', 'category', 'brand', 'price', 'sku', 'createdAt', 'code', 'status', 'type'],
    queryDefaultLimit: 20,
    queryMaxLimit: 100,
    returnBasePath: 'https://api.example.com'
  }

  await api.use(RestApiPlugin, restApiOptions)
  await useStoragePlugin(api, knex)

  // Create products table with fields suitable for multi-field sorting
  await api.addResource('products', {
    schema: {
      id: { type: 'id' },
      name: { type: 'string', required: true, max: 200, search: true },
      category: { type: 'string', required: true, max: 100, search: true, indexed: true },
      brand: { type: 'string', required: true, max: 100, search: true, indexed: true },
      price: { type: 'number', required: true },
      sku: { type: 'string', required: true, max: 50, unique: true },
      status: { type: 'string', max: 50, default: 'active' },
      createdAt: { type: 'dateTime', temporalPrecision: 3, defaultTo: () => new Date().toISOString() }
    },
    tableName: 'cursor_products'
  })
  await api.resources.products.createKnexTable()
  mapTable(knex, api, 'cursor_products', 'products')

  // Create items table with custom ID property
  await api.addResource('items', {
    schema: {
      item_id: { type: 'id' },
      code: { type: 'string', required: true, max: 10, unique: true },
      name: { type: 'string', required: true, max: 200 },
      category: { type: 'string', required: true, max: 100 },
      type: { type: 'string', required: true, max: 50 }
    },
    idProperty: 'item_id',
    tableName: 'cursor_items'
  })
  await api.resources.items.createKnexTable()
  mapTable(knex, api, 'cursor_items', 'items')

  return api
}

/**
 * Creates an API configuration for testing virtual fields validation
 */
export async function createVirtualFieldsApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'virtual-fields-test-api'
  const api = new Api({
    name: apiName,
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const restApiOptions = {
    format: 'jsonapi',
    returning: 'full',
    ...pluginOptions['rest-api']
  }

  await api.use(RestApiPlugin, restApiOptions)
  await useStoragePlugin(api, knex)

  // Add a test resource with virtual fields
  await api.addResource('users', {
    schema: {
      // Regular fields
      username: { type: 'string', required: true },
      email: { type: 'string', required: true },
      age: { type: 'number' },

      // Virtual fields with validation rules
      password: { type: 'string', virtual: true, minLength: 8 },
      passwordConfirmation: { type: 'string', virtual: true, minLength: 8 },
      termsAccepted: { type: 'boolean', virtual: true, required: true },
      captchaScore: { type: 'number', virtual: true, min: 0, max: 1 },
      tags: { type: 'array', virtual: true },
      metadata: { type: 'object', virtual: true }
    },
    tableName: 'virtual_users'
  })

  await api.resources.users.createKnexTable()
  mapTable(knex, api, 'virtual_users', 'users')

  return api
}

/**
 * Creates an API configuration for testing searchSchema merge behavior.
 * Shared suites assert merge/validation behavior across storage backends;
 * backend-specific execution cases live in storage-specific tests.
 */
export async function createSearchSchemaMergeApi (knex, pluginOptions = {}) {
  const api = new Api({
    name: 'searchschema-merge-test-api',
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  await api.use(RestApiPlugin, {
    format: 'jsonapi',
    returning: 'full',
    ...pluginOptions['rest-api']
  })

  await useStoragePlugin(api, knex)

  if (pluginOptions.hooks) await api.customize({ hooks: pluginOptions.hooks })

  // Test resource with both search:true and searchSchema
  await api.addResource('products', {
    schema: {
      name: { type: 'string', search: true },        // Should be added to searchSchema
      description: { type: 'string', search: true }, // Should be added to searchSchema
      price: { type: 'number', search: true },       // Should be overridden by searchSchema
      category: { type: 'number' },               // Not searchable
      sku: { type: 'string', search: true },         // Should be added to searchSchema
      status: { type: 'string' }                     // Not searchable but added via searchSchema
    },
    searchSchema: {
      // This should override the price field from search:true
      // 'between' operator requires array type for validation [min, max]
      price: {
        type: 'array',
        filterOperator: 'between'
      },
      // Arbitrary public filter name that searches across multiple fields.
      // The key `term` is part of the API contract even though there is no `term` column.
      term: {
        type: 'string',
        oneOf: ['name', 'description'],
        filterOperator: 'like'
      },
      // This is a virtual field
      category_name: {
        type: 'string',
        actualField: 'category.name',
        filterOperator: 'like'
      },
      // Arbitrary public filter name with fully custom server-side meaning.
      // The Knex query layer decides what `availability` means.
      availability: {
        type: 'boolean',
        applyFilter: (query, input, { column, value }) => {
          query.where(column('status'), value('status', input ? 'active' : 'inactive'))
        }
      },
      // This is an explicit field not marked with search:true
      // 'in' operator requires array type for validation
      status: {
        type: 'array',
        filterOperator: 'in'
      }
    },
    tableName: 'searchmerge_products'
  })
  await api.resources.products.createKnexTable()
  mapTable(knex, api, 'searchmerge_products', 'products')

  // Test resource with only search:true fields
  await api.addResource('users', {
    schema: {
      username: { type: 'string', search: true },
      email: { type: 'string', search: true },
      age: { type: 'number' },
      bio: { type: 'string', search: { filterOperator: 'like' } }
    },
    tableName: 'searchmerge_users'
  })
  await api.resources.users.createKnexTable()
  mapTable(knex, api, 'searchmerge_users', 'users')

  // Test resource with only explicit searchSchema
  await api.addResource('orders', {
    schema: {
      order_number: { type: 'string' },
      total: { type: 'number' },
      status: { type: 'string' }
    },
    searchSchema: {
      order_number: { type: 'string', filterOperator: '=' },
      status: { type: 'array', filterOperator: 'in' }  // 'in' operator requires array type
    },
    tableName: 'searchmerge_orders'
  })
  await api.resources.orders.createKnexTable()
  mapTable(knex, api, 'searchmerge_orders', 'orders')

  return api
}

export async function createFileUploadApi (knex, pluginOptions = {}) {
  const apiName = pluginOptions.apiName || 'file-upload-test-api'
  const tableName = pluginOptions.tableName || 'file_documents'
  const tablePrefix = pluginOptions.tablePrefix || 'file'
  const storage = pluginOptions.storage
  const detectorState = pluginOptions.detectorState || { payload: null }

  if (!storage) {
    throw new Error('createFileUploadApi requires a storage adapter')
  }

  const api = new Api({
    name: apiName,
    log: { level: process.env.LOG_LEVEL || 'info' }
  })

  const previousTenant = storageMode.currentTenant
  const tenantId = storageMode.isAnyApi()
    ? (pluginOptions.tenantId || `${tablePrefix}_tenant`)
    : storageMode.defaultTenant

  if (storageMode.isAnyApi()) {
    storageMode.setCurrentTenant(tenantId)
  }

  try {
    await api.use(RestApiPlugin, {
      format: 'jsonapi',
      returning: 'full',
      sortableFields: ['id', 'title'],
      ...pluginOptions['rest-api']
    })
    await useStoragePlugin(api, knex, { tenantId })
    if (pluginOptions.hooks) await api.customize({ hooks: pluginOptions.hooks })
    await api.use(FileHandlingPlugin)
    if (pluginOptions.bulk) {
      const { BulkOperationsPlugin } = await import('../../plugins/core/bulk-operations-plugin.js')
      await api.use(BulkOperationsPlugin)
    }

    if (pluginOptions.app) {
      await api.use(ExpressPlugin, {
        mountPath: '/api',
        fileParser: pluginOptions.fileParser,
        fileParserOptions: pluginOptions.fileParserOptions
      })
      api.http.express.mount(pluginOptions.app)
    } else {
      api.rest.registerFileDetector({
        name: 'test-file-detector',
        detect: () => Boolean(detectorState.payload),
        parse: async () => detectorState.payload
      })
    }

    await api.addResource('documents', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true },
        ...Object.fromEntries((pluginOptions.fileFields || ['attachment']).map(field => [field, {
          type: 'file',
          storage,
          accepts: pluginOptions.fileAccepts || ['image/png'],
          required: pluginOptions.fileRequired ?? false,
          maxSize: pluginOptions.fileMaxSize ?? '1mb'
        }])),
        ...(pluginOptions.versioned ? { revision: { type: 'string', required: true } } : {})
      },
      ...(pluginOptions.versioned ? { versionField: 'revision' } : {}),
      ...(pluginOptions.withNotes
        ? {
            relationships: {
              notes: { type: 'hasMany', target: 'notes', foreignKey: 'document_id' }
            }
          }
        : {}),
      tableName
    })
    await api.resources.documents.createKnexTable()
    mapTable(knex, api, tableName, 'documents')

    if (pluginOptions.withNotes) {
      await api.addResource('notes', {
        schema: {
          id: { type: 'id' },
          text: { type: 'string', required: true },
          document_id: { type: 'number', nullable: true, belongsTo: 'documents', as: 'document' }
        },
        tableName: `${tablePrefix}_notes`
      })
      await api.resources.notes.createKnexTable()
      mapTable(knex, api, `${tablePrefix}_notes`, 'notes')
    }

    return api
  } finally {
    if (storageMode.isAnyApi()) {
      storageMode.setCurrentTenant(previousTenant)
    }
  }
}
