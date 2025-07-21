import { requirePackage } from 'hooked-api';

let jwt;
try {
  jwt = (await import('jsonwebtoken')).default;
} catch (e) {
  requirePackage('jsonwebtoken', 'jwt-auth', 
    'JSON Web Token support is required for JWT authentication. This is a peer dependency.');
}

/**
 * Verify JWT token with multiple strategies
 */
export async function verifyToken(token, options) {
  const { secret, publicKey, algorithms, audience, issuer, jwksClient } = options;
  
  // Decode token to get header
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) {
    throw new Error('Invalid token format');
  }
  
  let verifyOptions = {
    algorithms,
    audience,
    issuer
  };
  
  // Get the signing key
  let signingKey;
  
  if (jwksClient && decoded.header.kid) {
    // Use JWKS
    const key = await jwksClient.getSigningKey(decoded.header.kid);
    signingKey = key.getPublicKey();
  } else if (publicKey) {
    // Use public key
    signingKey = publicKey;
  } else if (secret) {
    // Use secret
    signingKey = secret;
  } else {
    throw new Error('No signing key available');
  }
  
  // Verify token
  return jwt.verify(token, signingKey, verifyOptions);
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