import { compileSchemas } from '../lib/querying-writing/compile-schemas.js'

export default async function compileResourceSchemas ({ context, scopes, runHooks }) {
  const scope = scopes[context.scopeName]
  // Pass scopeOptions and vars from context since scope object structure is different
  return compileSchemas({ ...scope, scopeOptions: context.scopeOptions, vars: context.vars }, { context: { scopeName: context.scopeName }, runHooks })
}
