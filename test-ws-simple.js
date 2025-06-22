import test from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from './index.js';
import { WebSocketPlugin } from './plugins/websocket/index.js';
import { io as ioClient } from 'socket.io-client';
import { createServer } from 'http';
import { robustTeardown } from './tests/test-utils.js';

test('Simple WebSocket Test', async (t) => {
  let api, server, serverUrl;

  t.beforeEach(async () => {
    console.log('Setting up...');
    api = new Api();
    server = createServer();
    
    api.use(MemoryPlugin);
    api.use(WebSocketPlugin);
    
    await api.connect();
    api.websocket.init(server);
    
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://localhost:${port}`;
    console.log('Server listening on', serverUrl);
  });

  t.afterEach(async () => {
    console.log('Tearing down...');
    if (api.websocket) {
      await api.websocket.close();
    }
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    await robustTeardown({ api });
    console.log('Teardown complete');
  });

  await t.test('basic subscription', async () => {
    console.log('Starting basic subscription test');
    
    api.addResource('items', new Schema({
      name: { type: 'string' }
    }));
    
    const client = ioClient(serverUrl, {
      transports: ['websocket']
    });
    
    await new Promise(resolve => client.on('connect', resolve));
    console.log('Client connected');
    
    await new Promise(resolve => {
      client.on('subscription:success', resolve);
      client.emit('subscribe', { resource: 'items' });
    });
    console.log('Subscribed to items');
    
    client.disconnect();
    console.log('Test complete');
  });
});