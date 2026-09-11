import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { openSync, closeSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import knexLib from 'knex'

const exec = promisify(execFile)
const [selected = 'all', ...requestedFiles] = process.argv.slice(2)
const clients = selected === 'all' ? ['better-sqlite3', 'pg', 'mysql2'] : [selected]
const storageModes = process.env.JSON_REST_API_RUNNER_STORAGE
  ? [process.env.JSON_REST_API_RUNNER_STORAGE]
  : ['knex', 'anyapi']
if (storageModes.some(storage => !['knex', 'anyapi'].includes(storage))) {
  throw new Error('JSON_REST_API_RUNNER_STORAGE must be knex or anyapi')
}
if (clients.some(client => !['better-sqlite3', 'pg', 'mysql2', 'redis'].includes(client))) {
  throw new Error('Usage: node scripts/test-databases.js [all|better-sqlite3|pg|mysql2|redis] [test files...]')
}
const files = requestedFiles.length
  ? requestedFiles
  : selected === 'redis'
    ? ['tests/integration/socketio-lifecycle.test.js', 'tests/integration/socketio-redis.test.js']
    : [
        'scripts/measure-query-baseline.js',
        'tests/integration/database-environment.test.js',
        ...(await readdir('tests')).filter(name => /^conformance-.*\.test\.js$/.test(name)).sort().map(name => `tests/${name}`),
        'tests/db-schema-conformance.test.js',
        'tests/db-field-alterations.test.js',
        'tests/anyapi-temporal-migration.test.js',
        'tests/anyapi-field-evolution.test.js',
        'tests/anyapi-registry-failures.test.js',
        'tests/anyapi-descriptor-failures.test.js'
      ]
const jobs = new Set()
let interrupted
let temporaryRoot

function signal (job, value) {
  if (job.finished || !job.child.pid) return
  try { process.kill(process.platform === 'win32' ? job.child.pid : -job.child.pid, value) } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

function launch (command, args, { log, env = process.env } = {}) {
  if (interrupted) throw interrupted
  const fd = log ? openSync(log, 'a', 0o600) : undefined
  let child
  try {
    child = spawn(command, args, { env, detached: process.platform !== 'win32', stdio: log ? ['ignore', fd, fd] : 'inherit' })
  } finally { if (fd !== undefined) closeSync(fd) }
  const job = { child, finished: false }
  job.done = new Promise(resolve => {
    const finish = result => {
      job.finished = true
      jobs.delete(job)
      resolve(result)
    }
    child.once('error', error => finish({ error }))
    child.once('exit', (code, signal) => finish({ code, signal }))
  })
  jobs.add(job)
  return job
}

async function stop (job, value = 'SIGTERM') {
  signal(job, value)
  const timer = setTimeout(() => signal(job, 'SIGKILL'), 5000)
  try { await job.done } finally { clearTimeout(timer) }
}

async function run (command, args, options, timeout = 120000) {
  const job = launch(command, args, options)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; signal(job, 'SIGKILL') }, timeout)
  try {
    const result = await job.done
    if (interrupted) throw interrupted
    if (timedOut) throw new Error(`${path.basename(command)} exceeded ${timeout} ms`)
    if (result.error) throw result.error
    if (result.code !== 0) throw new Error(`${path.basename(command)} exited ${result.code ?? result.signal}`)
  } finally { clearTimeout(timer) }
}

function interrupt (signalName) {
  interrupted ||= new Error(`Database verification interrupted by ${signalName}`)
  for (const job of jobs) signal(job, 'SIGTERM')
}
const onInt = () => interrupt('SIGINT')
const onTerm = () => interrupt('SIGTERM')
process.once('SIGINT', onInt)
process.once('SIGTERM', onTerm)

async function startRedis (directory) {
  const { createClient } = await import('redis')
  await mkdir(directory, { mode: 0o700 })
  const connection = { socket: { path: path.join(directory, 'redis.sock') } }
  const server = launch(process.env.JSON_REST_API_REDIS_BIN || 'redis-server', [
    '--port', '0', '--unixsocket', connection.socket.path, '--unixsocketperm', '700',
    '--save', '', '--appendonly', 'no', '--dir', directory, '--daemonize', 'no'
  ], { log: path.join(directory, 'server.log') })
  let lastError
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (interrupted) throw interrupted
    if (server.finished) {
      const result = await server.done
      throw result.error || new Error('Redis exited before readiness')
    }
    const probe = createClient({ socket: { ...connection.socket, connectTimeout: 1000, reconnectStrategy: false } })
    probe.on('error', () => {})
    try {
      await probe.connect()
      if (await probe.ping() !== 'PONG') throw new Error('Redis did not answer PING')
      const version = (await probe.info('server')).match(/^redis_version:(.+)$/m)?.[1].trim()
      if (!version) throw new Error('Redis did not report its version')
      console.log(`Database ready: Redis ${version}`)
      console.log(`Database server PID: ${server.child.pid}`)
      return { server, connection }
    } catch (error) { lastError = error } finally { if (probe.isOpen) probe.destroy() }
    await delay(100)
  }
  throw new Error(`Redis did not become ready: ${lastError?.message}`)
}

async function startDatabase (client, directory) {
  if (client === 'redis') return startRedis(directory)
  await mkdir(directory, { mode: 0o700 })
  const data = path.join(directory, 'data')
  const log = path.join(directory, 'server.log')
  let server, connection
  if (client === 'pg') {
    const bin = process.env.JSON_REST_API_POSTGRES_BIN || (await exec('pg_config', ['--bindir'], { timeout: 5000 })).stdout.trim()
    await run(path.join(bin, 'initdb'), ['-D', data, '--username=jra_test', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C', '--no-instructions'], { log })
    server = launch(path.join(bin, 'postgres'), ['-D', data, '-k', directory, '-c', 'listen_addresses=', '-c', 'unix_socket_permissions=0700'], { log })
    connection = { host: directory, user: 'jra_test', database: 'postgres', connectionTimeoutMillis: 1000 }
  } else {
    const binary = process.env.JSON_REST_API_MYSQL_BIN || 'mysqld'
    await run(binary, ['--no-defaults', '--initialize-insecure', `--datadir=${data}`], { log })
    const socketPath = path.join(directory, 'mysql.sock')
    server = launch(binary, ['--no-defaults', `--datadir=${data}`, `--socket=${socketPath}`, `--pid-file=${path.join(directory, 'mysql.pid')}`, '--secure-file-priv=NULL', '--skip-networking', '--mysqlx=OFF', '--default-time-zone=+00:00'], { log })
    connection = { socketPath, user: 'root', connectTimeout: 1000, timezone: 'Z' }
  }

  const probe = knexLib({ client, connection, pool: { min: 0, max: 1 }, acquireConnectionTimeout: 1500 })
  let lastError
  try {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (interrupted) throw interrupted
      if (server.finished) throw new Error(`${client} exited before readiness`)
      try {
        const row = await probe.first(probe.raw('version() as version'))
        if (client === 'mysql2' && /mariadb/i.test(row.version)) throw new Error('MySQL verification requires MySQL; the selected binary is MariaDB')
        console.log(`Database ready: ${row.version}`)
        console.log(`Database server PID: ${server.child.pid}`)
        return { server, connection }
      } catch (error) { lastError = error }
      await delay(100)
    }
    throw new Error(`${client} did not become ready: ${lastError?.message}`)
  } finally { await probe.destroy() }
}

try {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'jra-db-'))
  console.log(`Disposable database directory: ${temporaryRoot}`)
  for (const client of clients) {
    let database
    try {
      if (client !== 'better-sqlite3') database = await startDatabase(client, path.join(temporaryRoot, client))
      for (const storage of storageModes) {
        console.log(`Running ${client} / ${storage}`)
        const testEnv = {
          ...process.env,
          JSON_REST_API_DATABASE: client === 'redis' ? 'better-sqlite3' : client,
          JSON_REST_API_STORAGE: storage,
          JSON_REST_API_TEST_CONNECTION: JSON.stringify(client === 'redis' ? {} : database?.connection || {}),
          ...(client === 'redis' ? { JSON_REST_API_REDIS_CONNECTION: JSON.stringify(database.connection) } : {})
        }
        delete testEnv.NODE_TEST_CONTEXT
        await run(process.execPath, ['--test', `--test-concurrency=${client === 'redis' ? 1 : 2}`, ...files], {
          env: testEnv
        }, requestedFiles.length ? 900000 : 1800000)
      }
    } finally {
      if (database) await stop(database.server, client === 'pg' ? 'SIGINT' : 'SIGTERM')
    }
  }
} catch (error) {
  console.error(error.message)
  for (const client of clients) {
    try { console.error((await readFile(path.join(temporaryRoot, client, 'server.log'), 'utf8')).slice(-12000)) } catch {}
  }
  process.exitCode = 1
} finally {
  try {
    await Promise.all([...jobs].map(job => stop(job)))
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  } finally {
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
    if (interrupted) process.exitCode = 1
  }
}
