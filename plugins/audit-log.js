/**
 * Security Audit Logging Plugin
 * 
 * Logs security-relevant events for monitoring and compliance
 */
export const AuditLogPlugin = {
  name: 'AuditLogPlugin',
  version: '1.0.0',
  
  install(api, options = {}) {
    const config = {
      // Log destinations
      logToConsole: options.logToConsole !== false,
      logToFile: options.logToFile || false,
      logToDatabase: options.logToDatabase || false,
      logToRemote: options.logToRemote || false,
      
      // What to log
      logAuthFailures: options.logAuthFailures !== false,
      logAuthSuccess: options.logAuthSuccess || false,
      logDataAccess: options.logDataAccess || false,
      logDataModification: options.logDataModification !== false,
      logRateLimiting: options.logRateLimiting !== false,
      logSecurityViolations: options.logSecurityViolations !== false,
      
      // Log format
      format: options.format || 'json', // json, syslog, cef
      includeIp: options.includeIp !== false,
      includeUserAgent: options.includeUserAgent !== false,
      includeRequestId: options.includeRequestId !== false,
      
      // Storage
      storage: options.storage || new Map(), // In production, use DB or log service
      maxLogSize: options.maxLogSize || 10000, // Max logs in memory
      
      // Callbacks
      onSecurityEvent: options.onSecurityEvent,
      
      ...options
    };
    
    // Initialize storage
    api._auditLogs = config.storage;
    
    /**
     * Log a security event
     */
    const logSecurityEvent = async (event) => {
      const logEntry = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        ...event
      };
      
      // Add request context if available
      if (event.context) {
        const req = event.context.options?.request;
        if (req && config.includeIp) {
          logEntry.ip = req.ip || req.connection?.remoteAddress;
        }
        if (req && config.includeUserAgent) {
          logEntry.userAgent = req.headers?.['user-agent'];
        }
        if (req && config.includeRequestId) {
          logEntry.requestId = req.id;
        }
      }
      
      // Store in memory (with size limit)
      if (config.storage instanceof Map) {
        // Implement circular buffer
        if (config.storage.size >= config.maxLogSize) {
          const firstKey = config.storage.keys().next().value;
          config.storage.delete(firstKey);
        }
        config.storage.set(logEntry.id, logEntry);
      } else if (config.storage.set) {
        // Async storage
        await config.storage.set(logEntry.id, logEntry);
      }
      
      // Log to console
      if (config.logToConsole) {
        const severity = event.severity || 'INFO';
        const message = formatLogMessage(logEntry, config.format);
        
        switch (severity) {
          case 'CRITICAL':
          case 'ERROR':
            console.error(`[AUDIT] ${message}`);
            break;
          case 'WARNING':
            console.warn(`[AUDIT] ${message}`);
            break;
          default:
            console.log(`[AUDIT] ${message}`);
        }
      }
      
      // Call custom handler
      if (config.onSecurityEvent) {
        await config.onSecurityEvent(logEntry);
      }
      
      return logEntry;
    };
    
    // Expose audit logging method
    api.auditLog = logSecurityEvent;
    
    // Hook: Authentication failures
    api.hook('authenticationFailed', async (context) => {
      if (!config.logAuthFailures) return;
      
      await logSecurityEvent({
        type: 'AUTH_FAILURE',
        severity: 'WARNING',
        userId: context.attemptedUserId,
        method: context.authMethod,
        reason: context.reason,
        context
      });
    });
    
    // Hook: Authentication success
    api.hook('authenticationSuccess', async (context) => {
      if (!config.logAuthSuccess) return;
      
      await logSecurityEvent({
        type: 'AUTH_SUCCESS',
        severity: 'INFO',
        userId: context.options.user?.id,
        method: context.authMethod,
        context
      });
    });
    
    // Hook: Authorization failures
    api.hook('authorizationFailed', async (context) => {
      await logSecurityEvent({
        type: 'AUTHZ_FAILURE',
        severity: 'WARNING',
        userId: context.options.user?.id,
        resource: context.options.type,
        operation: context.method,
        permission: context.requiredPermission,
        context
      });
    });
    
    // Hook: Rate limiting
    api.hook('rateLimitExceeded', async (context) => {
      if (!config.logRateLimiting) return;
      
      await logSecurityEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        severity: 'WARNING',
        identifier: context.rateLimitKey,
        limit: context.limit,
        window: context.window,
        context
      });
    });
    
    // Hook: Data access (reads)
    api.hook('afterGet', async (context) => {
      if (!config.logDataAccess) return;
      if (!context.result) return;
      
      await logSecurityEvent({
        type: 'DATA_ACCESS',
        severity: 'INFO',
        userId: context.options.user?.id,
        resource: context.options.type,
        recordId: context.id,
        context
      });
    }, 95); // Low priority (runs last)
    
    api.hook('afterQuery', async (context) => {
      if (!config.logDataAccess) return;
      if (!context.results?.length) return;
      
      await logSecurityEvent({
        type: 'DATA_QUERY',
        severity: 'INFO',
        userId: context.options.user?.id,
        resource: context.options.type,
        recordCount: context.results.length,
        filters: context.params?.filter,
        context
      });
    }, 95);
    
    // Hook: Data modifications
    api.hook('afterInsert', async (context) => {
      if (!config.logDataModification) return;
      
      await logSecurityEvent({
        type: 'DATA_CREATE',
        severity: 'INFO',
        userId: context.options.user?.id,
        resource: context.options.type,
        recordId: context.result?.[api.options.idProperty || 'id'],
        context
      });
    }, 95);
    
    api.hook('afterUpdate', async (context) => {
      if (!config.logDataModification) return;
      
      await logSecurityEvent({
        type: 'DATA_UPDATE',
        severity: 'INFO',
        userId: context.options.user?.id,
        resource: context.options.type,
        recordId: context.id,
        changedFields: context.changedFields || Object.keys(context.data || {}),
        context
      });
    }, 95);
    
    api.hook('afterDelete', async (context) => {
      if (!config.logDataModification) return;
      
      await logSecurityEvent({
        type: 'DATA_DELETE',
        severity: 'WARNING',
        userId: context.options.user?.id,
        resource: context.options.type,
        recordId: context.id,
        context
      });
    }, 95);
    
    // Hook: Security violations
    api.hook('securityViolation', async (context) => {
      if (!config.logSecurityViolations) return;
      
      await logSecurityEvent({
        type: context.violationType || 'SECURITY_VIOLATION',
        severity: context.severity || 'CRITICAL',
        userId: context.options?.user?.id,
        details: context.details,
        context
      });
    });
    
    // Add suspicious auth bypass logging to authorization plugin
    const originalWarn = console.warn;
    console.warn = function(...args) {
      const message = args[0];
      if (typeof message === 'string' && message.includes('Suspicious auth bypass attempt')) {
        logSecurityEvent({
          type: 'AUTH_BYPASS_ATTEMPT',
          severity: 'CRITICAL',
          details: message,
          additionalInfo: args[1]
        });
      }
      return originalWarn.apply(console, args);
    };
    
    // Query audit logs
    api.queryAuditLogs = async (filters = {}) => {
      const logs = [];
      
      if (config.storage instanceof Map) {
        for (const [id, log] of config.storage) {
          if (matchesFilters(log, filters)) {
            logs.push(log);
          }
        }
      } else if (config.storage.query) {
        // Async storage with query support
        return await config.storage.query(filters);
      }
      
      // Sort by timestamp descending
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return logs;
    };
    
    // Get audit log statistics
    api.getAuditStats = async (timeRange = {}) => {
      const logs = await api.queryAuditLogs(timeRange);
      
      const stats = {
        total: logs.length,
        byType: {},
        bySeverity: {},
        byUser: {},
        byResource: {},
        timeRange: {
          start: timeRange.start || logs[logs.length - 1]?.timestamp,
          end: timeRange.end || logs[0]?.timestamp
        }
      };
      
      for (const log of logs) {
        // By type
        stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
        
        // By severity
        stats.bySeverity[log.severity] = (stats.bySeverity[log.severity] || 0) + 1;
        
        // By user
        if (log.userId) {
          stats.byUser[log.userId] = (stats.byUser[log.userId] || 0) + 1;
        }
        
        // By resource
        if (log.resource) {
          stats.byResource[log.resource] = (stats.byResource[log.resource] || 0) + 1;
        }
      }
      
      return stats;
    };
  }
};

// Helper functions

function formatLogMessage(logEntry, format) {
  switch (format) {
    case 'json':
      return JSON.stringify(logEntry);
      
    case 'syslog':
      // Simplified syslog format
      const severity = getSyslogSeverity(logEntry.severity);
      return `<${severity}>1 ${logEntry.timestamp} ${logEntry.ip || '-'} ${logEntry.type} - ${JSON.stringify(logEntry)}`;
      
    case 'cef':
      // Common Event Format
      return `CEF:0|JsonRestApi|API|1.0|${logEntry.type}|${logEntry.type}|${getCefSeverity(logEntry.severity)}|${formatCefExtensions(logEntry)}`;
      
    default:
      return `${logEntry.timestamp} [${logEntry.severity}] ${logEntry.type}: ${JSON.stringify(logEntry)}`;
  }
}

function getSyslogSeverity(severity) {
  const map = {
    'CRITICAL': 2,
    'ERROR': 3,
    'WARNING': 4,
    'INFO': 6,
    'DEBUG': 7
  };
  return (map[severity] || 6) * 8 + 6; // Facility 6 (user-level)
}

function getCefSeverity(severity) {
  const map = {
    'CRITICAL': 10,
    'ERROR': 8,
    'WARNING': 6,
    'INFO': 3,
    'DEBUG': 1
  };
  return map[severity] || 3;
}

function formatCefExtensions(logEntry) {
  const extensions = [];
  
  if (logEntry.userId) extensions.push(`suser=${logEntry.userId}`);
  if (logEntry.ip) extensions.push(`src=${logEntry.ip}`);
  if (logEntry.resource) extensions.push(`cs1=${logEntry.resource}`);
  if (logEntry.userAgent) extensions.push(`cs2=${logEntry.userAgent}`);
  
  return extensions.join(' ');
}

function matchesFilters(log, filters) {
  if (filters.type && log.type !== filters.type) return false;
  if (filters.severity && log.severity !== filters.severity) return false;
  if (filters.userId && log.userId !== filters.userId) return false;
  if (filters.resource && log.resource !== filters.resource) return false;
  
  if (filters.start && new Date(log.timestamp) < new Date(filters.start)) return false;
  if (filters.end && new Date(log.timestamp) > new Date(filters.end)) return false;
  
  return true;
}