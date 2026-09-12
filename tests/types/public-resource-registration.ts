import { JsonRestApi } from '../../index.js'
import type {
  InferInput, InferOutput, JsonApiDocument, JsonApiResource, ResourceCoreMethods,
  ResourceIdentifier, ResourceSchema, RuntimeResource, RuntimeResourceOptions
} from '../../index.js'

const api = new JsonRestApi()
const books = await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    pages: { type: 'number', nullable: true },
    state: { type: 'string', enum: ['draft', 'published'] },
    secret: { type: 'string', hidden: true },
    summary: { type: 'string', computed: true }
  },
  sortableFields: ['title'],
  defaultSort: ['title'],
  storage: { naming: 'exact' }
})

const result = await books.post({ data: { title: 'Dune', pages: 412, state: 'draft', secret: 'private' } })
const title: string | undefined = result.title
const pages: number | null | undefined = result.pages
const summary: string | undefined = result.summary
const id: string = result.id
await books.patch({ id, data: { pages: null } })
await books.post({ data: {} }) // A hook/default can supply a required persisted value.
await books.post({ document: { data: { type: 'books', attributes: { title: 'Dune' } } } })
const wire: JsonApiDocument<JsonApiResource<{ title: string }, 'books'>> = await books.get({ id, format: 'jsonapi' })
const minimal: ResourceIdentifier<'books'> = await books.patch({ id, data: { title: 'Updated' }, returning: 'minimal' })
const none: void = await books.post({ data: { title: 'Silent' }, returning: 'none' })

// @ts-expect-error Literal schema value types reach the returned resource.
await books.patch({ id, data: { pages: 'long' } })
// @ts-expect-error Unknown writable fields are rejected.
await books.patch({ id, data: { titel: 'Typo' } })
// @ts-expect-error Declared enum values remain literal.
await books.patch({ id, data: { state: 'deleted' } })
// @ts-expect-error Computed attributes are not writable inputs.
await books.patch({ id, data: { summary: 'Forged' } })
// @ts-expect-error Hidden fields are not promised in returned records.
result.secret
// @ts-expect-error Fields can be omitted by projection or permissions.
const requiredTitle: string = result.title
// @ts-expect-error The registered resource name selects document type.
await books.post({ document: { data: { type: 'authors', attributes: { title: 'Dune' } } } })
// @ts-expect-error Resource option spelling is checked.
await api.addResource('invalidOptions', { schema: {}, sortableField: ['title'] })
// @ts-expect-error Invalid schema type names fail both registration overloads.
await api.addResource('invalidSchema', { schema: { title: { type: 'strnig' } } })
// @ts-expect-error Misspelled optional field settings must not silently enter inferred schemas.
await api.addResource('invalidFieldOption', { schema: { title: { type: 'string', requird: true } } })

const configured = await api.addResource('configured', {
  schema: { title: { type: 'string' } },
  format: 'jsonapi', returning: 'minimal'
})
const configuredWrite: JsonApiDocument<ResourceIdentifier<'configured'>> = await configured.post({ data: { title: 'New' } })
const configuredRead: JsonApiDocument<JsonApiResource<{ title: string | null }, 'configured'>> = await configured.get({ id })
const plainOverride = await configured.get({ id, format: 'plain' })
const overrideTitle: string | null | undefined = plainOverride.title
// @ts-expect-error An optional stored column without NOT NULL may contain SQL null.
const nonNullOptionalTitle: string | undefined = plainOverride.title

const customId = await api.addResource('customId', {
  idProperty: 'bookId',
  schema: { bookId: { type: 'id' }, title: { type: 'string' } }
})
await customId.post({ data: { id: 12, title: 'Logical ID' } })
const customIdResult = await customId.get({ id: 12 })
const publicId: string = customIdResult.id
// @ts-expect-error Physical ID backing fields are not writable application attributes.
await customId.post({ data: { bookId: 12 } })
// @ts-expect-error Public output has id rather than the physical ID column.
customIdResult.bookId

declare const dynamicIdProperty: string
const dynamicIdResource = await api.addResource('dynamicId', { idProperty: dynamicIdProperty, schema: { title: { type: 'string' } } })
// @ts-expect-error Unknown physical ID names need an explicit model, not an empty inferred write type.
await dynamicIdResource.post({ data: { unexpected: true } })

const schema = { title: { type: 'string' }, pages: { type: 'number' } } as const satisfies ResourceSchema
type BookInput = InferInput<typeof schema>
type BookOutput = InferOutput<typeof schema>
const reusable: BookInput = { title: 'Reusable' }
const registered = await api.addResource('reusable', { schema })
const reusableResult = await registered.post({ data: reusable })
const reusableTitle: string | null | undefined = reusableResult.title

interface AppContext { auth: { userId: string }; cache: Map<string, boolean> }
interface CustomBook extends BookOutput { display: string }
type CustomBooks = ResourceCoreMethods<CustomBook, BookInput, 'custom', 'jsonapi', 'full', AppContext>
const typed = new JsonRestApi<{ custom: CustomBooks }, AppContext>()
const custom = await typed.addResource('custom', { schema })
const customResult: JsonApiDocument<JsonApiResource<CustomBook, 'custom'>> = await custom.get({ id }, {
  auth: { userId: 'u1' }, cache: new Map()
})
const sameRegistry: CustomBooks = typed.resources.custom
// @ts-expect-error Explicit resource registries remain closed to undeclared names.
await typed.addResource('undeclared', { schema })
// @ts-expect-error Explicit custom context requirements survive registration.
await custom.get({ id }, {})

// Plugin-specific options use an explicit intersection rather than weakening all options.
const pluginOptions = { schema, myPlugin: { enabled: true } } satisfies RuntimeResourceOptions & { myPlugin: { enabled: boolean } }
await api.addResource('pluginConfigured', pluginOptions)

const customMethods = await api.addResource('customMethods', { schema, methods: { post: () => 'custom' } })
const dynamic: RuntimeResource = customMethods
// @ts-expect-error An overridden method is not falsely advertised as built-in CRUD.
await customMethods.post({ data: { title: 'New' } })

void [title, pages, summary, wire, minimal, none, requiredTitle, configuredWrite, configuredRead,
  overrideTitle, nonNullOptionalTitle, publicId, reusableTitle, customResult, sameRegistry, dynamic]
