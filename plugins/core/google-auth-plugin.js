/**
 * Google Authentication Plugin for REST API
 *
 * GOOGLE-SPECIFIC: Handles Google One-Tap authentication and session management
 * Creates app-owned sessions with refresh tokens from Google ID tokens
 */

import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';

export const GoogleAuthPlugin = {
  name: 'google-auth',
  dependencies: ['rest-api'],

  async install({ api, addHook, log, helpers, pluginOptions }) {
    log.info('Installing Google Authentication plugin');

    // GOOGLE-SPECIFIC: Configuration
    const config = {
      clientId: pluginOptions.clientId,
      sessionSecret: pluginOptions.sessionSecret || process.env.SESSION_SECRET || 'google-session-secret',
      sessionExpiry: pluginOptions.sessionExpiry || '30d',
      refreshExpiry: pluginOptions.refreshExpiry || '90d',
      usersResource: pluginOptions.usersResource || 'users',
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs'
    };

    if (!config.clientId) {
      log.warn('GoogleAuthPlugin: No client ID provided, skipping setup');
      return;
    }

    // GOOGLE-SPECIFIC: JWKS for Google token verification
    const JWKS = createRemoteJWKSet(new URL(config.jwksUrl));

    // Convert session secret to Uint8Array for jose
    const secret = new TextEncoder().encode(config.sessionSecret);

    // GOOGLE-SPECIFIC: Add auth endpoints using api.addRoute
    if (api.addRoute) {
      // Exchange Google One-Tap token for app session
      await api.addRoute({
        method: 'POST',
        path: '/api/auth/google/one-tap',
        handler: async ({ body, context }) => {
          try {
            const { credential } = body;

            // Verify Google ID token
            const { payload } = await jwtVerify(credential, JWKS, {
              issuer: ['https://accounts.google.com', 'accounts.google.com'],
              audience: config.clientId
            });

            log.debug('Google token verified', {
              sub: payload.sub,
              email: payload.email
            });

            // Upsert user in database
            const user = await helpers.jwtAuth.upsertUser(
              payload.sub,
              {
                email: payload.email,
                name: payload.name,
                google_picture: payload.picture,
                google_verified_email: payload.email_verified
              },
              'google'
            );

            console.log('🔴 GOOGLE AUTH: User object from upsertUser:', JSON.stringify(user, null, 2));
            const internalUserId = user?.id || user?.data?.id;
            console.log('🔴 GOOGLE AUTH: Extracted internalUserId:', internalUserId, 'type:', typeof internalUserId);
            console.log('🔴 GOOGLE AUTH: Google provider ID (sub):', payload.sub);

            // Create app-owned session token
            // IMPORTANT: userId field should contain the Google provider ID, not the internal user ID
            // The JWT plugin will look this up to find the internal user ID
            const sessionToken = await new SignJWT({
              userId: payload.sub,  // This MUST be the Google provider ID, not internal user ID!
              email: payload.email,
              provider: 'google',
              type: 'access'
            })
              .setProtectedHeader({ alg: 'HS256' })
              .setIssuedAt()
              .setIssuer('app')
              .setAudience('app')
              .setExpirationTime('30d')
              .sign(secret);

            // Create refresh token
            const refreshToken = await new SignJWT({
              userId: payload.sub,  // Also use Google provider ID here for consistency
              type: 'refresh'
            })
              .setProtectedHeader({ alg: 'HS256' })
              .setIssuedAt()
              .setIssuer('app')
              .setAudience('app')
              .setExpirationTime('90d')
              .sign(secret);

            return {
              statusCode: 200,
              body: {
                session: {
                  access_token: sessionToken,
                  refresh_token: refreshToken,
                  expires_in: 30 * 24 * 60 * 60, // 30 days
                  token_type: 'Bearer',
                  user: {
                    id: internalUserId,  // Return the internal user ID for the frontend
                    email: payload.email,
                    name: payload.name,
                    picture: payload.picture
                  }
                }
              }
            };

          } catch (error) {
            log.error('Google One-Tap exchange failed:', error.message || error);
            return {
              statusCode: 401,
              body: { error: error.message || 'Invalid Google token' }
            };
          }
        }
      });

      // Refresh token endpoint
      await api.addRoute({
        method: 'POST',
        path: '/api/auth/google/refresh',
        handler: async ({ body, context }) => {
          try {
            const { refresh_token } = body;

            const { payload } = await jwtVerify(refresh_token, secret, {
              issuer: 'app',
              audience: 'app'
            });

            if (payload.type !== 'refresh') {
              throw new Error('Invalid token type');
            }

            // Issue new access token
            const sessionToken = await new SignJWT({
              userId: payload.userId,
              provider: 'google',
              type: 'access'
            })
              .setProtectedHeader({ alg: 'HS256' })
              .setIssuedAt()
              .setIssuer('app')
              .setAudience('app')
              .setExpirationTime('30d')
              .sign(secret);

            return {
              statusCode: 200,
              body: {
                access_token: sessionToken,
                expires_in: 30 * 24 * 60 * 60
              }
            };

          } catch (error) {
            log.error('Google refresh failed:', error);
            return {
              statusCode: 401,
              body: { error: 'Invalid refresh token' }
            };
          }
        }
      });

      log.info('Added Google auth endpoints: /api/auth/google/one-tap, /api/auth/google/refresh');
    }

    // GOOGLE-SPECIFIC: Register as JWT provider for app-issued tokens
    addHook('jwt:register-provider', 'google-provider', {}, async ({ context }) => {
      context.providers.google = {
        secret: config.sessionSecret,  // App's secret, not Google's
        algorithms: ['HS256'],         // App's algorithm
        issuer: 'app',
        audience: 'app',
        userIdField: 'userId',
        emailField: 'email'
      };

      log.info('Google registered as JWT auth provider (app-issued tokens)');
    });

    // GOOGLE-SPECIFIC: Add Google fields to users schema
    addHook('schema:enrich', 'google-extend-users-schema', {}, async ({ context }) => {
      const { fields, scopeName } = context;

      if (scopeName !== config.usersResource) return;

      const googleFields = {
        google_id: { type: 'string', nullable: true, unique: true, indexed: true, search: true },
        google_picture: { type: 'string', nullable: true },
        google_name: { type: 'string', nullable: true },
        google_verified_email: { type: 'boolean', default: false }
      };

      Object.assign(fields, googleFields);
      log.debug(`Extended ${scopeName} with Google fields`);
    });

    log.info('GoogleAuthPlugin installed successfully');
  }
}