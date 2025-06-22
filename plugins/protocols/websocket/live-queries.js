export class LiveQueryManager {
  constructor(api) {
    this.api = api;
    this.liveQueries = new Map();
    this.socketQueries = new Map();
    this.queryCache = new Map();
    this.updateInterval = null;
  }

  createLiveQuery(resource, filter, socket) {
    const queryId = this.generateQueryId(resource, filter, socket.id);
    
    const liveQuery = {
      id: queryId,
      resource,
      filter: filter || {},
      socketId: socket.id,
      socket,
      createdAt: new Date(),
      lastUpdate: null,
      updateCount: 0,
      active: true
    };

    this.liveQueries.set(queryId, liveQuery);

    // Track by socket
    if (!this.socketQueries.has(socket.id)) {
      this.socketQueries.set(socket.id, new Set());
    }
    this.socketQueries.get(socket.id).add(queryId);

    // Start periodic updates if not already running
    if (!this.updateInterval) {
      this.startPeriodicUpdates();
    }

    return queryId;
  }

  removeLiveQuery(queryId) {
    const query = this.liveQueries.get(queryId);
    if (query) {
      query.active = false;
      this.liveQueries.delete(queryId);
      
      // Remove from socket tracking
      const socketQueries = this.socketQueries.get(query.socketId);
      if (socketQueries) {
        socketQueries.delete(queryId);
        if (socketQueries.size === 0) {
          this.socketQueries.delete(query.socketId);
        }
      }

      // Clear cache
      this.queryCache.delete(queryId);
    }

    // Stop periodic updates if no more queries
    if (this.liveQueries.size === 0 && this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  removeLiveQueriesForSocket(socketId) {
    const queries = this.socketQueries.get(socketId);
    if (queries) {
      queries.forEach(queryId => this.removeLiveQuery(queryId));
    }
  }

  async updateLiveQueries(resource, operation, data) {
    const queries = this.getQueriesForResource(resource);
    
    for (const query of queries) {
      if (!query.active) continue;

      try {
        // Check if the data matches the query filter
        const matches = await this.matchesFilter(data, query.filter, resource);
        
        if (matches || operation === 'deleted') {
          // Execute the query
          const result = await this.executeQuery(query);
          
          // Check if results changed
          const cacheKey = query.id;
          const cachedResult = this.queryCache.get(cacheKey);
          
          if (this.hasResultChanged(cachedResult, result)) {
            // Update cache
            this.queryCache.set(cacheKey, {
              data: result.data,
              meta: result.meta,
              timestamp: new Date()
            });

            // Send update to socket
            query.socket.emit('livequery:update', {
              queryId: query.id,
              operation,
              data: result.data,
              meta: result.meta,
              timestamp: new Date()
            });

            // Update statistics
            query.lastUpdate = new Date();
            query.updateCount++;
          }
        }
      } catch (error) {
        query.socket.emit('livequery:error', {
          queryId: query.id,
          error: error.message
        });
      }
    }
  }

  async executeQuery(query) {
    const { resource, filter } = query;
    
    try {
      const result = await this.api.resources[resource].query({
        filter: filter || {}
      }, {
        user: query.socket.user
      });

      return {
        data: result.data,
        meta: result.meta
      };
    } catch (error) {
      throw new Error(`Failed to execute live query: ${error.message}`);
    }
  }

  async matchesFilter(data, filter, resource) {
    if (!filter || Object.keys(filter).length === 0) {
      return true;
    }

    // Extract actual data
    const record = data.attributes || data;

    for (const [key, value] of Object.entries(filter)) {
      if (typeof value === 'object' && value !== null) {
        // Handle operators
        if (!this.matchesOperator(record[key], value)) {
          return false;
        }
      } else {
        // Simple equality
        if (record[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  matchesOperator(fieldValue, operator) {
    for (const [op, value] of Object.entries(operator)) {
      switch (op) {
        case 'eq':
          if (fieldValue !== value) return false;
          break;
        case 'ne':
          if (fieldValue === value) return false;
          break;
        case 'gt':
          if (!(fieldValue > value)) return false;
          break;
        case 'gte':
          if (!(fieldValue >= value)) return false;
          break;
        case 'lt':
          if (!(fieldValue < value)) return false;
          break;
        case 'lte':
          if (!(fieldValue <= value)) return false;
          break;
        case 'in':
          if (!value.includes(fieldValue)) return false;
          break;
        case 'nin':
          if (value.includes(fieldValue)) return false;
          break;
        case 'like':
          if (!new RegExp(value.replace('%', '.*'), 'i').test(fieldValue)) return false;
          break;
        default:
          // Unknown operator
          return false;
      }
    }
    return true;
  }

  hasResultChanged(cachedResult, newResult) {
    if (!cachedResult) return true;

    // Compare meta
    if (cachedResult.meta?.total !== newResult.meta?.total) {
      return true;
    }

    // Compare data length
    if (cachedResult.data.length !== newResult.data.length) {
      return true;
    }

    // Compare data IDs
    const cachedIds = cachedResult.data.map(item => item.id).sort();
    const newIds = newResult.data.map(item => item.id).sort();
    
    return !this.arraysEqual(cachedIds, newIds);
  }

  arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  getQueriesForResource(resource) {
    const queries = [];
    for (const query of this.liveQueries.values()) {
      if (query.resource === resource && query.active) {
        queries.push(query);
      }
    }
    return queries;
  }

  generateQueryId(resource, filter, socketId) {
    const filterStr = filter ? JSON.stringify(filter) : 'all';
    return `${resource}:${filterStr}:${socketId}:${Date.now()}`;
  }

  startPeriodicUpdates(interval = 30000) {
    this.updateInterval = setInterval(async () => {
      for (const query of this.liveQueries.values()) {
        if (!query.active) continue;

        try {
          const result = await this.executeQuery(query);
          const cacheKey = query.id;
          const cachedResult = this.queryCache.get(cacheKey);

          if (this.hasResultChanged(cachedResult, result)) {
            this.queryCache.set(cacheKey, {
              data: result.data,
              meta: result.meta,
              timestamp: new Date()
            });

            query.socket.emit('livequery:refresh', {
              queryId: query.id,
              data: result.data,
              meta: result.meta,
              timestamp: new Date()
            });

            query.lastUpdate = new Date();
          }
        } catch (error) {
          // Query might have been removed
        }
      }
    }, interval);
  }

  getStats() {
    const stats = {
      totalQueries: this.liveQueries.size,
      queriesByResource: {},
      averageUpdateCount: 0,
      totalUpdates: 0
    };

    for (const query of this.liveQueries.values()) {
      stats.queriesByResource[query.resource] = 
        (stats.queriesByResource[query.resource] || 0) + 1;
      stats.totalUpdates += query.updateCount;
    }

    if (this.liveQueries.size > 0) {
      stats.averageUpdateCount = stats.totalUpdates / this.liveQueries.size;
    }

    return stats;
  }
}