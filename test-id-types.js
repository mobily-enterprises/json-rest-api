import { Api, Schema, MemoryPlugin, MySQLPlugin } from './index.js';

async function testIdTypes() {
  console.log('Testing ID types for Memory and MySQL plugins...\n');
  
  const schema = new Schema({
    name: { type: 'string', required: true }
  });
  
  // Test Memory Plugin
  console.log('=== Testing Memory Plugin ===');
  const memoryApi = new Api();
  memoryApi.use(MemoryPlugin);
  memoryApi.addResource('users', schema);
  await memoryApi.execute('db.connect', {});
  
  const memoryUser = await memoryApi.insert({ name: 'Memory User' }, { type: 'users' });
  console.log('Memory Plugin ID:', memoryUser.data.id);
  console.log('Memory Plugin ID type:', typeof memoryUser.data.id);
  console.log('Memory Plugin full response:', JSON.stringify(memoryUser, null, 2));
  
  // Test MySQL Plugin (if configured)
  if (process.env.MYSQL_USER && process.env.MYSQL_PASSWORD) {
    console.log('\n=== Testing MySQL Plugin ===');
    const mysqlApi = new Api();
    mysqlApi.use(MySQLPlugin, {
      connection: {
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE || 'test'
      }
    });
    mysqlApi.addResource('users', schema);
    await mysqlApi.execute('db.connect', {});
    
    const mysqlUser = await mysqlApi.insert({ name: 'MySQL User' }, { type: 'users' });
    console.log('MySQL Plugin ID:', mysqlUser.data.id);
    console.log('MySQL Plugin ID type:', typeof mysqlUser.data.id);
    console.log('MySQL Plugin full response:', JSON.stringify(mysqlUser, null, 2));
    
    await mysqlApi.execute('db.disconnect', {});
  } else {
    console.log('\n[Skipped MySQL test - set MYSQL_USER and MYSQL_PASSWORD env vars to test]');
  }
}

testIdTypes().catch(console.error);