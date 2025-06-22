#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function fixTest(filePath) {
  console.log(`Fixing ${filePath}...`);
  
  let content = await readFile(filePath, 'utf8');
  
  // Fix the remaining t.context reference
  content = content.replace(/t\.context = \{ api, logs \};/g, 'globalThis.api = api;\n  globalThis.logs = logs;');
  
  // Fix assert.equal calls that should be checking for false
  content = content.replace(/assert\.equal\((.+?\.includes\([^)]+\))\);/g, (match, arg) => {
    return `assert.equal(${arg}, false);`;
  });
  
  // Fix assert.equal calls with true
  content = content.replace(/assert\.equal\((.+?\.includes\([^)]+\)), true\);/g, (match, arg) => {
    return `assert.equal(${arg}, true);`;
  });
  
  // Fix t.fail
  content = content.replace(/t\.fail\(/g, 'assert.fail(');
  
  // Fix assert.equal(x.includes(y, z)) patterns
  content = content.replace(/assert\.equal\((.+?)\.includes\(([^,)]+), (true|false)\)\);/g, (match, obj, search, bool) => {
    return `assert.equal(${obj}.includes(${search}), ${bool});`;
  });
  
  // Fix globalThis references in function scope
  content = content.replace(/const api = globalThis\.api;/g, 'const api = globalThis.api;');
  content = content.replace(/const logs = globalThis\.logs;/g, 'const logs = globalThis.logs;');
  
  // Remove empty lines after test function declaration
  content = content.replace(/test\('(.+?)', async \(\) => \{\n\s*\n\s*\n/g, "test('$1', async () => {\n  const api = globalThis.api;\n  const logs = globalThis.logs;\n  \n");
  
  // Fix specific patterns in error-sanitization test
  content = content.replace(/assert\.equal\(error\.message\.includes\('([^']+)', true\)\);/g, "assert.equal(error.message.includes('$1'), true);");
  content = content.replace(/assert\.equal\(error\.stack\.includes\('([^']+)'\)\);/g, "assert.equal(error.stack.includes('$1'), false);");
  
  // Fix specific patterns in security-headers test  
  content = content.replace(/assert\.equal\((.+?)\.includes\("([^"]+)", true\)\);/g, 'assert.equal($1.includes("$2"), true);');
  content = content.replace(/assert\.equal\((.+?)\.includes\('([^']+)', true\)\);/g, "assert.equal($1.includes('$2'), true);");
  
  // Fix audit-logging test specific issue
  content = content.replace(/assert\.equal\(violation\.details\.hasRequestToken\);/g, 'assert.equal(violation.details.hasRequestToken, false);');
  
  await writeFile(filePath, content);
  console.log(`✅ Fixed ${filePath}`);
}

async function main() {
  const dir = process.cwd();
  const files = await readdir(dir);
  
  const testFiles = files.filter(f => 
    f.startsWith('test-') && 
    f.endsWith('.js') && 
    f !== 'test-all-security.js'
  );
  
  console.log(`Found ${testFiles.length} test files to fix\n`);
  
  for (const file of testFiles) {
    await fixTest(join(dir, file));
  }
  
  console.log('\n✅ All tests fixed!');
}

main().catch(console.error);