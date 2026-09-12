import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { JsonRestApi, RestApiPlugin, RestApiKnexPlugin, ExpressPlugin, SocketIOPlugin } from '../index.js'
import express from 'express'
import knex from 'knex'
import { io } from 'socket.io-client'
import { waitForSocketEvent, installSocketBarrier, drainSocketEvents } from '../tests/helpers/socketio.js'

const source = await readFile(new URL('../docs/GUIDE/28-socketio.md', import.meta.url), 'utf8')
const setup = [...source.matchAll(/```js\n([\s\S]*?)\n```/g)].find(match => match[1].includes("name: 'socket-example'"))?.[1]
assert.ok(setup, 'The guide must retain its complete public setup example')
const code = setup.replace(/^import .*\n/gm, '').replace('server.listen(3000)', "server.listen(0, '127.0.0.1')")
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let state, database, socket
try {
  state = await new AsyncFunction('JsonRestApi', 'express', 'knex', 'createServer', 'RestApiPlugin', 'RestApiKnexPlugin', 'ExpressPlugin', 'SocketIOPlugin', `${code}\nreturn { api, server }`)(
    JsonRestApi, express, config => { database = knex(config); return database }, createServer, RestApiPlugin, RestApiKnexPlugin, ExpressPlugin, SocketIOPlugin
  )
  if (!state.server.listening) await once(state.server, 'listening')
  installSocketBarrier(state.api.io)
  socket = io(`http://127.0.0.1:${state.server.address().port}`, { path: '/api/socket.io', transports: ['websocket'], reconnection: false, autoConnect: false })
  const connected = waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
  socket.connect()
  await connected
  const subscription = { resource: 'countries', subscriptionId: 'country-list', filters: { name: 'Australia' } }
  const subscribed = await socket.timeout(5000).emitWithAck('subscribe', subscription)
  assert.equal(subscribed.success, true)
  assert.equal(subscribed.data.subscriptionId, 'country-list')
  assert.equal(subscribed.data.status, 'active')
  assert.equal((await socket.timeout(5000).emitWithAck('subscribe', subscription)).error.code, 'SUBSCRIPTION_EXISTS')
  const changes = []
  socket.on('subscription.update', change => changes.push(change))
  const countries = state.api.resources.countries
  const country = await countries.post({ data: { name: 'Australia' } })
  await drainSocketEvents(socket)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'resource.created')
  assert.equal(changes[0].id, country.id)
  assert.equal(changes[0].subscriptionId, 'country-list')
  await countries.post({ data: { name: 'Canada' } })
  await drainSocketEvents(socket)
  assert.equal(changes.length, 1, 'A nonmatching write must not notify this subscription')
  await countries.patch({ id: country.id, data: { name: 'New Zealand' } })
  await drainSocketEvents(socket)
  assert.equal(changes.at(-1).type, 'resource.updated')
  assert.equal(changes.length, 2, 'Leaving the filtered result must notify')
  await countries.patch({ id: country.id, data: { name: 'Australia' } })
  await drainSocketEvents(socket)
  assert.equal(changes.length, 3, 'Entering the filtered result must notify')
  await countries.delete({ id: country.id })
  await drainSocketEvents(socket)
  assert.equal(changes.length, 4)
  assert.equal(changes.at(-1).type, 'resource.deleted')
  assert.deepEqual(changes.at(-1).deletedRecord, { id: country.id })
  assert.equal((await socket.timeout(5000).emitWithAck('unsubscribe', { subscriptionId: 'country-list' })).success, true)
  await countries.post({ data: { name: 'Australia' } })
  await drainSocketEvents(socket)
  assert.equal(changes.length, 4)
  const restored = await socket.timeout(5000).emitWithAck('restore-subscriptions', { subscriptions: [subscription] })
  assert.deepEqual(restored.restored, ['country-list'])
  assert.deepEqual(restored.failed, [])
  console.log('Literal Socket.IO server guide passed: subscription, filtered changes, deletion, unsubscribe and restore')
} finally {
  socket?.disconnect()
  try {
    if (state?.api.io) await new Promise(resolve => state.api.io.close(resolve))
    else if (state?.server.listening) await new Promise(resolve => state.server.close(resolve))
  } finally { await database?.destroy() }
}
