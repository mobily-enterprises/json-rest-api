import assert from 'node:assert/strict'
import { it } from 'node:test'
import { pathToFileURL } from 'node:url'

const source = process.env.HOOKED_API_PAYLOAD_MODULE
  ? pathToFileURL(process.env.HOOKED_API_PAYLOAD_MODULE)
  : new URL('../../../node_modules/hooked-api/index.js', import.meta.url)
const { Api } = await import(source.href)

for (const format of ['pretty', 'json']) {
  for (const operation of ['api', 'scope', 'plugin']) {
    it(`${format} ${operation} startup logs omit payloads while the handler receives them`, async () => {
      const calls = []
      const capture = (...args) => calls.push(args)
      const api = new Api({
        name: 'payload-regression',
        logging: {
          level: 'debug',
          format,
          timestamp: false,
          colors: false,
          logger: { log: capture, warn: capture, error: capture }
        }
      })
      const payload = { secret: 'PRIVATE_DIAGNOSTIC_SENTINEL', large: 'x'.repeat(100000) }
      let received
      const handler = ({ params }) => { received = params; return 'completed' }
      if (operation === 'api') {
        api.customize({ apiMethods: { echo: handler } })
        calls.length = 0
        assert.equal(await api.echo(payload), 'completed')
      } else if (operation === 'scope') {
        await api.addScope('items', { scopeMethods: { echo: handler } })
        calls.length = 0
        assert.equal(await api.scopes.items.echo(payload), 'completed')
      } else {
        calls.length = 0
        await api.use({ name: 'payload-plugin', install: ({ pluginOptions }) => { received = pluginOptions } }, payload)
      }
      assert.equal(received.secret, payload.secret)
      assert.equal(received.large.length, 100000)
      assert.ok(calls.length > 0)
      const output = JSON.stringify(calls)
      assert.ok(!output.includes(payload.secret))
      assert.ok(output.length < 10000)
      assert.match(output, /called|Installing plugin/)
    })
  }
}
