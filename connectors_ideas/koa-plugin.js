/**
 * http-plugin-koa.js
 * This plugin for Hooked API provides a lightweight HTTP layer using the Koa.js framework.
 * It automatically generates JSON:API compliant RESTful routes for each scope using `koa-router`.
 *
 * It assumes you have `koa-bodyparser` installed and used before this plugin.
 * You'll need to install dependencies: npm install koa koa-router koa-bodyparser qs
 */
import KoaRouter from 'koa-router';
import qs from 'qs'; // The same query string parser Express uses
import { HookedApiError } from './hooked-api.js';
import { handleKoaApiError } from './error-handler-koa.js';

export const HttpKoaPlugin = {
  name: 'http-koa',

  install(context, api) {
    const { pluginOptions, log } = context;
    const httpOptions = pluginOptions.http || {};
    const { app, prefix = '/api' } = httpOptions;

    if (!app) {
      throw new HookedApiError(
        "The 'http-koa' plugin requires a Koa 'app' instance to be passed in the options. Example: api.use(HttpKoaPlugin, { http: { app: myKoaApp } })",
        'CONFIGURATION_ERROR'
      );
    }
    
    // Create a router instance for our API routes
    const router = new KoaRouter({ prefix });

    /**
     * Creates a generic Koa middleware for a specific API method.
     * @param {string} methodName - The name of the scope method to call (e.g., 'get', 'query').
     * @returns {Function} An async Koa middleware function.
     */
    const _createKoaHandler = (methodName) => {
      return async (ctx) => {
        const { scopeName, id } = ctx.params;
        
        try {
          // 1. Translate Koa ctx into API method params
          const apiParams = {};
          
          if (['get', 'put', 'patch', 'delete'].includes(methodName)) {
            apiParams.id = id;
          }
          if (['post', 'put', 'patch'].includes(methodName)) {
            // Assumes koa-bodyparser is used
            apiParams.inputRecord = ctx.request.body;
          }
          // Use qs to properly parse nested query objects
          apiParams.queryParams = ctx.querystring ? qs.parse(ctx.querystring) : {};

          log.debug(`Koa request for ${scopeName}.${methodName}`, { id, query: apiParams.queryParams });

          // 2. Execute the corresponding API method
          const result = await api.scopes[scopeName][methodName](apiParams);
          
          // 3. Set the successful Koa response
          switch (methodName) {
            case 'post':
              ctx.status = 201;
              ctx.body = result;
              break;
            case 'delete':
              ctx.status = 204;
              // No body for 204
              break;
            default:
              ctx.status = 200;
              ctx.body = result;
          }

        } catch (error) {
          // 4. Handle any errors thrown by the API
          handleKoaApiError(error, ctx, log);
        }
      };
    };

    /**
     * Creates all the standard RESTful routes for a given scope on the router.
     * @param {string} scopeName - The name of the scope to create routes for.
     */
    const _createRoutesForScope = (scopeName) => {
      const collectionPath = `/${scopeName}`;
      const resourcePath = `${collectionPath}/:id`;

      log.info(`Creating Koa HTTP routes for scope: '${scopeName}'`);

      router.get(collectionPath, _createKoaHandler('query'));
      router.get(resourcePath, _createKoaHandler('get'));
      router.post(collectionPath, _createKoaHandler('post'));
      router.put(resourcePath, _createKoaHandler('put'));
      router.patch(resourcePath, _createKoaHandler('patch'));
      router.del(resourcePath, _createKoaHandler('delete')); // .del is koa-router's alias for delete
    };

    // --- Main Logic: Wrap `addScope` to automate route creation ---
    const originalAddScope = api.addScope;

    api.addScope = (name, options, extras) => {
      const result = originalAddScope.call(api, name, options, extras);
      _createRoutesForScope(name);
      return result;
    };
    
    // Apply the router middleware to the Koa app
    app.use(router.routes()).use(router.allowedMethods());
    log.info(`Koa router installed with prefix '${prefix}'.`);
  }
};
