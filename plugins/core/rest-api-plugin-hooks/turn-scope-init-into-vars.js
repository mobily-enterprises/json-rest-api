export default async function turnScopeInitIntoVars({ context, scopes, vars: apiVars }) {
  // Refer to the scope's vars
  const scope = scopes[context.scopeName];
  const scopeOptions = scope?.scopeOptions || context.scopeOptions || {};
  const vars = scope?.vars || apiVars;

  // The scope-specific ones
  vars.sortableFields = scopeOptions.sortableFields || [];
  vars.defaultSort = scopeOptions.defaultSort || null;     

  // The general ones that are also set at api level, but overrideable
  if (typeof scopeOptions.queryDefaultLimit !== 'undefined') vars.queryDefaultLimit = scopeOptions.queryDefaultLimit;
  if (typeof scopeOptions.queryMaxLimit !== 'undefined') vars.queryMaxLimit = scopeOptions.queryMaxLimit;
  if (typeof scopeOptions.includeDepthLimit !== 'undefined') vars.includeDepthLimit = scopeOptions.includeDepthLimit;
  if (typeof scopeOptions.publicBaseUrl !== 'undefined') vars.publicBaseUrl = scopeOptions.publicBaseUrl;
  if (typeof scopeOptions.enablePaginationCounts !== 'undefined') vars.enablePaginationCounts = scopeOptions.enablePaginationCounts;
  
  // Set simplified settings as scope vars
  if (typeof scopeOptions.simplifiedApi !== 'undefined') vars.simplifiedApi = scopeOptions.simplifiedApi;
  if (typeof scopeOptions.simplifiedTransport !== 'undefined') vars.simplifiedTransport = scopeOptions.simplifiedTransport;
  
  // Set returnRecord settings as scope vars
  if (typeof scopeOptions.returnRecordApi !== 'undefined') vars.returnRecordApi = scopeOptions.returnRecordApi;
  if (typeof scopeOptions.returnRecordTransport !== 'undefined') vars.returnRecordTransport = scopeOptions.returnRecordTransport;
  
  // Set idProperty as scope var
  if (typeof scopeOptions.idProperty !== 'undefined') vars.idProperty = scopeOptions.idProperty;

  // Add validation for query limits
  if (vars.queryDefaultLimit && vars.queryMaxLimit) {
    if (vars.queryDefaultLimit > vars.queryMaxLimit) {
      throw new Error(
        `Invalid scope '${context.scopeName}' configuration: ` +
        `queryDefaultLimit (${vars.queryDefaultLimit}) cannot exceed queryMaxLimit (${vars.queryMaxLimit})`
      );
    }
  }
  
  // Validate relationship include limits at scope creation time
  Object.entries(scopeOptions.relationships || {}).forEach(([relName, relDef]) => {
    if (relDef.include?.limit && vars.queryMaxLimit) {
      if (relDef.include.limit > vars.queryMaxLimit) {
        throw new Error(
          `Invalid relationship '${context.scopeName}.${relName}' configuration: ` +
          `include.limit (${relDef.include.limit}) cannot exceed queryMaxLimit (${vars.queryMaxLimit})`
        );
      }
    }
  });
}