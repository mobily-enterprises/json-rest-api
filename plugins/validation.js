import { ValidationError, BadRequestError, ErrorCodes } from '../lib/errors.js';

/**
 * Validation plugin for JSON REST API
 */
export const ValidationPlugin = {
  install(api, options = {}) {
    // Initialize schemas map if not already present
    if (!api.schemas) {
      api.schemas = new Map();
    }

    // Get schema for a type
    api.getSchema = (type) => {
      return api.schemas.get(type);
    };

    // Add validation hooks
    api.hook('beforeValidate', async (context) => {
      const { method, data, options } = context;
      const type = options.type || 'default';
      const schema = api.schemas.get(type);

      if (!schema) {
        return; // No schema registered for this type
      }

      // Skip validation for certain methods
      if (method === 'delete' || method === 'get' || method === 'query') {
        return;
      }

      // Determine validation options
      const validationOptions = {
        emptyAsNull: options.emptyAsNull ?? schema.options?.emptyAsNull ?? false,
        canBeNull: options.canBeNull ?? schema.options?.canBeNull ?? false,
        onlyObjectValues: method === 'update' && !options.fullRecord,
        skipParams: options.skipParams
      };

      // For updates, we might need to fetch the existing record
      if (method === 'update' && options.validateFullRecord) {
        const impl = api.implementers.get('get');
        if (impl) {
          const existingRecord = await impl({ 
            id: context.id, 
            options: context.options 
          });
          if (existingRecord) {
            context.existingRecord = existingRecord;
            context.data = { ...existingRecord, ...data };
          }
        }
      }

      // Validate the data
      const { validatedObject, errors } = await schema.validate(
        context.data,
        validationOptions
      );

      // Update context with validated data and errors
      context.data = validatedObject;
      
      // Map schema errors to structured errors with proper codes
      const mappedErrors = errors.map(err => {
        let code = ErrorCodes.INVALID_VALUE;
        
        // Map error types to specific codes
        if (err.message.includes('required')) {
          code = ErrorCodes.REQUIRED_FIELD;
        } else if (err.message.includes('too long')) {
          code = ErrorCodes.FIELD_TOO_LONG;
        } else if (err.message.includes('too short')) {
          code = ErrorCodes.FIELD_TOO_SHORT;
        } else if (err.message.includes('type')) {
          code = ErrorCodes.INVALID_TYPE;
        } else if (err.message.includes('format')) {
          code = ErrorCodes.INVALID_FORMAT;
        } else if (err.message.includes('enum')) {
          code = ErrorCodes.INVALID_ENUM_VALUE;
        }
        
        return {
          field: err.field,
          message: err.message,
          code,
          value: context.data[err.field]
        };
      });
      
      context.errors.push(...mappedErrors);
    });

    // Add permission checking hook
    api.hook('afterValidate', async (context) => {
      const { method, options } = context;
      const type = options.type || 'default';

      // Check permissions if handler is registered
      if (options.checkPermissions) {
        const permissionHandler = options.checkPermissions;
        const { granted, message } = await permissionHandler(context);
        
        if (!granted) {
          context.errors.push({
            field: null,
            message: message || 'Permission denied',
            code: ErrorCodes.FORBIDDEN
          });
        }
      }

      // Run custom validation if provided
      if (options.validate) {
        await options.validate(context, context.errors);
      }
      
      // Validate foreign key references
      if ((method === 'insert' || method === 'update') && context.data) {
        const schema = api.schemas.get(type);
        if (!schema) return;
        
        // Check each field with refs
        for (const [fieldName, definition] of Object.entries(schema.structure)) {
          if (definition.refs && context.data[fieldName] !== undefined && context.data[fieldName] !== null) {
            const refResource = definition.refs.resource;
            const refId = context.data[fieldName];
            
            // Skip if no resource defined
            if (!refResource) continue;
            
            // Check if the referenced record exists
            try {
              // Use the API's get method to check if the record exists
              const getImpl = api.implementers.get('get');
              if (getImpl) {
                await getImpl({
                  id: refId,
                  options: { type: refResource }
                });
              }
            } catch (error) {
              // If it's a NotFoundError, the reference is invalid
              if (error.code === 'RESOURCE_NOT_FOUND' || error.name === 'NotFoundError') {
                context.errors.push({
                  field: fieldName,
                  message: `Referenced ${refResource} with id ${refId} does not exist`,
                  code: ErrorCodes.INVALID_REFERENCE,
                  value: refId
                });
              } else {
                // Re-throw other errors
                throw error;
              }
            }
          }
        }
      }
    });

    // Add search schema validation for queries
    api.hook('beforeQuery', async (context) => {
      const { params, options } = context;
      const type = options.type || 'default';
      const schema = api.schemas.get(type);

      if (!schema || !options.searchSchema) {
        return;
      }

      // Validate search parameters
      const searchData = {};
      
      // Extract search parameters from query params
      if (params.filter) {
        Object.assign(searchData, params.filter);
      }
      
      // Add any custom search fields
      if (params.search && options.searchField) {
        searchData[options.searchField] = params.search;
      }

      // Validate search parameters
      const { validatedObject, errors } = await options.searchSchema.validate(
        searchData,
        { onlyObjectValues: true }
      );

      if (errors.length > 0) {
        // Map search validation errors
        const mappedErrors = errors.map(err => ({
          field: `filter.${err.field}`,
          message: err.message,
          code: ErrorCodes.INVALID_PARAMETER,
          value: searchData[err.field]
        }));
        context.errors.push(...mappedErrors);
      } else {
        // Update filter with validated values
        if (params.filter) {
          params.filter = validatedObject;
        }
      }
    });

    // Helper to create a search schema from main schema
    api.createSearchSchema = (schema, searchableFields) => {
      const searchStructure = {};
      
      for (const field of searchableFields) {
        if (schema.structure[field]) {
          searchStructure[field] = { 
            ...schema.structure[field],
            required: false // Search fields are never required
          };
        }
      }

      // Use the same Schema class as the main schema
      return new schema.constructor(searchStructure);
    };

    // Add field cleanup functionality
    api.hook('transformResult', async (context) => {
      const { result, options } = context;
      const type = options.type || 'default';
      const schema = api.schemas.get(type);

      if (!result || !schema || !options.cleanupFields) {
        return;
      }

      // Remove fields not in schema
      for (const key in result) {
        if (!schema.structure[key]) {
          delete result[key];
        }
      }

      // Remove silent fields if requested
      if (options.removeSilentFields) {
        for (const [key, definition] of Object.entries(schema.structure)) {
          if (definition.silent && result[key] !== undefined) {
            delete result[key];
          }
        }
      }
    });
  }
};