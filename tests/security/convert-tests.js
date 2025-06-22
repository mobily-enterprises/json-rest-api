#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function convertTest(filePath) {
  console.log(`Converting ${filePath}...`);
  
  let content = await readFile(filePath, 'utf8');
  
  // Replace imports
  content = content.replace(
    "import test from 'ava';",
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';"
  );
  
  // Replace test.beforeEach
  content = content.replace(
    /test\.beforeEach\(t => \{/g,
    'test.beforeEach(async () => {'
  );
  
  content = content.replace(
    /test\.beforeEach\(async t => \{/g,
    'test.beforeEach(async () => {'
  );
  
  // Replace t.context assignments and usage
  content = content.replace(/t\.context\.(\w+) = /g, 'globalThis.$1 = ');
  content = content.replace(/t\.context\.(\w+)/g, 'globalThis.$1');
  content = content.replace(/const \{ (\w+(?:, \w+)*) \} = t\.context;/g, '');
  
  // Replace test callbacks
  content = content.replace(/test\('([^']+)', async t => \{/g, "test('$1', async () => {");
  content = content.replace(/test\('([^']+)', t => \{/g, "test('$1', () => {");
  
  // Replace assertions
  // t.truthy(x) -> assert.ok(x)
  content = content.replace(/t\.truthy\(/g, 'assert.ok(');
  
  // t.falsy(x) -> assert.ok(!x) or assert.equal(x, false/null/undefined)
  content = content.replace(/t\.falsy\(/g, 'assert.ok(!');
  
  // t.true(x) -> assert.equal(x, true)
  content = content.replace(/t\.true\(/g, 'assert.equal(');
  content = content.replace(/assert\.equal\(([^)]+)\)/g, (match, arg) => {
    if (match.includes('assert.equal(')) {
      return `assert.equal(${arg}, true)`;
    }
    return match;
  });
  
  // t.false(x) -> assert.equal(x, false)
  content = content.replace(/t\.false\(/g, 'assert.equal(');
  
  // Fix the assert.equal calls that were from t.false
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Look for assert.equal that came from t.false
    if (lines[i].includes('assert.equal(') && !lines[i].includes(', true)') && !lines[i].includes(', false)')) {
      // Check if this line originally had t.false
      if (lines[i].includes('.includes(') || lines[i].includes('!')) {
        lines[i] = lines[i].replace(/assert\.equal\(([^)]+)\);/g, 'assert.equal($1, false);');
      }
    }
  }
  content = lines.join('\n');
  
  // t.is(a, b) -> assert.equal(a, b) or assert.strictEqual(a, b)
  content = content.replace(/t\.is\(/g, 'assert.equal(');
  
  // t.not(a, b) -> assert.notEqual(a, b)
  content = content.replace(/t\.not\(/g, 'assert.notEqual(');
  
  // t.deepEqual(a, b) -> assert.deepEqual(a, b) or assert.deepStrictEqual(a, b)
  content = content.replace(/t\.deepEqual\(/g, 'assert.deepEqual(');
  
  // t.throws and t.throwsAsync
  content = content.replace(/await t\.throwsAsync\(/g, 'await assert.rejects(');
  content = content.replace(/t\.throws\(/g, 'assert.throws(');
  
  // Fix message patterns in throws/rejects
  content = content.replace(/\{ message: \/([^/]+)\/ \}/g, '{ message: /$1/ }');
  
  // Fix any remaining references to t.context
  content = content.replace(/const api = globalThis\.api;/g, 'const api = globalThis.api;');
  content = content.replace(/const logs = globalThis\.logs;/g, 'const logs = globalThis.logs;');
  
  await writeFile(filePath, content);
  console.log(`✅ Converted ${filePath}`);
}

async function main() {
  const dir = process.cwd();
  const files = await readdir(dir);
  
  const testFiles = files.filter(f => 
    f.startsWith('test-') && 
    f.endsWith('.js') && 
    f !== 'test-all-security.js'
  );
  
  console.log(`Found ${testFiles.length} test files to convert\n`);
  
  for (const file of testFiles) {
    await convertTest(join(dir, file));
  }
  
  console.log('\n✅ All tests converted!');
}

main().catch(console.error);