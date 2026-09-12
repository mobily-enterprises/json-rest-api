import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, glob, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(path.join(tmpdir(), 'json-rest-api-public-types-'))
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  }))[0]
  const expectedFiles = new Set(['package.json', 'index.js', 'index.d.ts', 'LICENSE', 'LICENSE-MIT', 'LICENSE-GPL-3.0', 'README.md', 'docs/API.md', 'docs/QUICKSTART.md', 'docs/architecture.md', 'docs/contributing.md'])
  for await (const file of glob(['lib/**/*.js', 'lib/**/*.d.ts', 'plugins/**/*.js', 'plugins/**/*.d.ts', 'types/**/*.d.ts', 'docs/GUIDE/**/*.md'], { cwd: root })) {
    expectedFiles.add(file.split(path.sep).join('/'))
  }
  assert.deepEqual(packed.files.map(file => file.path).sort(), [...expectedFiles].sort(), 'Tarball must contain runtime/declaration files and selected user docs only')
  const modules = path.join(temporary, 'node_modules')
  const installed = path.join(modules, 'json-rest-api')
  await mkdir(installed, { recursive: true })
  execFileSync('tar', ['-xzf', path.join(temporary, packed.filename), '--strip-components=1', '-C', installed])
  const missingDocTargets = []
  let localDocLinks = 0
  for (const file of packed.files.filter(file => file.path.endsWith('.md'))) {
    const source = (await readFile(path.join(installed, file.path), 'utf8')).replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '')
    for (const match of source.matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const href = match[1].replace(/^<|>$/g, '')
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue
      const target = decodeURIComponent(href.split(/[?#]/)[0])
      if (!target) continue
      localDocLinks++
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), target))
      if (!expectedFiles.has(resolved)) missingDocTargets.push(`${file.path}: ${href}`)
    }
  }
  assert.deepEqual(missingDocTargets, [], 'Packed documentation inline links must target included files')
  // Only dependencies are shared; the library itself must resolve to the tarball.
  await symlink(path.join(root, 'node_modules'), path.join(installed, 'node_modules'), 'dir')
  await symlink(path.join(root, 'node_modules/@types'), path.join(modules, '@types'), 'dir')
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ type: 'module', private: true }))
  const fixture = path.join(temporary, 'consumer.ts')
  await cp(path.join(root, 'tests/fixtures/public-package-types.ts'), fixture)
  const options = {
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'],
    typeRoots: [path.join(modules, '@types')]
  }
  const program = ts.createProgram([fixture], options)
  const report = diagnostics => ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => temporary, getNewLine: () => '\n'
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, report(diagnostics))
  const entry = program.getSourceFile(path.join(installed, 'index.d.ts'))
  assert.ok(entry, 'Consumer must resolve the packed declaration entry point')
  const checker = program.getTypeChecker()
  const symbol = checker.getSymbolAtLocation(entry)
  const declaredValues = checker.getExportsOfModule(symbol).filter(symbol => {
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return resolved.flags & ts.SymbolFlags.Value
  }).map(symbol => symbol.name).sort()
  const runtime = await import(pathToFileURL(path.join(installed, 'index.js')).href)
  assert.deepEqual(declaredValues, Object.keys(runtime).sort(), 'Declaration and runtime exports must agree')
  const bulk = await import(pathToFileURL(path.join(installed, 'plugins/core/bulk-operations-plugin.js')).href)
  assert.equal(bulk.BulkOperationsPlugin.name, 'bulk-operations')
  const localStorage = await import(pathToFileURL(path.join(installed, 'plugins/storage/local-storage.js')).href)
  assert.equal(localStorage.LocalStorage, runtime.LocalStorage)
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  host.readFile = file => {
    const source = read(file)
    return file === fixture ? source.replace(/@ts-expect-error/g, 'expected-error-disabled') : source
  }
  const rejected = ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host))
  const expectedLines = (await readFile(fixture, 'utf8')).split('\n')
    .flatMap((line, index) => line.includes('@ts-expect-error') ? [index + 1] : [])
  assert.ok(rejected.every(diagnostic => diagnostic.file?.fileName === fixture), report(rejected))
  const rejectedLines = rejected.map(diagnostic => diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line)
  assert.deepEqual(rejectedLines, expectedLines, report(rejected))
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.types, 'index.d.ts')
  assert.equal(manifest.license, '(GPL-3.0-or-later OR MIT)')
  console.log(`Packed public types and contents passed: ${packed.files.length} files, ${packed.size} packed bytes; ${localDocLinks} local documentation links; ${declaredValues.length} runtime exports, ${rejected.length} negative checks; ${packed.shasum}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
