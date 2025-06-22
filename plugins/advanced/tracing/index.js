export const TracingPlugin = {
  install(api, options = {}) {
    const {
      serviceName = 'json-rest-api',
      enableAutoInstrumentation = true,
      enableHttpTracing = true,
      enableDatabaseTracing = true,
      enableCustomSpans = true,
      samplingRate = 1.0,
      propagators = ['tracecontext', 'baggage'],
      exporters = ['console'],
      endpoint = null,
      headers = {},
      attributes = {}
    } = options;

    // Mock OpenTelemetry implementation (in production, use @opentelemetry packages)
    const tracer = new MockTracer({
      serviceName,
      samplingRate,
      exporters,
      endpoint,
      headers,
      defaultAttributes: attributes
    });

    // Store tracer reference
    api.tracer = tracer;

    // Auto-instrument hooks
    if (enableAutoInstrumentation) {
      // Wrap executeHook to add tracing
      const originalExecuteHook = api.executeHook.bind(api);
      api.executeHook = async function(name, context) {
        const spanName = `${name}:${context.options?.type || 'unknown'}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            'hook.name': name,
            'resource.type': context.options?.type,
            'operation.type': context.method
          }
        });
        
        context._hookSpan = span;
        
        try {
          const result = await originalExecuteHook(name, context);
          span.setStatus({ code: 'OK' });
          return result;
        } catch (error) {
          span.recordException(error);
          span.setStatus({ code: 'ERROR', message: error.message });
          throw error;
        } finally {
          span.end();
        }
      };
    }

    // HTTP tracing
    if (enableHttpTracing) {
      // Store spans in a WeakMap keyed by response object
      const httpSpans = new WeakMap();
      
      // Define the middleware function
      const tracingMiddleware = (req, res, next) => {
        // Extract parent context from headers
        const parentContext = tracer.extract(req.headers);
        
        // Start HTTP span
        const span = tracer.startSpan('http.request', {
          parent: parentContext,
          attributes: {
            'http.method': req.method,
            'http.url': req.originalUrl || req.url,
            'http.target': req.path,
            'http.host': req.headers?.host,
            'http.scheme': req.protocol,
            'http.user_agent': req.headers?.['user-agent'],
            'net.peer.ip': req.ip
          }
        });

        // Store span for later
        httpSpans.set(res, span);
        const traceContext = span.context();

        // Inject trace context into response headers
        const traceHeaders = tracer.inject(traceContext);
        Object.entries(traceHeaders).forEach(([key, value]) => {
          res.setHeader(key, value);
        });

        // Wrap res.end to capture response details
        const originalEnd = res.end.bind(res);
        res.end = function(...args) {
          const httpSpan = httpSpans.get(res);
          if (httpSpan) {
            // Add response attributes
            httpSpan.setAttributes({
              'http.status_code': res.statusCode,
              'http.response_size': res.get('content-length') || 0
            });

            if (res.statusCode >= 400) {
              httpSpan.setStatus({ code: 'ERROR' });
            } else {
              httpSpan.setStatus({ code: 'OK' });
            }

            httpSpan.end();
            
            // Record metrics
            const duration = httpSpan.duration || 0;
            const labels = {
              method: req.method,
              route: req.path,
              status: res.statusCode
            };
            tracer.recordMetric('http.request.duration', duration, labels);
            tracer.recordMetric('http.request.count', 1, labels);
            
            httpSpans.delete(res);
          }
          return originalEnd(...args);
        };

        next();
      };
      
      // Store middleware for manual installation
      api.httpTracingMiddleware = tracingMiddleware;
      
      // If app is available, install immediately
      if (api.app) {
        api.app.use(tracingMiddleware);
      }
    }

    // Database tracing
    if (enableDatabaseTracing) {
      // Trace queries
      api.hook('beforeQuery', (context) => {
        const span = tracer.startSpan('db.query', {
          attributes: {
            'db.type': 'sql',
            'db.operation': 'query',
            'db.table': context.options?.type,
            'db.statement': context.query ? JSON.stringify(context.query) : undefined
          }
        });
        context._dbSpan = span;
      }, { priority: -50 }); // Run early to ensure span is created

      api.hook('afterQuery', (context) => {
        if (context._dbSpan) {
          context._dbSpan.setAttributes({
            'db.rows_affected': context.result?.length || 0
          });
          
          if (context.error) {
            context._dbSpan.recordException(context.error);
            context._dbSpan.setStatus({ code: 'ERROR' });
          }
          
          context._dbSpan.end();
        }
      });

      // Trace other DB operations
      ['Insert', 'Update', 'Delete', 'Get'].forEach(op => {
        api.hook(`before${op}`, (context) => {
          const span = tracer.startSpan(`db.${op.toLowerCase()}`, {
            attributes: {
              'db.type': 'sql',
              'db.operation': op.toLowerCase(),
              'db.table': context.options?.type
            }
          });
          context[`_db${op}Span`] = span;
        });

        api.hook(`after${op}`, (context) => {
          const span = context[`_db${op}Span`];
          if (span) {
            if (op === 'Insert' || op === 'Update' || op === 'Delete') {
              // In hooks, context.result is the raw data, not JSON:API wrapped
              span.setAttributes({
                'db.rows_affected': (!context.error && context.result !== undefined) ? 1 : 0
              });
            }
            
            if (context.error) {
              span.recordException(context.error);
              span.setStatus({ code: 'ERROR' });
            }
            
            span.end();
          }
        });
      });
    }

    // Custom span API
    if (enableCustomSpans) {
      api.span = (name, fn, options = {}) => {
        const span = tracer.startSpan(name, options);
        
        try {
          const result = fn(span);
          
          // Handle async functions
          if (result && typeof result.then === 'function') {
            return result
              .then(res => {
                span.setStatus({ code: 'OK' });
                span.end();
                return res;
              })
              .catch(err => {
                span.recordException(err);
                span.setStatus({ code: 'ERROR', message: err.message });
                span.end();
                throw err;
              });
          }
          
          span.setStatus({ code: 'OK' });
          span.end();
          return result;
        } catch (error) {
          span.recordException(error);
          span.setStatus({ code: 'ERROR', message: error.message });
          span.end();
          throw error;
        }
      };

      api.startSpan = (name, options) => tracer.startSpan(name, options);
      api.getCurrentSpan = () => tracer.getCurrentSpan();
    }

    // Trace context propagation helpers
    api.tracing = {
      extract: (headers) => tracer.extract(headers),
      inject: (context) => tracer.inject(context),
      
      // Add baggage items
      setBaggage: (key, value) => {
        const span = tracer.getCurrentSpan();
        if (span) {
          span.setBaggage(key, value);
        }
      },
      
      getBaggage: (key) => {
        const span = tracer.getCurrentSpan();
        return span?.getBaggage(key);
      },

      // Sampling decision
      setSamplingPriority: (priority) => {
        const span = tracer.getCurrentSpan();
        if (span) {
          span.setSamplingPriority(priority);
        }
      }
    };

    // Metrics are recorded in the HTTP middleware when span ends

    // Export endpoint for trace data
    api._setupTracingEndpoints = () => {
      if (api.app) {
        api.app.get('/api/tracing/export', (req, res) => {
          const traces = tracer.export();
          res.json(traces);
        });

        api.app.get('/api/tracing/stats', (req, res) => {
          const stats = tracer.getStats();
          res.json(stats);
        });
      }
    };
    
    // Try to set up immediately if app exists
    if (api.app) {
      api._setupTracingEndpoints();
    }

    // Store shutdown method for manual cleanup
    api.shutdownTracing = async () => {
      await tracer.shutdown();
    };
  }
};

// Mock tracer implementation
class MockTracer {
  constructor(options) {
    this.options = options;
    this.spans = [];
    this.metrics = new Map();
    this.currentSpan = null;
    this.stats = {
      spansCreated: 0,
      spansExported: 0,
      spansSampled: 0,
      spansDropped: 0
    };
  }

  startSpan(name, options = {}) {
    const span = new MockSpan(name, {
      ...options,
      tracer: this,
      serviceName: this.options.serviceName,
      attributes: {
        ...this.options.defaultAttributes,
        ...options.attributes
      }
    });

    // Sampling decision
    const sampled = Math.random() < this.options.samplingRate;
    span.sampled = sampled;

    this.stats.spansCreated++;
    if (sampled) {
      this.stats.spansSampled++;
      this.spans.push(span);
    } else {
      this.stats.spansDropped++;
    }

    this.currentSpan = span;
    return span;
  }

  getCurrentSpan() {
    return this.currentSpan;
  }

  extract(headers) {
    // Extract trace context from headers
    const traceParent = headers?.traceparent;
    if (traceParent) {
      const parts = traceParent.split('-');
      return {
        traceId: parts[1],
        spanId: parts[2],
        traceFlags: parts[3]
      };
    }
    return null;
  }

  inject(context) {
    // Inject trace context into headers
    if (!context) return {};
    
    return {
      traceparent: `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`,
      tracestate: context.traceState || ''
    };
  }

  recordMetric(name, value, labels = {}) {
    const key = `${name}:${JSON.stringify(labels)}`;
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        name,
        labels,
        values: []
      });
    }
    
    this.metrics.get(key).values.push({
      value,
      timestamp: Date.now()
    });
  }

  export() {
    const exported = [...this.spans];
    this.stats.spansExported += exported.length;
    this.spans = [];
    return exported.map(span => span.toJSON());
  }

  getStats() {
    return {
      ...this.stats,
      activeSpans: this.spans.length,
      metrics: Array.from(this.metrics.values()).map(m => ({
        name: m.name,
        labels: m.labels,
        count: m.values.length,
        latest: m.values[m.values.length - 1]
      }))
    };
  }

  async shutdown() {
    // Export remaining spans
    if (this.spans.length > 0) {
      this.export();
    }
    
    // Clear state
    this.spans = [];
    this.metrics.clear();
    this.currentSpan = null;
  }
}

// Mock span implementation
class MockSpan {
  constructor(name, options) {
    this.name = name;
    this.options = options;
    this.traceId = options.parent?.traceId || this.generateId(32); // 32 hex chars for trace ID
    this.spanId = this.generateId(16); // 16 hex chars for span ID
    this.parentSpanId = options.parent?.spanId;
    this.startTime = Date.now();
    this.endTime = null;
    this.attributes = options.attributes || {};
    this.events = [];
    this.status = null;
    this.baggage = new Map();
    this.sampled = true;
    this.samplingPriority = null;
  }

  setAttributes(attributes) {
    Object.assign(this.attributes, attributes);
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
  }

  addEvent(name, attributes) {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes
    });
  }

  recordException(error) {
    this.addEvent('exception', {
      'exception.type': error.constructor.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack
    });
  }

  setStatus(status) {
    this.status = status;
  }

  setBaggage(key, value) {
    this.baggage.set(key, value);
  }

  getBaggage(key) {
    return this.baggage.get(key);
  }

  setSamplingPriority(priority) {
    this.samplingPriority = priority;
  }

  context() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      sampled: this.sampled,
      baggage: Object.fromEntries(this.baggage),
      traceState: ''
    };
  }

  end() {
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
  }

  generateId(length = 16) {
    // length is in hex characters, not bytes
    return Array.from({ length: length / 2 }, () => 
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join('');
  }

  toJSON() {
    return {
      name: this.name,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      serviceName: this.options.serviceName,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      attributes: this.attributes,
      events: this.events,
      status: this.status,
      sampled: this.sampled,
      samplingPriority: this.samplingPriority
    };
  }
}