import { AlaSQLAdapter } from './sql-adapters/alasql-adapter.js';
import { SQLPlugin } from './sql-adapters/sql-generic.js';

/**
 * Memory Plugin
 * 
 * Combines AlaSQL adapter with generic SQL functionality.
 * Provides in-memory SQL database with full SQL support.
 */
export const MemoryPlugin = {
  install(api, options = {}) {
    // Install AlaSQL adapter first
    AlaSQLAdapter.install(api, options);
    
    // Then install generic SQL plugin
    SQLPlugin.install(api, options);
  }
};