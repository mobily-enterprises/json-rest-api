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
    
    // Update updatedAt on update
    api.hook('beforeUpdate', async (context) => {
      const now = getCurrentTime();
      
      // Always update the updatedAt field
      context.data[updatedAtField] = now;
      
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