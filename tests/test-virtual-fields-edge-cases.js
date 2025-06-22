import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('Virtual Fields Edge Cases', () => {
  let api;
  
  beforeEach(() => {
    api = new Api({ debug: false });
    api.use(MemoryPlugin);
  });
  
  test('should handle multiple virtual fields in same resource', async () => {
    api.addResource('invoices', new Schema({
      itemPrice: { type: 'number', required: true },
      quantity: { type: 'number', required: true },
      taxRate: { type: 'number', required: true },
      // Multiple virtual fields
      subtotal: { type: 'number', virtual: true },
      tax: { type: 'number', virtual: true },
      total: { type: 'number', virtual: true },
      formattedTotal: { type: 'string', virtual: true }
    }));
    
    // Hook to calculate all virtual fields
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'invoices' && context.result) {
        const item = context.result;
        item.subtotal = item.itemPrice * item.quantity;
        item.tax = item.subtotal * (item.taxRate / 100);
        item.total = item.subtotal + item.tax;
        item.formattedTotal = `$${item.total.toFixed(2)}`;
      }
    });
    
    await api.connect();
    
    const invoice = await api.insert({
      itemPrice: 25.00,
      quantity: 4,
      taxRate: 8.5,
      // Virtual fields should be ignored during insert
      subtotal: 999,
      tax: 999,
      total: 999,
      formattedTotal: 'ignored'
    }, { type: 'invoices' });
    
    // Virtual fields should not be stored
    assert.equal(invoice.data.attributes.subtotal, undefined);
    assert.equal(invoice.data.attributes.total, undefined);
    
    // Get with virtual fields calculated
    const fetched = await api.get(invoice.data.id, { type: 'invoices' });
    assert.equal(fetched.data.attributes.subtotal, 100);
    assert.equal(fetched.data.attributes.tax, 8.5);
    assert.equal(fetched.data.attributes.total, 108.5);
    assert.equal(fetched.data.attributes.formattedTotal, '$108.50');
  });
  
  test('should handle virtual fields with dependencies on other virtual fields', async () => {
    api.addResource('employees', new Schema({
      firstName: { type: 'string', required: true },
      lastName: { type: 'string', required: true },
      baseSalary: { type: 'number', required: true },
      bonusPercentage: { type: 'number' },
      // Virtual fields with dependencies
      fullName: { type: 'string', virtual: true },
      bonus: { type: 'number', virtual: true },
      totalCompensation: { type: 'number', virtual: true }
    }));
    
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'employees' && context.result) {
        const emp = context.result;
        // First level virtual
        emp.fullName = `${emp.firstName} ${emp.lastName}`;
        emp.bonus = emp.baseSalary * ((emp.bonusPercentage || 0) / 100);
        // Second level virtual (depends on bonus)
        emp.totalCompensation = emp.baseSalary + emp.bonus;
      }
    });
    
    await api.connect();
    
    const employee = await api.insert({
      firstName: 'John',
      lastName: 'Doe',
      baseSalary: 100000,
      bonusPercentage: 15
    }, { type: 'employees' });
    
    const fetched = await api.get(employee.data.id, { type: 'employees' });
    assert.equal(fetched.data.attributes.fullName, 'John Doe');
    assert.equal(fetched.data.attributes.bonus, 15000);
    assert.equal(fetched.data.attributes.totalCompensation, 115000);
  });
  
  test('should handle virtual fields in bulk operations', async () => {
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      cost: { type: 'number', required: true },
      markup: { type: 'number', required: true },
      price: { type: 'number', virtual: true },
      profit: { type: 'number', virtual: true }
    }));
    
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'products' && context.result) {
        const product = context.result;
        product.price = product.cost * (1 + product.markup / 100);
        product.profit = product.price - product.cost;
      }
    });
    
    await api.connect();
    
    // Create multiple products
    const products = [
      { name: 'Widget A', cost: 10, markup: 50 },
      { name: 'Widget B', cost: 20, markup: 100 },
      { name: 'Widget C', cost: 5, markup: 200 }
    ];
    
    const created = [];
    for (const product of products) {
      const result = await api.insert(product, { type: 'products' });
      created.push(result.data.id);
    }
    
    // Query all products
    const allProducts = await api.query({}, { type: 'products' });
    
    // Virtual fields should be calculated for each
    assert.equal(allProducts.data.length, 3);
    
    const widgetA = allProducts.data.find(p => p.attributes.name === 'Widget A');
    assert.equal(widgetA.attributes.price, 15); // 10 * 1.5
    assert.equal(widgetA.attributes.profit, 5);
    
    const widgetB = allProducts.data.find(p => p.attributes.name === 'Widget B');
    assert.equal(widgetB.attributes.price, 40); // 20 * 2
    assert.equal(widgetB.attributes.profit, 20);
  });
  
  test('should handle virtual fields with conditional logic', async () => {
    api.addResource('accounts', new Schema({
      type: { type: 'string', required: true }, // 'savings', 'checking', 'credit'
      balance: { type: 'number', required: true },
      creditLimit: { type: 'number' },
      interestRate: { type: 'number' },
      // Virtual fields with conditional logic
      availableBalance: { type: 'number', virtual: true },
      monthlyInterest: { type: 'number', virtual: true },
      accountStatus: { type: 'string', virtual: true }
    }));
    
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'accounts' && context.result) {
        const account = context.result;
        
        // Available balance depends on account type
        if (account.type === 'credit') {
          account.availableBalance = (account.creditLimit || 0) + account.balance;
        } else {
          account.availableBalance = account.balance;
        }
        
        // Monthly interest only for savings
        if (account.type === 'savings' && account.interestRate) {
          account.monthlyInterest = account.balance * (account.interestRate / 100 / 12);
        } else {
          account.monthlyInterest = 0;
        }
        
        // Status based on balance
        if (account.balance < 0) {
          account.accountStatus = 'overdrawn';
        } else if (account.balance < 100) {
          account.accountStatus = 'low';
        } else {
          account.accountStatus = 'good';
        }
      }
    });
    
    await api.connect();
    
    // Test different account types
    const savings = await api.insert({
      type: 'savings',
      balance: 5000,
      interestRate: 2.5
    }, { type: 'accounts' });
    
    const credit = await api.insert({
      type: 'credit',
      balance: -500,
      creditLimit: 2000
    }, { type: 'accounts' });
    
    const checking = await api.insert({
      type: 'checking',
      balance: 50
    }, { type: 'accounts' });
    
    // Verify virtual fields
    const savingsData = await api.get(savings.data.id, { type: 'accounts' });
    assert.equal(savingsData.data.attributes.availableBalance, 5000);
    assert.equal(savingsData.data.attributes.monthlyInterest.toFixed(2), '10.42'); // 5000 * 0.025 / 12
    assert.equal(savingsData.data.attributes.accountStatus, 'good');
    
    const creditData = await api.get(credit.data.id, { type: 'accounts' });
    assert.equal(creditData.data.attributes.availableBalance, 1500); // 2000 - 500
    assert.equal(creditData.data.attributes.monthlyInterest, 0);
    assert.equal(creditData.data.attributes.accountStatus, 'overdrawn');
    
    const checkingData = await api.get(checking.data.id, { type: 'accounts' });
    assert.equal(checkingData.data.attributes.availableBalance, 50);
    assert.equal(checkingData.data.attributes.accountStatus, 'low');
  });
  
  test('should not include virtual fields in update operations', async () => {
    api.addResource('stats', new Schema({
      views: { type: 'number', required: true },
      likes: { type: 'number', required: true },
      engagementRate: { type: 'number', virtual: true }
    }));
    
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'stats' && context.result) {
        const stat = context.result;
        stat.engagementRate = stat.views > 0 ? (stat.likes / stat.views * 100) : 0;
      }
    });
    
    await api.connect();
    
    const stat = await api.insert({
      views: 1000,
      likes: 50
    }, { type: 'stats' });
    
    // Try to update virtual field
    const updated = await api.update(stat.data.id, {
      views: 2000,
      likes: 150,
      engagementRate: 999 // Should be ignored
    }, { type: 'stats' });
    
    // Get fresh data
    const fetched = await api.get(stat.data.id, { type: 'stats' });
    
    // Virtual field should be recalculated, not stored
    assert.equal(fetched.data.attributes.engagementRate, 7.5); // 150/2000 * 100
  });
  
  test('should handle virtual fields that reference other resources', async () => {
    api.addResource('departments', new Schema({
      name: { type: 'string', required: true },
      budget: { type: 'number', required: true },
      employeeCount: { type: 'number', virtual: true }
    }));
    
    api.addResource('employees', new Schema({
      name: { type: 'string', required: true },
      departmentId: { type: 'id', searchable: true },
      salary: { type: 'number' }
    }));
    
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'departments' && context.result) {
        const dept = context.result;
        
        // For testing, just set a mock count
        // In real implementation, you'd query the employees table
        dept.employeeCount = dept.id * 3; // Mock calculation
      }
    });
    
    await api.connect();
    
    const dept = await api.insert({
      name: 'Engineering',
      budget: 1000000
    }, { type: 'departments' });
    
    // Get department with virtual field
    const deptData = await api.get(dept.data.id, { type: 'departments' });
    assert.equal(deptData.data.attributes.employeeCount, dept.data.id * 3);
  });
  
  test('should handle virtual fields with async calculations', async () => {
    api.addResource('metrics', new Schema({
      url: { type: 'string', required: true },
      timestamp: { type: 'string', required: true },
      responseTime: { type: 'number', virtual: true },
      status: { type: 'string', virtual: true }
    }));
    
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'metrics' && context.result) {
        const metric = context.result;
        
        // Simulate async operation (e.g., checking URL status)
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Mock calculations
        metric.responseTime = Math.random() * 1000;
        metric.status = metric.responseTime < 500 ? 'healthy' : 'slow';
      }
    });
    
    await api.connect();
    
    const metric = await api.insert({
      url: 'https://example.com',
      timestamp: new Date().toISOString()
    }, { type: 'metrics' });
    
    const fetched = await api.get(metric.data.id, { type: 'metrics' });
    
    // Virtual fields should be populated
    assert(typeof fetched.data.attributes.responseTime === 'number');
    assert(['healthy', 'slow'].includes(fetched.data.attributes.status));
  });
  
  test('should handle errors in virtual field calculations gracefully', async () => {
    api.addResource('calculations', new Schema({
      numerator: { type: 'number', required: true },
      denominator: { type: 'number', required: true },
      result: { type: 'number', virtual: true },
      error: { type: 'string', virtual: true }
    }));
    
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'calculations' && context.result) {
        const calc = context.result;
        
        try {
          if (calc.denominator === 0) {
            throw new Error('Division by zero');
          }
          calc.result = calc.numerator / calc.denominator;
          calc.error = null;
        } catch (err) {
          calc.result = null;
          calc.error = err.message;
        }
      }
    });
    
    await api.connect();
    
    // Valid calculation
    const valid = await api.insert({
      numerator: 10,
      denominator: 2
    }, { type: 'calculations' });
    
    const validData = await api.get(valid.data.id, { type: 'calculations' });
    assert.equal(validData.data.attributes.result, 5);
    assert.equal(validData.data.attributes.error, null);
    
    // Invalid calculation
    const invalid = await api.insert({
      numerator: 10,
      denominator: 0
    }, { type: 'calculations' });
    
    const invalidData = await api.get(invalid.data.id, { type: 'calculations' });
    assert.equal(invalidData.data.attributes.result, null);
    assert.equal(invalidData.data.attributes.error, 'Division by zero');
  });
});