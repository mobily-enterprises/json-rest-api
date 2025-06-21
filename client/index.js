import { EventEmitter } from 'events';

class RestClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.baseURL = options.baseURL || '';
    this.headers = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      ...options.headers
    };
    this.timeout = options.timeout || 30000;
    this.interceptors = {
      request: [],
      response: [],
      error: []
    };
    this.resources = new Proxy({}, {
      get: (target, prop) => this._createResourceProxy(prop)
    });
  }

  _createResourceProxy(resourceName) {
    return {
      get: (id, options = {}) => this._request('GET', `/${resourceName}/${id}`, null, options),
      query: (options = {}) => this._request('GET', `/${resourceName}`, null, options),
      create: (data) => this._request('POST', `/${resourceName}`, { data }),
      update: (id, data) => this._request('PATCH', `/${resourceName}/${id}`, { data }),
      delete: (id) => this._request('DELETE', `/${resourceName}/${id}`),
      count: (filter = {}) => this._request('GET', `/${resourceName}`, null, { filter, page: { size: 1 } })
        .then(result => result.meta?.total || 0)
    };
  }

  async _request(method, path, body = null, queryParams = {}) {
    const url = new URL(this.baseURL + path);
    
    // Build query string
    if (queryParams.filter) {
      Object.entries(queryParams.filter).forEach(([key, value]) => {
        if (typeof value === 'object' && !Array.isArray(value)) {
          Object.entries(value).forEach(([op, val]) => {
            url.searchParams.append(`filter[${key}][${op}]`, val);
          });
        } else {
          url.searchParams.append(`filter[${key}]`, value);
        }
      });
    }
    
    if (queryParams.sort) {
      const sorts = Array.isArray(queryParams.sort) ? queryParams.sort : [queryParams.sort];
      url.searchParams.append('sort', sorts.join(','));
    }
    
    if (queryParams.page) {
      if (queryParams.page.size) url.searchParams.append('page[size]', queryParams.page.size);
      if (queryParams.page.number) url.searchParams.append('page[number]', queryParams.page.number);
    }
    
    if (queryParams.include) {
      const includes = Array.isArray(queryParams.include) ? queryParams.include : [queryParams.include];
      url.searchParams.append('include', includes.join(','));
    }
    
    if (queryParams.fields) {
      Object.entries(queryParams.fields).forEach(([resource, fields]) => {
        const fieldList = Array.isArray(fields) ? fields : [fields];
        url.searchParams.append(`fields[${resource}]`, fieldList.join(','));
      });
    }

    let requestConfig = {
      method,
      headers: { ...this.headers },
      signal: AbortSignal.timeout(this.timeout)
    };

    if (body) {
      requestConfig.body = JSON.stringify(body);
    }

    // Apply request interceptors
    for (const interceptor of this.interceptors.request) {
      requestConfig = await interceptor(requestConfig, url);
    }

    try {
      const response = await fetch(url, requestConfig);
      let data = null;

      if (response.headers.get('content-type')?.includes('application/json')) {
        data = await response.json();
      }

      // Apply response interceptors
      let result = { response, data };
      for (const interceptor of this.interceptors.response) {
        result = await interceptor(result);
      }

      if (!response.ok) {
        const error = new Error(data?.errors?.[0]?.detail || response.statusText);
        error.response = response;
        error.data = data;
        error.status = response.status;
        throw error;
      }

      return data?.data || data;
    } catch (error) {
      // Apply error interceptors
      let processedError = error;
      for (const interceptor of this.interceptors.error) {
        processedError = await interceptor(processedError);
      }
      throw processedError;
    }
  }

  addRequestInterceptor(interceptor) {
    this.interceptors.request.push(interceptor);
    return () => {
      const index = this.interceptors.request.indexOf(interceptor);
      if (index >= 0) this.interceptors.request.splice(index, 1);
    };
  }

  addResponseInterceptor(interceptor) {
    this.interceptors.response.push(interceptor);
    return () => {
      const index = this.interceptors.response.indexOf(interceptor);
      if (index >= 0) this.interceptors.response.splice(index, 1);
    };
  }

  addErrorInterceptor(interceptor) {
    this.interceptors.error.push(interceptor);
    return () => {
      const index = this.interceptors.error.indexOf(interceptor);
      if (index >= 0) this.interceptors.error.splice(index, 1);
    };
  }

  setAuthToken(token) {
    this.headers.Authorization = `Bearer ${token}`;
  }

  clearAuthToken() {
    delete this.headers.Authorization;
  }
}

export function createClient(options) {
  return new RestClient(options);
}

// Retry interceptor
export function retryInterceptor(maxRetries = 3, retryDelay = 1000) {
  return async (error) => {
    if (!error.config || error.config._retry >= maxRetries) {
      throw error;
    }

    const retryCount = (error.config._retry || 0) + 1;
    error.config._retry = retryCount;

    if (error.status >= 500 || error.name === 'AbortError') {
      await new Promise(resolve => setTimeout(resolve, retryDelay * retryCount));
      return error.config._originalRequest();
    }

    throw error;
  };
}

// Auth refresh interceptor
export function authRefreshInterceptor(refreshToken, refreshEndpoint) {
  return async (error) => {
    if (error.status === 401 && !error.config._isRetry) {
      error.config._isRetry = true;
      
      try {
        const response = await fetch(refreshEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        
        if (response.ok) {
          const data = await response.json();
          error.config.headers.Authorization = `Bearer ${data.accessToken}`;
          return error.config._originalRequest();
        }
      } catch (refreshError) {
        // Refresh failed
      }
    }
    
    throw error;
  };
}

// Logging interceptor
export function loggingInterceptor(logger = console) {
  return {
    request: async (config, url) => {
      logger.log(`[${config.method}] ${url}`);
      return config;
    },
    response: async (result) => {
      logger.log(`Response:`, result.data);
      return result;
    },
    error: async (error) => {
      logger.error(`Error:`, error.message, error.data);
      throw error;
    }
  };
}

export { RestClient };