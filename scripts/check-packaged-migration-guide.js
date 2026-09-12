import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(path.join(tmpdir(), 'json-rest-api-packaged-guide-'))
const installed = path.join(temporary, 'package')
const env = { ...process.env }
delete env.NODE_PATH

try {
  const artifact = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
    cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024
  }))[0]
  execFileSync('tar', ['-xzf', path.join(temporary, artifact.filename), '-C', temporary])
  assert.equal(await realpath(path.join(installed, 'index.js')), path.join(installed, 'index.js'))
  // Reuse test dependencies, but every relative runtime/documentation import resolves inside the tarball.
  await symlink(path.join(root, 'node_modules'), path.join(installed, 'node_modules'), 'dir')
  for (const file of ['scripts/check-migration-guide.js', 'tests/helpers/test-database.js', 'tests/helpers/storage-mode.js']) {
    const target = path.join(installed, file)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(path.join(root, file), target)
  }
  console.log(`Migration examples resolve packed runtime ${path.join(installed, 'index.js')}`)
  const output = execFileSync(process.execPath, ['scripts/check-migration-guide.js'], {
    cwd: installed, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024
  })
  process.stdout.write(output)
  console.log(JSON.stringify({ node: process.version, artifact: artifact.shasum, files: artifact.files.length, packedBytes: artifact.size }))
} finally {
  await rm(temporary, { recursive: true, force: true })
}
