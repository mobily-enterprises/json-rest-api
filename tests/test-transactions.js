import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin, MySQLPlugin } from '../index.js';
import { setupMySQL, robustTeardown } from './utils/test-helpers.js';

describe('Transaction Support', () => {
  describe('Memory Storage (No Transaction Support)', () => {
    let api;
    
    test.beforeEach(async () => {
      api = new Api();
      api.use(MemoryPlugin);
      
      // Define schemas
      const userSchema = new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string', required: true, unique: true },
        balance: { type: 'number', default: 0 }
      });
      
      const transactionSchema = new Schema({
        userId: { type: 'id', refs: { resource: 'users' } },
        amount: { type: 'number', required: true },
        type: { type: 'string', required: true }
      });
      
      api.addResource('users', userSchema);
      api.addResource('transactions', transactionSchema);
    });
    
    test('should execute operations without real transactions', async () => {
      // Transaction method should exist but provide no guarantees
      assert(typeof api.transaction === 'function');
      
      const result = await api.transaction(async (trx) => {
        const user = await trx.resources.users.create({
          name: 'Test User',
          email: 'test@example.com',
          balance: 100
        });
        
        await trx.resources.transactions.create({
          userId: user.id,
          amount: 50,
          type: 'deposit'
        });
        
        return user;
      });
      
      assert.equal(result.name, 'Test User');
      
      // Verify data was created
      const users = await api.resources.users.query();
      assert.equal(users.data.length, 1);
      
      const transactions = await api.resources.transactions.query();
      assert.equal(transactions.data.length, 1);
    });
    
    test('should not rollback on error (no transaction support)', async () => {
      try {
        await api.transaction(async (trx) => {
          await trx.resources.users.create({
            name: 'User 1',
            email: 'user1@example.com'
          });
          
          // This will fail due to missing required field
          await trx.resources.transactions.create({
            userId: 1
            // Missing required 'amount' and 'type'
          });
        });
        
        assert.fail('Should have thrown error');
      } catch (error) {
        // Error expected
      }
      
      // User should still exist (no rollback)
      const users = await api.resources.users.query();
      assert.equal(users.data.length, 1);
    });
  });
  
  // MySQL transaction tests
  const mysqlTest = process.env.MYSQL_HOST || process.env.DB_TYPE === 'mysql' 
    ? describe 
    : describe.skip;
    
  mysqlTest('MySQL Storage (Full Transaction Support)', () => {
    let api, connection;
    
    test.beforeEach(async () => {
      const setup = await setupMySQL();
      api = setup.api;
      connection = setup.connection;
      
      // Define schemas
      const accountSchema = new Schema({
        name: { type: 'string', required: true },
        balance: { type: 'number', required: true }
      });
      
      const transferSchema = new Schema({
        fromAccountId: { type: 'id', refs: { resource: 'accounts' } },
        toAccountId: { type: 'id', refs: { resource: 'accounts' } },
        amount: { type: 'number', required: true },
        status: { type: 'string', default: 'pending' }
      });
      
      api.addResource('accounts', accountSchema);
      api.addResource('transfers', transferSchema);
    });
    
    test.afterEach(async () => {
      await robustTeardown({ api, connection });
    });
    
    test('should commit transaction on success', async () => {
      // Create initial accounts
      const acc1 = await api.resources.accounts.create({ name: 'Account 1', balance: 1000 });
      const acc2 = await api.resources.accounts.create({ name: 'Account 2', balance: 500 });
      
      // Perform transfer in transaction
      await api.transaction(async (trx) => {
        // Deduct from account 1
        await trx.resources.accounts.update(acc1.id, {
          balance: 500
        });
        
        // Add to account 2
        await trx.resources.accounts.update(acc2.id, {
          balance: 1000
        });
        
        // Record transfer
        await trx.resources.transfers.create({
          fromAccountId: acc1.id,
          toAccountId: acc2.id,
          amount: 500,
          status: 'completed'
        });
      });
      
      // Verify final state
      const finalAcc1 = await api.resources.accounts.get(acc1.id);
      const finalAcc2 = await api.resources.accounts.get(acc2.id);
      
      assert.equal(finalAcc1.balance, 500);
      assert.equal(finalAcc2.balance, 1000);
      
      const transfers = await api.resources.transfers.query();
      assert.equal(transfers.data.length, 1);
      assert.equal(transfers.data[0].attributes.status, 'completed');
    });
    
    test('should rollback transaction on error', async () => {
      // Create initial accounts
      const acc1 = await api.resources.accounts.create({ name: 'Account 1', balance: 1000 });
      const acc2 = await api.resources.accounts.create({ name: 'Account 2', balance: 500 });
      
      try {
        await api.transaction(async (trx) => {
          // Deduct from account 1
          await trx.resources.accounts.update(acc1.id, {
            balance: 500
          });
          
          // Add to account 2
          await trx.resources.accounts.update(acc2.id, {
            balance: 1000
          });
          
          // This will fail due to invalid account ID
          await trx.resources.transfers.create({
            fromAccountId: acc1.id,
            toAccountId: 99999, // Non-existent
            amount: 500
          });
        });
        
        assert.fail('Should have thrown error');
      } catch (error) {
        // Expected error
      }
      
      // Verify accounts unchanged
      const finalAcc1 = await api.resources.accounts.get(acc1.id);
      const finalAcc2 = await api.resources.accounts.get(acc2.id);
      
      assert.equal(finalAcc1.balance, 1000); // Unchanged
      assert.equal(finalAcc2.balance, 500);  // Unchanged
      
      const transfers = await api.resources.transfers.query();
      assert.equal(transfers.data.length, 0); // No transfer recorded
    });
    
    test('should support savepoints', async () => {
      const account = await api.resources.accounts.create({ 
        name: 'Test Account', 
        balance: 1000 
      });
      
      await api.transaction(async (trx) => {
        // Update balance
        await trx.resources.accounts.update(account.id, { balance: 800 });
        
        try {
          await trx.savepoint('transfer', async () => {
            // Try to make invalid transfer
            await trx.resources.accounts.update(account.id, { balance: 600 });
            
            // This will fail
            await trx.resources.transfers.create({
              fromAccountId: account.id,
              toAccountId: 99999, // Non-existent
              amount: 200
            });
          });
        } catch (error) {
          // Savepoint rolled back, but main transaction continues
        }
        
        // Make a valid transfer
        await trx.resources.transfers.create({
          fromAccountId: account.id,
          toAccountId: account.id, // Transfer to self for testing
          amount: 100,
          status: 'completed'
        });
      });
      
      // Verify final state
      const finalAccount = await api.resources.accounts.get(account.id);
      assert.equal(finalAccount.balance, 800); // First update applied, savepoint rolled back
      
      const transfers = await api.resources.transfers.query();
      assert.equal(transfers.data.length, 1); // Valid transfer recorded
    });
    
    test('should handle transaction options', async () => {
      // Test with timeout
      const startTime = Date.now();
      
      try {
        await api.transaction({
          timeout: 100, // 100ms timeout
          retries: 0
        }, async (trx) => {
          // Simulate slow operation
          await new Promise(resolve => setTimeout(resolve, 200));
        });
        
        assert.fail('Should have timed out');
      } catch (error) {
        assert(error.message.includes('timeout'));
        assert(Date.now() - startTime < 150); // Should timeout quickly
      }
    });
    
    test('should support read-only transactions', async () => {
      const acc1 = await api.resources.accounts.create({ name: 'Account 1', balance: 1000 });
      const acc2 = await api.resources.accounts.create({ name: 'Account 2', balance: 500 });
      
      const result = await api.readTransaction(async (trx) => {
        const accounts = await trx.resources.accounts.query();
        const total = accounts.data.reduce(
          (sum, acc) => sum + acc.attributes.balance, 
          0
        );
        
        return { accounts: accounts.data.length, totalBalance: total };
      });
      
      assert.equal(result.accounts, 2);
      assert.equal(result.totalBalance, 1500);
    });
    
    test('should propagate transaction context to hooks', async () => {
      let hookContext = null;
      
      api.hook('beforeUpdate', async (context) => {
        hookContext = context;
      });
      
      const account = await api.resources.accounts.create({ 
        name: 'Test', 
        balance: 100 
      });
      
      await api.transaction(async (trx) => {
        await trx.resources.accounts.update(account.id, { balance: 200 });
      });
      
      assert(hookContext);
      assert(hookContext.options.transaction);
      assert(hookContext.options.transaction.connection);
    });
  });
  
  describe('Transaction API', () => {
    test('should validate transaction is not already finalized', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      
      await api.transaction(async (trx) => {
        // Manual commit
        await trx.commit();
        
        // Try to commit again
        try {
          await trx.commit();
          assert.fail('Should not allow double commit');
        } catch (error) {
          assert(error.message.includes('already finalized'));
        }
        
        // Try to rollback after commit
        try {
          await trx.rollback();
          assert.fail('Should not allow rollback after commit');
        } catch (error) {
          assert(error.message.includes('already finalized'));
        }
      });
    });
  });
});