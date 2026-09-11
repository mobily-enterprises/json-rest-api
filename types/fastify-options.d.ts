import type { HttpConnectorOptions } from './plugin-options.js'

// This checks supplied host capabilities; it does not replace Fastify's API types.
type HostMethod = (...args: never[]) => unknown

export interface FastifyHost {
  route: HostMethod
  register: HostMethod
  hasContentTypeParser: HostMethod
  removeContentTypeParser: HostMethod
  addContentTypeParser: HostMethod
  setErrorHandler: HostMethod
  addHook: HostMethod
  setNotFoundHandler: HostMethod
}

export interface FastifyPluginOptions<App extends FastifyHost = FastifyHost> extends HttpConnectorOptions {
  app: App
}
