import { it } from 'node:test'
import assert from 'node:assert/strict'
import { topologicalSort } from '../plugins/core/lib/querying-writing/schema-helpers.js'

it('checks dependency membership without repeatedly scanning all field names', t => {
  const names = Array.from({ length: 200 }, (_, index) => `field${index}`)
  const dependencies = new Map(names.map((name, index) => [name, index ? [names[index - 1]] : []]))
  let reads = 0
  const observed = new Proxy(names, {
    get (target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++
      return Reflect.get(target, property, receiver)
    }
  })
  assert.deepEqual(topologicalSort(observed, name => dependencies.get(name)), names)
  assert.ok(reads <= names.length * 2, `Expected at most two passes over names, observed ${reads} reads`)
  t.diagnostic(`Dependency membership: ${names.length} fields, ${reads} field-name reads`)
})

it('retains dependency-first order, duplicates and invalid-graph errors', () => {
  const edges = { first: ['shared'], second: ['shared'], shared: [] }
  assert.deepEqual(topologicalSort(['first', 'second', 'shared', 'first'], name => edges[name]), ['shared', 'first', 'second'])
  assert.throws(() => topologicalSort(['first'], () => ['missing']), /Unknown dependency 'missing' for 'first'/)
  assert.throws(() => topologicalSort(['first', 'second'], name => [name === 'first' ? 'second' : 'first']), /Circular dependency detected: first/)
})

it('sorts a deep valid graph without depending on the JavaScript call-stack limit', () => {
  const names = Array.from({ length: 12000 }, (_, index) => `field${index}`)
  const dependencies = new Map(names.map((name, index) => [name, index + 1 < names.length ? [names[index + 1]] : []]))
  assert.deepEqual(topologicalSort(names, name => dependencies.get(name)), [...names].reverse())
  dependencies.set(names.at(-1), [names[100]])
  assert.throws(() => topologicalSort(names, name => dependencies.get(name)), /Circular dependency detected: field100/)
})

it('retains lazy dependency traversal and closes iterators on graph failure', () => {
  const order = []
  function * dependencies (name) {
    order.push(`start:${name}`)
    if (name === 'first') yield 'second'
    order.push(`end:${name}`)
  }
  assert.deepEqual(topologicalSort(['first', 'second'], dependencies), ['second', 'first'])
  assert.deepEqual(order, ['start:first', 'start:second', 'end:second', 'end:first'])
  const closed = []
  const failCleanup = name => {
    closed.push(name)
    throw new Error('Secondary iterator cleanup failure')
  }
  function * invalid (name) {
    try { yield name === 'first' ? 'second' : 'missing' } finally {
      failCleanup(name)
    }
  }
  assert.throws(() => topologicalSort(['first', 'second'], invalid), /Unknown dependency 'missing' for 'second'/)
  assert.deepEqual(closed, ['second', 'first'])
})

it('preserves an iterator-next failure and closes its parent traversal', () => {
  const failure = new Error('Dependency iterator failed')
  const closed = []
  const broken = {
    [Symbol.iterator] () { return this },
    next () { throw failure },
    return () { closed.push('broken'); return { done: true } }
  }
  function * parent () {
    try { yield 'second' } finally { closed.push('parent') }
  }
  assert.throws(() => topologicalSort(['first', 'second'], name => name === 'first' ? parent() : broken), error => error === failure)
  assert.deepEqual(closed, ['parent'])
})
