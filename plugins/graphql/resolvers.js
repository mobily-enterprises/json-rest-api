import { GraphQLNonNull, GraphQLID, GraphQLInt, GraphQLList, GraphQLBoolean, GraphQLString } from 'graphql';

// Create resolvers for a resource
export function createResolvers(api, resourceName, schema, types) {
  const {
    outputType,
    inputType,
    updateInputType,
    filterType,
    sortType,
    pageInputType,
    responseType
  } = types;

  const queries = {};
  const mutations = {};

  // Get single resource
  queries[`get${capitalize(resourceName)}`] = {
    type: outputType,
    description: `Get a single ${resourceName} by ID`,
    args: {
      id: { 
        type: new GraphQLNonNull(GraphQLID),
        description: 'The ID of the resource'
      },
      include: {
        type: GraphQLString,
        description: 'Comma-separated list of relationships to include'
      }
    },
    resolve: async (parent, args, context) => {
      try {
        const options = {
          user: context.user,
          meta: context.meta
        };

        if (args.include) {
          options.include = args.include;
        }

        const result = await api.resources[resourceName].get(args.id, options);
        
        if (!result || !result.data) {
          throw new Error(`${resourceName} not found`);
        }

        // Transform JSON:API format to GraphQL format
        return transformJsonApiToGraphQL(result.data, result.included);
      } catch (error) {
        if (error.name === 'NotFoundError') {
          return null;
        }
        throw createGraphQLError(error);
      }
    }
  };

  // Query multiple resources
  // Check if resourceName already ends with 's' to avoid double pluralization
  const queryName = resourceName.endsWith('s') 
    ? `query${capitalize(resourceName)}` 
    : `query${capitalize(resourceName)}s`;
  queries[queryName] = {
    type: responseType,
    description: `Query ${resourceName} resources`,
    args: {
      filter: { 
        type: filterType,
        description: 'Filter conditions'
      },
      sort: { 
        type: new GraphQLList(sortType),
        description: 'Sort fields'
      },
      page: { 
        type: pageInputType,
        description: 'Pagination options'
      },
      include: {
        type: GraphQLString,
        description: 'Comma-separated list of relationships to include'
      }
    },
    resolve: async (parent, args, context) => {
      try {
        const query = {};
        
        // Build filter
        if (args.filter) {
          query.filter = transformGraphQLFilter(args.filter);
        }

        // Build sort
        if (args.sort && args.sort.length > 0) {
          query.sort = args.sort.join(',');
        }

        // Build pagination
        if (args.page) {
          query.page = {
            size: args.page.size,
            number: args.page.number
          };
        }

        // Include relationships
        if (args.include) {
          query.include = args.include;
        }

        const options = {
          user: context.user,
          meta: context.meta
        };

        const result = await api.resources[resourceName].query(query, options);

        // Transform data
        const transformedData = result.data.map(item => 
          transformJsonApiToGraphQL(item, result.included)
        );

        return {
          data: transformedData,
          meta: result.meta
        };
      } catch (error) {
        throw createGraphQLError(error);
      }
    }
  };

  // Create resource
  // Remove trailing 's' for singular mutation names
  const singularName = resourceName.endsWith('s') 
    ? resourceName.slice(0, -1) 
    : resourceName;
  mutations[`create${capitalize(singularName)}`] = {
    type: outputType,
    description: `Create a new ${resourceName}`,
    args: {
      input: { 
        type: new GraphQLNonNull(inputType),
        description: 'The data for the new resource'
      }
    },
    resolve: async (parent, args, context) => {
      try {
        const options = {
          user: context.user,
          meta: context.meta
        };

        const result = await api.resources[resourceName].create(args.input, options);
        
        return transformJsonApiToGraphQL(result.data, result.included);
      } catch (error) {
        throw createGraphQLError(error);
      }
    }
  };

  // Update resource
  mutations[`update${capitalize(singularName)}`] = {
    type: outputType,
    description: `Update an existing ${resourceName}`,
    args: {
      id: { 
        type: new GraphQLNonNull(GraphQLID),
        description: 'The ID of the resource to update'
      },
      input: { 
        type: new GraphQLNonNull(updateInputType),
        description: 'The fields to update'
      }
    },
    resolve: async (parent, args, context) => {
      try {
        const options = {
          user: context.user,
          meta: context.meta
        };

        const result = await api.resources[resourceName].update(
          args.id, 
          args.input, 
          options
        );
        
        return transformJsonApiToGraphQL(result.data, result.included);
      } catch (error) {
        throw createGraphQLError(error);
      }
    }
  };

  // Delete resource
  mutations[`delete${capitalize(singularName)}`] = {
    type: GraphQLBoolean,
    description: `Delete a ${resourceName}`,
    args: {
      id: { 
        type: new GraphQLNonNull(GraphQLID),
        description: 'The ID of the resource to delete'
      }
    },
    resolve: async (parent, args, context) => {
      try {
        const options = {
          user: context.user,
          meta: context.meta
        };

        await api.resources[resourceName].delete(args.id, options);
        return true;
      } catch (error) {
        throw createGraphQLError(error);
      }
    }
  };

  // Batch create
  const batchCreateName = resourceName.endsWith('s') 
    ? `createBatch${capitalize(resourceName)}` 
    : `createBatch${capitalize(resourceName)}s`;
  mutations[batchCreateName] = {
    type: new GraphQLList(outputType),
    description: `Create multiple ${resourceName} resources`,
    args: {
      input: { 
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(inputType))),
        description: 'Array of resources to create'
      }
    },
    resolve: async (parent, args, context) => {
      try {
        const options = {
          user: context.user,
          meta: context.meta
        };

        const results = await Promise.all(
          args.input.map(data => 
            api.resources[resourceName].create(data, options)
          )
        );

        return results.map(result => 
          transformJsonApiToGraphQL(result.data, result.included)
        );
      } catch (error) {
        throw createGraphQLError(error);
      }
    }
  };

  return { queries, mutations };
}

// Transform JSON:API format to GraphQL format
function transformJsonApiToGraphQL(jsonApiData, included = []) {
  if (!jsonApiData) return null;

  const result = {
    id: jsonApiData.id,
    ...jsonApiData.attributes
  };

  // Handle relationships
  if (jsonApiData.relationships) {
    for (const [relName, relData] of Object.entries(jsonApiData.relationships)) {
      if (relData.data) {
        if (Array.isArray(relData.data)) {
          // To-many relationship
          result[relName] = relData.data.map(ref => {
            const includedItem = included.find(
              inc => inc.type === ref.type && inc.id === ref.id
            );
            return includedItem ? transformJsonApiToGraphQL(includedItem, included) : ref;
          });
        } else {
          // To-one relationship
          const includedItem = included.find(
            inc => inc.type === relData.data.type && inc.id === relData.data.id
          );
          result[relName] = includedItem 
            ? transformJsonApiToGraphQL(includedItem, included) 
            : relData.data;
        }
      }
    }
  }

  return result;
}

// Transform GraphQL filter to API filter format
function transformGraphQLFilter(graphqlFilter) {
  const apiFilter = {};

  for (const [key, value] of Object.entries(graphqlFilter)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      // Handle logical operators
      apiFilter[`$${key.toLowerCase()}`] = Array.isArray(value)
        ? value.map(transformGraphQLFilter)
        : transformGraphQLFilter(value);
    } else if (key.endsWith('_gt')) {
      const field = key.slice(0, -3);
      apiFilter[field] = { gt: value };
    } else if (key.endsWith('_gte')) {
      const field = key.slice(0, -4);
      apiFilter[field] = { gte: value };
    } else if (key.endsWith('_lt')) {
      const field = key.slice(0, -3);
      apiFilter[field] = { lt: value };
    } else if (key.endsWith('_lte')) {
      const field = key.slice(0, -4);
      apiFilter[field] = { lte: value };
    } else if (key.endsWith('_like')) {
      const field = key.slice(0, -5);
      apiFilter[field] = { like: value };
    } else if (key.endsWith('_ilike')) {
      const field = key.slice(0, -6);
      apiFilter[field] = { ilike: value };
    } else if (key.endsWith('_in')) {
      const field = key.slice(0, -3);
      apiFilter[field] = { in: value };
    } else if (key.endsWith('_nin')) {
      const field = key.slice(0, -4);
      apiFilter[field] = { nin: value };
    } else if (key.endsWith('_is_null')) {
      const field = key.slice(0, -8);
      apiFilter[field] = value ? null : { $ne: null };
    } else {
      apiFilter[key] = value;
    }
  }

  return apiFilter;
}

// Create GraphQL-friendly error
function createGraphQLError(error) {
  const graphqlError = new Error(error.message);
  graphqlError.originalError = error;
  graphqlError.extensions = {
    code: error.code || error.name || 'INTERNAL_ERROR'
  };

  if (error.validationErrors) {
    graphqlError.extensions.validationErrors = error.validationErrors;
  }

  if (error.context) {
    graphqlError.extensions.context = error.context;
  }

  return graphqlError;
}

// Helper to capitalize strings
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Import GraphQLString at the top
