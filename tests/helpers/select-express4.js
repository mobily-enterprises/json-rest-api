import assert from 'node:assert/strict'
import { registerHooks, createRequire } from 'node:module'

registerHooks({
  resolve (specifier, context, nextResolve) {
    return nextResolve(specifier === 'express' || specifier.startsWith('express/')
      ? specifier.replace(/^express/, 'express4')
      : specifier, context)
  }
})

// Resolve from the production import location as well as the test environment.
const require = createRequire(new URL('../../plugins/core/connectors/express-plugin.js', import.meta.url))
const { version } = require('express/package.json')
assert.match(version, /^4\./)
assert.match(import.meta.resolve('express'), /\/express4\//)
process.stderr.write(`Connector matrix uses Express ${version}\n`)
