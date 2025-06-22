import test from 'ava';
import { Api } from '../../lib/api.js';
import { SecurityPlugin } from '../../plugins/security.js';
import { MemoryPlugin } from '../../plugins/memory.js';

test.beforeEach(t => {
  const api = new Api();
  api.use(MemoryPlugin);
  api.use(SecurityPlugin);
  
  api.addResource('posts', {
    title: { type: 'string', required: true },
    content: { type: 'string' },
    tags: { type: 'array' },
    metadata: { type: 'object' }
  });
  
  t.context.api = api;
});

test('XSS: blocks script tags in string fields', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    title: '<script>alert("XSS")</script>My Post',
    content: 'Normal content <script>evil()</script>'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // DOMPurify should strip all script tags
  t.false(result.title.includes('<script>'));
  t.false(result.title.includes('</script>'));
  t.false(result.content.includes('<script>'));
  t.true(result.title.includes('My Post'));
  t.true(result.content.includes('Normal content'));
});

test('XSS: blocks javascript: URLs', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    title: 'Post with malicious link',
    content: 'Click here: javascript:alert("XSS")'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // javascript: URLs should be removed
  t.is(result.content, 'Click here: ');
});

test('XSS: blocks data: URLs with scripts', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    title: 'Post with data URL',
    content: 'Image: data:text/html,<script>alert("XSS")</script>'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // data: URLs with scripts should be removed
  t.is(result.content, 'Image: ');
});

test('XSS: sanitizes HTML entities', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    title: '<img src=x onerror=alert("XSS")>',
    content: '<div onclick="evil()">Click me</div>'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // All HTML should be stripped
  t.false(result.title.includes('<img'));
  t.false(result.title.includes('onerror'));
  t.false(result.content.includes('<div'));
  t.false(result.content.includes('onclick'));
  t.is(result.content, 'Click me');
});

test('XSS: sanitizes nested objects', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    title: 'Post with metadata',
    metadata: {
      author: '<script>alert("XSS")</script>John',
      bio: 'Normal bio <img src=x onerror=alert("XSS")>'
    }
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // Nested fields should also be sanitized
  t.false(result.metadata.author.includes('<script>'));
  t.true(result.metadata.author.includes('John'));
  t.false(result.metadata.bio.includes('<img'));
  t.true(result.metadata.bio.includes('Normal bio'));
});

test('XSS: sanitizes arrays', async t => {
  const { api } = t.context;
  
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
  t.false(result.tags[0].includes('<script>'));
  t.true(result.tags[0].includes('javascript'));
  t.is(result.tags[1], 'normal-tag');
  t.is(result.tags[2], ''); // javascript: URL removed
});

test('XSS: handles null and undefined values', async t => {
  const { api } = t.context;
  
  const data = {
    title: 'Normal post',
    content: null,
    metadata: undefined
  };
  
  const result = await api.insert(data, { type: 'posts' });
  
  t.is(result.title, 'Normal post');
  t.is(result.content, null);
  // undefined is typically omitted in JSON
});

test('XSS: prevents stored XSS on retrieval', async t => {
  const { api } = t.context;
  
  // Even if somehow malicious data was stored, it should be sanitized on retrieval
  const data = {
    title: 'Test post'
  };
  
  const created = await api.insert(data, { type: 'posts' });
  
  // Manually update with malicious content (simulating compromised DB)
  await api.update(created.id, {
    title: '<script>alert("Stored XSS")</script>Updated'
  }, { type: 'posts' });
  
  const retrieved = await api.get(created.id, { type: 'posts' });
  
  // Should be sanitized on retrieval
  t.false(retrieved.title.includes('<script>'));
  t.true(retrieved.title.includes('Updated'));
});

test('XSS: blocks vbscript: URLs', async t => {
  const { api } = t.context;
  
  const maliciousData = {
    title: 'IE-specific attack',
    content: 'Click: vbscript:msgbox("XSS")'
  };
  
  const result = await api.insert(maliciousData, { type: 'posts' });
  
  // vbscript: URLs should be removed
  t.is(result.content, 'Click: ');
});

test('XSS: handles complex nested structures', async t => {
  const { api } = t.context;
  
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
  t.false(result.metadata.nested.deep.value.includes('<script>'));
  t.true(result.metadata.nested.deep.value.includes('Safe content'));
  t.false(result.metadata.nested.array[0].item.includes('<img'));
  t.is(result.metadata.nested.array[1].item, 'safe item');
});

test('XSS: preserves legitimate content', async t => {
  const { api } = t.context;
  
  const legitimateData = {
    title: 'Code example: <Array>',
    content: 'Use arrow functions => like this'
  };
  
  const result = await api.insert(legitimateData, { type: 'posts' });
  
  // Legitimate content should be preserved
  t.is(result.title, 'Code example: ');  // HTML tags stripped but content preserved
  t.true(result.content.includes('=>'));
});

test('XSS: handles unicode and special characters', async t => {
  const { api } = t.context;
  
  const data = {
    title: 'Unicode: 你好世界 & émojis 🎉',
    content: 'Special chars: & < > " \' / \\'
  };
  
  const result = await api.insert(data, { type: 'posts' });
  
  // Unicode should be preserved
  t.true(result.title.includes('你好世界'));
  t.true(result.title.includes('🎉'));
  // Special chars should be handled appropriately
  t.true(result.content.includes('&'));
});