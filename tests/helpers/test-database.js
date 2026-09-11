import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import knexLib from 'knex'

export const databaseClient = process.env.JSON_REST_API_DATABASE || 'better-sqlite3'
if (!['better-sqlite3', 'pg', 'mysql2'].includes(databaseClient)) {
  throw new Error(`Unknown JSON_REST_API_DATABASE '${databaseClient}'`)
}

export async function createTestDatabase (knexConfig, { concurrent = false, maxConnections, acquireConnectionTimeout } = {}) {
  if (process.env.JSON_REST_API_DATABASE && knexConfig && knexConfig.client !== databaseClient) {
    throw new Error(`Requested ${databaseClient} verification cannot use a ${knexConfig.client} fixture`)
  }
  if (knexConfig || databaseClient === 'better-sqlite3') {
    const directory = !knexConfig && concurrent ? await mkdtemp(path.join(tmpdir(), 'jra-sqlite-')) : null
    let knex, closing
    const close = () => {
      closing ||= (async () => {
        try { await knex?.destroy() } finally { if (directory) await rm(directory, { recursive: true, force: true }) }
      })()
      return closing
    }
    try {
      const filename = directory ? path.join(directory, 'test.sqlite') : ':memory:'
      knex = knexLib(knexConfig || {
        client: 'better-sqlite3',
        connection: { filename },
        useNullAsDefault: true,
        ...(directory
          ? {
              acquireConnectionTimeout: acquireConnectionTimeout ?? 5000,
              pool: {
                min: 0,
                max: maxConnections ?? 4,
                afterCreate (connection, done) {
                  try {
                    connection.pragma('foreign_keys = ON')
                    connection.pragma('busy_timeout = 0')
                    done(null, connection)
                  } catch (error) { done(error) }
                }
              }
            }
          : {
              ...(acquireConnectionTimeout === undefined ? {} : { acquireConnectionTimeout }),
              ...(maxConnections === undefined ? {} : { pool: { min: 0, max: maxConnections } })
            })
      })
      if (directory) await knex.raw('PRAGMA journal_mode = WAL')
      return { knex, name: knexConfig?.connection?.filename || filename, close }
    } catch (error) {
      await close()
      throw error
    }
  }

  if (!process.env.JSON_REST_API_TEST_CONNECTION) {
    throw new Error('Real database tests require JSON_REST_API_TEST_CONNECTION; use npm run test:databases')
  }
  const connection = JSON.parse(process.env.JSON_REST_API_TEST_CONNECTION)
  const config = { client: databaseClient, connection, acquireConnectionTimeout: acquireConnectionTimeout ?? 5000, pool: { min: 0, max: 1 } }
  const admin = knexLib(config)
  const name = `jra_test_${process.pid}_${randomUUID().replaceAll('-', '')}`
  let knex, closing
  let created = false
  const close = () => {
    closing ||= (async () => {
      try {
        try { await knex?.destroy() } finally {
          if (created) await admin.raw('DROP DATABASE ??', [name])
        }
      } finally { await admin.destroy() }
    })()
    return closing
  }

  try {
    await admin.raw(databaseClient === 'pg' ? 'CREATE DATABASE ??' : 'CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', [name])
    created = true
    knex = knexLib({ ...config, connection: { ...connection, database: name }, pool: { min: 0, max: maxConnections ?? 4 } })
    return { knex, name, close }
  } catch (error) {
    await close()
    throw error
  }
}
