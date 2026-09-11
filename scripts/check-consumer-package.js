import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, glob, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const libraryRoot = fileURLToPath(new URL('../', import.meta.url))
const separator = process.argv.indexOf('--', 2)
if (separator === -1) throw new Error('Usage: node scripts/check-consumer-package.js --consumer PATH -- COMMAND [ARGS...]')
const { values } = parseArgs({
  args: process.argv.slice(2, separator),
  options: {
    consumer: { type: 'string' },
    jskit: { type: 'string' },
    timeout: { type: 'string', default: '600000' }
  }
})
if (!values.consumer) throw new Error('--consumer is required')
const consumerRoot = await realpath(values.consumer)
const command = process.argv.slice(separator + 1)
if (!command.length) throw new Error('An explicit consumer check command is required after --')
const timeout = Number(values.timeout)
if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('--timeout must be a positive number of milliseconds')
const consumerRequire = createRequire(path.join(consumerRoot, 'package.json'))
const cancellation = new AbortController()
const interrupt = () => { cancellation.abort(new Error('Consumer check interrupted')) }
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)

function run (executable, args, { cwd, env = process.env, capture = false } = {}) {
  cancellation.signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable === 'node' ? process.execPath : executable, args, {
      cwd,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      detached: process.platform !== 'win32'
    })
    let output = ''
    let stderr = ''
    let failure
    const stop = (error) => {
      failure ||= error
      if (!child.pid) return
      try {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') failure = new AggregateError([failure, error], 'Could not stop consumer check')
      }
    }
    const abort = () => { stop(cancellation.signal.reason) }
    const timer = setTimeout(() => { stop(new Error(`${executable} exceeded ${timeout} ms`)) }, timeout)
    cancellation.signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', chunk => {
      output += chunk
      if (output.length > 16 * 1024 * 1024) stop(new Error('Command output exceeded 16 MiB'))
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk
      if (stderr.length > 16 * 1024 * 1024) stop(new Error('Command error output exceeded 16 MiB'))
    })
    child.once('error', error => { failure = error })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      cancellation.signal.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`${executable} failed (${signal || code})${stderr ? `\n${stderr}` : ''}`))
      else resolve(output)
    })
  })
}

async function dependencyFingerprint () {
  const files = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']
  return Promise.all(files.map(async name => {
    try {
      return [name, createHash('sha256').update(await readFile(path.join(consumerRoot, name))).digest('hex')]
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return [name, null]
    }
  }))
}

async function checkPairedConsumer (temporaryRoot, libraryArtifact) {
  const jskitRoot = await realpath(values.jskit)
  const { stageCurrentJskitWorkspaces, restoreCurrentJskitDependencyVersions, CURRENT_JSKIT_WORKSPACE_NPM_ENV } = await import(
    pathToFileURL(path.join(jskitRoot, 'tooling/testUtils/currentJskitWorkspaces.mjs')).href
  )
  const libraryTarball = libraryArtifact.tarball
  const appRoot = path.join(temporaryRoot, 'app')
  const excluded = new Set(['node_modules', '.git', '.env', 'dist', 'coverage', 'test-results', '.test-packages', 'playwright-report'])
  await cp(consumerRoot, appRoot, {
    recursive: true,
    filter: source => !excluded.has(path.basename(source)) && !path.basename(source).startsWith('.env.')
  })
  const manifests = [path.join(appRoot, 'package.json')]
  const appManifest = JSON.parse(await readFile(manifests[0], 'utf8'))
  for (const pattern of appManifest.workspaces || []) {
    for await (const manifest of glob(`${pattern}/package.json`, { cwd: appRoot })) {
      manifests.push(path.join(appRoot, manifest))
    }
  }
  const candidates = await stageCurrentJskitWorkspaces(appRoot)
  await rename(path.join(appRoot, 'test-results/jskit-candidate-packages'), path.join(appRoot, 'test-results/.jskit-candidate-packages'))
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
  const packageNames = manifest => sections.flatMap(section => Object.keys(manifest[section] || {}))
    .filter(name => name.startsWith('@jskit-ai/'))
  const pending = []
  for (const manifest of manifests) pending.push(...packageNames(JSON.parse(await readFile(manifest, 'utf8'))))
  const required = new Set()
  while (pending.length) {
    const name = pending.pop()
    if (required.has(name)) continue
    const candidate = candidates.get(name)
    assert.ok(candidate, `No current jskit-ai package for ${name}`)
    required.add(name)
    const manifest = JSON.parse(await readFile(path.join(candidate.packageRoot, 'package.json'), 'utf8'))
    pending.push(...packageNames(manifest))
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const artifacts = []
  for (const [name, candidate] of candidates) {
    const stagedRoot = path.join(appRoot, 'test-results/.jskit-candidate-packages', name.split('/')[1])
    await rm(stagedRoot, { recursive: true, force: true })
    if (!required.has(name)) continue
    const [packed] = JSON.parse(await run(npm, [
      'pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot
    ], { cwd: candidate.packageRoot, capture: true }))
    assert.equal(packed.name, name)
    assert.equal(packed.version, candidate.version, `Package ${name} changed version while staging`)
    const tarball = path.join(temporaryRoot, packed.filename)
    await mkdir(stagedRoot, { recursive: true })
    await run('tar', ['-xzf', tarball, '--strip-components=1', '-C', stagedRoot])
    artifacts.push({ name, version: packed.version, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex') })
  }
  for (const manifest of manifests) await restoreCurrentJskitDependencyVersions(path.dirname(manifest), candidates)
  const manifestPath = path.join(appRoot, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.workspaces = manifest.workspaces.map(pattern => pattern === 'test-results/jskit-candidate-packages/*' ? 'test-results/.jskit-candidate-packages/*' : pattern)
  manifest.dependencies = { ...manifest.dependencies, 'json-rest-api': `file:${libraryTarball}` }
  manifest.overrides = { ...manifest.overrides, 'json-rest-api': '$json-rest-api' }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const env = { ...process.env, ...CURRENT_JSKIT_WORKSPACE_NPM_ENV }
  await run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: appRoot, env })
  console.log(JSON.stringify({ consumer: consumerRoot, isolatedAt: appRoot, node: process.version, library: libraryArtifact, jskitArtifacts: artifacts, command }, null, 2))
  await run('node', ['--input-type=module', '-e', `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { realpathSync } from 'node:fs'
const root = process.cwd()
const expected = path.join(root, 'node_modules/json-rest-api/index.js')
assert.equal(import.meta.resolve('json-rest-api'), new URL(expected, 'file:').href)
for (const name of ${JSON.stringify([...required])}) {
  const staged = path.join(root, 'test-results/.jskit-candidate-packages', name.split('/')[1])
  assert.equal(realpathSync(path.join(root, 'node_modules', name)), staged)
  if (name === '@jskit-ai/json-rest-api-core') {
    assert.equal(createRequire(path.join(staged, 'package.json')).resolve('json-rest-api'), expected)
  }
}
console.log('Verified all selected package locations and host library resolution')
`], { cwd: appRoot, env })
  await run(command[0], command.slice(1), { cwd: appRoot, env })
}

let temporaryRoot
const before = await dependencyFingerprint()
try {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'json-rest-consumer-'))
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const [packed] = JSON.parse(await run(npm, [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot
  ], { cwd: libraryRoot, capture: true }))
  const tarball = path.join(temporaryRoot, packed.filename)
  const sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
  if (values.jskit) {
    await checkPairedConsumer(temporaryRoot, { tarball, version: packed.version, sha256, integrity: packed.integrity })
  } else {
    await writeFile(path.join(temporaryRoot, 'package.json'), JSON.stringify({
      name: 'json-rest-consumer-check', version: '0.0.0', private: true, type: 'module'
    }))

    // Use the consumer's exact Knex peer version; its native driver stays in the consumer.
    const knexPackage = JSON.parse(await readFile(consumerRequire.resolve('knex/package.json'), 'utf8'))
    await run(npm, [
      'install', '--ignore-scripts', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund',
      tarball, `knex@${knexPackage.version}`
    ], { cwd: temporaryRoot })

    const packageRoot = path.join(temporaryRoot, 'node_modules/json-rest-api')
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    assert.equal(manifest.version, packed.version)
    const anchor = pathToFileURL(path.join(temporaryRoot, 'package.json')).href
    const packageUrl = pathToFileURL(`${packageRoot}${path.sep}`).href
    const bootstrap = path.join(temporaryRoot, 'select-package.mjs')
    await writeFile(bootstrap, `import { registerHooks } from 'node:module'
registerHooks({
  resolve (specifier, context, nextResolve) {
    if (specifier !== 'json-rest-api' && !specifier.startsWith('json-rest-api/')) return nextResolve(specifier, context)
    const result = nextResolve(specifier, { ...context, parentURL: ${JSON.stringify(anchor)} })
    if (!result.url.startsWith(${JSON.stringify(packageUrl)})) throw new Error('Consumer resolved an unexpected json-rest-api package: ' + result.url)
    return result
  }
})
`)
    const env = {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(bootstrap).href}`.trim()
    }
    console.log(JSON.stringify({
      consumer: consumerRoot,
      node: process.version,
      package: { name: manifest.name, version: manifest.version, sha256, integrity: packed.integrity },
      installedAt: packageRoot,
      knex: knexPackage.version,
      command
    }, null, 2))
    await run('node', ['--input-type=module', '-e', `
import assert from 'node:assert/strict'
const resolved = import.meta.resolve('json-rest-api')
assert.ok(resolved.startsWith(${JSON.stringify(packageUrl)}))
const library = await import('json-rest-api')
assert.equal(library.RestApiPlugin.name, 'rest-api')
console.log('Verified package resolution:', resolved)
`], { cwd: consumerRoot, env })
    await run(command[0], command.slice(1), { cwd: consumerRoot, env })
  }
  assert.deepEqual(await dependencyFingerprint(), before, 'Consumer dependency files changed during verification')
} finally {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
