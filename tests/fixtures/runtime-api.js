import { JsonRestApi } from '../../lib/runtime/json-rest-api.js'

export async function createRuntimeProbeApi (options = {}) {
  const api = new JsonRestApi(options)
  await api.use({
    name: 'probe',
    install ({ addResourceMethod, addApiMethod, helpers }) {
      helpers.describe = () => 'initial'
      addResourceMethod('inspect', args => args)
      addResourceMethod('describe', ({ helpers }) => helpers.describe())
      addApiMethod('invoke', ({ params, context }) => params.handler(context))
    }
  })
  await api.addResource('first', {
    hooks: { probe: ({ context }) => context.events.push('first-only') }
  })
  await api.addResource('second', {
    helpers: { describe: () => 'local' },
    methods: { describe: () => 'local-method' }
  })
  return api
}
