/**
 * Helper functions for HTTP request context creation
 * Used by both HTTP and Express plugins
 */

/**
 * Extract the real client IP address, handling proxies
 * @param {Object} req - The request object (Node.js http.IncomingMessage or Express Request)
 * @returns {string} The client IP address
 */
export function getClientIP (req) {
  // Check X-Forwarded-For header (comma-separated list, first is original client)
  const xForwardedFor = req.headers['x-forwarded-for']
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim()
  }

  // Check X-Real-IP header (single IP)
  const xRealIP = req.headers['x-real-ip']
  if (xRealIP) {
    return xRealIP
  }

  // Check Cloudflare's CF-Connecting-IP
  const cfConnectingIP = req.headers['cf-connecting-ip']
  if (cfConnectingIP) {
    return cfConnectingIP
  }

  // Fall back to direct connection
  return req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip || // Express specific
         'unknown'
}

/**
 * Check if the request is using HTTPS
 * @param {Object} req - The request object
 * @returns {boolean} True if the request is secure
 */
export function isSecure (req) {
  // Express-specific property
  if (req.secure !== undefined) {
    return req.secure
  }

  // Check X-Forwarded-Proto header (used by proxies)
  const xForwardedProto = req.headers['x-forwarded-proto']
  if (xForwardedProto) {
    return xForwardedProto === 'https'
  }

  // Check if connection is encrypted (Node.js)
  if (req.connection?.encrypted) {
    return true
  }

  // Check protocol directly
  if (req.protocol === 'https') {
    return true
  }

  // Default to false
  return false
}

/**
 * Get the hostname from the request
 * @param {Object} req - The request object
 * @returns {string} The hostname
 */
export function getHostname (req) {
  // Express-specific property
  if (req.hostname) {
    return req.hostname
  }

  // Check Host header
  const hostHeader = req.headers.host
  if (hostHeader) {
    // Remove port if present
    const colonIndex = hostHeader.indexOf(':')
    return colonIndex === -1 ? hostHeader : hostHeader.substring(0, colonIndex)
  }

  // Fall back
  return 'localhost'
}

/**
 * Get the port from the request
 * @param {Object} req - The request object
 * @returns {number|null} The port number or null
 */
export function getPort (req) {
  // Check Host header for port
  const hostHeader = req.headers.host
  if (hostHeader) {
    const colonIndex = hostHeader.indexOf(':')
    if (colonIndex !== -1) {
      const port = parseInt(hostHeader.substring(colonIndex + 1), 10)
      if (!isNaN(port)) {
        return port
      }
    }
  }

  // Check connection local port
  if (req.connection?.localPort) {
    return req.connection.localPort
  }

  if (req.socket?.localPort) {
    return req.socket.localPort
  }

  // Default ports based on protocol
  return isSecure(req) ? 443 : 80
}

/**
 * Parse cookies from cookie header string
 * @param {string} cookieString - The cookie header value
 * @returns {Object} Parsed cookies as key-value pairs
 */
export function parseCookies (cookieString) {
  const cookies = {}

  if (!cookieString || typeof cookieString !== 'string') {
    return cookies
  }

  // Split by semicolons and parse each cookie
  cookieString.split(';').forEach(cookie => {
    const trimmedCookie = cookie.trim()
    if (trimmedCookie) {
      const eqIndex = trimmedCookie.indexOf('=')
      if (eqIndex !== -1) {
        const name = trimmedCookie.substring(0, eqIndex).trim()
        const value = trimmedCookie.substring(eqIndex + 1).trim()
        if (name) {
          // Remove quotes if present
          cookies[name] = value.replace(/^"(.*)"$/, '$1')
        }
      }
    }
  })

  return cookies
}

/**
 * Extract token from request based on common patterns
 * @param {Object} req - The request object
 * @returns {string|null} The extracted token or null
 */
export function extractToken (req) {
  // Check Authorization header for Bearer token
  const authHeader = req.headers.authorization || req.headers.Authorization
  if (authHeader && typeof authHeader === 'string') {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i)
    if (bearerMatch) {
      return bearerMatch[1]
    }
  }

  // Check cookies for session token (Auth.js pattern)
  const cookies = parseCookies(req.headers.cookie || '')
  if (cookies['__Secure-authjs.session-token']) {
    return cookies['__Secure-authjs.session-token']
  }
  if (cookies['authjs.session-token']) {
    return cookies['authjs.session-token']
  }

  return null
}

/**
 * Create a context object for the request
 * @param {Object} req - The request object
 * @param {Object} res - The response object
 * @param {string} source - The source plugin ('http' or 'express')
 * @returns {Object} The context object
 */
export function createContext (req, res, source) {
  const context = {
    source,
    auth: {
      userId: null,
      claims: null
    },
    request: {
      ip: getClientIP(req),
      userAgent: req.headers['user-agent'] || null,
      protocol: isSecure(req) ? 'https' : 'http',
      hostname: getHostname(req),
      port: getPort(req),
      method: req.method,
      path: req.url || req.path,
      headers: req.headers,
      cookies: parseCookies(req.headers.cookie || ''),
      token: extractToken(req)
    },
    raw: { req, res },
    handled: false,
    rejection: null
  }

  // Add reject function
  context.reject = (status, message, details = {}) => {
    context.handled = true
    context.rejection = {
      status,
      message,
      ...details
    }
  }

  return context
}
