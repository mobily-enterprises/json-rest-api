import { requirePackage } from 'hooked-api';
import { jwtVerify, decodeProtectedHeader, decodeJwt, createRemoteJWKSet, importSPKI } from 'jose';

/**
 * Verify JWT token with multiple strategies using jose
 */
export async function verifyToken(token, options) {
  const { secret, publicKey, algorithms, audience, issuer, jwksUrl } = options;
  
  // Decode token header to get kid if needed
  const header = decodeProtectedHeader(token);
  
  // Prepare verification options
  const verifyOptions = {};
  if (algorithms) verifyOptions.algorithms = algorithms;
  if (audience) verifyOptions.audience = audience;
  if (issuer) verifyOptions.issuer = issuer;
  
  try {
    let result;
    
    if (jwksUrl) {
      // Use JWKS URL with jose's built-in support
      const JWKS = createRemoteJWKSet(new URL(jwksUrl), {
        cacheMaxAge: 600000, // 10 minutes cache
        cooldownDuration: 30000 // 30 seconds cooldown on errors
      });
      
      result = await jwtVerify(token, JWKS, verifyOptions);
    } else if (publicKey) {
      // Import public key
      const key = await importSPKI(publicKey, algorithms?.[0] || 'RS256');
      result = await jwtVerify(token, key, verifyOptions);
    } else if (secret) {
      // Use secret for symmetric algorithms
      const encoder = new TextEncoder();
      const key = encoder.encode(secret);
      result = await jwtVerify(token, key, verifyOptions);
    } else {
      throw new Error('No signing key available');
    }
    
    // Return the payload (jose returns {payload, protectedHeader})
    return result.payload;
  } catch (error) {
    // Map jose errors to match existing error handling
    if (error.code === 'ERR_JWT_EXPIRED') {
      const expiredError = new Error('jwt expired');
      expiredError.name = 'TokenExpiredError';
      throw expiredError;
    }
    if (error.code === 'ERR_JWS_INVALID' || error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      const invalidError = new Error('invalid signature');
      invalidError.name = 'JsonWebTokenError';
      throw invalidError;
    }
    if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      const validationError = new Error(error.message);
      validationError.name = 'JsonWebTokenError';
      throw validationError;
    }
    throw error;
  }
}

/**
 * Decode JWT without verification (for getting header/payload info)
 */
export function decodeToken(token, options = {}) {
  try {
    if (options.complete) {
      return {
        header: decodeProtectedHeader(token),
        payload: decodeJwt(token)
      };
    }
    return decodeJwt(token);
  } catch (error) {
    return null;
  }
}

/**
 * Create the revoked tokens resource
 */
export async function createRevocationResource(api, tableName) {
  // Check if resource already exists
  if (api.resources[tableName]) {
    return;
  }
  
  await api.addResource(tableName, {
    schema: {
      id: { type: 'id' },
      jti: { type: 'string', required: true, unique: true },
      user_id: { type: 'string', required: true },
      expires_at: { type: 'dateTime', required: true },
      revoked_at: { type: 'dateTime', required: true }
    },
    
    // Add index for cleanup queries
    indexes: [
      { fields: ['expires_at'] },
      { fields: ['user_id'] }
    ],
    
    // Hide from API discovery
    hidden: true
  });
  
  // Create table if using Knex
  if (api.resources[tableName].createKnexTable) {
    await api.resources[tableName].createKnexTable();
  }
}

/**
 * Check if token is revoked
 */
export async function checkRevocation(jti, api, config, memoryStore) {
  if (config.storage === 'database') {
    try {
      const result = await api.resources[config.tableName].get({
        id: jti,
        simplified: true
      });
      return !!result;
    } catch (error) {
      // Not found = not revoked
      if (error.subtype === 'not_found') {
        return false;
      }
      throw error;
    }
  } else {
    // Memory storage - also clean up expired tokens while we're here
    const now = Date.now();
    for (const [storedJti, data] of memoryStore.entries()) {
      if (data.expiresAt < now) {
        memoryStore.delete(storedJti);
      }
    }
    
    return memoryStore.has(jti);
  }
}

/**
 * Clean up expired tokens from revocation table
 */
export async function cleanupExpiredTokens(api, tableName) {
  const knex = api.knex || api.vars?.knex;
  
  if (!knex) {
    throw new Error('Knex instance not found for cleanup');
  }
  
  const result = await knex(tableName)
    .where('expires_at', '<', new Date())
    .delete();
    
  return result;
}