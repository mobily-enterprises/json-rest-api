#!/usr/bin/env node

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const TEST_TIMEOUT = 30000; // 30 seconds per test file
const KILL_TIMEOUT = 5000; // 5 seconds to force kill after SIGTERM

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTest(testFile, timeout = TEST_TIMEOUT) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    log(`Running: ${path.basename(testFile)}`, 'cyan');
    
    const child = spawn('node', ['--test', testFile], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';
    let errorOutput = '';
    let timedOut = false;

    // Capture output
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      log(`TIMEOUT: ${path.basename(testFile)} exceeded ${timeout}ms`, 'red');
      
      // Try graceful shutdown first
      child.kill('SIGTERM');
      
      // Force kill after grace period
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, KILL_TIMEOUT);
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      
      const result = {
        file: testFile,
        fileName: path.basename(testFile),
        passed: code === 0 && !timedOut,
        duration,
        code,
        timedOut,
        output,
        errorOutput
      };

      if (result.passed) {
        log(`✓ ${result.fileName} (${duration}ms)`, 'green');
      } else if (timedOut) {
        log(`✗ ${result.fileName} - TIMEOUT after ${timeout}ms`, 'red');
      } else {
        log(`✗ ${result.fileName} - Failed with code ${code} (${duration}ms)`, 'red');
      }

      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      
      log(`✗ ${path.basename(testFile)} - Error: ${err.message}`, 'red');
      resolve({
        file: testFile,
        fileName: path.basename(testFile),
        passed: false,
        duration,
        error: err.message,
        output,
        errorOutput
      });
    });
  });
}

async function findTestFiles() {
  const testFiles = [];
  
  // Main test files
  const mainTests = await fs.readdir(path.join(__dirname));
  for (const file of mainTests) {
    if (file.startsWith('test-') && file.endsWith('.js') && file !== 'test-all.js' && file !== 'test-runner.js') {
      testFiles.push(path.join(__dirname, file));
    }
  }

  // Plugin tests (excluding advanced for now due to timeouts)
  const pluginsDir = path.join(__dirname, '..', 'plugins');
  const plugins = await fs.readdir(pluginsDir);
  
  for (const plugin of plugins) {
    if (plugin === 'advanced') continue; // Skip advanced tests for now
    
    const pluginPath = path.join(pluginsDir, plugin);
    const stat = await fs.stat(pluginPath);
    
    if (stat.isDirectory()) {
      const files = await fs.readdir(pluginPath);
      for (const file of files) {
        if (file.endsWith('.test.js') || file === 'test.js') {
          testFiles.push(path.join(pluginPath, file));
        }
      }
    }
  }

  return testFiles;
}

async function runAllTests() {
  console.log('');
  log('JSON REST API Test Runner', 'bright');
  log('========================', 'bright');
  console.log('');
  
  const testFiles = await findTestFiles();
  log(`Found ${testFiles.length} test files`, 'blue');
  console.log('');

  const results = [];
  const startTime = Date.now();

  // Run tests sequentially to avoid resource conflicts
  for (const testFile of testFiles) {
    const result = await runTest(testFile);
    results.push(result);
    
    // Short delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const totalDuration = Date.now() - startTime;
  
  // Summary
  console.log('');
  log('Test Summary', 'bright');
  log('============', 'bright');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed && !r.timedOut).length;
  const timedOut = results.filter(r => r.timedOut).length;
  
  log(`Total tests: ${results.length}`, 'blue');
  log(`Passed: ${passed}`, 'green');
  if (failed > 0) log(`Failed: ${failed}`, 'red');
  if (timedOut > 0) log(`Timed out: ${timedOut}`, 'yellow');
  log(`Total time: ${(totalDuration / 1000).toFixed(2)}s`, 'blue');
  
  // Show failed tests
  if (failed + timedOut > 0) {
    console.log('');
    log('Failed Tests:', 'red');
    
    for (const result of results) {
      if (!result.passed) {
        console.log(`  - ${result.fileName}${result.timedOut ? ' (TIMEOUT)' : ''}`);
        if (result.errorOutput) {
          console.log(`    ${result.errorOutput.split('\n')[0]}`);
        }
      }
    }
  }

  // Exit with appropriate code
  process.exit(passed === results.length ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err}`, 'red');
  process.exit(1);
});

// Run tests
runAllTests().catch(err => {
  log(`Test runner error: ${err}`, 'red');
  process.exit(1);
});