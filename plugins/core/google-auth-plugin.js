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

      // Link Google account to existing user
      await api.addRoute({
        method: 'POST',
        path: '/api/auth/google/link',
        handler: async ({ body, context }) => {
          try {
            // Check if user is authenticated
            if (!context.auth?.userId) {
              return {
                statusCode: 401,
                body: { error: 'Must be logged in to link accounts' }
              };
            }

            // Fetch the current user
            log.info(`[Google Link] Fetching user with ID: ${context.auth.userId}`);
            const userResult = await api.scopes.users.methods.get({
              id: context.auth.userId
            }, context);

            const currentUser = userResult.data;
            log.info(`[Google Link] Current user:`, currentUser);

            const { credential } = body;

            // Verify Google ID token
            const { payload } = await jwtVerify(credential, JWKS, {
              issuer: ['https://accounts.google.com', 'accounts.google.com'],
              audience: config.clientId
            });

            // Check if email matches current user
            log.info(`[Google Link] Comparing emails: Google=${payload.email}, Current=${currentUser.email}`);
            if (payload.email !== currentUser.email) {
              return {
                statusCode: 400,
                body: {
                  error: 'EMAIL_MISMATCH',
                  message: 'The Google account email must match your current account email'
                }
              };
            }

            // Check if this Google ID is already linked to another account
            const existingUser = await api.scopes.users.methods.query({
              filter: { google_id: payload.sub }
            }, context);

            if (existingUser.length > 0 && existingUser[0].id !== currentUser.id) {
              return {
                statusCode: 400,
                body: {
                  error: 'ALREADY_LINKED',
                  message: 'This Google account is already linked to another user'
                }
              };
            }

            // Update current user with Google ID
            log.info(`[Google Link] Updating user ${currentUser.id} with google_id: ${payload.sub}`);
            await api.scopes.users.methods.patch({
              inputRecord: {
                id: currentUser.id,
                google_id: payload.sub
              }
            }, context);

            log.info(`Linked Google account ${payload.email} to user ${currentUser.id}`);

            return {
              statusCode: 200,
              body: {
                success: true,
                linked: 'google',
                message: 'Google account successfully linked'
              }
            };

          } catch (error) {
            log.error('Google account linking failed:', error);
            return {
              statusCode: 500,
              body: { error: error.message || 'Failed to link Google account' }
            };
          }
        }
      });

      log.info('Added Google auth endpoints: /api/auth/google/one-tap, /api/auth/google/refresh, /api/auth/google/link');
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