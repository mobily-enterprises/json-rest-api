# Enterprise Guide: Chapter 5 - Migration Strategies

## The Migration Challenge

Here's a conversation I've heard too many times:

**CTO**: "We need to modernize our API."  
**Lead Dev**: "Great! Let's redesign everything from scratch!"  
**CTO**: "We have 3 million daily users and 847 API consumers..."  
**Lead Dev**: "Oh. So we need to keep the old API running?"  
**CTO**: "For at least 2 years. Also, no downtime allowed."  
**Lead Dev**: "..."

This chapter shows you how to migrate legacy systems to modern architectures without breaking everything, losing customers, or your sanity.

## Understanding Your Starting Point

### Legacy System Assessment

Before you migrate anything, understand what you have:

```javascript
// Legacy system analyzer
class LegacySystemAnalyzer {
  async analyze(config) {
    const report = {
      timestamp: new Date(),
      database: await this.analyzeDatabaseSchema(config.db),
      api: await this.analyzeAPIEndpoints(config.api),
      dependencies: await this.analyzeDependencies(config.code),
      risks: [],
      recommendations: []
    }
    
    // Identify risks
    this.identifyRisks(report)
    
    // Generate recommendations
    this.generateRecommendations(report)
    
    return report
  }
  
  async analyzeDatabaseSchema(dbConfig) {
    const connection = await mysql.createConnection(dbConfig)
    
    // Get all tables
    const [tables] = await connection.execute(
      "SELECT table_name, table_rows, data_length FROM information_schema.tables WHERE table_schema = ?",
      [dbConfig.database]
    )
    
    const analysis = {
      tableCount: tables.length,
      totalRows: 0,
      totalSize: 0,
      tables: {}
    }
    
    for (const table of tables) {
      // Get column information
      const [columns] = await connection.execute(
        "SELECT column_name, data_type, is_nullable, column_key, extra FROM information_schema.columns WHERE table_schema = ? AND table_name = ?",
        [dbConfig.database, table.table_name]
      )
      
      // Get foreign keys
      const [foreignKeys] = await connection.execute(
        `SELECT constraint_name, column_name, referenced_table_name, referenced_column_name 
         FROM information_schema.key_column_usage 
         WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL`,
        [dbConfig.database, table.table_name]
      )
      
      analysis.tables[table.table_name] = {
        rowCount: table.table_rows,
        sizeBytes: table.data_length,
        columns: columns.map(col => ({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          key: col.column_key,
          auto_increment: col.extra.includes('auto_increment')
        })),
        foreignKeys: foreignKeys.map(fk => ({
          column: fk.column_name,
          references: `${fk.referenced_table_name}.${fk.referenced_column_name}`
        })),
        
        // Detect patterns
        patterns: this.detectTablePatterns(table.table_name, columns)
      }
      
      analysis.totalRows += table.table_rows
      analysis.totalSize += table.data_length
    }
    
    await connection.end()
    return analysis
  }
  
  detectTablePatterns(tableName, columns) {
    const patterns = []
    const columnNames = columns.map(c => c.column_name.toLowerCase())
    
    // Detect soft deletes
    if (columnNames.includes('deleted') || columnNames.includes('deleted_at')) {
      patterns.push('soft-delete')
    }
    
    // Detect versioning
    if (columnNames.includes('version') || columnNames.includes('revision')) {
      patterns.push('versioning')
    }
    
    // Detect audit fields
    if (columnNames.includes('created_by') && columnNames.includes('updated_by')) {
      patterns.push('audit-trail')
    }
    
    // Detect multi-tenancy
    if (columnNames.includes('tenant_id') || columnNames.includes('company_id')) {
      patterns.push('multi-tenant')
    }
    
    // Detect hierarchical data
    if (columnNames.includes('parent_id') || columnNames.includes('tree_left')) {
      patterns.push('hierarchical')
    }
    
    return patterns
  }
  
  async analyzeAPIEndpoints(apiConfig) {
    // Parse existing API routes
    const routes = await this.extractRoutes(apiConfig.codebase)
    
    return {
      totalEndpoints: routes.length,
      byMethod: this.groupBy(routes, 'method'),
      byResource: this.groupBy(routes, 'resource'),
      
      // API patterns
      patterns: {
        restful: routes.filter(r => this.isRESTful(r)).length,
        rpc: routes.filter(r => this.isRPC(r)).length,
        graphql: routes.filter(r => r.path.includes('graphql')).length
      },
      
      // Complexity metrics
      complexity: {
        avgPathDepth: this.avgPathDepth(routes),
        maxPathDepth: Math.max(...routes.map(r => r.path.split('/').length)),
        avgQueryParams: this.avgQueryParams(routes)
      }
    }
  }
  
  identifyRisks(report) {
    // Large tables without indexes
    for (const [table, info] of Object.entries(report.database.tables)) {
      if (info.rowCount > 1000000) {
        const hasIndexes = info.columns.some(c => c.key !== '')
        if (!hasIndexes) {
          report.risks.push({
            type: 'performance',
            severity: 'high',
            table,
            issue: 'Large table without indexes',
            impact: 'Queries will be slow'
          })
        }
      }
    }
    
    // Tables with too many columns
    for (const [table, info] of Object.entries(report.database.tables)) {
      if (info.columns.length > 30) {
        report.risks.push({
          type: 'design',
          severity: 'medium',
          table,
          issue: 'Table has too many columns',
          impact: 'Difficult to maintain, may need normalization'
        })
      }
    }
    
    // Circular dependencies
    const dependencies = this.buildDependencyGraph(report.database.tables)
    const circles = this.findCircularDependencies(dependencies)
    
    for (const circle of circles) {
      report.risks.push({
        type: 'architecture',
        severity: 'high',
        tables: circle,
        issue: 'Circular dependency detected',
        impact: 'Difficult to migrate, may cause deadlocks'
      })
    }
  }
}

// Run analysis
const analyzer = new LegacySystemAnalyzer()
const report = await analyzer.analyze({
  db: {
    host: 'legacy-db.company.com',
    database: 'production',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  api: {
    codebase: './legacy-api'
  }
})

console.log('Legacy System Report:', JSON.stringify(report, null, 2))
```

## Migration Patterns

### Pattern 1: Strangler Fig

Gradually replace legacy endpoints with new ones:

```javascript
// Strangler Fig implementation
class StranglerFigMigration {
  constructor(legacyApi, newApi) {
    this.legacy = legacyApi
    this.new = newApi
    this.migrationStatus = new Map()
  }
  
  // Create a proxy that routes to old or new based on migration status
  createProxy() {
    return express.Router().use('*', async (req, res, next) => {
      const endpoint = this.parseEndpoint(req)
      const status = this.migrationStatus.get(endpoint.key)
      
      // Log traffic for analysis
      await this.logTraffic(endpoint, status)
      
      switch (status?.phase) {
        case 'shadow':
          // Call both, return legacy response
          return this.shadowMode(req, res)
          
        case 'canary':
          // Route percentage to new API
          return this.canaryMode(req, res, status.percentage)
          
        case 'migrated':
          // Route all to new API
          return this.routeToNew(req, res)
          
        default:
          // Not migrated yet, use legacy
          return this.routeToLegacy(req, res)
      }
    })
  }
  
  async shadowMode(req, res) {
    // Call legacy API
    const legacyPromise = this.callLegacy(req)
    
    // Call new API in background
    const newPromise = this.callNew(req).catch(err => {
      console.error('Shadow call failed:', err)
      return { error: err.message }
    })
    
    // Return legacy response
    const legacyResponse = await legacyPromise
    res.status(legacyResponse.status).json(legacyResponse.data)
    
    // Compare responses asynchronously
    setImmediate(async () => {
      const newResponse = await newPromise
      
      if (!newResponse.error) {
        const differences = this.compareResponses(
          legacyResponse.data,
          newResponse.data
        )
        
        if (differences.length > 0) {
          await this.logDifferences({
            endpoint: req.path,
            method: req.method,
            differences,
            legacyResponse: legacyResponse.data,
            newResponse: newResponse.data
          })
        }
      }
    })
  }
  
  async canaryMode(req, res, percentage) {
    // Determine if this request goes to new API
    const hash = this.hashRequest(req)
    const useNew = (hash % 100) < percentage
    
    if (useNew) {
      try {
        const response = await this.callNew(req)
        
        // Add header to indicate new API
        res.set('X-API-Version', 'new')
        res.status(response.status).json(response.data)
        
        // Track success
        await this.trackCanarySuccess(req.path)
      } catch (error) {
        // Fallback to legacy on error
        console.error('Canary failed, falling back:', error)
        await this.trackCanaryFailure(req.path, error)
        
        return this.routeToLegacy(req, res)
      }
    } else {
      return this.routeToLegacy(req, res)
    }
  }
  
  // Migration control
  async startMigration(endpoint, options = {}) {
    const key = this.getEndpointKey(endpoint)
    
    this.migrationStatus.set(key, {
      endpoint,
      phase: 'shadow',
      startedAt: new Date(),
      options
    })
    
    console.log(`Started shadow migration for ${key}`)
  }
  
  async promoteToCanary(endpoint, percentage = 5) {
    const key = this.getEndpointKey(endpoint)
    const status = this.migrationStatus.get(key)
    
    if (!status || status.phase !== 'shadow') {
      throw new Error('Endpoint must be in shadow phase first')
    }
    
    // Check shadow mode results
    const shadowReport = await this.getShadowReport(key)
    
    if (shadowReport.errorRate > 0.01) {
      throw new Error(`Shadow error rate too high: ${shadowReport.errorRate}`)
    }
    
    if (shadowReport.differences > 0.05) {
      throw new Error(`Too many response differences: ${shadowReport.differences}`)
    }
    
    status.phase = 'canary'
    status.percentage = percentage
    status.canaryStarted = new Date()
    
    console.log(`Promoted ${key} to canary at ${percentage}%`)
  }
  
  async increaseCanaryTraffic(endpoint, newPercentage) {
    const key = this.getEndpointKey(endpoint)
    const status = this.migrationStatus.get(key)
    
    if (!status || status.phase !== 'canary') {
      throw new Error('Endpoint must be in canary phase')
    }
    
    // Check canary metrics
    const canaryReport = await this.getCanaryReport(key)
    
    if (canaryReport.errorRate > 0.001) {
      throw new Error(`Canary error rate too high: ${canaryReport.errorRate}`)
    }
    
    if (canaryReport.latencyIncrease > 1.2) {
      throw new Error(`Latency increased by ${canaryReport.latencyIncrease}x`)
    }
    
    status.percentage = newPercentage
    console.log(`Increased canary traffic for ${key} to ${newPercentage}%`)
  }
  
  async completeMigration(endpoint) {
    const key = this.getEndpointKey(endpoint)
    const status = this.migrationStatus.get(key)
    
    if (!status || status.phase !== 'canary' || status.percentage < 100) {
      throw new Error('Endpoint must be at 100% canary first')
    }
    
    status.phase = 'migrated'
    status.completedAt = new Date()
    
    console.log(`Completed migration for ${key}`)
    
    // Schedule legacy cleanup
    setTimeout(() => {
      this.cleanupLegacy(endpoint)
    }, 30 * 24 * 60 * 60 * 1000) // 30 days
  }
}

// Use the strangler fig pattern
const migration = new StranglerFigMigration(legacyApi, newApi)
const app = express()

// Mount the proxy
app.use('/api', migration.createProxy())

// Start migrating endpoints
await migration.startMigration({ path: '/api/users', method: 'GET' })

// After validation in shadow mode
await migration.promoteToCanary({ path: '/api/users', method: 'GET' }, 5)

// Gradually increase traffic
await migration.increaseCanaryTraffic({ path: '/api/users', method: 'GET' }, 10)
await migration.increaseCanaryTraffic({ path: '/api/users', method: 'GET' }, 25)
await migration.increaseCanaryTraffic({ path: '/api/users', method: 'GET' }, 50)
await migration.increaseCanaryTraffic({ path: '/api/users', method: 'GET' }, 100)

// Complete migration
await migration.completeMigration({ path: '/api/users', method: 'GET' })
```

### Pattern 2: Database-First Migration

Migrate the database layer while keeping APIs compatible:

```javascript
// Database migration orchestrator
class DatabaseMigration {
  constructor(oldDb, newDb) {
    this.oldDb = oldDb
    this.newDb = newDb
    this.syncStatus = new Map()
  }
  
  // Phase 1: Dual writes
  async enableDualWrites(table) {
    console.log(`Enabling dual writes for ${table}`)
    
    // Create triggers in old database
    await this.oldDb.query(`
      CREATE TRIGGER ${table}_after_insert
      AFTER INSERT ON ${table}
      FOR EACH ROW
      BEGIN
        INSERT INTO sync_queue (table_name, operation, record_id, data)
        VALUES ('${table}', 'INSERT', NEW.id, JSON_OBJECT(*))
      END
    `)
    
    await this.oldDb.query(`
      CREATE TRIGGER ${table}_after_update
      AFTER UPDATE ON ${table}
      FOR EACH ROW
      BEGIN
        INSERT INTO sync_queue (table_name, operation, record_id, data)
        VALUES ('${table}', 'UPDATE', NEW.id, JSON_OBJECT(*))
      END
    `)
    
    // Start sync worker
    this.startSyncWorker(table)
    
    this.syncStatus.set(table, {
      phase: 'dual-write',
      startedAt: new Date()
    })
  }
  
  // Sync worker that processes the queue
  async startSyncWorker(table) {
    const worker = async () => {
      try {
        // Get pending sync items
        const items = await this.oldDb.query(
          'SELECT * FROM sync_queue WHERE table_name = ? AND status = "pending" ORDER BY created_at LIMIT 100',
          [table]
        )
        
        for (const item of items) {
          try {
            // Transform data for new schema
            const transformed = await this.transformData(
              table,
              item.operation,
              JSON.parse(item.data)
            )
            
            // Apply to new database
            await this.applyToNewDb(table, item.operation, transformed)
            
            // Mark as synced
            await this.oldDb.query(
              'UPDATE sync_queue SET status = "synced" WHERE id = ?',
              [item.id]
            )
          } catch (error) {
            // Mark as failed
            await this.oldDb.query(
              'UPDATE sync_queue SET status = "failed", error = ? WHERE id = ?',
              [error.message, item.id]
            )
          }
        }
      } catch (error) {
        console.error('Sync worker error:', error)
      }
      
      // Run again
      setTimeout(() => worker(), 1000)
    }
    
    worker()
  }
  
  // Phase 2: Backfill historical data
  async backfillTable(table, options = {}) {
    const { batchSize = 1000, startId = 0 } = options
    
    console.log(`Starting backfill for ${table}`)
    
    let lastId = startId
    let processed = 0
    
    while (true) {
      // Get batch from old database
      const rows = await this.oldDb.query(
        `SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`,
        [lastId, batchSize]
      )
      
      if (rows.length === 0) break
      
      // Transform and insert into new database
      const transformed = await Promise.all(
        rows.map(row => this.transformData(table, 'INSERT', row))
      )
      
      await this.newDb.batchInsert(table, transformed)
      
      processed += rows.length
      lastId = rows[rows.length - 1].id
      
      // Update progress
      await this.updateBackfillProgress(table, {
        processed,
        lastId,
        percentage: await this.calculateProgress(table, lastId)
      })
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.log(`Backfill complete for ${table}: ${processed} rows`)
  }
  
  // Phase 3: Verify data consistency
  async verifyConsistency(table, options = {}) {
    const { sampleSize = 1000, fullScan = false } = options
    
    console.log(`Verifying consistency for ${table}`)
    
    const inconsistencies = []
    
    if (fullScan) {
      // Compare all rows
      const oldCount = await this.oldDb.query(
        `SELECT COUNT(*) as count FROM ${table}`
      )
      const newCount = await this.newDb.query(
        `SELECT COUNT(*) as count FROM ${table}`
      )
      
      if (oldCount[0].count !== newCount[0].count) {
        inconsistencies.push({
          type: 'count-mismatch',
          oldCount: oldCount[0].count,
          newCount: newCount[0].count
        })
      }
    }
    
    // Sample comparison
    const samples = await this.oldDb.query(
      `SELECT * FROM ${table} ORDER BY RAND() LIMIT ?`,
      [sampleSize]
    )
    
    for (const oldRow of samples) {
      const newRow = await this.newDb.query(
        `SELECT * FROM ${table} WHERE id = ?`,
        [oldRow.id]
      )
      
      if (newRow.length === 0) {
        inconsistencies.push({
          type: 'missing-row',
          id: oldRow.id
        })
        continue
      }
      
      // Compare data
      const transformed = await this.transformData(table, 'INSERT', oldRow)
      const differences = this.compareRows(transformed, newRow[0])
      
      if (differences.length > 0) {
        inconsistencies.push({
          type: 'data-mismatch',
          id: oldRow.id,
          differences
        })
      }
    }
    
    return {
      table,
      consistent: inconsistencies.length === 0,
      inconsistencies,
      sampleSize
    }
  }
  
  // Phase 4: Switch reads to new database
  async switchReads(table) {
    const status = this.syncStatus.get(table)
    
    if (!status || status.phase !== 'dual-write') {
      throw new Error('Table must be in dual-write mode')
    }
    
    // Verify consistency first
    const consistency = await this.verifyConsistency(table, { fullScan: true })
    
    if (!consistency.consistent) {
      throw new Error(`Table ${table} has inconsistencies: ${consistency.inconsistencies.length}`)
    }
    
    status.phase = 'read-from-new'
    status.readSwitchedAt = new Date()
    
    console.log(`Switched reads to new database for ${table}`)
  }
  
  // Phase 5: Stop writes to old database
  async stopOldWrites(table) {
    const status = this.syncStatus.get(table)
    
    if (!status || status.phase !== 'read-from-new') {
      throw new Error('Reads must be switched first')
    }
    
    // Drop triggers
    await this.oldDb.query(`DROP TRIGGER IF EXISTS ${table}_after_insert`)
    await this.oldDb.query(`DROP TRIGGER IF EXISTS ${table}_after_update`)
    
    status.phase = 'migrated'
    status.completedAt = new Date()
    
    console.log(`Migration complete for ${table}`)
  }
  
  // Data transformation
  async transformData(table, operation, data) {
    const transformers = {
      users: this.transformUser.bind(this),
      orders: this.transformOrder.bind(this),
      products: this.transformProduct.bind(this)
    }
    
    const transformer = transformers[table]
    if (!transformer) {
      return data // No transformation needed
    }
    
    return transformer(data)
  }
  
  async transformUser(oldUser) {
    return {
      id: oldUser.user_id,
      email: oldUser.email_address.toLowerCase(),
      
      // Combine first and last name
      fullName: `${oldUser.first_name} ${oldUser.last_name}`.trim(),
      
      // Parse JSON fields
      preferences: JSON.parse(oldUser.preferences || '{}'),
      
      // Rename fields
      createdAt: oldUser.created_date,
      updatedAt: oldUser.modified_date,
      
      // Add new fields
      version: 1,
      source: 'legacy_migration'
    }
  }
  
  async transformOrder(oldOrder) {
    return {
      id: oldOrder.order_id,
      customerId: oldOrder.customer_id,
      
      // Calculate status from multiple fields
      status: this.calculateOrderStatus(oldOrder),
      
      // Parse items from JSON
      items: JSON.parse(oldOrder.order_items || '[]').map(item => ({
        productId: item.product_id,
        quantity: item.qty,
        price: parseFloat(item.price),
        discount: parseFloat(item.discount || 0)
      })),
      
      // Convert money fields
      total: {
        amount: parseFloat(oldOrder.total_amount),
        currency: oldOrder.currency_code || 'USD'
      },
      
      // Timestamps
      createdAt: oldOrder.order_date,
      updatedAt: oldOrder.last_modified
    }
  }
}

// Execute database migration
const dbMigration = new DatabaseMigration(oldDb, newDb)

// Migrate users table
await dbMigration.enableDualWrites('users')
await dbMigration.backfillTable('users')
await dbMigration.verifyConsistency('users')
await dbMigration.switchReads('users')
await dbMigration.stopOldWrites('users')
```

### Pattern 3: API Adapter Layer

Create adapters to support old API contracts with new implementation:

```javascript
// API Adapter for backward compatibility
class LegacyAPIAdapter {
  constructor(newApi) {
    this.newApi = newApi
    this.router = express.Router()
    this.setupRoutes()
  }
  
  setupRoutes() {
    // Old: GET /api/v1/get_user_info?user_id=123
    // New: GET /api/v2/users/123
    this.router.get('/api/v1/get_user_info', async (req, res) => {
      try {
        const userId = req.query.user_id
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'user_id is required'
          })
        }
        
        // Call new API
        const user = await this.newApi.resources.users.get(userId)
        
        // Transform to old format
        const legacyResponse = {
          success: true,
          data: {
            user_id: user.id,
            first_name: user.fullName.split(' ')[0],
            last_name: user.fullName.split(' ').slice(1).join(' '),
            email_address: user.email,
            phone_number: user.phone || null,
            
            // Flatten nested data
            street_address: user.address?.street,
            city: user.address?.city,
            state: user.address?.state,
            zip_code: user.address?.postalCode,
            
            // Convert new fields to old
            account_status: this.mapStatus(user.status),
            created_date: user.createdAt,
            
            // Fields that don't exist in new API
            legacy_field: null,
            deprecated_flag: 'N'
          }
        }
        
        res.json(legacyResponse)
      } catch (error) {
        // Map errors to old format
        res.status(500).json({
          success: false,
          error: error.message,
          error_code: this.mapErrorCode(error)
        })
      }
    })
    
    // Old: POST /api/v1/create_order
    // New: POST /api/v2/orders
    this.router.post('/api/v1/create_order', async (req, res) => {
      try {
        // Transform old request to new format
        const newOrderData = {
          customerId: req.body.customer_id,
          
          // Transform items array
          items: req.body.line_items.map(item => ({
            productId: item.product_code,
            quantity: parseInt(item.qty),
            price: parseFloat(item.unit_price)
          })),
          
          // Transform address
          shippingAddress: {
            street: req.body.ship_to_address,
            city: req.body.ship_to_city,
            state: req.body.ship_to_state,
            postalCode: req.body.ship_to_zip,
            country: 'US' // Default in old API
          },
          
          // Map payment method
          paymentMethod: this.mapPaymentMethod(req.body.payment_type),
          
          // New required fields with defaults
          source: 'legacy_api',
          currency: 'USD'
        }
        
        // Validate transformed data
        const validation = await this.validateNewOrder(newOrderData)
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: validation.errors.join(', ')
          })
        }
        
        // Create order in new system
        const order = await this.newApi.resources.orders.insert(newOrderData)
        
        // Transform response to old format
        res.json({
          success: true,
          order_number: order.orderNumber,
          order_id: order.id,
          total_amount: order.total.amount.toFixed(2),
          estimated_delivery: this.formatOldDate(order.estimatedDelivery),
          
          // Old API returned these
          confirmation_email_sent: true,
          loyalty_points_earned: this.calculateLegacyPoints(order)
        })
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          error_code: this.mapErrorCode(error)
        })
      }
    })
    
    // Bulk endpoint adapter
    this.router.post('/api/v1/bulk_update', async (req, res) => {
      const results = {
        success: true,
        processed: 0,
        failed: 0,
        errors: []
      }
      
      // Old API processed everything in one transaction
      // New API requires individual updates
      for (const update of req.body.updates) {
        try {
          await this.processBulkItem(update)
          results.processed++
        } catch (error) {
          results.failed++
          results.errors.push({
            id: update.id,
            error: error.message
          })
        }
      }
      
      results.success = results.failed === 0
      res.json(results)
    })
  }
  
  // Helper methods for transformation
  mapStatus(newStatus) {
    const statusMap = {
      'active': 'A',
      'suspended': 'S', 
      'closed': 'C',
      'pending': 'P'
    }
    return statusMap[newStatus] || 'U'
  }
  
  mapPaymentMethod(oldMethod) {
    const methodMap = {
      'CC': 'credit_card',
      'DC': 'debit_card',
      'PP': 'paypal',
      'BT': 'bank_transfer',
      'CA': 'cash'
    }
    return methodMap[oldMethod] || 'other'
  }
  
  mapErrorCode(error) {
    if (error.code) return error.code
    
    if (error.message.includes('not found')) return 'E_NOT_FOUND'
    if (error.message.includes('validation')) return 'E_VALIDATION'
    if (error.message.includes('unauthorized')) return 'E_AUTH'
    
    return 'E_UNKNOWN'
  }
  
  formatOldDate(date) {
    if (!date) return null
    
    // Old API used MM/DD/YYYY format
    const d = new Date(date)
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`
  }
  
  calculateLegacyPoints(order) {
    // Old system gave 1 point per dollar
    return Math.floor(order.total.amount)
  }
}

// Deploy adapter
const adapter = new LegacyAPIAdapter(newApi)
app.use(adapter.router)

// Monitor adapter usage
adapter.router.use((req, res, next) => {
  // Track legacy API usage
  metrics.legacyApiCalls.inc({
    endpoint: req.path,
    method: req.method
  })
  
  // Add deprecation headers
  res.set('X-API-Deprecated', 'true')
  res.set('X-API-Deprecation-Date', '2025-01-01')
  res.set('X-API-Migration-Guide', 'https://docs.company.com/api/migration')
  
  next()
})
```

## Real-World Migration: Monolith to Microservices

Let's migrate a real e-commerce monolith to microservices:

```javascript
// Complete migration orchestrator
class MonolithToMicroservicesMigration {
  constructor(config) {
    this.config = config
    this.services = new Map()
    this.migrationPlan = this.createMigrationPlan()
  }
  
  createMigrationPlan() {
    return {
      phases: [
        {
          name: 'Extract User Service',
          duration: '2 months',
          services: ['users', 'authentication', 'profiles'],
          dependencies: []
        },
        {
          name: 'Extract Product Service',
          duration: '1 month',
          services: ['products', 'categories', 'inventory'],
          dependencies: []
        },
        {
          name: 'Extract Order Service',
          duration: '3 months',
          services: ['orders', 'cart', 'checkout'],
          dependencies: ['users', 'products']
        },
        {
          name: 'Extract Payment Service',
          duration: '2 months',
          services: ['payments', 'invoices', 'refunds'],
          dependencies: ['users', 'orders']
        },
        {
          name: 'Extract Shipping Service',
          duration: '1 month',
          services: ['shipping', 'tracking', 'returns'],
          dependencies: ['orders', 'users']
        },
        {
          name: 'Extract Notification Service',
          duration: '2 weeks',
          services: ['notifications', 'emails', 'sms'],
          dependencies: ['users']
        }
      ]
    }
  }
  
  async executePhase(phaseName) {
    const phase = this.migrationPlan.phases.find(p => p.name === phaseName)
    if (!phase) throw new Error(`Phase ${phaseName} not found`)
    
    console.log(`Starting migration phase: ${phaseName}`)
    
    // Check dependencies
    for (const dep of phase.dependencies) {
      if (!this.services.has(dep)) {
        throw new Error(`Dependency ${dep} not yet migrated`)
      }
    }
    
    // Create new services
    for (const serviceName of phase.services) {
      await this.extractService(serviceName)
    }
    
    // Set up inter-service communication
    await this.setupServiceCommunication(phase.services)
    
    // Migrate data
    await this.migrateServiceData(phase.services)
    
    // Switch traffic
    await this.switchTraffic(phase.services)
    
    console.log(`Completed phase: ${phaseName}`)
  }
  
  async extractService(serviceName) {
    console.log(`Extracting ${serviceName} service`)
    
    const serviceConfig = {
      users: {
        api: this.createUserServiceAPI(),
        database: 'users_db',
        tables: ['users', 'profiles', 'preferences', 'sessions'],
        events: ['UserCreated', 'UserUpdated', 'UserDeleted', 'UserLoggedIn']
      },
      
      products: {
        api: this.createProductServiceAPI(),
        database: 'products_db',
        tables: ['products', 'categories', 'product_categories', 'inventory'],
        events: ['ProductCreated', 'ProductUpdated', 'InventoryUpdated']
      },
      
      orders: {
        api: this.createOrderServiceAPI(),
        database: 'orders_db',
        tables: ['orders', 'order_items', 'cart', 'cart_items'],
        events: ['OrderPlaced', 'OrderUpdated', 'OrderShipped', 'OrderDelivered']
      }
    }
    
    const config = serviceConfig[serviceName]
    if (!config) throw new Error(`Unknown service: ${serviceName}`)
    
    // Create service API
    const service = {
      name: serviceName,
      api: config.api,
      database: config.database,
      tables: config.tables,
      events: config.events,
      status: 'extracting'
    }
    
    this.services.set(serviceName, service)
    
    // Set up service infrastructure
    await this.setupServiceInfrastructure(service)
  }
  
  createUserServiceAPI() {
    const api = new Api()
    
    api.use(MySQLPlugin, {
      host: process.env.USERS_DB_HOST,
      database: 'users_db'
    })
    
    api.use(BoundedContextPlugin, {
      contexts: {
        users: {
          name: 'User Management',
          resources: ['users', 'profiles', 'sessions']
        }
      }
    })
    
    // User schema optimized for microservice
    api.addResource('users', {
      schema: new Schema({
        id: { type: 'uuid', generated: true },
        email: { type: 'string', required: true, unique: true },
        passwordHash: { type: 'string', required: true },
        
        // Profile embedded instead of separate table
        profile: {
          type: 'object',
          structure: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            phone: { type: 'string' },
            dateOfBirth: { type: 'date' }
          }
        },
        
        // Status and metadata
        status: { type: 'string', enum: ['active', 'suspended', 'deleted'] },
        emailVerified: { type: 'boolean', default: false },
        twoFactorEnabled: { type: 'boolean', default: false },
        
        // Timestamps
        createdAt: { type: 'timestamp', generated: true },
        updatedAt: { type: 'timestamp' },
        lastLoginAt: { type: 'timestamp' }
      }),
      
      hooks: {
        afterInsert: async (context) => {
          // Publish event for other services
          await publishEvent('UserCreated', {
            userId: context.result.id,
            email: context.result.email,
            createdAt: context.result.createdAt
          })
        },
        
        afterUpdate: async (context) => {
          // Publish event with changes
          await publishEvent('UserUpdated', {
            userId: context.id,
            changes: context.changes,
            updatedAt: new Date()
          })
        }
      }
    })
    
    return api
  }
  
  async setupServiceInfrastructure(service) {
    // Create database
    await this.createServiceDatabase(service.database)
    
    // Set up message queue
    await this.setupMessageQueue(service.name)
    
    // Deploy service
    await this.deployService(service)
    
    // Set up monitoring
    await this.setupMonitoring(service)
  }
  
  async migrateServiceData(serviceNames) {
    for (const serviceName of serviceNames) {
      const service = this.services.get(serviceName)
      
      console.log(`Migrating data for ${serviceName}`)
      
      // Create CDC (Change Data Capture) pipeline
      const pipeline = new DataMigrationPipeline({
        source: {
          type: 'mysql',
          connection: this.config.monolithDb,
          tables: service.tables
        },
        
        destination: {
          type: 'mysql',
          connection: {
            host: process.env[`${serviceName.toUpperCase()}_DB_HOST`],
            database: service.database
          }
        },
        
        transformations: this.getDataTransformations(serviceName),
        
        mode: 'continuous' // Keep syncing until cutover
      })
      
      // Start migration
      await pipeline.start()
      
      // Monitor progress
      const monitor = setInterval(async () => {
        const progress = await pipeline.getProgress()
        console.log(`${serviceName} migration: ${progress.percentage}% (${progress.recordsMigrated} records)`)
        
        if (progress.percentage >= 100) {
          clearInterval(monitor)
        }
      }, 30000) // Every 30 seconds
    }
  }
  
  getDataTransformations(serviceName) {
    const transformations = {
      users: [
        {
          name: 'combine-names',
          apply: (record) => {
            record.profile = {
              firstName: record.first_name,
              lastName: record.last_name,
              phone: record.phone_number,
              dateOfBirth: record.dob
            }
            
            delete record.first_name
            delete record.last_name
            delete record.phone_number
            delete record.dob
            
            return record
          }
        },
        {
          name: 'normalize-status',
          apply: (record) => {
            const statusMap = {
              'A': 'active',
              'S': 'suspended',
              'D': 'deleted'
            }
            
            record.status = statusMap[record.status] || 'active'
            return record
          }
        }
      ],
      
      products: [
        {
          name: 'extract-pricing',
          apply: (record) => {
            record.pricing = {
              basePrice: record.price,
              currency: record.currency || 'USD',
              salePrice: record.sale_price,
              saleStart: record.sale_start_date,
              saleEnd: record.sale_end_date
            }
            
            delete record.price
            delete record.currency
            delete record.sale_price
            delete record.sale_start_date
            delete record.sale_end_date
            
            return record
          }
        }
      ]
    }
    
    return transformations[serviceName] || []
  }
  
  async switchTraffic(serviceNames) {
    for (const serviceName of serviceNames) {
      console.log(`Switching traffic to ${serviceName} service`)
      
      // Update API Gateway configuration
      await this.updateApiGateway({
        service: serviceName,
        routes: this.getServiceRoutes(serviceName),
        loadBalancer: {
          strategy: 'round-robin',
          healthCheck: `/health`,
          instances: await this.getServiceInstances(serviceName)
        }
      })
      
      // Monitor error rates
      const errorMonitor = new ErrorRateMonitor({
        service: serviceName,
        threshold: 0.01, // 1% error rate
        window: 300 // 5 minutes
      })
      
      errorMonitor.on('threshold-exceeded', async (data) => {
        console.error(`High error rate detected for ${serviceName}:`, data)
        
        // Rollback if needed
        if (data.errorRate > 0.05) {
          await this.rollbackService(serviceName)
        }
      })
    }
  }
  
  getServiceRoutes(serviceName) {
    const routes = {
      users: [
        { path: '/api/users/*', target: 'http://users-service' },
        { path: '/api/auth/*', target: 'http://users-service' },
        { path: '/api/profiles/*', target: 'http://users-service' }
      ],
      
      products: [
        { path: '/api/products/*', target: 'http://products-service' },
        { path: '/api/categories/*', target: 'http://products-service' },
        { path: '/api/inventory/*', target: 'http://products-service' }
      ],
      
      orders: [
        { path: '/api/orders/*', target: 'http://orders-service' },
        { path: '/api/cart/*', target: 'http://orders-service' },
        { path: '/api/checkout/*', target: 'http://orders-service' }
      ]
    }
    
    return routes[serviceName] || []
  }
}

// Execute the migration
const migration = new MonolithToMicroservicesMigration({
  monolithDb: {
    host: 'legacy-db.company.com',
    database: 'monolith',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  }
})

// Run phases in order
for (const phase of migration.migrationPlan.phases) {
  await migration.executePhase(phase.name)
  
  // Wait for stabilization
  await new Promise(resolve => setTimeout(resolve, 7 * 24 * 60 * 60 * 1000)) // 1 week
}
```

## Migration Monitoring and Rollback

### Comprehensive Monitoring

```javascript
// Migration monitoring system
class MigrationMonitor {
  constructor(config) {
    this.config = config
    this.metrics = {
      performance: new Map(),
      errors: new Map(),
      dataConsistency: new Map(),
      userExperience: new Map()
    }
  }
  
  async startMonitoring(migrationId) {
    console.log(`Starting monitoring for migration: ${migrationId}`)
    
    // Performance monitoring
    this.monitorPerformance(migrationId)
    
    // Error rate monitoring
    this.monitorErrors(migrationId)
    
    // Data consistency checks
    this.monitorDataConsistency(migrationId)
    
    // User experience metrics
    this.monitorUserExperience(migrationId)
    
    // Set up alerts
    this.setupAlerts(migrationId)
  }
  
  monitorPerformance(migrationId) {
    const perfMonitor = setInterval(async () => {
      const metrics = {
        timestamp: new Date(),
        
        // Response times
        legacyResponseTime: await this.measureResponseTime('legacy'),
        newResponseTime: await this.measureResponseTime('new'),
        
        // Throughput
        legacyThroughput: await this.measureThroughput('legacy'),
        newThroughput: await this.measureThroughput('new'),
        
        // Resource usage
        legacyCPU: await this.getCPUUsage('legacy'),
        newCPU: await this.getCPUUsage('new'),
        legacyMemory: await this.getMemoryUsage('legacy'),
        newMemory: await this.getMemoryUsage('new')
      }
      
      // Calculate degradation
      metrics.responseTimeDegradation = 
        (metrics.newResponseTime - metrics.legacyResponseTime) / metrics.legacyResponseTime
      
      metrics.throughputImprovement = 
        (metrics.newThroughput - metrics.legacyThroughput) / metrics.legacyThroughput
      
      // Store metrics
      if (!this.metrics.performance.has(migrationId)) {
        this.metrics.performance.set(migrationId, [])
      }
      this.metrics.performance.get(migrationId).push(metrics)
      
      // Check thresholds
      if (metrics.responseTimeDegradation > 0.2) {
        await this.alert({
          type: 'performance-degradation',
          severity: 'high',
          message: `Response time increased by ${(metrics.responseTimeDegradation * 100).toFixed(1)}%`,
          metrics
        })
      }
    }, 60000) // Every minute
  }
  
  monitorErrors(migrationId) {
    const errorMonitor = setInterval(async () => {
      const metrics = {
        timestamp: new Date(),
        
        // Error rates
        legacyErrorRate: await this.getErrorRate('legacy'),
        newErrorRate: await this.getErrorRate('new'),
        
        // Error types
        legacyErrors: await this.getErrorTypes('legacy'),
        newErrors: await this.getErrorTypes('new'),
        
        // New errors (not in legacy)
        newErrorTypes: []
      }
      
      // Find new error types
      for (const [type, count] of Object.entries(metrics.newErrors)) {
        if (!metrics.legacyErrors[type] || metrics.legacyErrors[type] < count * 0.1) {
          metrics.newErrorTypes.push({ type, count })
        }
      }
      
      // Store metrics
      if (!this.metrics.errors.has(migrationId)) {
        this.metrics.errors.set(migrationId, [])
      }
      this.metrics.errors.get(migrationId).push(metrics)
      
      // Check thresholds
      if (metrics.newErrorRate > metrics.legacyErrorRate * 1.5) {
        await this.alert({
          type: 'error-rate-increase',
          severity: 'critical',
          message: `Error rate increased from ${metrics.legacyErrorRate}% to ${metrics.newErrorRate}%`,
          newErrors: metrics.newErrorTypes
        })
      }
    }, 30000) // Every 30 seconds
  }
  
  monitorDataConsistency(migrationId) {
    const consistencyChecker = setInterval(async () => {
      const tables = this.config.tables || []
      const results = {
        timestamp: new Date(),
        consistent: true,
        inconsistencies: []
      }
      
      for (const table of tables) {
        // Compare record counts
        const legacyCount = await this.getRecordCount('legacy', table)
        const newCount = await this.getRecordCount('new', table)
        
        if (Math.abs(legacyCount - newCount) > 10) {
          results.consistent = false
          results.inconsistencies.push({
            table,
            type: 'count-mismatch',
            legacy: legacyCount,
            new: newCount,
            difference: newCount - legacyCount
          })
        }
        
        // Sample data comparison
        const samples = await this.getSampleRecords('legacy', table, 100)
        
        for (const sample of samples) {
          const newRecord = await this.getRecord('new', table, sample.id)
          
          if (!newRecord) {
            results.inconsistencies.push({
              table,
              type: 'missing-record',
              id: sample.id
            })
            continue
          }
          
          // Compare fields
          const differences = this.compareRecords(sample, newRecord)
          if (differences.length > 0) {
            results.inconsistencies.push({
              table,
              type: 'data-mismatch',
              id: sample.id,
              differences
            })
          }
        }
      }
      
      // Store results
      if (!this.metrics.dataConsistency.has(migrationId)) {
        this.metrics.dataConsistency.set(migrationId, [])
      }
      this.metrics.dataConsistency.get(migrationId).push(results)
      
      // Alert on inconsistencies
      if (!results.consistent) {
        await this.alert({
          type: 'data-inconsistency',
          severity: 'high',
          message: `Found ${results.inconsistencies.length} data inconsistencies`,
          sample: results.inconsistencies.slice(0, 5)
        })
      }
    }, 300000) // Every 5 minutes
  }
  
  async generateReport(migrationId) {
    const report = {
      migrationId,
      generatedAt: new Date(),
      summary: {
        status: 'in-progress',
        healthScore: 0,
        recommendations: []
      },
      
      performance: this.analyzePerformanceMetrics(migrationId),
      errors: this.analyzeErrorMetrics(migrationId),
      dataConsistency: this.analyzeConsistencyMetrics(migrationId),
      userExperience: this.analyzeUserMetrics(migrationId)
    }
    
    // Calculate health score
    report.summary.healthScore = this.calculateHealthScore(report)
    
    // Generate recommendations
    if (report.performance.degradation > 0.1) {
      report.summary.recommendations.push(
        'Performance degradation detected. Consider optimizing queries or scaling resources.'
      )
    }
    
    if (report.errors.increaseRate > 0.5) {
      report.summary.recommendations.push(
        'Significant error rate increase. Review new error types and add error handling.'
      )
    }
    
    if (!report.dataConsistency.isConsistent) {
      report.summary.recommendations.push(
        'Data inconsistencies detected. Pause migration and run reconciliation.'
      )
    }
    
    return report
  }
}

// Rollback system
class MigrationRollback {
  constructor(config) {
    this.config = config
    this.checkpoints = new Map()
  }
  
  async createCheckpoint(migrationId, phase) {
    console.log(`Creating checkpoint for ${migrationId} at phase ${phase}`)
    
    const checkpoint = {
      id: `${migrationId}-${phase}-${Date.now()}`,
      migrationId,
      phase,
      timestamp: new Date(),
      
      // Capture current state
      database: await this.backupDatabase(),
      configuration: await this.backupConfiguration(),
      traffic: await this.captureTrafficConfig(),
      
      // Metrics at checkpoint
      metrics: {
        errorRate: await this.getCurrentErrorRate(),
        responseTime: await this.getCurrentResponseTime(),
        throughput: await this.getCurrentThroughput()
      }
    }
    
    this.checkpoints.set(checkpoint.id, checkpoint)
    
    // Store checkpoint
    await this.storeCheckpoint(checkpoint)
    
    return checkpoint.id
  }
  
  async rollback(checkpointId, reason) {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`)
    }
    
    console.log(`Starting rollback to ${checkpointId}. Reason: ${reason}`)
    
    try {
      // Step 1: Stop new traffic
      await this.pauseTraffic()
      
      // Step 2: Restore traffic configuration
      await this.restoreTrafficConfig(checkpoint.traffic)
      
      // Step 3: Restore database
      await this.restoreDatabase(checkpoint.database)
      
      // Step 4: Restore configuration
      await this.restoreConfiguration(checkpoint.configuration)
      
      // Step 5: Verify rollback
      await this.verifyRollback(checkpoint)
      
      // Step 6: Resume traffic
      await this.resumeTraffic()
      
      console.log(`Rollback completed successfully`)
      
      // Notify stakeholders
      await this.notifyRollback({
        checkpointId,
        reason,
        completedAt: new Date(),
        metrics: await this.compareMetrics(checkpoint.metrics)
      })
      
    } catch (error) {
      console.error('Rollback failed:', error)
      
      // Emergency procedures
      await this.emergencyProcedures(error)
      
      throw error
    }
  }
  
  async verifyRollback(checkpoint) {
    const verifications = [
      {
        name: 'Database Integrity',
        check: async () => {
          const tables = await this.getDatabaseTables()
          return tables.length === checkpoint.database.tableCount
        }
      },
      {
        name: 'API Availability',
        check: async () => {
          const endpoints = await this.testEndpoints()
          return endpoints.every(e => e.status === 'ok')
        }
      },
      {
        name: 'Error Rates',
        check: async () => {
          const currentRate = await this.getCurrentErrorRate()
          return currentRate <= checkpoint.metrics.errorRate * 1.1
        }
      }
    ]
    
    for (const verification of verifications) {
      const passed = await verification.check()
      if (!passed) {
        throw new Error(`Rollback verification failed: ${verification.name}`)
      }
    }
  }
}
```

## Common Migration Pitfalls and Solutions

### Pitfall 1: Data Type Mismatches

```javascript
// Problem: Legacy uses different data types
// Solution: Type conversion layer

class DataTypeConverter {
  constructor(mappings) {
    this.mappings = mappings
  }
  
  convert(table, field, value, direction = 'legacy-to-new') {
    const mapping = this.mappings[table]?.[field]
    if (!mapping) return value
    
    const converter = direction === 'legacy-to-new' 
      ? mapping.toNew 
      : mapping.toLegacy
    
    return converter ? converter(value) : value
  }
}

const typeConverter = new DataTypeConverter({
  users: {
    // Legacy: CHAR(1), New: boolean
    active: {
      toNew: (value) => value === 'Y',
      toLegacy: (value) => value ? 'Y' : 'N'
    },
    
    // Legacy: VARCHAR separate fields, New: JSON object
    address: {
      toNew: (value, record) => ({
        street: record.street_address,
        city: record.city,
        state: record.state,
        zip: record.zip_code
      }),
      toLegacy: (value) => ({
        street_address: value.street,
        city: value.city,
        state: value.state,
        zip_code: value.zip
      })
    },
    
    // Legacy: Unix timestamp, New: ISO date
    created_at: {
      toNew: (value) => new Date(value * 1000).toISOString(),
      toLegacy: (value) => Math.floor(new Date(value).getTime() / 1000)
    }
  }
})
```

### Pitfall 2: Business Logic in Database

```javascript
// Problem: Stored procedures and triggers
// Solution: Extract to application layer

class StoredProcedureMigrator {
  async extractBusinessLogic(procedureName) {
    const procedure = await this.getProcedureDefinition(procedureName)
    
    // Parse stored procedure
    const logic = this.parseProcedure(procedure)
    
    // Generate equivalent JavaScript
    return this.generateJavaScript(logic)
  }
  
  generateJavaScript(logic) {
    const template = `
async function ${logic.name}(${logic.parameters.join(', ')}) {
  ${logic.body.map(statement => this.convertStatement(statement)).join('\n  ')}
}
    `
    
    return template
  }
  
  // Example: Order total calculation stored procedure
  async migrateOrderTotalProcedure() {
    // Legacy stored procedure
    /*
    CREATE PROCEDURE CalculateOrderTotal(IN orderId INT)
    BEGIN
      DECLARE subtotal DECIMAL(10,2);
      DECLARE tax DECIMAL(10,2);
      DECLARE shipping DECIMAL(10,2);
      
      SELECT SUM(quantity * price) INTO subtotal
      FROM order_items WHERE order_id = orderId;
      
      SET tax = subtotal * 0.08;
      SET shipping = CASE 
        WHEN subtotal > 100 THEN 0
        ELSE 10
      END;
      
      UPDATE orders 
      SET subtotal = subtotal,
          tax = tax,
          shipping = shipping,
          total = subtotal + tax + shipping
      WHERE id = orderId;
    END
    */
    
    // Migrated to application logic
    return {
      hook: 'beforeUpdate',
      handler: async (context) => {
        if (context.resource !== 'orders') return
        
        // Calculate totals
        const items = await context.api.resources.orderitems.query({
          filter: { orderId: context.id }
        })
        
        const subtotal = items.reduce((sum, item) => 
          sum + (item.quantity * item.price), 0
        )
        
        const tax = subtotal * 0.08
        const shipping = subtotal > 100 ? 0 : 10
        
        // Update order
        context.data.subtotal = subtotal
        context.data.tax = tax
        context.data.shipping = shipping
        context.data.total = subtotal + tax + shipping
      }
    }
  }
}
```

### Pitfall 3: Hidden Dependencies

```javascript
// Problem: Undocumented service dependencies
// Solution: Dependency discovery and mapping

class DependencyDiscovery {
  async discoverDependencies(serviceName) {
    const dependencies = {
      direct: new Set(),
      indirect: new Set(),
      runtime: new Set()
    }
    
    // Analyze code imports
    const codeAnalysis = await this.analyzeCode(serviceName)
    codeAnalysis.imports.forEach(imp => dependencies.direct.add(imp))
    
    // Analyze database queries
    const dbAnalysis = await this.analyzeDatabaseQueries(serviceName)
    dbAnalysis.crossTableJoins.forEach(table => dependencies.direct.add(table))
    
    // Analyze runtime calls (from logs)
    const runtimeAnalysis = await this.analyzeRuntimeCalls(serviceName)
    runtimeAnalysis.httpCalls.forEach(service => dependencies.runtime.add(service))
    runtimeAnalysis.messageBus.forEach(topic => dependencies.runtime.add(topic))
    
    // Analyze configuration
    const configAnalysis = await this.analyzeConfiguration(serviceName)
    configAnalysis.externalServices.forEach(service => dependencies.direct.add(service))
    
    return {
      serviceName,
      dependencies: {
        direct: Array.from(dependencies.direct),
        indirect: Array.from(dependencies.indirect),
        runtime: Array.from(dependencies.runtime)
      },
      
      // Risk assessment
      risks: this.assessDependencyRisks(dependencies)
    }
  }
  
  assessDependencyRisks(dependencies) {
    const risks = []
    
    // Circular dependencies
    const circular = this.findCircularDependencies(dependencies)
    if (circular.length > 0) {
      risks.push({
        type: 'circular-dependency',
        severity: 'high',
        items: circular
      })
    }
    
    // Too many dependencies
    const totalDeps = dependencies.direct.size + dependencies.runtime.size
    if (totalDeps > 10) {
      risks.push({
        type: 'high-coupling',
        severity: 'medium',
        count: totalDeps,
        recommendation: 'Consider breaking into smaller services'
      })
    }
    
    // Undocumented runtime dependencies
    if (dependencies.runtime.size > 0) {
      risks.push({
        type: 'hidden-dependencies',
        severity: 'high',
        items: Array.from(dependencies.runtime),
        recommendation: 'Document and make explicit'
      })
    }
    
    return risks
  }
}
```

## Summary

Migration is not a technical problem - it's a business continuity challenge. Success requires:

1. **Gradual approach** - Never big bang migrations
2. **Continuous verification** - Monitor everything
3. **Rollback capability** - Always have an escape plan
4. **Data integrity** - It's not migrated until it's verified
5. **Communication** - Keep all stakeholders informed

Remember: The goal isn't to migrate fast, it's to migrate without breaking the business.

Next chapter: [Training Materials →](./ENTERPRISE_GUIDE_06_Training_Materials.md)