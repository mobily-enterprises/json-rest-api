#!/usr/bin/env node

/**
 * Test Runner for Plugin Groups
 * 
 * This runner executes tests for specific plugin groups:
 * - core: Core functionality tests
 * - core-extra: Core extra plugin tests
 * - protocols: Protocol plugin tests (GraphQL, gRPC, WebSocket)
 * - infrastructure: Infrastructure plugin tests
 * - enterprise: Enterprise plugin tests
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
let group = null;

// Handle both --group=value and --group value formats
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--group=')) {
    group = args[i].split('=')[1];
    break;
  } else if (args[i] === '--group' && i + 1 < args.length) {
    group = args[i + 1];
    break;
  }
}

if (!group) {
  console.error('Usage: node test-runner.js --group <group-name>');
  console.error('Available groups: core, core-extra, protocols, infrastructure, enterprise');
  process.exit(1);
}

// Define test files for each group
const testGroups = {
  core: [
    // Core functionality tests
    'test-positioning.js',
    'test-field-security-simple.js',
    // HTTP API tests
    'test-crud.js',
    'test-validation.js',
    'test-query-filtering.js',
    'test-sorting-pagination.js',
    'test-relationships.js',
    'test-relationships-joins.js',
    'test-error-handling.js',
    'test-hooks-middleware.js',
    'test-edge-cases.js',
    // Note: Comprehensive core tests are in test-all.js but it also imports
    // tests from other plugin groups (protocols, infrastructure).
    // TODO: Extract core-only tests from test-all.js into separate files
  ],
  
  'core-extra': [
    'test-authorization.js',
    'test-field-security.js',  // Uses AuthorizationPlugin
    'test-cors-plugin.js',
    'test-jwt-plugin.js',
    'test-query-limits.js',
    'test-security-features.js',
    'test-timing-attack-prevention.js',
    'test-views.js',
    'test-http-views.js',
    'test-migrations.js',
  ],
  
  protocols: [
    'test-discovery.js',
    'test-graphql-plugin.js',
    'test-grpc-plugin.js',
    'test-websocket-plugin.js',
    'test-websocket-plugin-old.js',
  ],
  
  infrastructure: [
    'test-api-gateway.js',
    'test-health-plugin.js',
    'test-service-discovery-plugin.js',
  ],
  
  enterprise: [
    // Add enterprise test files here when they exist
  ]
};

const testFiles = testGroups[group];

if (!testFiles) {
  console.error(`Unknown group: ${group}`);
  console.error('Available groups: core, core-extra, protocols, infrastructure, enterprise');
  process.exit(1);
}

// Check which test files actually exist
async function getExistingTests() {
  const existing = [];
  for (const file of testFiles) {
    try {
      // Look in subdirectories for organized test groups
      let path;
      if (group === 'core') {
        path = join(__dirname, 'core', file);
      } else if (group === 'core-extra') {
        path = join(__dirname, 'core-extra', file);
      } else {
        path = join(__dirname, file);
      }
      await fs.access(path);
      existing.push(file);
    } catch (err) {
      // File doesn't exist, skip it
    }
  }
  return existing;
}

// Run the tests
async function runTests() {
  console.log(`\n🧪 Running ${group} tests...\n`);
  
  const existingTests = await getExistingTests();
  
  if (existingTests.length === 0) {
    console.log(`No tests found for group: ${group}`);
    process.exit(0);
  }
  
  console.log(`Found ${existingTests.length} test files:`);
  existingTests.forEach(file => console.log(`  - ${file}`));
  console.log('');
  
  // Run each test file
  for (const testFile of existingTests) {
    console.log(`\n📄 Running ${testFile}...\n`);
    
    // Look in subdirectories for organized test groups
    let testPath;
    if (group === 'core') {
      testPath = join(__dirname, 'core', testFile);
    } else if (group === 'core-extra') {
      testPath = join(__dirname, 'core-extra', testFile);
    } else {
      testPath = join(__dirname, testFile);
    }
    
    // Spawn node process to run the test
    const child = spawn('node', [testPath], {
      stdio: 'inherit',
      env: process.env
    });
    
    // Wait for the test to complete
    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => {
        resolve(code);
      });
    });
    
    if (exitCode !== 0) {
      console.error(`\n❌ Test ${testFile} failed with exit code ${exitCode}`);
      process.exit(exitCode);
    }
  }
  
  console.log(`\n✅ All ${group} tests passed!\n`);
}

// Run the tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});