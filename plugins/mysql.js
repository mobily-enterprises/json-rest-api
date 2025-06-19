import { MySQLAdapter } from './adapters/mysql-adapter.js';
import { SQLPlugin } from './sql-generic.js';

/**
 * MySQL Plugin
 * 
 * Combines MySQL adapter with generic SQL functionality.
 * This maintains backward compatibility while using the new architecture.
 */
export const MySQLPlugin = {
  install(api, options = {}) {
    // Install MySQL adapter first
    MySQLAdapter.install(api, options);
    
    // Then install generic SQL plugin
    SQLPlugin.install(api, options);
    
    // MySQL-specific features that were in the old plugin
    if (options.syncSchemas) {
      api.hook('afterConnect', async () => {
        // Auto-sync schemas if requested
        for (const [type, schema] of api.schemas.entries()) {
          await api.execute('db.createTable', {
            table: type,
            schema,
            idProperty: api.options.idProperty || 'id'
          });
        }
      });
    }
  }
};