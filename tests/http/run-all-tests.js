#!/usr/bin/env node

console.log('========================================')
console.log('Running ALL HTTP Integration Tests')
console.log('========================================\n')

const tests = [
  './test-crud.js',
  './test-validation.js',
  './test-query-filtering.js',
  './test-sorting-pagination.js',
  './test-relationships-joins.js',
  './test-error-handling.js',
  './test-hooks-middleware.js',
  './test-security.js'
]

let totalPassed = 0
let totalFailed = 0
const startTime = Date.now()

for (const test of tests) {
  try {
    console.log(`\n📋 Running ${test}...`)
    console.log('─'.repeat(50))
    
    await import(test)
    totalPassed++
  } catch (error) {
    console.error(`\n❌ Test ${test} failed:`)
    console.error(error.message)
    if (error.stack) {
      console.error(error.stack.split('\n').slice(0, 5).join('\n'))
    }
    totalFailed++
  }
}

const duration = ((Date.now() - startTime) / 1000).toFixed(2)

console.log('\n' + '='.repeat(50))
console.log('TEST SUMMARY')
console.log('='.repeat(50))
console.log(`✅ Passed: ${totalPassed}`)
console.log(`❌ Failed: ${totalFailed}`)
console.log(`⏱️  Duration: ${duration}s`)
console.log('='.repeat(50))

if (totalFailed > 0) {
  console.log('\n🚨 Some tests failed!')
  process.exit(1)
} else {
  console.log('\n🎉 All tests passed!')
}