/**
 * Scope validation functions for REST API plugin
 * These validations run when scopes are added to ensure proper configuration
 */

import { createPolymorphicHelpers } from './polymorphic-helpers.js';

/**
 * Validates that all belongsTo fields have an explicit type defined
 * @param {Object} eventData - The scope:added event data
 * @param {string} eventData.scopeName - Name of the scope being added
 * @param {Object} eventData.scopeOptions - Options for the scope including schema
 * @throws {Error} If a belongsTo field is missing a type definition
 */
export function validateBelongsToTypes({ eventData }) {
  const { scopeName, scopeOptions } = eventData;
  const schema = scopeOptions.schema || {};
  
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldDef.belongsTo && !fieldDef.type) {
      throw new Error(
        `Schema error in '${scopeName}': Field '${fieldName}' has belongsTo ` +
        `but no type. All belongsTo fields must have an explicit type for validation. ` +
        `Example: ${fieldName}: { type: 'number', belongsTo: '${fieldDef.belongsTo}', as: '${fieldDef.as || fieldName}' }`
      );
    }
  }
}

/**
 * Validates polymorphic relationships in scope configuration
 * @param {Object} eventData - The scope:added event data
 * @param {string} eventData.scopeName - Name of the scope being added
 * @param {Object} eventData.scopeOptions - Options for the scope including relationships
 * @param {Object} api - The API instance containing scopes and logger
 * @throws {Error} If a polymorphic relationship is invalid
 */
export function validatePolymorphicRelationships({ eventData, api }) {
  const { scopeName, scopeOptions } = eventData;
  const relationships = scopeOptions.relationships || {};
  
  // Create polymorphic helpers with access to scopes and logger
  const polymorphicHelpers = createPolymorphicHelpers(api.scopes, api.log);
  
  for (const [relName, relDef] of Object.entries(relationships)) {
    if (relDef.belongsToPolymorphic) {
      const validation = polymorphicHelpers.validatePolymorphicRelationship(relDef, scopeName);
      if (!validation.valid) {
        throw new Error(
          `Invalid polymorphic relationship '${relName}' in scope '${scopeName}': ${validation.error}`
        );
      }
    }
  }
}