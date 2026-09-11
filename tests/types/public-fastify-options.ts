import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { FastifyPluginOptions } from '../../types/fastify-options.js'

const app = Fastify()
const options: FastifyPluginOptions = { app, mountPath: '/api', httpValidators: true }
const inferred = { app, handle404: false } satisfies FastifyPluginOptions
inferred.app.get('/health', async () => ({ ok: true }))
const explicit: FastifyPluginOptions<FastifyInstance> = { app }
explicit.app.get('/health', async () => ({ ok: true }))
const http2 = Fastify({ http2: true })
const http2Options: FastifyPluginOptions = { app: http2 }
void [options, http2Options]

// @ts-expect-error Fastify requires an existing server instance.
const missing: FastifyPluginOptions = {}
// @ts-expect-error A server configuration is not a server instance.
const configuration: FastifyPluginOptions = { app: { logger: true } }
// @ts-expect-error Route registration alone cannot supply parser and hook operations.
const incomplete: FastifyPluginOptions = { app: { route: () => undefined } }
// @ts-expect-error The request body limit belongs to the supplied Fastify server.
const expressLimit: FastifyPluginOptions = { app, requestSizeLimit: '1mb' }
// @ts-expect-error The validator toggle is boolean.
const validator: FastifyPluginOptions = { app, httpValidators: 'true' }
void [missing, configuration, incomplete, expressLimit, validator]
