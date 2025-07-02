/**
 * http-plugin.js
 * * This plugin for Hooked API provides a lightweight HTTP layer using Node.js's native `http` module.
 * It creates a server and automatically generates JSON:API compliant RESTful routes for each scope.
 *
 * It uses the 'qs' library to parse complex query strings, just like Express.
 * You'll need to install it: npm install qs
 */
import http from 'http';
import qs from 'qs'; // The same query string parser Express uses
import { HookedApiError } from './hooked-api.js';
import { handleApiError } from './error-handler.js';

/**
 * A helper function to parse the JSON body from an incoming request.
 * @param {http.IncomingMessage} req - The request object.
 * @returns {Promise<object|null>} A promise that resolves with the parsed JSON object or null.
 */
async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
      return resolve(null);
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch (error) {
        reject(new HookedApiError('Invalid JSON in request body.', 'BAD_REQUEST'));
      }
    });
    req.on('error', reject);
  });
}

export const HttpPlugin = {
  name: 'http',

  install(context, api) {
    const { pluginOptions, log } = context;
    const httpOptions = pluginOptions.http || {};
    const { port = 3000, prefix = '/api' } = httpOptions;

    // This map will store our route handlers
    const routes = new Map();

    // A simple regex to match our API routes
    // It captures the scope name and an optional ID
    const routeRegex = new RegExp(`^${prefix}/([a-zA-Z0-9_-]+)(?:/([a-zA-Z0-9_-]+))?/?$`);

    /**
     * The main request handler for the http.Server.
     * This function acts as our router.
     */
    const requestListener = async (req, res) => {
      const { url, method } = req;
      const [path, queryString] = url.split('?');

      const match = path.match(routeRegex);

      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ errors: [{ status: '404', title: 'Not Found' }] }));
      }

      const [, scopeName, id] = match;

      // Determine the API method based on the HTTP verb and presence of an ID
      let apiMethodName;
      if (method === 'GET') {
        apiMethodName = id ? 'get' : 'query';
      } else if (method === 'POST' && !id) {
        apiMethodName = 'post';
      } else if (method === 'PUT' && id) {
        apiMethodName = 'put';
      } else if (method === 'PATCH' && id) {
        apiMethodName = 'patch';
      } else if (method === 'DELETE' && id) {
        apiMethodName = 'delete';
      }

      if (!apiMethodName || !api.scopes[scopeName]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ errors: [{ status: '404', title: 'Not Found' }] }));
      }

      try {
        // 1. Translate the native request into API method params
        const apiParams = {};
        
        // Use 'qs' to parse the query string into a nested object
        apiParams.queryParams = queryString ? qs.parse(queryString) : {};
        apiParams.inputRecord = await parseJsonBody(req);
        if (id) {
          apiParams.id = id;
        }

        log.debug(`HTTP request for ${scopeName}.${apiMethodName}`, { id, query: apiParams.queryParams });

        // 2. Execute the corresponding API method
        const result = await api.scopes[scopeName][apiMethodName](apiParams);

        // 3. Send the successful HTTP response
        let statusCode = 200;
        let responseBody = JSON.stringify(result);
        
        if (apiMethodName === 'post') {
            statusCode = 201;
        } else if (apiMethodName === 'delete') {
            statusCode = 204;
            responseBody = null;
        }

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(statusCode);
        res.end(responseBody);

      } catch (error) {
        // 4. Handle any errors thrown by the API
        // Note: The error handler now needs the `res` object directly
        handleApiError(error, res, log);
      }
    };

    // Create and start the HTTP server
    const server = http.createServer(requestListener);
    server.listen(port, () => {
      log.info(`HTTP server started on http://localhost:${port}`);
    });

    // We no longer need to wrap addScope, as the router is dynamic.
    // The plugin's job is simply to start the server.
  }
};
