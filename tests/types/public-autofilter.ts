import type { AutoFilterDefinition, AutoFilterPluginOptions, AutoFilterRegistry, AutoFilterResolver, ResourceAutoFilter } from '../../types/autofilter.js'

interface Context { workspaceId?: string }
const resolver: AutoFilterResolver<Context> = async ({ context, filter }) => {
  const path: string = filter.inputPath
  const required: boolean = filter.required
  void [path, required]
  return context.workspaceId
}
const filter: AutoFilterDefinition<Context> = { field: 'workspace_id', resolver: 'workspace', required: false }
const inline: AutoFilterDefinition<Context> = { field: 'workspace_id', resolve: resolver }
const fallback: AutoFilterDefinition<Context> = { field: 'workspace_id', resolve: null, resolver }
const options: AutoFilterPluginOptions<Context> = {
  resolvers: { workspace: resolver, absent: () => undefined, empty: () => null },
  presets: { workspace: [filter], public: { filters: [] } }
}
const resource: ResourceAutoFilter<Context> = { preset: 'workspace', filters: [inline] }
const filtersOnly: ResourceAutoFilter<Context> = { filters: [fallback] }
const publicResource: ResourceAutoFilter = 'public'
const disabled: ResourceAutoFilter = false
declare const registry: AutoFilterRegistry
const scopeConfig = registry.getScopeConfig('books')
if (scopeConfig) {
  const preset: string | null = scopeConfig.preset
  const first = scopeConfig.filters[0]
  if (first) { const name: string = first.resolver; void name }
  void preset
}
void [options, resource, filtersOnly, publicResource, disabled]

// @ts-expect-error Every filter needs a resolver or resolve entry.
const missingResolver: AutoFilterDefinition = { field: 'workspace_id' }
// @ts-expect-error Every filter targets a persisted field by name.
const missingField: AutoFilterDefinition = { resolver: 'workspace' }
// @ts-expect-error Registry entries are functions, not resolved values.
const invalidResolver: AutoFilterPluginOptions = { resolvers: { workspace: 'w1' } }
// @ts-expect-error Preset objects require a filters array.
const invalidPreset: AutoFilterPluginOptions = { presets: { workspace: {} } }
// @ts-expect-error Resource objects need filters or a preset.
const emptyResource: ResourceAutoFilter = {}
// @ts-expect-error Required is a boolean, not a string toggle.
const invalidRequired: AutoFilterDefinition = { field: 'workspace_id', resolver: 'workspace', required: 'false' }
void [missingResolver, missingField, invalidResolver, invalidPreset, emptyResource, invalidRequired]
