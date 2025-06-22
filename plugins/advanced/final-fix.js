// Final fixes for test issues
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function fixCacheVariables() {
  console.log('Fixing cache test variables...');
  const path = join(__dirname, 'cache/cache.test.js');
  let content = await readFile(path, 'utf8');
  
  // Fix undefined variables
  content = content.replace(/items\.push\(item\);/g, 'items.push(itemResponse);');
  content = content.replace(/await smallApi\.resources\.items\.get\(itemId\);/g, 
    'await smallApi.resources.items.get(itemResponse.data.id);');
  content = content.replace(/await smallApi\.resources\.large\.get\(itemId\);/g, 
    'await smallApi.resources.large.get(itemResponse.data.id);');
  content = content.replace(/await brokenApi\.resources\.test\.get\(itemId\);/g, 
    'await brokenApi.resources.test.get(itemResponse.data.id);');
  
  // Fix user references
  content = content.replace(/await api\.resources\.posts\.insert\({\s*title: 'Test Post',\s*authorId: userId/g,
    'await api.resources.posts.insert({\n        title: \'Test Post\',\n        authorId: user.data.id');
  
  // Add missing userId definition
  content = content.replace(/await api\.resources\.users\.get\(userId\);/g, function(match, offset) {
    const before = content.substring(Math.max(0, offset - 200), offset);
    if (!before.includes('const userId =')) {
      return 'const userId = userResponse.data.id;\n      ' + match;
    }
    return match;
  });
  
  await writeFile(path, content);
}

async function fixInterceptorsResult() {
  console.log('Fixing interceptors test result access...');
  const path = join(__dirname, 'interceptors/interceptors.test.js');
  let content = await readFile(path, 'utf8');
  
  // Fix result.id references
  content = content.replace(/const resultId = result\.data\.id;/g, '');
  content = content.replace(/assert\.equal\(resultId, 'recovered-1'\);/g, 
    'assert.equal(result.data.id, \'recovered-1\');');
  content = content.replace(/const stored = await api\.resources\.items\.get\(resultId\);/g,
    'const stored = await api.resources.items.get(result.data.id);');
  
  // Fix data.recovered
  content = content.replace(/assert\.equal\(result\.fail, false\);/g,
    'assert.equal(result.data.fail, false);');
  
  await writeFile(path, content);
}

async function fixVersioningFields() {
  console.log('Fixing versioning test fields...');
  const path = join(__dirname, 'versioning/versioning.test.js');
  let content = await readFile(path, 'utf8');
  
  // Remove any remaining fields: wrappers
  content = content.replace(/addResource\('(\w+)', new Schema\({\s*fields: {/g, 
    'addResource(\'$1\', new Schema({');
  
  await writeFile(path, content);
}

await fixCacheVariables();
await fixInterceptorsResult();
await fixVersioningFields();

console.log('\nApplying final fixes completed!');