import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../lib/api.js';
import { Schema } from '../../lib/schema.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';
import { AuditLogPlugin } from '../../plugins/audit-log.js';
import { AuthorizationPlugin } from '../../plugins/authorization.js';

test.beforeEach(async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  
  const logs = [];
  api.use(AuditLogPlugin, {
    logToConsole: false,
    onSecurityEvent: async (event) => {
      logs.push(event);
    }
  });
  
  globalThis.api = api;
  globalThis.logs = logs;
});

test('Audit logging: logs authentication failures', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Emit auth failure event
  await api.runHooks('authenticationFailed', {
    attemptedUserId: 'user123',
    authMethod: 'password',
    reason: 'Invalid credentials'
  });
  
  assert.equal(logs.length, 1);
  assert.equal(logs[0].type, 'AUTH_FAILURE');
  assert.equal(logs[0].severity, 'WARNING');
  assert.equal(logs[0].userId, 'user123');
  assert.equal(logs[0].reason, 'Invalid credentials');
  assert.ok(logs[0].timestamp);
  assert.ok(logs[0].id);
});

test('Audit logging: logs data modifications', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  const user = { id: 123, name: 'testuser' };
  
  // Create
  const item = await api.insert(
    { name: 'Test item' },
    { type: 'items', user }
  );
  
  // Update
  await api.update(
    item.id,
    { name: 'Updated item' },
    { type: 'items', user }
  );
  
  // Delete
  await api.delete(item.id, { type: 'items', user });
  
  // Check logs
  const createLog = logs.find(l => l.type === 'DATA_CREATE');
  assert.ok(createLog);
  assert.equal(createLog.userId, 123);
  assert.equal(createLog.resource, 'items');
  assert.equal(createLog.recordId, item.id);
  
  const updateLog = logs.find(l => l.type === 'DATA_UPDATE');
  assert.ok(updateLog);
  assert.deepEqual(updateLog.changedFields, ['name']);
  
  const deleteLog = logs.find(l => l.type === 'DATA_DELETE');
  assert.ok(deleteLog);
  assert.equal(deleteLog.severity, 'WARNING');
  assert.equal(deleteLog.recordId, item.id);
});

test('Audit logging: logs authorization failures', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  api.use(AuthorizationPlugin, {
    roles: {
      user: ['items.read']
    }
  });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  const user = { id: 456, roles: ['user'] };
  
  // Try unauthorized create
  try {
    await api.insert(
      { name: 'Test' },
      { type: 'items', user }
    );
  } catch (error) {
    // Expected
  }
  
  const authzLog = logs.find(l => l.type === 'AUTHZ_FAILURE');
  assert.ok(authzLog);
  assert.equal(authzLog.userId, 456);
  assert.equal(authzLog.resource, 'items');
  assert.equal(authzLog.operation, 'insert');
  assert.equal(authzLog.permission, 'items.create');
});

test('Audit logging: logs rate limit violations', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  await api.runHooks('rateLimitExceeded', {
    rateLimitKey: '192.168.1.100',
    limit: 100,
    window: 900000,
    options: {
      request: {
        ip: '192.168.1.100',
        headers: { 'user-agent': 'TestBot/1.0' }
      }
    }
  });
  
  const rateLog = logs.find(l => l.type === 'RATE_LIMIT_EXCEEDED');
  assert.ok(rateLog);
  assert.equal(rateLog.identifier, '192.168.1.100');
  assert.equal(rateLog.limit, 100);
  assert.equal(rateLog.ip, '192.168.1.100');
  assert.equal(rateLog.userAgent, 'TestBot/1.0');
});

test('Audit logging: query audit logs with filters', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Create various events
  const events = [
    { type: 'AUTH_FAILURE', severity: 'WARNING', userId: 1 },
    { type: 'AUTH_SUCCESS', severity: 'INFO', userId: 2 },
    { type: 'DATA_ACCESS', severity: 'INFO', userId: 1, resource: 'users' },
    { type: 'DATA_DELETE', severity: 'WARNING', userId: 2, resource: 'posts' },
    { type: 'AUTHZ_FAILURE', severity: 'WARNING', userId: 3 }
  ];
  
  for (const event of events) {
    await api.auditLog(event);
  }
  
  // Query by type
  const authFailures = await api.queryAuditLogs({ type: 'AUTH_FAILURE' });
  assert.equal(authFailures.length, 1);
  
  // Query by severity
  const warnings = await api.queryAuditLogs({ severity: 'WARNING' });
  assert.equal(warnings.length, 3);
  
  // Query by user
  const user1Logs = await api.queryAuditLogs({ userId: 1 });
  assert.equal(user1Logs.length, 2);
  
  // Query by resource
  const userLogs = await api.queryAuditLogs({ resource: 'users' });
  assert.equal(userLogs.length, 1);
});

test('Audit logging: generates statistics', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Create test events
  const testEvents = [
    { type: 'AUTH_FAILURE', severity: 'WARNING', userId: 1 },
    { type: 'AUTH_FAILURE', severity: 'WARNING', userId: 2 },
    { type: 'AUTH_SUCCESS', severity: 'INFO', userId: 1 },
    { type: 'DATA_ACCESS', severity: 'INFO', userId: 1, resource: 'users' },
    { type: 'DATA_ACCESS', severity: 'INFO', userId: 2, resource: 'users' },
    { type: 'DATA_ACCESS', severity: 'INFO', userId: 1, resource: 'posts' },
    { type: 'DATA_DELETE', severity: 'WARNING', userId: 1, resource: 'posts' }
  ];
  
  for (const event of testEvents) {
    await api.auditLog(event);
  }
  
  const stats = await api.getAuditStats();
  
  assert.equal(stats.total, 7);
  
  // By type
  assert.equal(stats.byType.AUTH_FAILURE, 2);
  assert.equal(stats.byType.AUTH_SUCCESS, 1);
  assert.equal(stats.byType.DATA_ACCESS, 3);
  assert.equal(stats.byType.DATA_DELETE, 1);
  
  // By severity
  assert.equal(stats.bySeverity.WARNING, 3);
  assert.equal(stats.bySeverity.INFO, 4);
  
  // By user
  assert.equal(stats.byUser[1], 5);
  assert.equal(stats.byUser[2], 2);
  
  // By resource
  assert.equal(stats.byResource.users, 2);
  assert.equal(stats.byResource.posts, 2);
});

test('Audit logging: different log formats', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const outputs = [];
  
  // Test JSON format
  const apiJson = new Api();
  apiJson.use(AuditLogPlugin, {
    format: 'json',
    logToConsole: false,
    onSecurityEvent: async (event) => {
      outputs.push({ format: 'json', output: JSON.stringify(event) });
    }
  });
  
  await apiJson.auditLog({
    type: 'TEST_EVENT',
    severity: 'INFO'
  });
  
  // Test syslog format
  const apiSyslog = new Api();
  apiSyslog.use(AuditLogPlugin, {
    format: 'syslog',
    logToConsole: false
  });
  
  // Test CEF format
  const apiCef = new Api();
  apiCef.use(AuditLogPlugin, {
    format: 'cef',
    logToConsole: false
  });
  
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].format, 'json');
  assert.ok(JSON.parse(outputs[0].output));
});

test('Audit logging: security violation events', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  await api.runHooks('securityViolation', {
    violationType: 'CSRF_TOKEN_INVALID',
    severity: 'WARNING',
    details: {
      method: 'POST',
      path: '/api/users',
      hasRequestToken: false
    },
    options: {
      user: { id: 789 }
    }
  });
  
  const violation = logs.find(l => l.type === 'CSRF_TOKEN_INVALID');
  assert.ok(violation);
  assert.equal(violation.severity, 'WARNING');
  assert.equal(violation.userId, 789);
  assert.equal(violation.details.hasRequestToken, false);
});

test('Audit logging: request context inclusion', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const mockRequest = {
    ip: '10.0.0.1',
    headers: {
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': '203.0.113.1'
    },
    id: 'req-123'
  };
  
  await api.runHooks('authenticationFailed', {
    attemptedUserId: 'user@example.com',
    authMethod: 'password',
    reason: 'Invalid password',
    options: { request: mockRequest }
  });
  
  const log = logs[0];
  assert.equal(log.ip, '10.0.0.1');
  assert.equal(log.userAgent, 'Mozilla/5.0');
  assert.equal(log.requestId, 'req-123');
});

test('Audit logging: memory store size limits', async () => {
  const api = new Api();
  const storage = new Map();
  
  api.use(AuditLogPlugin, {
    logToConsole: false,
    storage,
    maxLogSize: 5
  });
  
  // Create more than maxLogSize events
  for (let i = 0; i < 10; i++) {
    await api.auditLog({
      type: 'TEST_EVENT',
      id: `event-${i}`
    });
  }
  
  // Should only keep last 5
  assert.equal(storage.size, 5);
  
  // Should have events 5-9
  const ids = Array.from(storage.values()).map(e => e.id);
  assert.deepEqual(ids, ['event-5', 'event-6', 'event-7', 'event-8', 'event-9']);
});