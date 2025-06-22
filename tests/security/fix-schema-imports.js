#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function fixSchemaImports(filePath) {
  console.log(`Fixing ${filePath}...`);
  
  let content = await readFile(filePath, 'utf8');
  
  // Add Schema import if it's missing
  if (!content.includes("import { Schema }") && content.includes("api.addResource")) {
    content = content.replace(
      "import { Api } from '../../lib/api.js';",
      "import { Api } from '../../lib/api.js';\nimport { Schema } from '../../lib/schema.js';"
    );
  }
  
  // Fix addResource calls to use Schema
  content = content.replace(
    /api\.addResource\('(\w+)', \{([^}]+)\}\);/g,
    (match, resourceName, schemaDefinition) => {
      return `api.addResource('${resourceName}', new Schema({${schemaDefinition}}));`;
    }
  );
  
  // Fix multi-line addResource calls
  content = content.replace(
    /api\.addResource\('(\w+)', \{([^}]+\n[^}]+)\}\);/g,
    (match, resourceName, schemaDefinition) => {
      return `api.addResource('${resourceName}', new Schema({${schemaDefinition}}));`;
    }
  );
  
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
    await fixSchemaImports(join(dir, file));
  }
  
  console.log('\n✅ All tests fixed!');
}

main().catch(console.error);