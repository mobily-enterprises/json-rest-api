// Import express first to ensure it's available
import express from 'express';
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'jsonrestapi';

// Make express available globally for the plugin
global.express = express;

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

// Add plugins
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);

// Temporarily patch the Express plugin to use our express
const originalInstall = ExpressPlugin.install;
ExpressPlugin.install = async function(context) {
  // Override the express import in the plugin
  const patchedContext = {
    ...context,
    vars: { ...context.vars, _express: express }
  };
  
  // Call original install
  await originalInstall.call(this, patchedContext);
  
  // If express wasn't loaded, use our version
  if (!patchedContext.vars.express.router) {
    const router = express.Router({ mergeParams: true });
    patchedContext.vars.express.router = router;
  }
};

api.use(ExpressPlugin);

// Add a simple test resource
api.addResource('test', {
  schema: {
    name: { type: 'string', required: true }
  }
});

// Add test data helper
api.customize({
  vars: {
    helpers: {
      dataQuery: async () => ({ data: [] })
    }
  }
});

console.log('✓ All plugins loaded successfully!');

// Create Express app and test
const app = express();

// Check if methods are available
console.log('API methods available:', Object.keys(api).filter(k => typeof api[k] === 'function'));

// Try the simpler approach - using the Express router directly
if (api.getExpressRouter) {
  app.use('/api', api.getExpressRouter());
  console.log('✓ Express router mounted successfully!');
} else {
  console.log('✗ getExpressRouter method not found');
}

process.exit(0);