/**
 * http-plugin-express.js
 * This plugin for Hooked API provides an HTTP layer using the Express.js framework.
 * It automatically generates JSON:API compliant RESTful routes for each scope
 * added to the API instance.
 */
import { HookedApiError } from './hooked-api.js';
import { handleApiError } from './error-handler.js';

export const HttpExpressPlugin = {
  name: 'http-express',

  /**
   * Installs the HTTP plugin, connecting the API to an Express app.
   * @param {object} context - The installation context from Hooked API.
   * @param {object} context.pluginOptions - Options passed during `api.use()`.
   * @param {Express.Application} context.pluginOptions.http.app - The Express app instance. (Required)
   * @param {string} [context.pluginOptions.http.prefix='/api'] - The URL prefix for all API routes.
   * @param {Api} api - The API instance itself.
   */
  install(context, api) {
    const { pluginOptions, log } = context;
    const httpOptions = pluginOptions.http || {};
    
    const { app, prefix = '/api' } = httpOptions;

    if (!app) {
      throw new HookedApiError(
        "The 'http-express' plugin requires an Express 'app' instance to be passed in the options. Example: api.use(HttpExpressPlugin, { http: { app: myExpressApp } })",
        'CONFIGURATION_ERROR'
      );
    }

    log.info(`Express HTTP plugin installed. Routes will be prefixed with '${prefix}'.`);

    /**
     * Creates a generic Express request handler for a specific API method.
     * This factory function avoids code duplication for route handlers.
     * @param {string} methodName - The name of the scope method to call (e.g., 'get', 'query').
     * @returns {Function} An async Express route handler.
     */
    const _createRequestHandler = (methodName) => {
      // This is an async function that Express 5 will handle correctly,
      // automatically catching promise rejections and passing them to the error handler.
      return async (req, res, next) => {
        const { scopeName, id } = req.params;

        try {
          // 1. Translate Express req into the API method's specific params object.
          const apiParams = {};

          if (['get', 'put', 'patch', 'delete'].includes(methodName)) {
            apiParams.id = id;
          }
          if (['query', 'get', 'post', 'put', 'patch'].includes(methodName)) {
            // Express automatically parses simple query strings. For nested objects
            // like `fields[articles]`, ensure the 'qs' query parser is enabled in your main app.
            apiParams.queryParams = req.query;
          }
          if (['post', 'put', 'patch'].includes(methodName)) {
            // Assumes `express.json()` body-parser middleware is used on the app.
            apiParams.inputRecord = req.body;
          }

          log.debug(`Express request for ${scopeName}.${methodName}`, { id, query: req.query });

          // 2. Execute the corresponding API method
          const result = await api.scopes[scopeName][methodName](apiParams);

          // 3. Send the successful HTTP response
          switch (methodName) {
            case 'post':
              res.status(201).json(result);
              break;
            case 'delete':
              res.status(204).send();
              break;
            default:
              res.status(200).json(result);
          }
        } catch (error) {
          // 4. Pass any errors to Express's next-tick error handler.
          next(error);
        }
      };
    };

    /**
     * Creates all the standard RESTful routes for a given scope.
     * @param {string} scopeName - The name of the scope to create routes for.
     */
    const _createRoutesForScope = (scopeName) => {
      // Use a new router for each scope to keep things clean.
      const router = express.Router();
      const basePath = `/${scopeName}`;
      const singlePath = `${basePath}/:id`;

      log.info(`Creating Express HTTP routes for scope: '${scopeName}'`);

      router.get('/', _createRequestHandler('query'));
      router.get('/:id', _createRequestHandler('get'));
      router.post('/', _createRequestHandler('post'));
      router.put('/:id', _createRequestHandler('put'));
      router.patch('/:id', _createRequestHandler('patch'));
      router.delete('/:id', _createRequestHandler('delete'));
      
      // Mount the scope's router on the main app at the correct prefix.
      app.use(prefix, router);
    };

    // --- Main Logic: Wrap `addScope` to automate route creation ---
    const originalAddScope = api.addScope;

    api.addScope = (name, options, extras) => {
      const result = originalAddScope.call(api, name, options, extras);
      _createRoutesForScope(name);
      return result;
    };
  }
};
