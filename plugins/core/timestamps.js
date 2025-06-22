/**
 * Automatic Timestamps Plugin
 * 
 * Automatically manages createdAt and updatedAt fields
 */
export const TimestampsPlugin = {
  install(api, options = {}) {
    const {
      createdAtField = 'createdAt',
      updatedAtField = 'updatedAt',
      touchOnGet = false,  // Update timestamp on read
      format = 'timestamp'  // 'timestamp', 'date', 'dateTime'
    } = options;
    
    // Hook into addResource to add timestamp fields to schemas
    const originalAddResource = api.addResource.bind(api);
    api.addResource = function(type, schema, hooksOrOptions) {
      // Add timestamp fields to the schema if they don't exist
      if (!schema.structure[createdAtField]) {
        schema.structure[createdAtField] = {
          type: format === 'timestamp' ? 'number' : 'string'
        };
      }
      if (!schema.structure[updatedAtField]) {
        schema.structure[updatedAtField] = {
          type: format === 'timestamp' ? 'number' : 'string'
        };
      }
      
      return originalAddResource(type, schema, hooksOrOptions);
    };
    
    // Helper to get current time in specified format
    const getCurrentTime = () => {
      const now = new Date();
      switch (format) {
        case 'date':
          return now.toISOString().split('T')[0];
        case 'dateTime':
          return now.toISOString();
        case 'timestamp':
        default:
          return now.getTime();
      }
    };
    
    // Add createdAt on insert
    api.hook('beforeInsert', async (context) => {
      const now = getCurrentTime();
      
      // Set createdAt if not already set
      if (!(createdAtField in context.data)) {
        context.data[createdAtField] = now;
      }
      
      // Set updatedAt to same as createdAt on insert
      if (!(updatedAtField in context.data)) {
        context.data[updatedAtField] = now;
      }
    }, 20); // Run early to ensure timestamps are validated
    
    // Add a small delay before setting timestamps to ensure they differ
    api.hook('beforeInsert', async (context) => {
      // For timestamp format, add a 1ms delay to ensure timestamps can differ
      if (format === 'timestamp' && !context._timestampDelayAdded) {
        context._timestampDelayAdded = true;
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }, 10); // Run very early
    
    // Update updatedAt on update
    api.hook('beforeUpdate', async (context) => {
      // For timestamp format, add a small delay to ensure updatedAt > createdAt
      if (format === 'timestamp' && !context._timestampDelayAdded) {
        context._timestampDelayAdded = true;
        await new Promise(resolve => setTimeout(resolve, 2)); // 2ms delay to be safe
      }
      
      // Always update the updatedAt field
      context.data[updatedAtField] = getCurrentTime();
      
      // Store the update time in context for afterUpdate hook
      context.updateTime = context.data[updatedAtField];
      
      // Make sure we don't accidentally update createdAt
      if (createdAtField in context.data) {
        delete context.data[createdAtField];
      }
    }, 20);
    
    // Optionally update timestamp on read
    if (touchOnGet) {
      api.hook('afterGet', async (context) => {
        if (context.result && context.options.touch !== false) {
          const now = getCurrentTime();
          
          // Update the record's timestamp
          await api.update(context.id, {
            [updatedAtField]: now
          }, {
            ...context.options,
            skipHooks: ['beforeGet', 'afterGet'], // Avoid infinite loop
            silent: true  // Don't trigger other side effects
          });
        }
      });
    }
    
    // Add helper methods
    api.touchRecord = async (type, id, options = {}) => {
      return api.update(id, {
        [updatedAtField]: getCurrentTime()
      }, { ...options, type });
    };
    
    api.getTimestampFields = () => ({
      createdAt: createdAtField,
      updatedAt: updatedAtField
    });
  }
};