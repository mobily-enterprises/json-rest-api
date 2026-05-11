import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SocketIOPlugin } from '../index.js'

describe('Public exports', () => {
  it('exports the documented Socket.IO plugin from the package entrypoint', () => {
    assert.equal(SocketIOPlugin.name, 'socketio')
    assert.equal(typeof SocketIOPlugin.install, 'function')
  })
})
