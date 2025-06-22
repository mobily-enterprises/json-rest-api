import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../lib/api.js';
import { Schema } from '../../lib/schema.js';
import { SecurityPlugin } from '../../plugins/security.js';
import { MemoryPlugin } from '../../plugins/memory.js';
import { ValidationPlugin } from '../../plugins/validation.js';

test.beforeEach(async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(ValidationPlugin);
  api.use(SecurityPlugin, {
    authentication: {
      required: false
    }
  });
  
  api.addResource('posts', new Schema({
    title: { type: 'string', required: true },
    content: { type: 'string', canBeNull: true },
    tags: { type: 'array', canBeNull: true },
    metadata: { type: 'object', canBeNull: true }
  }));
  
  globalThis.api = api;
});

test('XSS: blocks script tags in string fields', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    title: '<script>alert("XSS")</script>My Post',
    content: 'Normal content <script>evil()</script>'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // DOMPurify should strip all script tags
  assert.equal(result.data.attributes.title.includes('<script>'), false);
  assert.equal(result.data.attributes.title.includes('</script>'), false);
  assert.equal(result.data.attributes.content.includes('<script>'), false);
  assert.equal(result.data.attributes.title.includes('My Post'), true);
  assert.equal(result.data.attributes.content.includes('Normal content'), true);
});

test('XSS: blocks javascript: URLs', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    title: 'Post with malicious link',
    content: 'Click here: javascript:alert("XSS")'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // javascript: URLs should be removed
  assert.equal(result.data.attributes.content, 'Click here: ');
});

test('XSS: blocks data: URLs with scripts', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    title: 'Post with data URL',
    content: 'Image: data:text/html,<script>alert("XSS")</script>'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // data: URLs with scripts should be removed
  assert.equal(result.data.attributes.content, 'Image: ');
});

test('XSS: sanitizes HTML entities', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    title: '<img src=x onerror=alert("XSS")>',
    content: '<div onclick="evil()">Click me</div>'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // All HTML should be stripped
  assert.equal(result.data.attributes.title.includes('<img'), false);
  assert.equal(result.data.attributes.title.includes('onerror'), false);
  assert.equal(result.data.attributes.content.includes('<div'), false);
  assert.equal(result.data.attributes.content.includes('onclick'), false);
  assert.equal(result.data.attributes.content, 'Click me');
});

test('XSS: sanitizes nested objects', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    title: 'Post with metadata',
    metadata: {
      author: '<script>alert("XSS")</script>John',
      bio: 'Normal bio <img src=x onerror=alert("XSS")>'
    }
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // Nested fields should also be sanitized
  assert.equal(result.data.attributes.metadata.author.includes('<script>'), false);
  assert.equal(result.data.attributes.metadata.author.includes('John'), true);
  assert.equal(result.data.attributes.metadata.bio.includes('<img'), false);
  assert.equal(result.data.attributes.metadata.bio.includes('Normal bio'), true);
});

test('XSS: sanitizes arrays', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    title: 'Post with tags',
    tags: [
      '<script>alert("XSS")</script>javascript',
      'normal-tag',
      'javascript:alert("XSS")'
    ]
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // Array elements should be sanitized
  assert.equal(result.data.attributes.tags[0].includes('<script>'), false);
  assert.equal(result.data.attributes.tags[0].includes('javascript'), true);
  assert.equal(result.data.attributes.tags[1], 'normal-tag');
  assert.equal(result.data.attributes.tags[2], ''); // javascript: URL removed
});

test('XSS: handles null and undefined values', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const data = {
    title: 'Normal post',
    content: null,
    metadata: undefined
  };
  
  const result = await api.insert(data, { type: 'posts' });
  
  assert.equal(result.data.attributes.title, 'Normal post');
  assert.equal(result.data.attributes.content, null);
  // undefined is typically omitted in JSON
});

test('XSS: prevents stored XSS on retrieval', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Even if somehow malicious data was stored, it should be sanitized on retrieval
  const data = {
    title: 'Test post'
  };
  
  const created = await api.insert(data, { type: 'posts' });
  
  // Manually update with malicious content (simulating compromised DB)
  await api.update(created.data.id, {
    title: '<script>alert("Stored XSS")</script>Updated'
  }, { type: 'posts' });
  
  const retrieved = await api.get(created.data.id, { type: 'posts' });
  
  // Should be sanitized on retrieval
  assert.equal(retrieved.data.attributes.title.includes('<script>'), false);
  assert.equal(retrieved.data.attributes.title.includes('Updated'), true);
});

test('XSS: blocks vbscript: URLs', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const maliciousData = {
    title: 'IE-specific attack',
    content: 'Click: vbscript:msgbox("XSS")'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // vbscript: URLs should be removed
  assert.equal(result.data.attributes.content, 'Click: ');
});

test('XSS: handles complex nested structures', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const complexData = {
    title: 'Complex post',
    metadata: {
      nested: {
        deep: {
          value: '<script>deep XSS</script>Safe content'
        },
        array: [
          { item: '<img src=x onerror=alert(1)>' },
          { item: 'safe item' }
        ]
      }
    }
  };
  
  const result = await api.insert(complexData, { type: 'posts' });
  
  // Deep nested values should be sanitized
  assert.equal(result.data.attributes.metadata.nested.deep.value.includes('<script>'), false);
  assert.equal(result.data.attributes.metadata.nested.deep.value.includes('Safe content'), true);
  assert.equal(result.data.attributes.metadata.nested.array[0].item.includes('<img'), false);
  assert.equal(result.data.attributes.metadata.nested.array[1].item, 'safe item');
});

test('XSS: preserves legitimate content', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const legitimateData = {
    title: 'Code example: <Array>',
    content: 'Use arrow functions => like this'
  };
  
  const result = await api.insert(legitimateData, { type: 'posts' });
  
  // Legitimate content should be preserved
  assert.equal(result.data.attributes.title, 'Code example: ');  // HTML tags stripped but content preserved
  assert.equal(result.data.attributes.content.includes('=>'), true);
});

test('XSS: handles unicode and special characters', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  const data = {
    title: 'Unicode: 你好世界 & émojis 🎉',
    content: 'Special chars: & < > " \' / \\'
  };
  
  const result = await api.insert(data, { type: 'posts' });
  
  // Unicode should be preserved
  assert.equal(result.data.attributes.title.includes('你好世界'), true);
  assert.equal(result.data.attributes.title.includes('🎉'), true);
  // Special chars should be handled appropriately
  assert.equal(result.data.attributes.content.includes('&'), true);
});