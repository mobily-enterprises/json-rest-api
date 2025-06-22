#!/usr/bin/env node

import { spawn } from 'child_process';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runAllTests() {
  console.log('🔒 Running Comprehensive Security Test Suite\n');
  
  const testFiles = await readdir(__dirname);
  const tests = testFiles.filter(file => 
    file.startsWith('test-') && file.endsWith('.js')
  );
  
  console.log(`Found ${tests.length} security test files\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log(`\n📋 Running ${test}...`);
    console.log('─'.repeat(50));
    
    try {
      await runTest(join(__dirname, test));
      passed++;
      console.log(`✅ ${test} passed`);
    } catch (error) {
      failed++;
      console.log(`❌ ${test} failed`);
    }
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log('🏁 Security Test Suite Summary:');
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📊 Total: ${tests.length}`);
  console.log('═'.repeat(50) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

function runTest(testFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['ava', testFile], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' }
    });
    
    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

// Run with detailed MySQL tests if configured
if (process.env.RUN_MYSQL_TESTS === 'true' && process.env.MYSQL_USER) {
  console.log('🐬 MySQL tests enabled\n');
}

runAllTests().catch(console.error);