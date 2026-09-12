import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createFieldSettersApi } from './fixtures/api-configs.js'
import { assertWriteFailure, cleanTables } from './helpers/test-utils.js'

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

// API instance that persists across tests
let api

describe('Field Setters', () => {
  before(async () => {
    // Initialize API once
    api = await createFieldSettersApi(knex)
  })

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy()
  })

  describe('Basic Field Transformations', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_users'])
    })

    it('should apply simple setter transformations on create', async () => {
      // Create user with data that needs transformation
      const user = await api.resources.users.post({ format: 'plain', data: { email: '  USER@EXAMPLE.COM  ', username: '  JohnDoe  ', tags: 'tag1,tag2,tag3', preferences: '{"theme":"dark","notifications":true}' } })

      // Get the user to verify setters were applied
      const fetchedUser = await api.resources.users.get({ id: user.id })

      // The setters transformed the data before storage
      assert.equal(fetchedUser.email, 'user@example.com')
      assert.equal(fetchedUser.username, 'johndoe')
      assert.equal(fetchedUser.tags, 'tag1,tag2,tag3')
      assert.equal(fetchedUser.preferences, '{"theme":"dark","notifications":true}')
    })

    it('should apply setter transformations on update (PUT)', async () => {
      // Create initial user
      const user = await api.resources.users.post({ format: 'plain', data: { email: 'original@example.com', username: 'originaluser', tags: 'old', preferences: '{"theme":"light"}' } })

      // Update with PUT
      await api.resources.users.put({ id: user.id, format: 'plain', data: { email: '  UPDATED@EXAMPLE.COM  ', username: '  UpdatedUser  ', tags: 'new1,new2', preferences: '{"theme":"dark","lang":"en"}' } })

      // Get the user to verify setters were applied
      const updatedUser = await api.resources.users.get({ id: user.id })
      assert.equal(updatedUser.email, 'updated@example.com')
      assert.equal(updatedUser.username, 'updateduser')
      assert.equal(updatedUser.tags, 'new1,new2')
      assert.equal(updatedUser.preferences, '{"theme":"dark","lang":"en"}')
    })

    it('should apply setter transformations on partial update (PATCH)', async () => {
      // Create initial user
      const user = await api.resources.users.post({ format: 'plain', data: { email: 'original@example.com', username: 'originaluser', tags: 'old', preferences: '{"theme":"light"}' } })

      // Update only email with PATCH
      await api.resources.users.patch({ id: user.id, format: 'plain', data: { email: '  PATCHED@EXAMPLE.COM  ' } })

      // Get the user to verify setter was applied only to patched field
      const patchedUser = await api.resources.users.get({ id: user.id })
      assert.equal(patchedUser.email, 'patched@example.com')
      assert.equal(patchedUser.username, 'originaluser') // Unchanged
    })
  })

  describe('Type Conversion Setters', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_products'])
    })

    it('should apply type conversion setters after validation', async () => {
      const product = await api.resources.products.post({ format: 'plain', data: { name: 'Test Product', price: 99.999, discount_percent: 15.678, metadata: { key: 'value' } } })

      // Get the product to verify setters were applied
      const fetchedProduct = await api.resources.products.get({ id: product.id })
      assert.equal(fetchedProduct.price, 10000) // 99.999 * 100 rounded = 10000 cents
      assert.equal(fetchedProduct.discount_percent, 16) // 15.678 rounded
      assert.deepEqual(fetchedProduct.metadata, { key: 'value' })
    })
  })

  describe('Async Setters', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_secure'])
    })

    it('should support async setter functions', async () => {
      const record = await api.resources.secure_data.post({ format: 'plain', data: { password: 'mysecretpassword', api_key: 'test-key-123', data: 'sensitive information' } })

      assert.ok(record.id, 'Record should have an id')

      // Get the record to verify async setters were applied
      const fetchedRecord = await api.resources.secure_data.get({ id: record.id })

      // Password should be hashed (mock hash)
      assert.equal(fetchedRecord.password, 'hashed:mysecretpassword')

      // API key should be encrypted (base64)
      assert.equal(fetchedRecord.api_key, Buffer.from('test-key-123').toString('base64'))

      // Data should be encrypted
      assert.equal(fetchedRecord.data, Buffer.from('sensitive information').toString('base64'))
    })
  })

  describe('Setter Dependencies', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_computed'])
    })

    it('should apply setters in dependency order', async () => {
      const data = await api.resources.computed_data.post({ format: 'plain', data: { base_value: 100, multiplier: 2, adjustment: 10 } })

      const fetchedData = await api.resources.computed_data.get({ id: data.id })
      assert.equal(fetchedData.base_value, 100)
      assert.equal(fetchedData.multiplier, 2)
      assert.equal(fetchedData.adjustment, 10)
      assert.equal(fetchedData.calculated_value, 200) // 100 * 2
      assert.equal(fetchedData.final_value, 210) // 200 + 10
    })
  })

  describe('Error Handling', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_users'])
    })

    it('should reject setter errors and roll back the write', async () => {
      await assert.rejects(
        api.resources.error_test.post({ format: 'plain', data: { good_field: 'HELLO', bad_field: 'world' } }),
        error => {
          assertWriteFailure(error, { outcome: 'rolledBack' })
          assert.equal(error.cause.cause.message, 'Setter failed!')
          assert.deepEqual(error.cause.context, { scopeName: 'error_test', fieldName: 'bad_field', phase: 'setter' })
          return true
        }
      )

      const records = await api.resources.error_test.query()
      assert.equal(records.data.length, 0)

      await cleanTables(knex, ['setter_errors'])
    })
  })

  describe('Null and Undefined Handling', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_nullable'])
    })

    it('should handle null and undefined values in setters', async () => {
      const data = await api.resources.nullable_data.post({ format: 'plain', data: { field1: null, field3: '', field4: 0 } })

      const fetchedData = await api.resources.nullable_data.get({ id: data.id })
      assert.equal(fetchedData.field1, null)
      assert.equal(fetchedData.field2, null)
      assert.equal(fetchedData.field3, 'empty') // Empty string transformed
      assert.equal(fetchedData.field4, -1) // Zero transformed
    })
  })

  describe('Validation Before Setters', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_validated'])
    })

    it('should run setters only after successful validation', async () => {
      // Try to create with invalid data
      await assert.rejects(
        api.resources.validated_data.post({ format: 'plain', data: { email: 'not-an-email', age: 150 } }),
        /Schema validation failed/
      )

      // No records should be created - verify with query
      const records = await api.resources.validated_data.query()
      assert.equal(records.data.length, 0)
    })

    it('should apply setters to validated type-cast data', async () => {
      const data = await api.resources.validated_data.post({ format: 'plain', data: { email: '  VALID@EXAMPLE.COM  ', age: '25', score: '98.7' } })

      const fetchedData = await api.resources.validated_data.get({ id: data.id })
      assert.equal(fetchedData.email, 'valid@example.com')
      assert.equal(fetchedData.age, 25) // Setter sees number, not string
      assert.equal(fetchedData.score, 99) // Rounded up by setter
    })
  })

  describe('Circular Dependencies', () => {
    it('should detect circular setter dependencies', async () => {
      await assert.rejects(
        api.addResource('circular_setters', {
          schema: {
            fieldA: {
              type: 'string',
              setter: (v) => v,
              runSetterAfter: ['fieldB']
            },
            fieldB: {
              type: 'string',
              setter: (v) => v,
              runSetterAfter: ['fieldA']
            }
          },
          tableName: 'circular_setters'
        }),
        /Circular dependency detected/
      )
    })

    it('should detect unknown setter dependencies', async () => {
      await assert.rejects(
        api.addResource('unknown_deps', {
          schema: {
            field1: {
              type: 'string',
              setter: (v) => v,
              runSetterAfter: ['nonexistent']
            }
          },
          tableName: 'unknown_deps'
        }),
        /setter dependency 'nonexistent' that does not exist/
      )
    })
  })
})
