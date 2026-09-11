import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(path.join(tmpdir(), 'json-rest-api-clean-package-'))
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const env = { ...process.env }
delete env.NODE_PATH
const run = (command, args, cwd = temporary) => execFileSync(command, args, {
  cwd, env, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024
})
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root))[0]
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ name: 'clean-package-check', private: true, type: 'module' }))
  console.log(`Installing ${packed.filename} (${packed.shasum}) into a clean temporary consumer`)
  run('npm', ['install', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', path.join(temporary, packed.filename)])
  await cp(path.join(root, 'tests/fixtures/clean-package-smoke.js'), path.join(temporary, 'smoke.js'))
  console.log(run(process.execPath, ['smoke.js', 'core']))
  console.log('Installing fresh Knex/SQLite dependencies (the native driver may compile from source)')
  run('npm', ['install', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund',
    `knex@${manifest.devDependencies.knex}`, `better-sqlite3@${manifest.devDependencies['better-sqlite3']}`])
  console.log(run(process.execPath, ['smoke.js', 'storage']))
  const lock = JSON.parse(await readFile(path.join(temporary, 'package-lock.json'), 'utf8'))
  const versions = Object.fromEntries(Object.entries(lock.packages).filter(([name]) => name.startsWith('node_modules/')).map(([name, info]) => [name, info.version]))
  for (const developmentOnly of ['typescript', 'eslint', 'fast-check', 'supertest']) {
    assert.equal(versions[`node_modules/${developmentOnly}`], undefined, `${developmentOnly} must not be a runtime dependency`)
  }
  console.log(JSON.stringify({ node: process.version, artifact: packed.shasum, dependencies: versions }, null, 2))
} finally {
  await rm(temporary, { recursive: true, force: true })
}
