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
      
      // Get resource-specific positioning config
      const resourceOptions = api.resourceOptions?.get(options.type) || {};
      const resourcePosConfig = resourceOptions.positioning || {};
      
      // Merge configs: defaults -> resource config -> operation options
      const posOptions = { 
        ...defaultOptions, 
        ...resourcePosConfig,
        ...(options.positioning || {})
      };
      
      // Check if positioning is configured for this resource
      if (!posOptions.field) return;
      
      // Build position filters based on groupBy
      const positionFilters = [];
      if (posOptions.groupBy) {
        const groupByFields = Array.isArray(posOptions.groupBy) ? posOptions.groupBy : [posOptions.groupBy];
        positionFilters.push(...groupByFields);
      }
      posOptions.positionFilters = positionFilters;
      
      // Use the configured field name
      posOptions.positionField = posOptions.field || posOptions.positionField;

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
            await shiftPositionsBeforeInsert(api, options.type, targetPosition, posOptions.positionField, positionFilter);
            
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
        
        // If no other fields are being updated, add a placeholder position field
        // This ensures the UPDATE query has at least one field to update
        // The actual position will be set in afterUpdate
        if (Object.keys(data).length === 0) {
          // Get current record to preserve its position temporarily
          const currentRecord = await api.get(context.id, options);
          if (currentRecord?.data?.attributes?.[posOptions.positionField] !== undefined) {
            data[posOptions.positionField] = currentRecord.data.attributes[posOptions.positionField];
          } else {
            data[posOptions.positionField] = 0; // Temporary value
          }
        }
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
        sort: [{ field: posOptions.positionField, direction: 'DESC' }],
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
        sort: [{ field: posOptions.positionField, direction: 'ASC' }],
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
      sort: [{ field: positionField, direction: 'DESC' }],
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
  const type = options.type;
  
  // Use bulk shift operation if available
  try {
    const result = await api.shiftPositions(type, {
      field: positionField,
      from: fromPosition,
      delta: 1,
      filter: filter,
      excludeIds: excludeId ? [excludeId] : []
    });
    
    return result;
  } catch (error) {
    // Fallback to individual updates if bulk shift is not implemented
    // Silently fall back to individual updates
    
    // Get all records (we'll filter manually for MemoryPlugin compatibility)
    const result = await api.query({
      filter: filter,
      sort: [{ field: positionField, direction: 'DESC' }], // Sort descending to avoid conflicts
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
          type,
          positioning: { enabled: false } // Disable positioning to avoid recursion
        });
      }
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
async function shiftPositionsBeforeInsert(api, type, fromPosition, positionField, filter) {
  // Use bulk shift operation if available
  try {
    const result = await api.shiftPositions(type, {
      field: positionField,
      from: fromPosition,
      delta: 1,
      filter: filter,
      excludeIds: []
    });
    
    return result;
  } catch (error) {
    // Fallback to individual updates if bulk shift is not implemented
    // Silently fall back to individual updates
    
    // Get all records (we'll filter manually for MemoryPlugin compatibility)
    const result = await api.query({
      filter: filter,
      sort: [{ field: positionField, direction: 'DESC' }], // Sort descending to avoid conflicts
      page: { size: 10000 }
    }, { type });
    
    // Filter records that need shifting and shift them
    for (const record of result.data) {
      const currentPos = record.attributes[positionField];
      if (currentPos >= fromPosition) {
        await api.update(record.id, {
          [positionField]: currentPos + 1
        }, { 
          type,
          positioning: { enabled: false } // Disable positioning to avoid recursion
        });
      }
    }
  }
}