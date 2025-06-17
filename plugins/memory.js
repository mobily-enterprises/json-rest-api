import firstBy from 'thenby';

/**
 * Memory storage plugin for JSON REST API
 */
export const MemoryPlugin = {
  install(api, options = {}) {
    // Initialize data storage
    api.memoryData = options.initialData || [];
    api.memoryIdCounter = options.initialIdCounter || 1;

    // Implement CRUD operations
    api.implement('get', async (context) => {
      const { id, options } = context;
      const idProperty = options.idProperty || api.options.idProperty;
      
      const record = api.memoryData.find(item => 
        String(item[idProperty]) === String(id)
      );
      
      return record || null;
    });

    api.implement('query', async (context) => {
      const { params, options } = context;
      let data = [...api.memoryData];

      // Apply filters
      if (params.filter) {
        data = data.filter(item => {
          for (const [key, value] of Object.entries(params.filter)) {
            if (item[key] !== value) return false;
          }
          return true;
        });
      }

      // Apply search (if search parameter exists)
      if (params.search && options.searchFields) {
        const searchLower = params.search.toLowerCase();
        data = data.filter(item => {
          return options.searchFields.some(field => {
            const fieldValue = String(item[field] || '').toLowerCase();
            return fieldValue.includes(searchLower);
          });
        });
      }

      // Count total before pagination
      const total = data.length;

      // Apply sorting
      if (params.sort) {
        const sorts = params.sort.split(',');
        let sortChain = firstBy(() => 0);
        
        for (const sortField of sorts) {
          const descending = sortField.startsWith('-');
          const field = sortField.replace(/^-/, '');
          
          sortChain = sortChain.thenBy(
            item => item[field],
            { direction: descending ? -1 : 1, ignoreCase: true }
          );
        }
        
        data.sort(sortChain);
      }

      // Apply pagination
      const pageSize = Number(params.page?.size) || 10;
      const pageNumber = Number(params.page?.number) || 1;
      const skip = (pageNumber - 1) * pageSize;
      
      data = data.slice(skip, skip + pageSize);

      return {
        results: data,
        meta: {
          total,
          pageSize,
          pageNumber,
          totalPages: Math.ceil(total / pageSize)
        }
      };
    });

    api.implement('insert', async (context) => {
      const { data, options } = context;
      const idProperty = options.idProperty || api.options.idProperty;
      
      // Generate ID if not provided
      if (!data[idProperty]) {
        data[idProperty] = api.memoryIdCounter++;
      }
      
      // Handle positioning if enabled
      if (options.positionField && data[options.beforeIdField] !== undefined) {
        await handlePositioning(api, data, options);
      }
      
      // Add to memory
      api.memoryData.push(data);
      
      return { ...data };
    });

    api.implement('update', async (context) => {
      const { id, data, options } = context;
      const idProperty = options.idProperty || api.options.idProperty;
      
      const index = api.memoryData.findIndex(item => 
        String(item[idProperty]) === String(id)
      );
      
      if (index === -1) {
        throw new Error('Resource not found');
      }
      
      // Handle positioning
      if (options.positionField && data[options.beforeIdField] !== undefined) {
        await handlePositioning(api, { ...api.memoryData[index], ...data }, options);
      }
      
      // Update record
      api.memoryData[index] = { ...api.memoryData[index], ...data };
      
      return api.memoryData[index];
    });

    api.implement('delete', async (context) => {
      const { id, options } = context;
      const idProperty = options.idProperty || api.options.idProperty;
      
      const index = api.memoryData.findIndex(item => 
        String(item[idProperty]) === String(id)
      );
      
      if (index === -1) {
        throw new Error('Resource not found');
      }
      
      api.memoryData.splice(index, 1);
    });
  }
};

/**
 * Handle record positioning
 */
async function handlePositioning(api, record, options) {
  const { positionField, beforeIdField } = options;
  const idProperty = options.idProperty || api.options.idProperty;
  const beforeId = record[beforeIdField];
  
  if (beforeId === null) {
    // Place at end
    const maxPosition = Math.max(...api.memoryData.map(r => r[positionField] || 0));
    record[positionField] = maxPosition + 1;
  } else if (beforeId !== undefined) {
    // Find the record to place before
    const beforeRecord = api.memoryData.find(r => 
      String(r[idProperty]) === String(beforeId)
    );
    
    if (beforeRecord) {
      const position = beforeRecord[positionField] || 0;
      
      // Shift positions of records after this position
      api.memoryData.forEach(r => {
        if (r[positionField] >= position) {
          r[positionField]++;
        }
      });
      
      record[positionField] = position;
    }
  }
  
  // Remove beforeId from record as it's virtual
  delete record[beforeIdField];
}