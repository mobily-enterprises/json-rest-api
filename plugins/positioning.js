/**
 * Positioning plugin for managing record order
 */
export const PositioningPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      positionField: 'position',
      beforeIdField: 'beforeId',
      positionFilters: [],
      ...options
    };

    // Add positioning options to API
    api.positioningOptions = defaultOptions;

    // Hook into insert operations
    api.hook('beforeInsert', async (context) => {
      const { data, options } = context;
      const posOptions = { ...defaultOptions, ...options.positioning };
      
      if (!posOptions.enabled) return;

      // Handle beforeId positioning
      if (data[posOptions.beforeIdField] !== undefined) {
        const beforeId = data[posOptions.beforeIdField];
        delete data[posOptions.beforeIdField]; // Remove virtual field
        
        if (beforeId === null) {
          // Place at end
          const filters = {};
          for (const field of posOptions.positionFilters) {
            if (data[field] !== undefined) {
              filters[field] = data[field];
            }
          }
          const maxPos = await api.getNextPosition(options.type, filters, posOptions) - 1;
          data[posOptions.positionField] = maxPos + 1;
        } else {
          // Place before specific record
          const beforeRecord = await api.get(beforeId, options);
          if (beforeRecord?.data) {
            const targetPosition = beforeRecord.data.attributes[posOptions.positionField] || 1;
            
            // Build filter for position queries
            const positionFilter = {};
            for (const field of posOptions.positionFilters) {
              if (data[field] !== undefined) {
                positionFilter[field] = data[field];
              }
            }
            
            // Shift positions before inserting
            await shiftPositionsBeforeInsert(api, options, targetPosition, posOptions.positionField, positionFilter);
            
            // Set position for new record
            data[posOptions.positionField] = targetPosition;
          }
        }
      } else if (!data[posOptions.positionField]) {
        // Auto-assign position if not provided
        const filters = {};
        for (const field of posOptions.positionFilters) {
          if (data[field] !== undefined) {
            filters[field] = data[field];
          }
        }
        data[posOptions.positionField] = await api.getNextPosition(options.type, filters, posOptions);
      }
    });

    // Hook into update operations
    api.hook('beforeUpdate', async (context) => {
      const { data, options } = context;
      const posOptions = { ...defaultOptions, ...options.positioning };
      
      if (!posOptions.enabled) return;

      // Handle beforeId positioning
      if (data[posOptions.beforeIdField] !== undefined) {
        context.positioningData = {
          beforeId: data[posOptions.beforeIdField],
          positionField: posOptions.positionField,
          filters: posOptions.positionFilters
        };
        
        // Remove virtual field from data
        delete data[posOptions.beforeIdField];
      }
    });

    // Note: afterInsert hook removed - positioning now handled entirely in beforeInsert

    // Calculate and apply positioning after update
    api.hook('afterUpdate', async (context) => {
      if (!context.positioningData) return;

      await applyPositioning(api, context, 'update');
    });

    // Add positioning helpers to API
    api.reposition = async (type, recordId, beforeId, options = {}) => {
      const posOptions = { ...defaultOptions, ...options };
      
      // Update the record with new position
      await api.update(recordId, {
        [posOptions.beforeIdField]: beforeId
      }, {
        type,
        positioning: { enabled: true, ...posOptions }
      });
    };

    // Get next position in sequence
    api.getNextPosition = async (type, filters = {}, options = {}) => {
      const posOptions = { ...defaultOptions, ...options };
      
      // Query to find max position
      const result = await api.query({
        filter: filters,
        sort: `-${posOptions.positionField}`,
        page: { size: 1 }
      }, { type });

      if (result.data.length > 0) {
        const maxPosition = result.data[0].attributes[posOptions.positionField] || 0;
        return maxPosition + 1;
      }
      
      return 1;
    };

    // Normalize positions (remove gaps)
    api.normalizePositions = async (type, filters = {}, options = {}) => {
      const posOptions = { ...defaultOptions, ...options };
      
      // Get all records sorted by position
      const result = await api.query({
        filter: filters,
        sort: posOptions.positionField,
        page: { size: 10000 } // Get all records
      }, { type });

      // Update positions to remove gaps
      let position = 1;
      for (const record of result.data) {
        if (record.attributes[posOptions.positionField] !== position) {
          await api.update(record.id, {
            [posOptions.positionField]: position
          }, { type });
        }
        position++;
      }
    };
  }
};

/**
 * Apply positioning logic
 */
async function applyPositioning(api, context, operation) {
  const { positioningData, result, options } = context;
  const { beforeId, positionField, filters } = positioningData;
  
  // Build filter for position queries
  const positionFilter = { ...filters };
  
  // Handle different beforeId values
  if (beforeId === null) {
    // Place at end - get max position
    const maxPosResult = await api.query({
      filter: positionFilter,
      sort: `-${positionField}`,
      page: { size: 1 }
    }, options);
    
    const maxPosition = maxPosResult.data.length > 0 
      ? (maxPosResult.data[0].attributes[positionField] || 0)
      : 0;
    
    const newPosition = maxPosition + 1;
    
    // Update the record with new position
    await updatePosition(api, context, newPosition);
    
  } else if (beforeId) {
    // Place before specific record
    const beforeRecord = await api.get(beforeId, options);
    
    if (beforeRecord.data) {
      const targetPosition = beforeRecord.data.attributes[positionField] || 1;
      
      // Get the record ID (for updates, exclude the current record from shifting)
      const recordId = context.result?.data?.id || context.result?.id || context.id;
      
      // Shift positions of records at or after target position
      await shiftPositions(api, context, targetPosition, positionFilter, recordId);
      
      // Update the record with target position
      await updatePosition(api, context, targetPosition);
    }
  }
  // If beforeId is undefined, keep existing position (do nothing)
}

/**
 * Shift positions to make room
 */
async function shiftPositions(api, context, fromPosition, filter, excludeId = null) {
  const { options } = context;
  const { positionField } = context.positioningData;
  
  // Get all records (we'll filter manually for MemoryPlugin compatibility)
  const result = await api.query({
    filter: filter,
    sort: `-${positionField}`, // Sort descending to avoid conflicts
    page: { size: 10000 }
  }, options);
  
  // Filter and shift records
  for (const record of result.data) {
    // Skip the record being updated
    if (excludeId && record.id === excludeId) continue;
    
    const currentPos = record.attributes[positionField];
    if (currentPos >= fromPosition) {
      await api.update(record.id, {
        [positionField]: currentPos + 1
      }, { 
        ...options,
        positioning: { enabled: false } // Disable positioning to avoid recursion
      });
    }
  }
}

/**
 * Update record position
 */
async function updatePosition(api, context, position) {
  const { result, options } = context;
  const { positionField } = context.positioningData;
  
  // Get the ID from the result
  const recordId = result?.data?.id || result?.id;
  if (!recordId) {
    throw new Error('Cannot update position: record ID not found');
  }
  
  // Update the record with new position
  const updateResult = await api.update(recordId, {
    [positionField]: position
  }, {
    ...options,
    positioning: { enabled: false } // Disable positioning to avoid recursion
  });
  
  // Update the result in context, preserving any existing data
  if (updateResult.data && context.result) {
    // Merge the position update result with the original result
    if (context.result.data && context.result.data.attributes) {
      context.result.data.attributes[positionField] = position;
    }
  }
}

/**
 * Shift positions before inserting a new record
 */
async function shiftPositionsBeforeInsert(api, options, fromPosition, positionField, filter) {
  // Get all records (we'll filter manually for MemoryPlugin compatibility)
  const result = await api.query({
    filter: filter,
    sort: `-${positionField}`, // Sort descending to avoid conflicts
    page: { size: 10000 }
  }, options);
  
  // Filter records that need shifting and shift them
  for (const record of result.data) {
    const currentPos = record.attributes[positionField];
    if (currentPos >= fromPosition) {
      await api.update(record.id, {
        [positionField]: currentPos + 1
      }, { 
        ...options,
        positioning: { enabled: false } // Disable positioning to avoid recursion
      });
    }
  }
}