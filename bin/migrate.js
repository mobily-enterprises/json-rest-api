#!/usr/bin/env node

import { Command } from 'commander'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const program = new Command()

program
  .name('json-rest-api migrate')
  .description('Database migration tool for json-rest-api')
  .version('1.0.0')

program
  .command('create <name>')
  .description('Create a new migration file')
  .option('-d, --directory <dir>', 'migrations directory', './migrations')
  .action(async (name, options) => {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
    const filename = `${timestamp}_${name.replace(/[^a-z0-9_]/gi, '_')}.js`
    const filepath = path.join(options.directory, filename)
    
    await fs.mkdir(options.directory, { recursive: true })
    
    const template = `export default {
  async up(api, db) {
    // Add your forward migration here
    // Available methods:
    // - db.createTable(name, columns)
    // - db.dropTable(name)
    // - db.addColumn(table, column, type, options)
    // - db.dropColumn(table, column)
    // - db.addIndex(table, columns, options)
    // - db.dropIndex(table, name)
    // - db.execute(sql, params)
  },
  
  async down(api, db) {
    // Add your rollback migration here
  }
}
`
    
    await fs.writeFile(filepath, template)
    console.log(`Created migration: ${filepath}`)
  })

program
  .command('up')
  .description('Run pending migrations')
  .option('-t, --target <name>', 'migrate up to a specific migration')
  .option('-c, --config <file>', 'config file path', './api-config.js')
  .action(async (options) => {
    try {
      const { api } = await import(path.resolve(options.config))
      await api.connect()
      
      const migrated = await api.migrations.up(options.target)
      
      if (migrated.length === 0) {
        console.log('No migrations to run.')
      } else {
        console.log(`Migrated ${migrated.length} file(s).`)
      }
      
      await api.disconnect()
    } catch (error) {
      console.error('Migration failed:', error.message)
      process.exit(1)
    }
  })

program
  .command('down')
  .description('Rollback migrations')
  .option('-s, --steps <n>', 'number of migrations to rollback', '1')
  .option('-c, --config <file>', 'config file path', './api-config.js')
  .action(async (options) => {
    try {
      const { api } = await import(path.resolve(options.config))
      await api.connect()
      
      const steps = options.steps === 'all' ? null : parseInt(options.steps)
      const rolled = await api.migrations.down(steps)
      
      if (rolled.length === 0) {
        console.log('No migrations to rollback.')
      } else {
        console.log(`Rolled back ${rolled.length} migration(s).`)
      }
      
      await api.disconnect()
    } catch (error) {
      console.error('Rollback failed:', error.message)
      process.exit(1)
    }
  })

program
  .command('status')
  .description('Show migration status')
  .option('-c, --config <file>', 'config file path', './api-config.js')
  .action(async (options) => {
    try {
      const { api } = await import(path.resolve(options.config))
      await api.connect()
      
      const status = await api.migrations.status()
      
      console.log('\nApplied migrations:')
      if (status.applied.length === 0) {
        console.log('  None')
      } else {
        status.applied.forEach(m => {
          console.log(`  ✓ ${m.name} (batch ${m.batch})`)
        })
      }
      
      console.log('\nPending migrations:')
      if (status.pending.length === 0) {
        console.log('  None')
      } else {
        status.pending.forEach(m => {
          console.log(`  - ${m.name}`)
        })
      }
      
      await api.disconnect()
    } catch (error) {
      console.error('Status check failed:', error.message)
      process.exit(1)
    }
  })

program
  .command('reset')
  .description('Rollback all migrations')
  .option('-c, --config <file>', 'config file path', './api-config.js')
  .action(async (options) => {
    try {
      const { api } = await import(path.resolve(options.config))
      await api.connect()
      
      await api.migrations.reset()
      console.log('All migrations rolled back.')
      
      await api.disconnect()
    } catch (error) {
      console.error('Reset failed:', error.message)
      process.exit(1)
    }
  })

program
  .command('refresh')
  .description('Rollback all migrations and re-run them')
  .option('-c, --config <file>', 'config file path', './api-config.js')
  .action(async (options) => {
    try {
      const { api } = await import(path.resolve(options.config))
      await api.connect()
      
      await api.migrations.refresh()
      console.log('Database refreshed.')
      
      await api.disconnect()
    } catch (error) {
      console.error('Refresh failed:', error.message)
      process.exit(1)
    }
  })

program.parse()