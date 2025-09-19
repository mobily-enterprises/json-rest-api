import { ensureAnyApiSchema } from '../anyapi/schema-utils.js';
import { YouapiRegistry } from '../anyapi/youapi-registry.js';
import { RestApiValidationError } from '../../lib/rest-api-errors.js';
import {
  DEFAULT_QUERY_LIMIT,
  DEFAULT_MAX_QUERY_LIMIT,
} from './lib/querying-writing/knex-constants.js';
import {
  calculatePaginationMeta,
  generatePaginationLinks,
  generateCursorPaginationLinks,
  buildCursorMeta,
  parseCursor,
} from './lib/querying/knex-pagination-helpers.js';
import { getUrlPrefix, buildResourceUrl } from './lib/querying/url-helpers.js';
import {
  normalizeId,
  resolveFieldInfo,
  coerceValueForDefinition,
} from '../anyapi/utils/descriptor-helpers.js';
import {
  YouapiQueryAdapter,
  preloadRelatedDescriptors,
} from '../anyapi/query/youapi-query-adapter.js';

const DEFAULT_TENANT = 'default';
const LINKS_TABLE = 'any_links';

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

    const getRequestedFieldsForType = (context, resourceType) => {
      if (!context?.queryParams?.fields) return null;
      const fieldParam = context.queryParams.fields[resourceType];
      if (!fieldParam) return null;
      if (Array.isArray(fieldParam)) {
        return fieldParam.map((field) => field.trim()).filter((field) => field);
      }
      return String(fieldParam)
        .split(',')
        .map((field) => field.trim())
        .filter((field) => field);
    };

    const applySparseFieldsetToResource = (resource, context) => {
      if (!resource?.attributes) return;
      const requested = getRequestedFieldsForType(context, resource.type);
      if (!requested || requested.length === 0) return;

      const filtered = {};
      for (const field of requested) {
        if (Object.prototype.hasOwnProperty.call(resource.attributes, field)) {
          filtered[field] = resource.attributes[field];
        }
      }
      resource.attributes = filtered;
    };

    const applySortingToQuery = ({ query, sort, descriptor, scope }) => {
      let sortList = Array.isArray(sort) ? sort : (sort ? [sort] : []);

      if (sortList.length === 0 && scope?.vars?.defaultSort) {
        const defaultSort = scope.vars.defaultSort;
        if (Array.isArray(defaultSort)) {
          sortList = defaultSort;
        } else if (typeof defaultSort === 'string') {
          sortList = [defaultSort];
        } else if (defaultSort && typeof defaultSort === 'object') {
          const field = defaultSort.field || defaultSort.column || 'id';
          const direction = (defaultSort.direction || '').toLowerCase() === 'desc' ? '-' : '';
          sortList = [`${direction}${field}`];
        }
      }

      const effectiveSort = sortList.length > 0 ? sortList : ['id'];
      const descriptors = [];

      for (const entry of effectiveSort) {
        const desc = typeof entry === 'string' && entry.startsWith('-');
        const field = typeof entry === 'string' ? (desc ? entry.slice(1) : entry) : entry;
        const fieldInfo = resolveFieldInfo(descriptor, field);
        if (!fieldInfo?.column) continue;
        query.orderBy(fieldInfo.column, desc ? 'desc' : 'asc');
        descriptors.push({
          field,
          column: fieldInfo.column,
          direction: desc ? 'desc' : 'asc',
          definition: fieldInfo.definition || null,
          isRelationship: fieldInfo.isRelationship || false,
        });
      }

      if (descriptors.length === 0) {
        descriptors.push({
          field: 'id',
          column: 'id',
          direction: 'asc',
          definition: { type: 'id' },
          isRelationship: false,
        });
      }

      return descriptors;
    };

    const buildQueryString = (queryParams = {}) => {
      const buildParts = (prefix, value) => {
        const parts = [];
        if (Array.isArray(value)) {
          if (value.length === 0) return parts;
          parts.push(`${prefix}=${value.map((item) => encodeURIComponent(item)).join(',')}`);
          return parts;
        }
        if (value && typeof value === 'object') {
          for (const [key, subValue] of Object.entries(value)) {
            if (subValue === undefined || subValue === null) continue;
            const newPrefix = `${prefix}[${key}]`;
            parts.push(...buildParts(newPrefix, subValue));
          }
          return parts;
        }
        if (value === undefined || value === null) return parts;
        parts.push(`${prefix}=${encodeURIComponent(value)}`);
        return parts;
      };

      const parts = [];
      for (const [key, value] of Object.entries(queryParams)) {
        parts.push(...buildParts(key, value));
      }
      return parts.length > 0 ? `?${parts.join('&')}` : '';
    };

    const applyPaginationToQuery = ({
      query,
      scope,
      queryParams,
      sortDescriptors,
    }) => {
      const pageParams = queryParams?.page || {};
      const scopeVars = scope?.vars || {};
      const defaultLimit = scopeVars.queryDefaultLimit || DEFAULT_QUERY_LIMIT;
      const maxLimit = scopeVars.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT;

      const descriptors = (sortDescriptors && sortDescriptors.length > 0)
        ? sortDescriptors
        : [{
            field: 'id',
            column: 'id',
            direction: 'asc',
            definition: { type: 'id' },
            isRelationship: false,
          }];

      const hasCursorParam = pageParams.after !== undefined || pageParams.before !== undefined;
      const hasPageSize = pageParams.size !== undefined;
      const hasPageNumber = pageParams.number !== undefined;

      const parseCursorOrThrow = (rawCursor, paramName) => {
        try {
          return parseCursor(rawCursor);
        } catch (error) {
          throw new RestApiValidationError(
            `Invalid cursor format in ${paramName} parameter`,
            {
              fields: [`page.${paramName}`],
              violations: [{
                field: `page.${paramName}`,
                rule: 'invalid_cursor',
                message: error.message,
              }],
            },
          );
        }
      };

      const coerceCursorValues = (cursorMap) => {
        const typed = {};
        for (const descriptor of descriptors) {
          if (descriptor.field === undefined) continue;
          const raw = cursorMap[descriptor.field];
          if (raw === undefined) continue;
          typed[descriptor.field] = coerceValueForDefinition(
            raw,
            descriptor.definition,
            { isRelationship: descriptor.isRelationship },
          );
        }
        return typed;
      };

      const buildCursorPredicate = (cursorValues, operatorSelector) => {
        query.where(function cursorWhere() {
          descriptors.forEach((descriptor, index) => {
            const value = cursorValues[descriptor.field];
            if (value === undefined) return;

            this.orWhere(function singleLevel() {
              for (let i = 0; i < index; i += 1) {
                const prev = descriptors[i];
                const prevValue = cursorValues[prev.field];
                if (prevValue === undefined) return;
                this.where(prev.column, prevValue);
              }

              const operator = operatorSelector(descriptor.direction);
              this.where(descriptor.column, operator, value);
            });
          });
        });
      };

      const ensurePageSize = () => {
        const requestedSize = Number(pageParams.size ?? defaultLimit);
        if (!Number.isFinite(requestedSize) || requestedSize <= 0) {
          throw new RestApiValidationError('Page size must be greater than 0', {
            fields: ['page.size'],
            violations: [{
              field: 'page.size',
              rule: 'min_value',
              message: 'Page size must be a positive number',
            }],
          });
        }
        return Math.min(Math.trunc(requestedSize), maxLimit);
      };

      if (hasCursorParam || (hasPageSize && !hasPageNumber)) {
        if (pageParams.after && pageParams.before) {
          throw new RestApiValidationError(
            'page[after] and page[before] cannot be used together',
            {
              fields: ['page.after', 'page.before'],
              violations: [{
                field: 'page.after',
                rule: 'conflict',
                message: 'Provide either page[after] or page[before], not both',
              }],
            },
          );
        }

        const pageSize = ensurePageSize();
        query.limit(pageSize + 1);

        if (pageParams.after) {
          const cursorMap = parseCursorOrThrow(pageParams.after, 'after');
          const cursorValues = coerceCursorValues(cursorMap);
          buildCursorPredicate(cursorValues, (direction) => (direction === 'desc' ? '<' : '>'));
        } else if (pageParams.before) {
          const cursorMap = parseCursorOrThrow(pageParams.before, 'before');
          const cursorValues = coerceCursorValues(cursorMap);
          buildCursorPredicate(cursorValues, (direction) => (direction === 'desc' ? '>' : '<'));
        }

        return {
          mode: 'cursor',
          pageSize,
          sortDescriptors: descriptors,
        };
      }

      if (hasPageSize || hasPageNumber) {
        const pageSize = ensurePageSize();
        const pageNumber = Math.trunc(Number(pageParams.number ?? 1));
        const safePageNumber = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;
        const offset = (safePageNumber - 1) * pageSize;

        query.limit(pageSize).offset(offset);

        return {
          mode: 'offset',
          page: safePageNumber,
          pageSize,
          sortDescriptors: descriptors,
        };
      }

      query.limit(defaultLimit);
      return {
        mode: 'default',
        page: 1,
        pageSize: defaultLimit,
        sortDescriptors: descriptors,
      };
    };

    const canonicalizeLinkPair = ({
      tenantId,
      relationshipKey,
      inverseRelationshipKey,
      leftResource,
      leftId,
      rightResource,
      rightId,
    }) => {
      const normalizedLeftId = normalizeId(leftId);
      const normalizedRightId = normalizeId(rightId);

      if (normalizedLeftId == null || normalizedRightId == null) {
        return null;
      }

      if (inverseRelationshipKey && inverseRelationshipKey < relationshipKey) {
        return {
          tenant_id: tenantId,
          relationship: inverseRelationshipKey,
          inverse_relationship: relationshipKey,
          left_resource: rightResource,
          left_id: normalizedRightId,
          right_resource: leftResource,
          right_id: normalizedLeftId,
        };
      }

      return {
        tenant_id: tenantId,
        relationship: relationshipKey,
        inverse_relationship: inverseRelationshipKey || null,
        left_resource: leftResource,
        left_id: normalizedLeftId,
        right_resource: rightResource,
        right_id: normalizedRightId,
      };
    };

    const buildLinkIdentity = (canonicalRow) => ({
      tenant_id: canonicalRow.tenant_id,
      relationship: canonicalRow.relationship,
      left_resource: canonicalRow.left_resource,
      left_id: canonicalRow.left_id,
      right_resource: canonicalRow.right_resource,
      right_id: canonicalRow.right_id,
    });

    const findInverseManyToMany = async ({ descriptor, relInfo }) => {
      if (!relInfo?.target) return null;

      let targetDescriptor;
      try {
        targetDescriptor = await getDescriptor(relInfo.target);
      } catch (error) {
        return null;
      }

      const entries = Object.entries(targetDescriptor.manyToMany || {});
      for (const [candidateName, candidateInfo] of entries) {
        const candidateTarget = candidateInfo.target || descriptor.resource;
        if (candidateTarget !== descriptor.resource) continue;

        if (relInfo.through && candidateInfo.through && relInfo.through !== candidateInfo.through) {
          continue;
        }

        if (
          relInfo.foreignKey && relInfo.otherKey &&
          candidateInfo.foreignKey && candidateInfo.otherKey
        ) {
          const foreignMatches = relInfo.foreignKey === candidateInfo.otherKey;
          const otherMatches = relInfo.otherKey === candidateInfo.foreignKey;
          if (!foreignMatches || !otherMatches) continue;
        }

        const relationshipKey = candidateInfo.relationship
          || `${targetDescriptor.tenant}:${targetDescriptor.resource}:${candidateName}`;

        return {
          descriptor: targetDescriptor,
          relName: candidateName,
          relInfo: candidateInfo,
          relationshipKey,
        };
      }

      return null;
    };

    const getManyToManyInfo = async (scopeName, relName) => {
      const descriptor = await getDescriptor(scopeName);
      const relInfo = descriptor.manyToMany?.[relName];
      if (!relInfo) return null;
      const relationshipKey = relInfo.relationship || `${descriptor.tenant}:${descriptor.resource}:${relName}`;
      const inverse = await findInverseManyToMany({ descriptor, relInfo });
      const inverseRelationshipKey = inverse?.relationshipKey || null;
      return { descriptor, relInfo, relationshipKey, inverseRelationshipKey };
    };

    const loadLinkRowsForResource = async ({ descriptor, relationshipKey, resourceId, db }) => {
      const ownerId = normalizeId(resourceId);
      if (ownerId == null) return new Map();

      const rows = await db(LINKS_TABLE)
        .where('tenant_id', descriptor.tenant)
        .andWhere((builder) => {
          builder
            .where((q) => {
              q.where('relationship', relationshipKey)
                .andWhere('left_resource', descriptor.resource)
                .andWhere('left_id', ownerId);
            })
            .orWhere((q) => {
              q.where('inverse_relationship', relationshipKey)
                .andWhere('right_resource', descriptor.resource)
                .andWhere('right_id', ownerId);
            });
        })
        .select('id', 'relationship', 'inverse_relationship', 'left_resource', 'left_id', 'right_resource', 'right_id');

      const map = new Map();

      for (const row of rows) {
        let relatedResource;
        let relatedId;
        let otherKey = null;

        if (row.relationship === relationshipKey && row.left_resource === descriptor.resource) {
          relatedResource = row.right_resource;
          relatedId = normalizeId(row.right_id);
          otherKey = row.inverse_relationship || null;
        } else if (row.inverse_relationship === relationshipKey && row.right_resource === descriptor.resource) {
          relatedResource = row.left_resource;
          relatedId = normalizeId(row.left_id);
          otherKey = row.relationship || null;
        } else {
          continue;
        }

        if (relatedId == null) continue;

        const canonical = canonicalizeLinkPair({
          tenantId: descriptor.tenant,
          relationshipKey,
          inverseRelationshipKey: otherKey,
          leftResource: descriptor.resource,
          leftId: ownerId,
          rightResource: relatedResource,
          rightId: relatedId,
        });

        if (!canonical) continue;

        map.set(relatedId, {
          rowId: row.id,
          relatedResource,
          canonical,
          otherKey,
        });
      }

      return map;
    };

    const fetchLinksForParents = async ({ descriptor, relationshipKey, parentIds, db }) => {
      const normalizedIds = parentIds
        .map((id) => normalizeId(id))
        .filter((id) => id !== null);

      if (normalizedIds.length === 0) return [];

      const rows = await db(LINKS_TABLE)
        .where('tenant_id', descriptor.tenant)
        .andWhere((builder) => {
          builder
            .where((q) => {
              q.where('relationship', relationshipKey)
                .andWhere('left_resource', descriptor.resource)
                .whereIn('left_id', normalizedIds);
            })
            .orWhere((q) => {
              q.where('inverse_relationship', relationshipKey)
                .andWhere('right_resource', descriptor.resource)
                .whereIn('right_id', normalizedIds);
            });
        })
        .select('relationship', 'inverse_relationship', 'left_resource', 'left_id', 'right_resource', 'right_id');

      const results = [];

      for (const row of rows) {
        let parentId;
        let childId;
        let childType;

        if (row.relationship === relationshipKey && row.left_resource === descriptor.resource) {
          parentId = normalizeId(row.left_id);
          childId = normalizeId(row.right_id);
          childType = row.right_resource;
        } else if (row.inverse_relationship === relationshipKey && row.right_resource === descriptor.resource) {
          parentId = normalizeId(row.right_id);
          childId = normalizeId(row.left_id);
          childType = row.left_resource;
        } else {
          continue;
        }

        if (parentId == null || childId == null) continue;

        results.push({ parentId, childId, childType });
      }

      return results;
    };

    const ensureTargetsExist = async ({ relInfo, relData, transaction }) => {
      const relArray = Array.isArray(relData) ? relData : [];
      if (relArray.length === 0) return;
      const targetScope = api.resources[relInfo.target];
      if (!targetScope) {
        throw new Error(`Target resource '${relInfo.target}' not found`);
      }
      for (const identifier of relArray) {
        if (!identifier?.id) {
          throw new Error('Relationship data requires resource identifier with id');
        }
        if (identifier.type && identifier.type !== relInfo.target) {
          throw new Error(`Relationship expects type '${relInfo.target}' but received '${identifier.type}'`);
        }
        await targetScope.get({ id: identifier.id, transaction, simplified: false });
      }
    };

    const attachLinks = async ({ descriptor, relInfo, relationshipKey, inverseRelationshipKey, leftId, relData, db }) => {
      const relArray = Array.isArray(relData) ? relData : [];
      if (relArray.length === 0) return;

      for (const identifier of relArray) {
        const rightId = normalizeId(identifier.id);
        if (rightId == null) continue;

        const canonical = canonicalizeLinkPair({
          tenantId: descriptor.tenant,
          relationshipKey,
          inverseRelationshipKey,
          leftResource: descriptor.resource,
          leftId,
          rightResource: relInfo.target,
          rightId,
        });

        if (!canonical) continue;

        const identity = buildLinkIdentity(canonical);

        const existing = await db(LINKS_TABLE)
          .where(identity)
          .first();

        if (existing) {
          if (!existing.inverse_relationship && canonical.inverse_relationship) {
            await db(LINKS_TABLE)
              .where({ id: existing.id })
              .update({
                inverse_relationship: canonical.inverse_relationship,
                updated_at: db.fn.now(),
              });
          }
          continue;
        }

        await db(LINKS_TABLE).insert({
          ...canonical,
          payload: null,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
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
          inverseRelationshipKey: info.inverseRelationshipKey,
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
            inverseRelationshipKey: info.inverseRelationshipKey,
            leftId,
            relData,
            db,
          });
        } else {
          await attachLinks({
            descriptor: info.descriptor,
            relInfo: info.relInfo,
            relationshipKey: info.relationshipKey,
            inverseRelationshipKey: info.inverseRelationshipKey,
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
          inverseRelationshipKey: info.inverseRelationshipKey,
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
          inverseRelationshipKey: info.inverseRelationshipKey,
          leftId,
          db,
        });
      },
      fetchManyToManyRows: async ({ scopeName, relName, parentIds, context }) => {
        const info = await getManyToManyInfo(scopeName, relName);
        if (!info) return [];
        const db = context.db || context.transaction || api.knex.instance;
        return fetchLinksForParents({
          descriptor: info.descriptor,
          relationshipKey: info.relationshipKey,
          parentIds,
          db,
        });
      },
    };

    const syncLinks = async ({ descriptor, relInfo, relationshipKey, inverseRelationshipKey, leftId, relData, db }) => {
      const relArray = Array.isArray(relData) ? relData : [];
      const existingMap = await loadLinkRowsForResource({
        descriptor,
        relationshipKey,
        resourceId: leftId,
        db,
      });

      const desired = new Set(
        relArray
          .map((identifier) => normalizeId(identifier.id))
          .filter((id) => id !== null),
      );

      const existingIds = new Set(existingMap.keys());

      const toAdd = [...desired].filter((id) => !existingIds.has(id));
      const toRemove = [...existingIds].filter((id) => !desired.has(id));

      if (toAdd.length > 0) {
        const data = toAdd.map((id) => ({ id }));
        await attachLinks({
          descriptor,
          relInfo,
          relationshipKey,
          inverseRelationshipKey,
          leftId,
          relData: data,
          db,
        });
      }

      if (toRemove.length > 0) {
        for (const id of toRemove) {
          const entry = existingMap.get(id);
          if (!entry?.canonical) continue;
          await db(LINKS_TABLE)
            .where(buildLinkIdentity(entry.canonical))
            .delete();
        }
      }
    };

    const removeLinks = async ({ descriptor, relInfo, relationshipKey, inverseRelationshipKey, leftId, relData, db }) => {
      const relArray = Array.isArray(relData) ? relData : [];
      if (relArray.length === 0) return;

      const existingMap = await loadLinkRowsForResource({
        descriptor,
        relationshipKey,
        resourceId: leftId,
        db,
      });

      for (const identifier of relArray) {
        const relatedId = normalizeId(identifier.id);
        if (relatedId == null) continue;

        const entry = existingMap.get(relatedId);
        if (entry?.canonical) {
          await db(LINKS_TABLE)
            .where(buildLinkIdentity(entry.canonical))
            .delete();
          continue;
        }

        const canonical = canonicalizeLinkPair({
          tenantId: descriptor.tenant,
          relationshipKey,
          inverseRelationshipKey,
          leftResource: descriptor.resource,
          leftId,
          rightResource: relInfo.target,
          rightId: relatedId,
        });

        if (!canonical) continue;

        await db(LINKS_TABLE)
          .where(buildLinkIdentity(canonical))
          .delete();
      }
    };

    const listLinks = async ({ descriptor, relInfo, relationshipKey, leftId, db }) => {
      const existingMap = await loadLinkRowsForResource({
        descriptor,
        relationshipKey,
        resourceId: leftId,
        db,
      });

      return [...existingMap.entries()].map(([relatedId, entry]) => ({
        type: entry.relatedResource || relInfo.target,
        id: relatedId,
      }));
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

      const updateRow = Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== undefined)
      );

      if (Object.keys(updateRow).length === 0) {
        return 0;
      }

      const result = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .update(updateRow);

      return result;
    };

    helpers.dataPatch = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const { canonical } = descriptor;
      const id = context.id;
      const attributes = context.inputRecord?.data?.attributes || {};
      const row = translateAttributesForStorage(attributes, descriptor);

      const updateRow = Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== undefined)
      );

      if (Object.keys(updateRow).length === 0) {
        return 0;
      }

      const result = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .update(updateRow);

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
      const scope = api.resources?.[scopeName];

      const row = await context.db(canonical.tableName)
        .where('id', id)
        .where(canonical.resourceColumn, descriptor.resource)
        .where(canonical.tenantColumn, descriptor.tenant)
        .first();

      if (!row) return null;
      const translated = translateRecordFromStorage(row, descriptor);
      const minimal = {
        type: descriptor.resource,
        id: String(row.id),
        attributes: translated.attributes,
        relationships: translated.relationships,
      };
      if (scope) {
        minimal.links = {
          self: buildResourceUrl(context, scope, scopeName, minimal.id),
        };
      }
      return minimal;
    };

    const parseIncludeTree = (includeParam) => {
      const tree = {};
      if (!includeParam) return tree;

      const pushPath = (raw) => {
        if (!raw) return;
        const segments = raw.split('.').map((segment) => segment.trim()).filter(Boolean);
        if (segments.length === 0) return;
        let node = tree;
        for (const segment of segments) {
          node[segment] = node[segment] || {};
          node = node[segment];
        }
      };

      if (Array.isArray(includeParam)) {
        for (const entry of includeParam) {
          String(entry).split(',').forEach((part) => pushPath(part.trim()));
        }
      } else {
        String(includeParam).split(',').forEach((part) => pushPath(part.trim()));
      }

      return tree;
    };

    const collectIncludes = async ({ descriptor, resources, includeTree, context, includes, seen }) => {
      const entries = Object.entries(includeTree || {});
      if (entries.length === 0 || !resources || resources.length === 0) return;

      const db = context.db || context.transaction || api.knex.instance;
      const addSelfLink = (resource, resourceType) => {
        const targetScope = api.resources?.[resourceType];
        if (!targetScope) return;
        resource.links = resource.links || {};
        resource.links.self = buildResourceUrl(context, targetScope, resourceType, resource.id);
      };

      for (const [relName, childTree] of entries) {
        const childKeys = Object.keys(childTree || {});

        const belongsToInfo = descriptor.belongsTo?.[relName];
        if (belongsToInfo) {
          const ids = [...new Set(resources
            .map((resource) => resource.relationships?.[relName]?.data?.id)
            .filter((id) => id !== undefined && id !== null))];

          if (ids.length === 0) continue;

          const targetDescriptor = await registry.getDescriptor(DEFAULT_TENANT, belongsToInfo.target);
          if (!targetDescriptor) continue;

          const rows = await db(targetDescriptor.canonical.tableName)
            .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
            .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
            .whereIn('id', ids);

          const newResources = [];
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
            applySparseFieldsetToResource(includeResource, context);
            addSelfLink(includeResource, targetDescriptor.resource);
            includes.push(includeResource);
            newResources.push(includeResource);
          }

          if (childKeys.length > 0 && newResources.length > 0) {
            await attachHasManyRelationships({ resources: newResources, descriptor: targetDescriptor, context });
            await attachManyToManyRelationships({ resources: newResources, descriptor: targetDescriptor, context });
            await collectIncludes({
              descriptor: targetDescriptor,
              resources: newResources,
              includeTree: childTree,
              context,
              includes,
              seen,
            });
          }
          continue;
        }

        const polymorphicInfo = descriptor.polymorphicBelongsTo?.[relName];
        if (polymorphicInfo) {
          const typeToIds = new Map();
          for (const resource of resources) {
            const relData = resource.relationships?.[relName]?.data;
            if (!relData?.type || relData?.id == null) continue;
            const targetType = String(relData.type);
            const targetId = normalizeId(relData.id);
            if (targetId == null) continue;
            if (!typeToIds.has(targetType)) {
              typeToIds.set(targetType, new Set());
            }
            typeToIds.get(targetType).add(targetId);
          }

          const newResources = [];
          for (const [targetType, idSet] of typeToIds.entries()) {
            if (idSet.size === 0) continue;
            let targetDescriptor;
            try {
              targetDescriptor = await getDescriptor(targetType);
            } catch (error) {
              continue;
            }

            const rows = await db(targetDescriptor.canonical.tableName)
              .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
              .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
              .whereIn('id', [...idSet]);

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
              applySparseFieldsetToResource(includeResource, context);
              addSelfLink(includeResource, targetDescriptor.resource);
              includes.push(includeResource);
              newResources.push(includeResource);
            }
          }

          if (childKeys.length > 0 && newResources.length > 0) {
            const resourcesByType = new Map();
            for (const includeResource of newResources) {
              if (!resourcesByType.has(includeResource.type)) {
                resourcesByType.set(includeResource.type, []);
              }
              resourcesByType.get(includeResource.type).push(includeResource);
            }

            for (const [targetType, groupedResources] of resourcesByType.entries()) {
              let targetDescriptor;
              try {
                targetDescriptor = await getDescriptor(targetType);
              } catch (error) {
                continue;
              }

              await attachHasManyRelationships({ resources: groupedResources, descriptor: targetDescriptor, context });
              await attachManyToManyRelationships({ resources: groupedResources, descriptor: targetDescriptor, context });
              await collectIncludes({
                descriptor: targetDescriptor,
                resources: groupedResources,
                includeTree: childTree,
                context,
                includes,
                seen,
              });
            }
          }

          continue;
        }

        const hasManyInfo = descriptor.relationships?.[relName];
        if (hasManyInfo?.type === 'hasMany' && hasManyInfo.target && (hasManyInfo.foreignKey || hasManyInfo.via)) {
          let targetDescriptor;
          try {
            targetDescriptor = await getDescriptor(hasManyInfo.target);
          } catch (error) {
            continue;
          }

          const parentIds = resources
            .map((resource) => normalizeId(resource.id))
            .filter((id) => id !== null);

          if (parentIds.length === 0) continue;

          const queryIds = Array.from(new Set([
            ...parentIds,
            ...parentIds
              .map((id) => {
                const numeric = Number(id);
                return Number.isFinite(numeric) ? numeric : null;
              })
              .filter((value) => value !== null),
          ]));

          let rows = [];
          let groupingColumn = null;

          if (hasManyInfo.foreignKey) {
            const foreignField = targetDescriptor.fields?.[hasManyInfo.foreignKey];
            if (!foreignField?.slot) {
              continue;
            }
            groupingColumn = foreignField.slot;
            rows = await db(targetDescriptor.canonical.tableName)
              .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
              .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
              .whereIn(groupingColumn, parentIds);
          } else if (hasManyInfo.via) {
            const polyInfo = targetDescriptor.polymorphicBelongsTo?.[hasManyInfo.via];
            if (!polyInfo?.idColumn || !polyInfo?.typeColumn) {
              continue;
            }
            groupingColumn = polyInfo.idColumn;
            rows = await db(targetDescriptor.canonical.tableName)
              .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
              .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
              .where(polyInfo.typeColumn, descriptor.resource)
              .whereIn(groupingColumn, queryIds);
          }

          if (!groupingColumn || rows.length === 0) {
            continue;
          }

          const newResources = [];
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
              applySparseFieldsetToResource(includeResource, context);
              addSelfLink(includeResource, targetDescriptor.resource);
              includes.push(includeResource);
              newResources.push(includeResource);
            }

          if (childKeys.length > 0 && newResources.length > 0) {
            await attachHasManyRelationships({ resources: newResources, descriptor: targetDescriptor, context });
            await attachManyToManyRelationships({ resources: newResources, descriptor: targetDescriptor, context });
            await collectIncludes({
              descriptor: targetDescriptor,
              resources: newResources,
              includeTree: childTree,
              context,
              includes,
              seen,
            });
          }

          continue;
        }

        const manyInfo = descriptor.manyToMany?.[relName];
        if (manyInfo) {
          const info = await getManyToManyInfo(descriptor.resource, relName);
          if (!info) continue;
          const linkRows = await fetchLinksForParents({
            descriptor: info.descriptor,
            relationshipKey: info.relationshipKey,
            parentIds: resources.map((resource) => resource.id),
            db,
          });

          const childIds = [...new Set(linkRows.map((row) => row.childId))];
          if (childIds.length === 0) continue;

          const targetDescriptor = await registry.getDescriptor(DEFAULT_TENANT, info.relInfo.target);
          if (!targetDescriptor) continue;

          const rows = await db(targetDescriptor.canonical.tableName)
            .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
            .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
            .whereIn('id', childIds);

         const newResources = [];
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
           applySparseFieldsetToResource(includeResource, context);
            addSelfLink(includeResource, targetDescriptor.resource);
            includes.push(includeResource);
            newResources.push(includeResource);
          }

          if (childKeys.length > 0 && newResources.length > 0) {
            await attachHasManyRelationships({ resources: newResources, descriptor: targetDescriptor, context });
            await attachManyToManyRelationships({ resources: newResources, descriptor: targetDescriptor, context });
            await collectIncludes({
              descriptor: targetDescriptor,
              resources: newResources,
              includeTree: childTree,
              context,
              includes,
              seen,
            });
          }
        }
      }
    };

    const buildIncludes = async ({ parentResources, descriptor, context }) => {
      const includeTree = parseIncludeTree(context.queryParams?.include);
      if (Object.keys(includeTree).length === 0) return [];

      const includes = [];
      const seen = new Set();

      await collectIncludes({
        descriptor,
        resources: parentResources,
        includeTree,
        context,
        includes,
        seen,
      });

      return includes;
    };

    const attachHasManyRelationships = async ({ resources, descriptor, context }) => {
      if (!resources || resources.length === 0) return;
      const hasManyEntries = Object.entries(descriptor.relationships || {})
        .filter(([, relDef]) => relDef?.type === 'hasMany' && relDef.target && (relDef.foreignKey || relDef.via));

      if (hasManyEntries.length === 0) return;

      const db = context.db || context.transaction || api.knex.instance;
      const parentIds = resources.map((resource) => resource.id);
      const normalizedParentIds = parentIds
        .map((id) => normalizeId(id))
        .filter((id) => id !== null);

      if (normalizedParentIds.length === 0) return;

      for (const [relName, relDef] of hasManyEntries) {
        let targetDescriptor;
        try {
          targetDescriptor = await getDescriptor(relDef.target);
        } catch (error) {
          continue;
        }

        if (relDef.foreignKey) {
          const foreignField = targetDescriptor.fields?.[relDef.foreignKey];
          if (!foreignField?.slot) continue;
          const column = foreignField.slot;

          const rows = await db(targetDescriptor.canonical.tableName)
            .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
            .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
            .whereIn(column, normalizedParentIds);

          const grouped = rows.reduce((acc, row) => {
            const parentId = row[column];
            if (parentId == null) return acc;
            const key = String(parentId);
            acc[key] = acc[key] || [];
            acc[key].push({ type: targetDescriptor.resource, id: String(row.id) });
            return acc;
          }, {});

          for (const resource of resources) {
            resource.relationships = resource.relationships || {};
            const related = grouped[String(resource.id)] || [];
            resource.relationships[relName] = { data: related };
          }

          continue;
        }

        if (relDef.via) {
          const polyInfo = targetDescriptor.polymorphicBelongsTo?.[relDef.via];
          if (!polyInfo?.idColumn || !polyInfo?.typeColumn) continue;

          const queryIds = Array.from(new Set([
            ...normalizedParentIds,
            ...normalizedParentIds
              .map((id) => {
                const numeric = Number(id);
                return Number.isFinite(numeric) ? numeric : null;
              })
              .filter((value) => value !== null),
          ]));

          const rows = await db(targetDescriptor.canonical.tableName)
            .where(targetDescriptor.canonical.tenantColumn, targetDescriptor.tenant)
            .where(targetDescriptor.canonical.resourceColumn, targetDescriptor.resource)
            .where(polyInfo.typeColumn, descriptor.resource)
            .whereIn(polyInfo.idColumn, queryIds);

          const grouped = rows.reduce((acc, row) => {
            const parentId = row[polyInfo.idColumn];
            if (parentId == null) return acc;
            const key = String(parentId);
            acc[key] = acc[key] || [];
            acc[key].push({ type: targetDescriptor.resource, id: String(row.id) });
            return acc;
          }, {});

          for (const resource of resources) {
            resource.relationships = resource.relationships || {};
            const related = grouped[String(resource.id)] || [];
            resource.relationships[relName] = { data: related };
          }
        }
      }
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
        const rows = await fetchLinksForParents({
          descriptor: info.descriptor,
          relationshipKey: info.relationshipKey,
          parentIds,
          db,
        });

        const grouped = rows.reduce((acc, row) => {
          const key = String(row.parentId);
          acc[key] = acc[key] || [];
          acc[key].push({ type: row.childType, id: String(row.childId) });
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
      const scope = api.resources?.[scopeName];

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

      applySparseFieldsetToResource(data, context);

      await attachHasManyRelationships({
        resources: [data],
        descriptor,
        context,
      });

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

      if (scope) {
        data.links = data.links || {};
        data.links.self = buildResourceUrl(context, scope, scopeName, data.id);
        response.links = {
          self: data.links.self,
        };
      }

      if (included.length > 0) {
        for (const includeResource of included) {
          const targetScope = api.resources?.[includeResource.type];
          if (!targetScope) continue;
          includeResource.links = includeResource.links || {};
          includeResource.links.self = buildResourceUrl(
            context,
            targetScope,
            includeResource.type,
            includeResource.id,
          );
        }
      }

      return response;
    };

    const buildTableNameMaps = () => {
      const resourceToTableName = new Map();
      const tableNameToResource = new Map();
      for (const [resourceName, resourceScope] of Object.entries(api.resources || {})) {
        const tableName = resourceScope?.vars?.schemaInfo?.tableName;
        if (!tableName) continue;
        resourceToTableName.set(resourceName, tableName);
        tableNameToResource.set(tableName, resourceName);
      }
      return { resourceToTableName, tableNameToResource };
    };

    helpers.dataQuery = async ({ scopeName, context, runHooks }) => {
      const descriptor = await getDescriptor(scopeName);
      const db = context.db || context.transaction || api.knex.instance;
      const scope = api.resources?.[scopeName];
      const queryParams = context.queryParams || {};

      const { resourceToTableName, tableNameToResource } = buildTableNameMaps();
      const descriptorsMap = await preloadRelatedDescriptors({ registry, descriptor });
      const adapter = new YouapiQueryAdapter({
        descriptor,
        db,
        registry,
        descriptorsMap,
        resourceToTableName,
        tableNameToResource,
        log,
      });
      const queryBuilder = adapter.query;

      const schemaInfo = scope?.vars?.schemaInfo;
      const tableNameForHooks = schemaInfo?.tableName || adapter.tableAlias;

      context.knexQuery = {
        query: queryBuilder,
        filters: queryParams.filters,
        schemaInfo,
        scopeName,
        tableName: tableNameForHooks,
        db,
        isAnyApi: true,
        adapter,
      };

      if (runHooks) {
        await runHooks('knexQueryFiltering');
      }

      delete context.knexQuery;

      const countQuery = queryBuilder.clone();

      const sortDescriptors = applySortingToQuery({
        query: queryBuilder,
        sort: queryParams.sort,
        descriptor,
        scope,
      });

      const paginationInfo = applyPaginationToQuery({
        query: queryBuilder,
        scope,
        queryParams,
        sortDescriptors,
      });

      let rows = await queryBuilder.select();
      let cursorRecords = null;
      let hasMore = false;

      if (paginationInfo.mode === 'cursor') {
        const { pageSize, sortDescriptors: cursorDescriptors } = paginationInfo;
        cursorRecords = rows.map((row) => {
          const record = {};
          for (const descriptorEntry of cursorDescriptors) {
            if (descriptorEntry.field === 'id') {
              record.id = row.id;
            } else if (descriptorEntry.column) {
              record[descriptorEntry.field] = row[descriptorEntry.column];
            }
          }
          return record;
        });

        if (rows.length > pageSize) {
          hasMore = true;
          rows = rows.slice(0, pageSize);
          cursorRecords = cursorRecords.slice(0, pageSize);
        }
      }

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
        const resourceScope = scope;
        if (resourceScope) {
          resource.links = resource.links || {};
          resource.links.self = buildResourceUrl(context, resourceScope, scopeName, resource.id);
        }
        applySparseFieldsetToResource(resource, context);
        return resource;
      });

      await attachHasManyRelationships({
        resources: data,
        descriptor,
        context,
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

      context.returnMeta = context.returnMeta || {};
      context.returnMeta.queryString = buildQueryString(queryParams);
      delete context.returnMeta.paginationMeta;
      delete context.returnMeta.paginationLinks;

      if (paginationInfo.mode === 'offset') {
        const { page, pageSize } = paginationInfo;
        let paginationMeta;

        if (scope?.vars?.enablePaginationCounts) {
          const countResult = await countQuery.count({ count: '*' }).first();
          const total = Number(countResult?.count ?? countResult?.total ?? 0);
          paginationMeta = calculatePaginationMeta(total, page, pageSize);
        } else {
          paginationMeta = { page, pageSize };
        }

        context.returnMeta.paginationMeta = paginationMeta;
        const urlPrefix = getUrlPrefix(context, scope);
        context.returnMeta.paginationLinks = generatePaginationLinks(
          urlPrefix,
          scopeName,
          queryParams,
          paginationMeta,
        );
      } else if (paginationInfo.mode === 'cursor' && cursorRecords) {
        const cursorFields = paginationInfo.sortDescriptors.map((descriptorEntry) => descriptorEntry.field);
        const paginationMeta = buildCursorMeta(
          cursorRecords,
          paginationInfo.pageSize,
          hasMore,
          cursorFields,
        );
        context.returnMeta.paginationMeta = paginationMeta;
        const urlPrefix = getUrlPrefix(context, scope);
        context.returnMeta.paginationLinks = generateCursorPaginationLinks(
          urlPrefix,
          scopeName,
          queryParams,
          cursorRecords,
          paginationInfo.pageSize,
          hasMore,
          cursorFields,
        );
      }

      if (context.returnMeta.paginationMeta) {
        response.meta = {
          pagination: context.returnMeta.paginationMeta,
        };
      }

      if (context.returnMeta.paginationLinks) {
        response.links = context.returnMeta.paginationLinks;
      } else if (scope) {
        const urlPrefix = getUrlPrefix(context, scope);
        response.links = {
          self: `${urlPrefix}/${scopeName}${context.returnMeta.queryString || ''}`,
        };
      }

      return response;
    };

    helpers.dataQueryCount = async ({ scopeName, context }) => {
      const descriptor = await getDescriptor(scopeName);
      const db = context.db || context.transaction || api.knex.instance;
      const { resourceToTableName, tableNameToResource } = buildTableNameMaps();
      const descriptorsMap = await preloadRelatedDescriptors({ registry, descriptor });
      const adapter = new YouapiQueryAdapter({
        descriptor,
        db,
        registry,
        descriptorsMap,
        resourceToTableName,
        tableNameToResource,
        log,
      });

      const [{ count }] = await adapter.query.count({ count: '*' });
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

  for (const [alias, info] of Object.entries(descriptor.polymorphicBelongsTo || {})) {
    const typeValue = info.typeColumn ? row[info.typeColumn] : null;
    const idValue = info.idColumn ? row[info.idColumn] : null;

    let relationshipData = null;
    if (typeValue != null && idValue != null) {
      relationshipData = {
        type: String(typeValue),
        id: String(idValue),
      };
    } else if (typeValue == null && idValue == null) {
      relationshipData = null;
    }

    relationships[alias] = { data: relationshipData };
  }

  return { attributes, relationships };
};
