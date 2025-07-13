/**
 * @module knex-constants
 * @description Shared constants for the REST API Knex plugin
 * 
 * This module contains all the magic strings and shared constants used
 * throughout the plugin to avoid repetition and improve maintainability.
 */

// Internal property names used for relationship tracking
export const RELATIONSHIPS_KEY = '_relationships';
export const RELATIONSHIP_METADATA_KEY = '_relationshipMetadata';
export const ROW_NUMBER_KEY = '_rn';

// Schema handling helpers
export const getSchemaStructure = (schema) => schema?.structure || schema || {};
export const getIdProperty = (schemaInfo) => schemaInfo?.idProperty || 'id';

// Default values
export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_NUMBER = 1;

// Database clients
export const DB_CLIENTS = {
  POSTGRES: 'pg',
  MYSQL: 'mysql',
  MYSQL2: 'mysql2',
  SQLITE: 'sqlite3',
  MSSQL: 'mssql'
};

// Error subtypes
export const ERROR_SUBTYPES = {
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  CONFLICT: 'conflict'
};