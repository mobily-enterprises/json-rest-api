import { it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'

const client = process.env.JSON_REST_API_RUNNER_DATABASE || 'better-sqlite3'

async function checkFailure ({ signal, missingBinary, missingTest = false, wrongDriver = false } = {}) {
  const testFile = missingTest ? 'tests/fixtures/absent-database-test.js' : 'tests/fixtures/database-runner-child.js'
  const child = spawn(process.execPath, ['scripts/test-databases.js', missingBinary || client, testFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      JSON_REST_API_RUNNER_CASE: signal ? 'wait' : wrongDriver ? 'wrong-driver' : 'failure',
      ...(missingBinary === 'pg' ? { JSON_REST_API_POSTGRES_BIN: path.resolve('tests/fixtures/absent-postgres-bin') } : {}),
      ...(missingBinary === 'mysql2' ? { JSON_REST_API_MYSQL_BIN: path.resolve('tests/fixtures/absent-mysqld') } : {}),
      ...(missingBinary === 'redis' ? { JSON_REST_API_REDIS_BIN: path.resolve('tests/fixtures/absent-redis-server') } : {})
    }
  })
  let output = ''
  let signalled = false
  const capture = data => {
    output += data.toString()
    if (signal && !signalled && output.includes('DATABASE_RUNNER_CHILD_READY')) {
      signalled = true
      child.kill(signal)
    }
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const timer = setTimeout(() => child.kill('SIGTERM'), 90000)
  let result
  try {
    result = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
  } finally { clearTimeout(timer) }
  assert.equal(result.code, 1, output)
  assert.equal(result.signal, null, output)
  if (signal) {
    assert.equal(signalled, true, output)
    assert.match(output, /Database verification interrupted/)
  } else if (missingBinary) assert.match(output, /ENOENT/)
  else if (missingTest) assert.match(output, /Could not find.*absent-database-test/)
  else if (wrongDriver) assert.match(output, /verification cannot use a .* fixture/)
  else assert.match(output, /Injected database runner failure/)
  const directory = output.match(/Disposable database directory: (.+)/)?.[1]
  assert.ok(directory, output)
  await assert.rejects(access(directory), { code: 'ENOENT' })
  if (!missingBinary && client !== 'better-sqlite3') {
    const pid = Number(output.match(/Database server PID: (\d+)/)?.[1])
    assert.ok(pid > 0, output)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  }
}

it(`database runner removes its environment after test failure (${client})`, () => checkFailure())
for (const signal of ['SIGINT', 'SIGTERM']) {
  it(`database runner stops active tests and removes its environment on ${signal} (${client})`, () => checkFailure({ signal }))
}
for (const missingBinary of ['pg', 'mysql2', 'redis']) {
  it(`database runner fails explicitly and cleans up when ${missingBinary} is missing`, () => checkFailure({ missingBinary }))
}
it(`database runner fails and cleans up when a selected test file is missing (${client})`, () => checkFailure({ missingTest: true }))
it(`database runner rejects a fixture that selects a different driver (${client})`, () => checkFailure({ wrongDriver: true }))
