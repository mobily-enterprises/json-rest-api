/**
 * Positioning Plugin
 * 
 * Manages record ordering with position field.
 * - Uses database transactions when available (MySQL)
 * - Simple positioning for memory storage (no atomicity guarantees)
 */
export const PositioningPlugin = {
  name: 'PositioningPlugin',
  version: '1.0.0',
  
  install(api, options = {}) {
    const defaultOptions = {
      positionField: 'position',
      beforeIdField: 'beforeId',
      ...options
    };

    // Store plugin config
    api.positioning = {
      options: defaultOptions
    };

    // Add atomic shift operation to API if storage supports it
    api.implement('shiftPositions', async (context) => {
      const { type, params } = context;
      const { field, from, delta, filter, excludeIds = [] } = params;
      
      // Try to use storage-specific atomic operation
      const storage = api.storagePlugin;
      if (storage?.supportsAtomicUpdates) {
        return await storage.atomicShiftPositions(type, params);
      }
      
      // Fallback to simple sequential updates
      // Get all affected records
      const result = await api.query({
        filter: filter || {},
        sort: [{ field, direction: 'DESC' }],
        page: { size: 10000 }
      }, { type });
      
      // Update each record
      const updates = [];
      for (const record of result.data) {
        if (excludeIds.includes(record.id)) continue;
        
        const currentPos = record.attributes[field];
        if (currentPos >= from) {
          updates.push({
            id: record.id,
            data: { [field]: currentPos + delta }
          });
        }
      }
      
      // Execute updates
      for (const update of updates) {
        await api.update(update.id, update.data, {
          type,
          positioning: { enabled: false }
        });
      }
      
      return { shifted: updates.length };
    });

    // Hook into validation to remove virtual field
    api.hook('beforeValidate', async (context) => {
      const { data, options, method } = context;
      
      if (method !== 'insert' && method !== 'update') return;
      
      // Get positioning config
      const resourceOptions = api.resourceOptions?.get(options.type) || {};
      const resourcePosConfig = resourceOptions.positioning || {};
      
      if (!resourcePosConfig.field && !resourcePosConfig.positionField) {
        return; // Positioning not configured for this resource
      }
      
      const posOptions = { 
        ...defaultOptions, 
        ...resourcePosConfig,
        ...(options.positioning || {})
      };
      
      // Remove virtual beforeId field before validation
      if (data && data[posOptions.beforeIdField] !== undefined) {
        context._beforeId = data[posOptions.beforeIdField];
        delete data[posOptions.beforeIdField];
      }
    }, 5);

    // Hook into insert operations
    api.hook('beforeInsert', async (context) => {
      const { data, options } = context;
      
      // Get positioning config
      const resourceOptions = api.resourceOptions?.get(options.type) || {};
      const resourcePosConfig = resourceOptions.positioning || {};
      
      if (!resourcePosConfig.field && !data[defaultOptions.positionField]) {
        return; // Positioning not configured for this resource
      }
      
      const posOptions = { 
        ...defaultOptions, 
        ...resourcePosConfig,
        ...(options.positioning || {})
      };
      
      const positionField = posOptions.field || posOptions.positionField;
      
      // Build position filters based on groupBy
      const positionFilter = {};
      if (posOptions.groupBy) {
        const groupByFields = Array.isArray(posOptions.groupBy) 
          ? posOptions.groupBy 
          : [posOptions.groupBy];
        
        for (const field of groupByFields) {
          if (data[field] !== undefined) {
            positionFilter[field] = data[field];
          }
        }
      }
      
      // Handle beforeId positioning
      if (context._beforeId !== undefined) {
        const beforeId = context._beforeId;
        
        await assignPosition(api, context, {
          beforeId,
          positionField,
          positionFilter,
          posOptions
        });
      } else if (!data[positionField]) {
        // Auto-assign position at end
        await assignPosition(api, context, {
          beforeId: null,
          positionField,
          positionFilter,
          posOptions
        });
      }
    }, 5); // Very high priority to run before other hooks

    // Hook into update operations
    api.hook('beforeUpdate', async (context) => {
      const { data, options, id } = context;
      
      const resourceOptions = api.resourceOptions?.get(options.type) || {};
      const resourcePosConfig = resourceOptions.positioning || {};
      
      if (!resourcePosConfig.field) return;
      
      const posOptions = { 
        ...defaultOptions, 
        ...resourcePosConfig,
        ...(options.positioning || {})
      };
      
      // Handle beforeId positioning
      if (context._beforeId !== undefined) {
        const beforeId = context._beforeId;
        
        // Get current record to maintain groupBy filters
        const current = await api.get(id, options);
        
        const positionFilter = {};
        if (posOptions.groupBy) {
          const groupByFields = Array.isArray(posOptions.groupBy) 
            ? posOptions.groupBy 
            : [posOptions.groupBy];
          
          for (const field of groupByFields) {
            positionFilter[field] = current.data.attributes[field];
          }
        }
        
        // Use atomic repositioning
        await reposition(api, context, {
          recordId: id,
          beforeId,
          positionField: posOptions.field || posOptions.positionField,
          positionFilter,
          posOptions
        });
      }
    }, 5); // Very high priority to run before other hooks

    // Add helper method for getting next position
    api.getNextPosition = async (type, filter = {}, options = {}) => {
      const posOptions = { ...defaultOptions, ...options };
      
      const result = await api.query({
        filter,
        sort: [{ field: posOptions.positionField, direction: 'DESC' }],
        page: { size: 1 }
      }, { type });
      
      const maxPosition = result.data.length > 0
        ? (result.data[0].attributes[posOptions.positionField] || 0)
        : 0;
        
      return maxPosition + 1;
    };
  }
};

/**
 * Assign position atomically for insert operations
 */
async function assignPosition(api, context, config) {
  const { beforeId, positionField, positionFilter, posOptions } = config;
  const { data, options } = context;
  
  if (beforeId === null) {
    // Place at end - use atomic increment if available
    const storage = api.storagePlugin;
    if (storage?.atomicGetNextPosition) {
      data[positionField] = await storage.atomicGetNextPosition(
        options.type,
        positionFilter,
        positionField
      );
    } else {
      // Simple approach: get max position and add 1
      const result = await api.query({
        filter: positionFilter,
        sort: [{ field: positionField, direction: 'DESC' }],
        page: { size: 1 }
      }, options);
      
      const maxPosition = result.data.length > 0
        ? (result.data[0].attributes[positionField] || 0)
        : 0;
      
      data[positionField] = maxPosition + 1;
    }
  } else {
    // Place before specific record
    const beforeRecord = await api.get(beforeId, options);
    if (!beforeRecord?.data) {
      throw new Error(`Record ${beforeId} not found for positioning`);
    }
    
    const targetPosition = beforeRecord.data.attributes[positionField] || 1;
    
    // Shift existing records
    await api.execute('shiftPositions', {
      type: options.type,
      params: {
        field: positionField,
        from: targetPosition,
        delta: 1,
        filter: positionFilter
      }
    });
    
    // Set position for new record
    data[positionField] = targetPosition;
  }
}

/**
 * Reposition record for update operations
 */
async function reposition(api, context, config) {
  const { recordId, beforeId, positionField, positionFilter, posOptions } = config;
  const { data, options } = context;
  
  // Get current position
  const current = await api.get(recordId, options);
  const currentPosition = current.data.attributes[positionField];
  
  let targetPosition;
  
  if (beforeId === null) {
    // Move to end
    const result = await api.query({
      filter: positionFilter,
      sort: [{ field: positionField, direction: 'DESC' }],
      page: { size: 1 }
    }, options);
    
    targetPosition = result.data.length > 0
      ? (result.data[0].attributes[positionField] || 0) + 1
      : 1;
  } else {
    // Move before specific record
    const beforeRecord = await api.get(beforeId, options);
    if (!beforeRecord?.data) {
      throw new Error(`Record ${beforeId} not found for positioning`);
    }
    targetPosition = beforeRecord.data.attributes[positionField] || 1;
  }
  
  // Only reposition if actually moving
  if (targetPosition !== currentPosition) {
    if (currentPosition < targetPosition) {
      // Moving down - shift records up
      await api.execute('shiftPositions', {
        type: options.type,
        params: {
          field: positionField,
          from: currentPosition + 1,
          delta: -1,
          filter: { 
            ...positionFilter,
            [positionField]: { $lte: targetPosition - 1 }
          },
          excludeIds: [recordId]
        }
      });
      data[positionField] = targetPosition - 1;
    } else {
      // Moving up - shift records down
      await api.execute('shiftPositions', {
        type: options.type,
        params: {
          field: positionField,
          from: targetPosition,
          delta: 1,
          filter: {
            ...positionFilter,
            [positionField]: { $lt: currentPosition }
          },
          excludeIds: [recordId]
        }
      });
      data[positionField] = targetPosition;
    }
  }
}