import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { get } from 'node:http'

for (const [file, production] of [['examples/url-override-example.js', false], ['examples/url-override-example.js', true], ['quickTest.js', false]]) {
  const child = spawn(process.execPath, [file], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: '0', FORCE_PRODUCTION_URLS: String(production) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stderr.on('data', chunk => { output += chunk })
  const exited = once(child, 'exit')
  let timeout
  try {
    const base = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Example startup timed out: ${output}`)), 15000)
      child.once('error', reject)
      child.once('exit', code => reject(new Error(`Example exited ${code}: ${output}`)))
      child.stdout.on('data', chunk => {
        output += chunk
        const match = output.match(/(?:Server ready: |API available at )(http:\/\/127\.0\.0\.1:\d+\/api(?:\/items)?)/)
        if (match) resolve(match[1])
      })
    })
    clearTimeout(timeout)
    if (file === 'quickTest.js') {
      const read = async path => {
        const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) })
        assert.equal(response.status, 200, path)
        return response.json()
      }
      const publishers = await read('/publishers')
      assert.deepEqual(publishers.data.map(record => record.attributes.name).sort(), ['HarperCollins', 'Oxford University Press', 'Penguin Random House'])
      const withAuthors = await read('/publishers/1?include=authors')
      assert.equal(withAuthors.included[0].attributes.name, 'George')
      assert.equal(withAuthors.included[0].attributes.surname, 'Orwell (Eric Blair)')
      const filtered = await read('/authors?filter[publisherName]=Penguin')
      assert.equal(filtered.data.length, 1)
      const missing = await read('/authors?filter[name]=Nobody')
      assert.deepEqual(missing.data, [])
      const linkage = await read('/authors/1/relationships/publisher')
      assert.deepEqual(linkage.data, { type: 'publishers', id: '1' })
      console.log('QuickTest seed, update, include, filter and relationship HTTP checks passed')
      continue
    }
    const defaultPrefix = production ? 'https://api.production.com/api' : '/api'
    for (const [headers, prefix] of [
      [{}, defaultPrefix],
      [{ 'X-Public-URL': 'https://cdn.example.com/api' }, 'https://cdn.example.com/api'],
      [{ 'X-API-Version': 'v2' }, 'https://api.example.com/v2'],
      [{ Host: 'tenant-a.example.com' }, 'https://tenant-a.api.com/api'],
      [{ 'X-Public-URL': 'https://unconfigured.example/api' }, defaultPrefix]
    ]) {
      const { status, body } = await new Promise((resolve, reject) => {
        const request = get(base, { headers, signal: AbortSignal.timeout(5000) }, response => {
          let data = ''
          response.on('data', chunk => { data += chunk })
          response.on('error', reject)
          response.on('end', () => {
            try { resolve({ status: response.statusCode, body: JSON.parse(data) }) } catch (error) { reject(error) }
          })
        })
        request.on('error', reject)
      })
      assert.equal(status, 200)
      assert.equal(body.data[0].links.self, `${prefix}/items/1`)
    }
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json', 'X-Public-URL': 'https://public.api.com/api' },
      body: JSON.stringify({ data: { type: 'items', attributes: { name: 'New Item' } } }),
      signal: AbortSignal.timeout(5000)
    })
    assert.equal(created.status, 201)
    const body = await created.json()
    assert.equal(body.data.attributes.name, 'New Item')
    assert.equal(body.data.links.self, 'https://public.api.com/api/items/2')
    console.log(`URL example HTTP checks passed: production override ${production}`)
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const force = setTimeout(() => child.kill('SIGKILL'), 5000)
    try { await exited } finally { clearTimeout(force) }
  }
}
