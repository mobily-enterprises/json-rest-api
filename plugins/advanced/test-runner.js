// Test runner for advanced plugins
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [
  'cache/cache.test.js',
  'config/config.test.js',
  'versioning/versioning.test.js',
  'context/context.test.js',
  'interceptors/interceptors.test.js',
  'tracing/tracing.test.js'
];

async function runTest(testFile) {
  console.log(`\nRunning ${testFile}...`);
  
  return new Promise((resolve) => {
    const child = spawn('node', ['--test', '--test-timeout=5000', join(__dirname, testFile)], {
      stdio: 'pipe'
    });
    
    let output = '';
    let passed = 0;
    let failed = 0;
    let killed = false;
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    child.on('close', (code) => {
      if (killed) return;
      
      // Parse output for test results
      const passMatch = output.match(/# pass (\d+)/);
      const failMatch = output.match(/# fail (\d+)/);
      
      if (passMatch) passed = parseInt(passMatch[1]);
      if (failMatch) failed = parseInt(failMatch[1]);
      
      console.log(`✓ Passed: ${passed}, ✗ Failed: ${failed}`);
      
      resolve({
        file: testFile,
        passed,
        failed,
        code
      });
    });
    
    // Kill after 10 seconds (reduced from 30)
    setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      console.log(`✗ ${testFile} timed out after 10s`);
      resolve({
        file: testFile,
        passed: 0,
        failed: 1,
        code: 1,
        timedOut: true
      });
    }, 10000);
  });
}

async function runAllTests() {
  console.log('Running advanced plugin tests...');
  
  const results = [];
  for (const test of tests) {
    const result = await runTest(test);
    results.push(result);
  }
  
  console.log('\n=== Summary ===');
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const result of results) {
    totalPassed += result.passed;
    totalFailed += result.failed;
    
    const status = result.failed === 0 && !result.timedOut ? '✓' : '✗';
    console.log(`${status} ${result.file}: ${result.passed} passed, ${result.failed} failed`);
  }
  
  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed`);
  
  process.exit(totalFailed > 0 ? 1 : 0);
}

runAllTests();