import { JsonRestApi } from '../../index.js'
import type { HookHandler, HookContext } from '../../types/hook-context.js'
import type { RuntimeCustomization, RuntimeHook, RuntimeResource } from '../../types/runtime.js'
import type { ResourceCoreMethods } from '../../types/resource-methods.js'

interface AppContext {
  auth: { userId: string }
  cache: Map<string, boolean>
  savedId?: string
}

const hooks = {
  beforeProcessingPatch: ({ context }) => {
    const method: 'patch' = context.method
    context.cache.set(context.auth.userId, true)
    // @ts-expect-error Early documents have not passed structural validation.
    context.inputRecord.data.attributes.title = 'Unvalidated'
    // @ts-expect-error A generated/validated target ID is not available at every processing hook.
    const id: string = context.id
    void [method, id]
  },
  beforeSchemaValidatePatch: {
    functionName: 'prepare-title',
    handler: ({ context }) => {
      const attributes = context.inputRecord.data.attributes ??= {}
      if (typeof attributes.title === 'string') attributes.title = attributes.title.trim()
      context.savedId = 'custom state remains mutable'
      // @ts-expect-error Attribute values are not schema-inferred or guaranteed valid yet.
      const title: string = attributes.title
      // @ts-expect-error Hooks cannot retarget the operation through library-owned identity.
      context.method = 'post'
      // @ts-expect-error Hooks cannot substitute library transaction ownership.
      context.transaction = undefined
      // @ts-expect-error Validated document identity cannot retarget the operation.
      context.inputRecord.data.id = 'another-record'
      // @ts-expect-error Validated resource type cannot retarget the operation.
      context.inputRecord.data.type = 'another-resource'
      // @ts-expect-error Replacing data would also replace validated identity and planned linkage.
      context.inputRecord.data = { type: 'other' }
      // @ts-expect-error Relationships are authorized and planned before schema-validation hooks.
      context.inputRecord.data.relationships = {}
      const group = context.inputRecord.data.relationships?.group
      if (group) {
        // @ts-expect-error Replacing linkage does not rebuild the prepared relationship operations.
        group.data = { type: 'groups', id: 'changed' }
        if (group.data && 'id' in group.data) {
          // @ts-expect-error Planned identifiers cannot be changed in place either.
          group.data.id = 'changed'
        }
      }
      void title
    }
  },
  afterDataCallPost: ({ context }) => {
    context.savedId = String(context.id)
    // @ts-expect-error Generated IDs are library-owned.
    context.id = 'replacement'
  },
  checkPermissions: ({ context }) => {
    const operation = context.originalContext ?? context
    operation.cache.set(operation.auth.userId, true)
    // Query permissions can run with a temporary filtering envelope.
    operation.knexQuery?.query?.clone()
    // @ts-expect-error The filtering envelope is not itself a Knex builder.
    operation.knexQuery?.where({ active: true })
    // @ts-expect-error Permission wrapper properties are not the operation's typed application state.
    context.auth.userId
  },
  checkPermissionsPatchRelationship: ({ context }) => {
    const method: 'patchRelationship' = context.method
    context.cache.set(context.relationshipName, true)
    void method
  },
  enrichAttributes: ({ context }) => {
    context.attributes.displayName = 'Presented'
    context.parentContext.cache.set('enriched', true)
    // @ts-expect-error Application state belongs to the parent operation, not this wrapper.
    context.auth.userId
    // @ts-expect-error The wrapper must retain its originating operation reference.
    context.parentContext = context.parentContext
  },
  finishPatch: ({ context }) => {
    if (context.format === 'jsonapi' && context.responseRecord) {
      const attributes = context.responseRecord.data.attributes ??= {}
      attributes.displayName = 'Prepared before commit'
    }
    // @ts-expect-error returning: none has no response record.
    context.responseRecord.id
  },
  finishGet: ({ context }) => {
    context.record.data.attributes ??= {}
    context.record.data.attributes.visited = true
    // @ts-expect-error A GET hook receives a single resource, not a collection.
    context.record.data.map(() => undefined)
  },
  finishQuery: ({ context }) => {
    for (const resource of context.record.data) context.cache.set(resource.id, true)
    // @ts-expect-error A query hook receives resource data as a collection.
    context.record.data.id
  },
  afterCommit: ({ context }) => {
    context.savedId = context.id === undefined ? undefined : String(context.id)
    // @ts-expect-error Completion hooks observe transaction outcomes, not rewrite them.
    context.transactionOutcome = 'rolledBack'
    // @ts-expect-error Completion can belong to an API transaction rather than one resource.
    const resource: string = context.scopeName
    void resource
  }
} satisfies NonNullable<RuntimeCustomization<AppContext>['hooks']>

const api = new JsonRestApi<Record<string, RuntimeResource>, AppContext>()
await api.customize({ hooks })
await api.customize({
  hooks: {
    beforeSchemaValidatePost: ({ context }) => {
      context.cache.set('registered-inline', true)
      // @ts-expect-error Inline registration retains known-hook ownership types.
      context.scopeName = 'other'
    }
  }
})

const named: HookHandler<'beforeSchemaValidatePut', AppContext> = ({ context }) => {
  const method: 'put' = context.method
  context.cache.set(method, true)
}
await api.customize({ hooks: { beforeSchemaValidatePut: { afterFunction: 'validation', handler: named } } })

declare const notes: ResourceCoreMethods<{ title: string }>
const nestedWrite: HookHandler<'beforeDataCallPost', AppContext> = async ({ context }) => {
  await notes.patch({ id: 'related', data: { title: 'Updated together' }, transaction: context.transaction }, {
    auth: context.auth, cache: context.cache
  })
  // @ts-expect-error The enclosing operation owns completion of this transaction.
  await context.transaction.commit()
}
void nestedWrite

const custom: RuntimeHook<{ jobId: string; complete?: boolean }> = ({ context }) => {
  context.complete = context.jobId.length > 0
}
await api.customize({ hooks: { pluginJobFinished: custom } })

const defaultApi = new JsonRestApi()
await defaultApi.customize({
  hooks: {
    beforeSchemaValidatePost: ({ context }) => {
      context.extraInformation = 'No application interface required'
      const attributes = context.inputRecord.data.attributes ??= {}
      attributes.title = 'A known document structure with unknown field values'
      // @ts-expect-error Known hooks retain ownership types with the default context too.
      context.returning = 'none'
      // @ts-expect-error Registered default-context handlers do not degrade to any.
      attributes.title.trim()
      // @ts-expect-error Storage references are library-owned even on default contexts.
      context.storageAdapter = undefined
    },
    beforeProcessingPost: ({ context }) => {
      // @ts-expect-error An early default-context document still needs structural validation.
      context.inputRecord.data.attributes.title = 'Unchecked'
    },
    finishGet: ({ context }) => {
      const id: string = context.record.data.id
      // @ts-expect-error Default-context read hooks know whether data is one resource or many.
      context.record.data.map(() => undefined)
      void id
    }
  }
})

declare const conflicting: HookContext<AppContext & { method: number; transaction: string }>
const method: string | undefined = conflicting.method
// @ts-expect-error A custom context declaration cannot redefine a library-owned field.
const transaction: string = conflicting.transaction
void [method, transaction]
