import { compileSchemas } from '../lib/querying-writing/compile-schemas.js'
import { assertXid8Fields } from '../lib/querying-writing/field-types.js'
import { assertBlobFields } from '../lib/querying-writing/blob-fields.js'
import { databaseFamily } from '../lib/querying-writing/database-capabilities.js'

export default async function compileResourceSchemas ({ api, context, scopes, runHooks }) {
  const scope = scopes[context.scopeName]
  // Pass scopeOptions and vars from context since scope object structure is different
  await compileSchemas({ ...scope, scopeOptions: context.scopeOptions, vars: context.vars }, { context: { scopeName: context.scopeName }, runHooks })
  const knex = api.knex?.instance
  assertXid8Fields(context.vars.schemaInfo, context.scopeName, Boolean(knex) && !api.anyapi && databaseFamily(knex) === 'pg')
  assertBlobFields(context.vars.schemaInfo, context.scopeName, { anyapi: Boolean(api.anyapi), maxAllowedPacket: api.knex?.capabilities?.dbInfo?.maxAllowedPacket })
}
