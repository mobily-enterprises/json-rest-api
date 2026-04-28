export default async function applyQueryFiltersMethod ({ context, params = {}, runHooks }) {
  const { query, filters, storageAdapter, ...knexQuery } = params

  if (!query) {
    return query
  }

  const previousKnexQuery = context.knexQuery
  const previousStorageAdapter = context.storageAdapter

  context.knexQuery = {
    query,
    filters,
    storageAdapter,
    adapter: storageAdapter,
    ...knexQuery
  }

  if (storageAdapter) {
    context.storageAdapter = storageAdapter
  }

  try {
    await runHooks('knexQueryFiltering')
    return {
      query: context.knexQuery?.query || query
    }
  } finally {
    if (previousKnexQuery === undefined) {
      delete context.knexQuery
    } else {
      context.knexQuery = previousKnexQuery
    }

    if (previousStorageAdapter === undefined) {
      delete context.storageAdapter
    } else {
      context.storageAdapter = previousStorageAdapter
    }
  }
}
