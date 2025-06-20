import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * JWT Authentication Plugin
 * 
 * Provides secure token generation and verification using JSON Web Tokens
 * Replaces the insecure Base64 JSON tokens with cryptographically signed JWTs
 */
export const JwtPlugin = {
  name: 'JwtPlugin',
  version: '1.0.0',
  
  install(api, options = {}) {
    // Configuration with secure defaults
    const config = {
      secret: options.secret || options.jwtSecret || process.env.JWT_SECRET,
      publicKey: options.publicKey || process.env.JWT_PUBLIC_KEY,
      privateKey: options.privateKey || process.env.JWT_PRIVATE_KEY,
      algorithm: options.algorithm || 'HS256',  // HS256 for secret, RS256 for key pair
      expiresIn: options.expiresIn || '24h',
      refreshExpiresIn: options.refreshExpiresIn || '30d',
      issuer: options.issuer || 'json-rest-api',
      audience: options.audience || undefined,
      clockTolerance: options.clockTolerance || 30,  // 30 seconds
      ignoreExpiration: options.ignoreExpiration || false,
      refreshTokenLength: options.refreshTokenLength || 32,
      
      // Migration support
      supportLegacyTokens: options.supportLegacyTokens || false,
      legacyTokenWarning: options.legacyTokenWarning !== false,
      
      // Token storage (for refresh tokens)
      tokenStore: options.tokenStore || new Map(),  // In production, use Redis/DB
      
      // Hooks
      beforeSign: options.beforeSign,
      afterVerify: options.afterVerify,
      onRefresh: options.onRefresh
    };
    
    // Validate configuration
    if (!config.secret && !config.privateKey) {
      throw new Error(
        'JWT configuration error: Either "secret" or "privateKey" must be provided.\n' +
        'Set JWT_SECRET environment variable or pass secret/privateKey in options.'
      );
    }
    
    // Use RS256 if key pair provided
    if (config.privateKey && config.publicKey) {
      config.algorithm = options.algorithm || 'RS256';
    }
    
    /**
     * Generate a JWT token
     */
    api.generateToken = async (payload, customOptions = {}) => {
      const tokenOptions = {
        algorithm: config.algorithm,
        expiresIn: customOptions.expiresIn || config.expiresIn,
        issuer: config.issuer,
        subject: customOptions.subject || String(payload.userId || payload.id),
        jwtid: customOptions.jwtid || crypto.randomUUID()
      };
      
      // Only add audience if defined
      if (customOptions.audience || config.audience) {
        tokenOptions.audience = customOptions.audience || config.audience;
      }
      
      // Clean payload - remove sensitive fields
      const cleanPayload = { ...payload };
      delete cleanPayload.password;
      delete cleanPayload.salt;
      delete cleanPayload.hash;
      
      // Add standard claims
      cleanPayload.iat = Math.floor(Date.now() / 1000);
      
      // Call beforeSign hook if provided
      if (config.beforeSign) {
        await config.beforeSign(cleanPayload, tokenOptions);
      }
      
      // Sign with appropriate key
      const signingKey = config.algorithm.startsWith('RS') || config.algorithm.startsWith('ES')
        ? config.privateKey
        : config.secret;
      
      const token = jwt.sign(cleanPayload, signingKey, tokenOptions);
      
      return token;
    };
    
    /**
     * Generate a refresh token
     */
    api.generateRefreshToken = async (userId, metadata = {}) => {
      const refreshToken = crypto.randomBytes(config.refreshTokenLength).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
      
      const tokenData = {
        userId,
        hashedToken,
        metadata,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + parseDuration(config.refreshExpiresIn)),
        lastUsed: null
      };
      
      // Store hashed version
      await config.tokenStore.set(hashedToken, tokenData);
      
      return refreshToken;
    };
    
    /**
     * Verify a JWT token
     */
    api.verifyToken = async (token, customOptions = {}) => {
      if (!token) {
        throw new Error('No token provided');
      }
      
      // Check if it's a legacy token (Base64 JSON)
      if (config.supportLegacyTokens && isLegacyToken(token)) {
        if (config.legacyTokenWarning) {
          console.warn('⚠️  WARNING: Legacy Base64 token detected. Please migrate to JWT tokens.');
        }
        
        return verifyLegacyToken(token);
      }
      
      const verifyOptions = {
        algorithms: [config.algorithm],
        issuer: config.issuer,
        clockTolerance: config.clockTolerance,
        ignoreExpiration: customOptions.ignoreExpiration || config.ignoreExpiration
      };
      
      // Only add audience if defined
      if (customOptions.audience || config.audience) {
        verifyOptions.audience = customOptions.audience || config.audience;
      }
      
      try {
        // Verify with appropriate key
        const verifyingKey = config.algorithm.startsWith('RS') || config.algorithm.startsWith('ES')
          ? config.publicKey || config.privateKey  // Public key preferred, but private key works too
          : config.secret;
        
        const decoded = jwt.verify(token, verifyingKey, verifyOptions);
        
        // Call afterVerify hook if provided
        if (config.afterVerify) {
          await config.afterVerify(decoded);
        }
        
        return decoded;
      } catch (error) {
        // Enhance error messages
        if (error.name === 'TokenExpiredError') {
          const expiredAt = new Date(error.expiredAt);
          throw new Error(`Token expired at ${expiredAt.toISOString()}`);
        } else if (error.name === 'JsonWebTokenError') {
          throw new Error(`Invalid token: ${error.message}`);
        } else if (error.name === 'NotBeforeError') {
          throw new Error(`Token not active yet: ${error.message}`);
        }
        
        throw error;
      }
    };
    
    /**
     * Refresh an access token using a refresh token
     */
    api.refreshAccessToken = async (refreshToken) => {
      if (!refreshToken) {
        throw new Error('No refresh token provided');
      }
      
      // Hash the token to look it up
      const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const tokenData = await config.tokenStore.get(hashedToken);
      
      if (!tokenData) {
        throw new Error('Invalid refresh token');
      }
      
      // Check expiration
      if (new Date() > tokenData.expiresAt) {
        await config.tokenStore.delete(hashedToken);
        throw new Error('Refresh token expired');
      }
      
      // Update last used
      tokenData.lastUsed = new Date();
      await config.tokenStore.set(hashedToken, tokenData);
      
      // Generate new access token
      const payload = {
        userId: tokenData.userId,
        ...tokenData.metadata
      };
      
      if (config.onRefresh) {
        await config.onRefresh(payload, tokenData);
      }
      
      const accessToken = await api.generateToken(payload);
      
      return {
        accessToken,
        refreshToken,  // Return same refresh token
        expiresIn: config.expiresIn
      };
    };
    
    /**
     * Revoke a refresh token
     */
    api.revokeRefreshToken = async (refreshToken) => {
      const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
      return await config.tokenStore.delete(hashedToken);
    };
    
    /**
     * Decode token without verification (for debugging)
     */
    api.decodeToken = (token) => {
      return jwt.decode(token, { complete: true });
    };
    
    // Add authentication hook
    api.hook('beforeOperation', async (context) => {
      const req = context.options.request;
      if (!req) return;
      
      // Extract token from various sources
      let token = null;
      
      // 1. Authorization header (Bearer token)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
      
      // 2. Custom header
      if (!token && options.tokenHeader) {
        token = req.headers[options.tokenHeader.toLowerCase()];
      }
      
      // 3. Query parameter (not recommended for production)
      if (!token && options.tokenQueryParam && req.query) {
        token = req.query[options.tokenQueryParam];
      }
      
      // 4. Cookie (if cookie parsing is available)
      if (!token && options.tokenCookie && req.cookies) {
        token = req.cookies[options.tokenCookie];
      }
      
      // Verify token if found
      if (token) {
        try {
          const decoded = await api.verifyToken(token);
          context.options.user = decoded;
          context.options.authenticated = true;
          context.options.authMethod = 'jwt';
        } catch (error) {
          context.options.authError = error.message;
          // Don't throw here - let other plugins handle authorization
        }
      }
    }, 10); // High priority
  }
};

// Helper to check if token is legacy Base64 JSON
function isLegacyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    JSON.parse(decoded);
    return true;
  } catch {
    return false;
  }
}

// Verify legacy token (for migration period)
function verifyLegacyToken(token) {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    
    if (decoded.exp && decoded.exp < Date.now()) {
      throw new Error('Token expired');
    }
    
    return decoded;
  } catch (error) {
    if (error.message === 'Token expired') {
      throw error;
    }
    throw new Error('Invalid token');
  }
}

// Parse duration string (e.g., '24h', '7d', '60m')
function parseDuration(duration) {
  const units = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000
  };
  
  const match = duration.match(/^(\d+)([smhdwy])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  
  return parseInt(match[1]) * units[match[2]];
}