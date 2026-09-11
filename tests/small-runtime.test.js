import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeProbeApi } from './fixtures/runtime-api.js'
import { Hooks } from '../lib/runtime/json-rest-api.js'

// This is the new assembly contract; operation regressions exercise its SQL users.
describe('Small resource runtime', () => {
  let api
  before(async () => { api = await createRuntimeProbeApi() })

  it('exposes stable resource and method identities', () => {
    assert.equal(api.resources.first, api.resources.first)
    assert.equal(api.resources.first.inspect, api.resources.first.inspect)
    assert.equal(typeof api.resources.first, 'object')
    assert.deepEqual(Object.keys(api.resources), ['first', 'second'])
    assert.equal(api.scopes, undefined)
    assert.equal(api.addScope, undefined)
  })

  it('shares the exact caller context and keeps resource hooks local', async () => {
    const context = { events: [] }
    const args = await api.resources.first.inspect({}, context)
    assert.equal(args.context, context)
    assert.equal(args.scope, api.resources.first)
    await args.runHooks('probe')
    const other = await api.resources.second.inspect({}, context)
    await other.runHooks('probe')
    assert.deepEqual(context.events, ['first-only'])
  })

  it('applies late helper defaults while keeping local overrides', async () => {
    await api.customize({ helpers: { describe: () => 'updated' } })
    assert.equal(await api.resources.first.describe(), 'updated')
    assert.equal((await api.resources.second.inspect()).helpers.describe(), 'local')
    api.resources.first.helpers.describe = () => 'first override'
    assert.equal(api.helpers.describe(), 'updated')
    assert.equal(await api.resources.first.describe(), 'first override')
    delete api.resources.first.helpers.describe
    assert.equal(await api.resources.first.describe(), 'updated')
  })

  it('applies late methods without replacing resource-specific methods', async () => {
    await api.customize({ methods: { describe: () => 'new method' } })
    assert.equal(await api.resources.first.describe(), 'new method')
    assert.equal(await api.resources.second.describe(), 'local-method')
    await api.use({
      name: 'late',
      install ({ addResourceMethod }) {
        addResourceMethod('late', ({ scopeName }) => scopeName)
      }
    })
    assert.equal(await api.resources.first.late(), 'first')
    assert.equal(await api.resources.second.late(), 'second')
  })

  for (const value of [null, undefined, false, 0, 'failure', Object.freeze(new Error('frozen'))]) {
    it(`preserves the exact rejected value: ${String(value)}`, async () => {
      const result = await api.invoke({ handler: () => { throw value } }).then(
        () => assert.fail('Expected rejection'), error => ({ error })
      )
      assert.equal(result.error, value)
    })
  }

  it('rejects prototype pollution and accidental thenable methods', async () => {
    await assert.rejects(api.customize({ vars: JSON.parse('{"__proto__": {"polluted": true}}') }), /Invalid name/)
    await assert.rejects(api.customize({ methods: { then () {} } }), /Invalid name/)
    assert.equal(api.vars.polluted, undefined)
  })

  it('rejects removed logging and customization options', async () => {
    await assert.rejects(createRuntimeProbeApi({ logging: { level: 'error' } }), /Pass logger directly/)
    await assert.rejects(createRuntimeProbeApi({ log: { level: 'error' } }), /Pass logger directly/)
    await assert.rejects(api.customize({ scopeMethods: {} }), /Unsupported customization/)
    await assert.rejects(api.customize({ apiMethods: {} }), /Unsupported customization/)
  })

  it('rejects missing dependencies and duplicate installations', async () => {
    let installed = false
    await assert.rejects(api.use({ name: 'missing', dependencies: ['absent'], install () { installed = true } }), /requires absent/)
    assert.equal(installed, false)
    await assert.rejects(api.use({ name: 'probe', install () {} }), /already installed/)
    await api.use({ name: 'alternative', dependencies: [['absent', 'probe']], install () { installed = true } })
    assert.equal(installed, true)
  })
})

describe('Sequential named hooks', () => {
  it('awaits handlers in explicit order and stops on false', async () => {
    const hooks = new Hooks()
    const events = []
    hooks.add('event', 'middle', {}, async () => { await Promise.resolve(); events.push('middle') })
    hooks.add('event', 'before', { beforeFunction: 'middle' }, () => { events.push('before') })
    hooks.add('event', 'after', { afterFunction: 'middle' }, () => { events.push('after'); return false })
    hooks.add('event', 'unreachable', {}, () => assert.fail('Ran after false'))
    assert.equal(await hooks.run('event', {}), false)
    assert.deepEqual(events, ['before', 'middle', 'after'])
  })

  it('does not run hooks registered during the current dispatch', async () => {
    const hooks = new Hooks()
    const events = []
    hooks.add('event', 'register', {}, () => {
      hooks.add('event', 'late', {}, () => { events.push('late') })
    })
    await hooks.run('event', {})
    assert.deepEqual(events, [])
    await hooks.run('event', {})
    assert.deepEqual(events, ['late'])
  })

  for (const value of [null, undefined, false, 0, 'failure']) {
    it(`preserves ${String(value)} thrown by a hook and stops dispatch`, async () => {
      const hooks = new Hooks()
      hooks.add('event', 'fail', {}, () => { throw value })
      hooks.add('event', 'unreachable', {}, () => assert.fail('Ran after rejection'))
      const result = await hooks.run('event', {}).then(
        () => assert.fail('Expected rejection'), error => ({ error })
      )
      assert.equal(result.error, value)
    })
  }

  it('rejects unknown ordering options and missing anchors', () => {
    const hooks = new Hooks()
    assert.throws(() => hooks.add('event', 'bad', { sequence: 50 }, () => {}), /beforeFunction/)
    assert.throws(() => hooks.add('event', 'bad', { beforeFunction: 'missing' }, () => {}), /no handler/)
  })
})
