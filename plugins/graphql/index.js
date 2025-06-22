import { createHandler } from 'graphql-http/lib/use/express';
import { 
  GraphQLSchema, 
  GraphQLObjectType, 
  GraphQLString, 
  GraphQLInt, 
  GraphQLFloat, 
  GraphQLBoolean, 
  GraphQLList, 
  GraphQLNonNull, 
  GraphQLID, 
  GraphQLInputObjectType,
  GraphQLScalarType,
  Kind
} from 'graphql';
import { generateSchema } from './schema-generator.js';
import { createResolvers } from './resolvers.js';
import { setupSubscriptions } from './subscriptions.js';

// Custom scalar for Date/Timestamp
const DateScalar = new GraphQLScalarType({
  name: 'Date',
  description: 'Date custom scalar type',
  serialize(value) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  },
  parseValue(value) {
    return new Date(value);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    return null;
  }
});

// Custom scalar for JSON
const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  serialize(value) {
    return value;
  },
  parseValue(value) {
    return value;
  },
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.OBJECT:
        const value = Object.create(null);
        ast.fields.forEach(field => {
          value[field.name.value] = JSONScalar.parseLiteral(field.value);
        });
        return value;
      case Kind.LIST:
        return ast.values.map(JSONScalar.parseLiteral);
      default:
        return null;
    }
  }
});

export const GraphQLPlugin = {
  install(api, options = {}) {
    const {
      path = '/graphql',
      subscriptionPath = '/graphql',
      graphiql = true,
      formatError,
      extensions,
      context: customContext,
      introspection = true,
      playground = false,
      debug = api.options.debug
    } = options;

    // Initialize GraphQL state
    api.graphql = {
      types: new Map(),
      queries: {},
      mutations: {},
      subscriptions: {},
      customScalars: {
        Date: DateScalar,
        JSON: JSONScalar
      },
      schema: null,
      middleware: null,
      typeCache: new Map() // Shared type cache for common types
    };

    // Track resources for automatic schema generation
    const resourceConfigs = new Map();

    // Hook into resource addition
    api.hook('afterAddResource', async (context) => {
      const { name, schema, options: resourceOptions } = context;
      
      console.log('GraphQL: Processing resource', name);
      
      // Store resource configuration
      resourceConfigs.set(name, {
        name,
        schema,
        options: resourceOptions,
        graphql: resourceOptions?.graphql || {}
      });

      // Generate GraphQL types
      const types = generateSchema(name, schema, api.graphql.customScalars, api.graphql.typeCache);
      api.graphql.types.set(name, types);

      // Create resolvers
      const resolvers = createResolvers(api, name, schema, types);
      
      // Add queries
      Object.assign(api.graphql.queries, resolvers.queries);
      
      // Add mutations
      Object.assign(api.graphql.mutations, resolvers.mutations);

      // Regenerate schema
      api.graphql.schema = buildGraphQLSchema(api.graphql);
    });

    // Build GraphQL schema
    function buildGraphQLSchema(graphqlState) {
      const hasQueries = Object.keys(graphqlState.queries).length > 0;
      const hasMutations = Object.keys(graphqlState.mutations).length > 0;
      const hasSubscriptions = Object.keys(graphqlState.subscriptions).length > 0;

      if (!hasQueries) {
        // GraphQL requires at least one query
        graphqlState.queries._empty = {
          type: GraphQLString,
          resolve: () => 'No queries defined yet'
        };
      }

      const schemaConfig = {
        query: new GraphQLObjectType({
          name: 'Query',
          fields: () => graphqlState.queries
        })
      };

      if (hasMutations) {
        schemaConfig.mutation = new GraphQLObjectType({
          name: 'Mutation',
          fields: () => graphqlState.mutations
        });
      }

      if (hasSubscriptions) {
        schemaConfig.subscription = new GraphQLObjectType({
          name: 'Subscription',
          fields: () => graphqlState.subscriptions
        });
      }

      return new GraphQLSchema(schemaConfig);
    }

    // Create GraphQL middleware
    api.graphql.middleware = () => {
      if (!api.graphql.schema) {
        api.graphql.schema = buildGraphQLSchema(api.graphql);
      }

      return createHandler({
        schema: api.graphql.schema,
        context: async (req) => ({
          req,
          api,
          user: req.user,
          meta: req.meta || {},
          loaders: new Map(), // DataLoader cache
          ...(typeof customContext === 'function' 
            ? await customContext(req) 
            : customContext)
        }),
        formatError: formatError || ((error) => {
          if (debug) {
            return {
              message: error.message,
              locations: error.locations,
              path: error.path,
              extensions: {
                code: error.originalError?.code || 'INTERNAL_ERROR',
                ...(error.originalError?.extensions || {})
              }
            };
          }
          // Production: hide internal errors
          if (error.message.includes('Internal server error')) {
            return {
                message: 'An error occurred processing your request',
                extensions: { code: 'INTERNAL_ERROR' }
              };
            }
          return {
            message: error.message,
            extensions: { code: error.originalError?.code || 'GRAPHQL_ERROR' }
          };
        })
      });
    };

    // Manual schema extension methods
    api.graphql.addQuery = (name, config) => {
      api.graphql.queries[name] = config;
      api.graphql.schema = buildGraphQLSchema(api.graphql);
    };

    api.graphql.addMutation = (name, config) => {
      api.graphql.mutations[name] = config;
      api.graphql.schema = buildGraphQLSchema(api.graphql);
    };

    api.graphql.addSubscription = (name, config) => {
      api.graphql.subscriptions[name] = config;
      api.graphql.schema = buildGraphQLSchema(api.graphql);
    };

    api.graphql.addType = (name, type) => {
      api.graphql.types.set(name, { outputType: type });
    };

    api.graphql.addScalar = (name, scalar) => {
      api.graphql.customScalars[name] = scalar;
    };

    // Get the built schema
    api.graphql.getSchema = () => {
      if (!api.graphql.schema) {
        api.graphql.schema = buildGraphQLSchema(api.graphql);
      }
      return api.graphql.schema;
    };

    // Attach to Express if available
    api.graphql.attach = (app) => {
      // GraphQL endpoint
      app.use(path, (req, res, next) => {
        // Add start time for performance tracking
        req.startTime = Date.now();
        next();
      }, api.graphql.middleware());

      // GraphiQL interface
      if (graphiql && !playground) {
        app.get(path, (req, res) => {
          res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>GraphiQL</title>
              <style>
                body { height: 100%; margin: 0; width: 100%; overflow: hidden; }
                #graphiql { height: 100vh; }
              </style>
              <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
              <script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
              <script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
              <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
            </head>
            <body>
              <div id="graphiql">Loading...</div>
              <script>
                const fetcher = GraphiQL.createFetcher({ url: '${path}' });
                ReactDOM.render(
                  React.createElement(GraphiQL, { fetcher: fetcher }),
                  document.getElementById('graphiql'),
                );
              </script>
            </body>
            </html>
          `);
        });
      }
      
      // GraphQL Playground (alternative to GraphiQL)
      if (playground) {
        app.get(path, (req, res) => {
          res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>GraphQL Playground</title>
              <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/graphql-playground-react/build/static/css/index.css" />
              <script src="https://cdn.jsdelivr.net/npm/graphql-playground-react/build/static/js/middleware.js"></script>
            </head>
            <body>
              <div id="root"></div>
              <script>
                window.addEventListener('load', function (event) {
                  GraphQLPlayground.init(document.getElementById('root'), {
                    endpoint: '${path}'
                  })
                })
              </script>
            </body>
            </html>
          `);
        });
      }

      // Setup subscriptions if WebSocket plugin is available
      if (api.websocket && Object.keys(api.graphql.subscriptions).length > 0) {
        setupSubscriptions(api, app, {
          path: subscriptionPath,
          schema: api.graphql.getSchema()
        });
      }
    };

    // Auto-attach if HTTPPlugin is already loaded or app provided in options
    const app = api.app || options.app;
    if (app) {
      // Wait for next tick to ensure all resources are loaded
      process.nextTick(() => {
        api.graphql.attach(app);
      });
    }

    // Introspection query helper
    api.graphql.introspect = async () => {
      const { graphql, getIntrospectionQuery } = await import('graphql');
      const schema = api.graphql.getSchema();
      const result = await graphql({
        schema,
        source: getIntrospectionQuery()
      });
      return result;
    };

    // Federation support (for microservices)
    api.graphql.federate = (serviceName, serviceUrl) => {
      api.graphql.addQuery(`_service_${serviceName}`, {
        type: new GraphQLObjectType({
          name: `${serviceName}Service`,
          fields: {
            name: { type: GraphQLString },
            url: { type: GraphQLString },
            schema: { type: GraphQLString }
          }
        }),
        resolve: () => ({
          name: serviceName,
          url: serviceUrl,
          schema: 'federated'
        })
      });
    };
  }
};