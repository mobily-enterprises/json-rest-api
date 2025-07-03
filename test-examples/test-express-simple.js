import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api';
import express from 'express';

const api = new Api({
  name: 'my-library-api',
  version: '1.0.0'
});

try {
  // Add plugins
  api.use(RestApiPlugin);
  api.use(FileHandlingPlugin);
  api.use(ExpressPlugin);
  
  console.log('All plugins loaded successfully');
  
  // Wait for async installation
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log('Checking API methods after wait:');
  console.log('- getExpressRouter:', typeof api.getExpressRouter);
  console.log('- mountExpress:', typeof api.mountExpress);
  
} catch (error) {
  console.error('Plugin installation error:', error);
  process.exit(1);
}