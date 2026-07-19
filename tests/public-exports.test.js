import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RowPolicyPlugin, SocketIOPlugin } from '../index.js'

describe('Public exports', () => {
  it('exports the documented Socket.IO plugin from the package entrypoint', () => {
    assert.equal(SocketIOPlugin.name, 'socketio')
    assert.equal(typeof SocketIOPlugin.install, 'function')
  })

  it('exports the row-policy plugin from the package entrypoint', () => {
    assert.equal(RowPolicyPlugin.name, 'row-policy')
    assert.equal(typeof RowPolicyPlugin.install, 'function')
  })
})
