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
      context.errors.push(...errors);
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
            code: 'PERMISSION_DENIED'
          });
        }
      }

      // Run custom validation if provided
      if (options.validate) {
        await options.validate(context, context.errors);
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
        context.errors.push(...errors);
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