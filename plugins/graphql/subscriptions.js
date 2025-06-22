import { GraphQLObjectType, GraphQLNonNull, GraphQLID } from 'graphql';
import { PubSub } from 'graphql-subscriptions';
import { useServer } from 'graphql-ws/lib/use/ws';
import { execute, subscribe } from 'graphql';
import { WebSocketServer } from 'ws';

// Setup GraphQL subscriptions
export function setupSubscriptions(api, app, options) {
  const { path, schema } = options;
  
  // Create PubSub instance (use Redis in production)
  const pubsub = new PubSub();
  
  // Store pubsub on API for use in hooks
  api.graphql.pubsub = pubsub;

  // Add subscription support to each resource
  for (const [resourceName, types] of api.graphql.types) {
    const { outputType } = types;
    
    // Resource created subscription
    api.graphql.subscriptions[`${resourceName}Created`] = {
      type: outputType,
      description: `Subscribe to ${resourceName} creation events`,
      args: {
        filter: { type: types.filterType }
      },
      subscribe: (parent, args, context) => {
        // Check permissions
        if (!hasSubscriptionPermission(context, resourceName, 'create')) {
          throw new Error('Unauthorized subscription');
        }

        const topic = `${resourceName.toUpperCase()}_CREATED`;
        const iterator = pubsub.asyncIterator(topic);

        // Filter events based on args
        if (args.filter) {
          return withFilter(
            () => iterator,
            (payload, variables) => {
              return matchesFilter(payload[`${resourceName}Created`], variables.filter);
            }
          )(parent, args, context);
        }

        return iterator;
      },
      resolve: (payload) => payload[`${resourceName}Created`]
    };

    // Resource updated subscription
    api.graphql.subscriptions[`${resourceName}Updated`] = {
      type: outputType,
      description: `Subscribe to ${resourceName} update events`,
      args: {
        id: { type: GraphQLID },
        filter: { type: types.filterType }
      },
      subscribe: (parent, args, context) => {
        // Check permissions
        if (!hasSubscriptionPermission(context, resourceName, 'update')) {
          throw new Error('Unauthorized subscription');
        }

        const topic = args.id 
          ? `${resourceName.toUpperCase()}_UPDATED_${args.id}`
          : `${resourceName.toUpperCase()}_UPDATED`;
          
        const iterator = pubsub.asyncIterator(topic);

        // Filter events
        if (args.filter) {
          return withFilter(
            () => iterator,
            (payload, variables) => {
              return matchesFilter(payload[`${resourceName}Updated`], variables.filter);
            }
          )(parent, args, context);
        }

        return iterator;
      },
      resolve: (payload) => payload[`${resourceName}Updated`]
    };

    // Resource deleted subscription
    api.graphql.subscriptions[`${resourceName}Deleted`] = {
      type: new GraphQLObjectType({
        name: `${capitalize(resourceName)}DeletedPayload`,
        fields: {
          id: { type: new GraphQLNonNull(GraphQLID) },
          deletedAt: { type: api.graphql.customScalars.Date }
        }
      }),
      description: `Subscribe to ${resourceName} deletion events`,
      args: {
        id: { type: GraphQLID }
      },
      subscribe: (parent, args, context) => {
        // Check permissions
        if (!hasSubscriptionPermission(context, resourceName, 'delete')) {
          throw new Error('Unauthorized subscription');
        }

        const topic = args.id 
          ? `${resourceName.toUpperCase()}_DELETED_${args.id}`
          : `${resourceName.toUpperCase()}_DELETED`;
          
        return pubsub.asyncIterator(topic);
      },
      resolve: (payload) => payload[`${resourceName}Deleted`]
    };

    // Live query subscription (real-time query results)
    api.graphql.subscriptions[`${resourceName}LiveQuery`] = {
      type: types.responseType,
      description: `Subscribe to live query results for ${resourceName}`,
      args: {
        filter: { type: types.filterType },
        sort: { type: types.sortType }
      },
      subscribe: async (parent, args, context) => {
        // Check permissions
        if (!hasSubscriptionPermission(context, resourceName, 'query')) {
          throw new Error('Unauthorized subscription');
        }

        const queryId = generateQueryId(resourceName, args);
        const topic = `LIVE_QUERY_${queryId}`;

        // Initial query
        const initialResults = await api.resources[resourceName].query({
          filter: args.filter ? transformGraphQLFilter(args.filter) : {},
          sort: args.sort
        }, {
          user: context.user,
          meta: context.meta
        });

        // Emit initial results
        setTimeout(() => {
          pubsub.publish(topic, {
            [`${resourceName}LiveQuery`]: {
              data: initialResults.data.map(item => 
                transformJsonApiToGraphQL(item, initialResults.included)
              ),
              meta: initialResults.meta
            }
          });
        }, 0);

        // Set up auto-refresh on changes
        const refreshQuery = async () => {
          const results = await api.resources[resourceName].query({
            filter: args.filter ? transformGraphQLFilter(args.filter) : {},
            sort: args.sort
          }, {
            user: context.user,
            meta: context.meta
          });

          pubsub.publish(topic, {
            [`${resourceName}LiveQuery`]: {
              data: results.data.map(item => 
                transformJsonApiToGraphQL(item, results.included)
              ),
              meta: results.meta
            }
          });
        };

        // Subscribe to resource changes
        const handlers = {
          created: () => refreshQuery(),
          updated: () => refreshQuery(),
          deleted: () => refreshQuery()
        };

        api.graphql.liveQueries = api.graphql.liveQueries || new Map();
        api.graphql.liveQueries.set(queryId, { handlers, topic });

        return pubsub.asyncIterator(topic);
      },
      resolve: (payload) => payload[`${resourceName}LiveQuery`]
    };
  }

  // Hook into API events to publish subscription updates
  api.hook('afterInsert', async (context) => {
    const resourceName = context.resource || context.options?.type;
    if (!resourceName) return;

    const topic = `${resourceName.toUpperCase()}_CREATED`;
    const payload = {
      [`${resourceName}Created`]: transformJsonApiToGraphQL(context.result.data)
    };
    
    pubsub.publish(topic, payload);

    // Trigger live queries
    triggerLiveQueries(api, resourceName, 'created');
  });

  api.hook('afterUpdate', async (context) => {
    const resourceName = context.resource || context.options?.type;
    if (!resourceName) return;

    const topic = `${resourceName.toUpperCase()}_UPDATED`;
    const topicWithId = `${topic}_${context.id}`;
    const payload = {
      [`${resourceName}Updated`]: transformJsonApiToGraphQL(context.result.data)
    };
    
    pubsub.publish(topic, payload);
    pubsub.publish(topicWithId, payload);

    // Trigger live queries
    triggerLiveQueries(api, resourceName, 'updated');
  });

  api.hook('afterDelete', async (context) => {
    const resourceName = context.resource || context.options?.type;
    if (!resourceName) return;

    const topic = `${resourceName.toUpperCase()}_DELETED`;
    const topicWithId = `${topic}_${context.id}`;
    const payload = {
      [`${resourceName}Deleted`]: {
        id: context.id,
        deletedAt: new Date().toISOString()
      }
    };
    
    pubsub.publish(topic, payload);
    pubsub.publish(topicWithId, payload);

    // Trigger live queries
    triggerLiveQueries(api, resourceName, 'deleted');
  });

  // Set up WebSocket server for subscriptions
  if (api.websocket) {
    const server = app.listen ? app : api.server;
    
    // Create WebSocket server
    const wsServer = new WebSocketServer({
      server,
      path
    });

    // Set up GraphQL-WS
    useServer({
      schema,
      execute,
      subscribe,
      context: async (ctx) => {
        // Get auth from connection params
        const connectionParams = ctx.connectionParams;
        if (connectionParams?.authorization) {
          try {
            const user = await validateToken(connectionParams.authorization);
            return { user };
          } catch (error) {
            throw new Error('Authentication failed');
          }
        }
        return {};
      },
      onConnect: async (ctx) => {
        // Connection established
        console.log('Subscription client connected');
      },
      onDisconnect: async (ctx) => {
        // Cleanup
        console.log('Subscription client disconnected');
      }
    }, wsServer);
  }

  return pubsub;
}

// Helper functions
function hasSubscriptionPermission(context, resourceName, operation) {
  // Implement your permission logic here
  // For now, allow all authenticated users
  return !!context.user || true; // Remove "|| true" in production
}

function matchesFilter(data, filter) {
  // Simple filter matching implementation
  for (const [key, value] of Object.entries(filter)) {
    if (data[key] !== value) {
      return false;
    }
  }
  return true;
}

function generateQueryId(resourceName, args) {
  return `${resourceName}_${JSON.stringify(args)}`.replace(/[^a-zA-Z0-9]/g, '_');
}

function triggerLiveQueries(api, resourceName, event) {
  if (!api.graphql.liveQueries) return;

  for (const [queryId, { handlers }] of api.graphql.liveQueries) {
    if (queryId.startsWith(resourceName) && handlers[event]) {
      handlers[event]();
    }
  }
}

async function validateToken(token) {
  // Implement your token validation logic
  // This should match your authentication system
  return { id: '1', name: 'Test User' };
}

function withFilter(asyncIteratorFn, filterFn) {
  return async function* (parent, args, context, info) {
    const iterator = await asyncIteratorFn(parent, args, context, info);
    for await (const payload of iterator) {
      if (await filterFn(payload, args, context, info)) {
        yield payload;
      }
    }
  };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function transformJsonApiToGraphQL(jsonApiData, included = []) {
  if (!jsonApiData) return null;

  const result = {
    id: jsonApiData.id,
    ...jsonApiData.attributes
  };

  if (jsonApiData.relationships) {
    for (const [relName, relData] of Object.entries(jsonApiData.relationships)) {
      if (relData.data) {
        if (Array.isArray(relData.data)) {
          result[relName] = relData.data.map(ref => {
            const includedItem = included.find(
              inc => inc.type === ref.type && inc.id === ref.id
            );
            return includedItem ? transformJsonApiToGraphQL(includedItem, included) : ref;
          });
        } else {
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

function transformGraphQLFilter(graphqlFilter) {
  const apiFilter = {};
  for (const [key, value] of Object.entries(graphqlFilter)) {
    apiFilter[key] = value;
  }
  return apiFilter;
}