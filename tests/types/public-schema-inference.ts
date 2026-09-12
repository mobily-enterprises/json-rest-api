import type {
  InferInput, InferOutput, ResourceField, ResourceNestedSchema, ResourceRelationship, ResourceSchema, ResourceSearchSchema
} from '../../types/resource-schema.js'
import type { ResourceCoreMethods } from '../../types/resource-methods.js'
import type { FileStorage } from '../../types/file-storage.js'

type Equal<Left, Right> = (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2) ? true : false
type Assert<Condition extends true> = Condition

declare const preferences: ResourceNestedSchema<{
  emailAlerts: { type: 'boolean'; required: true }
  theme: { type: 'string'; enum: readonly ['dark', 'light'] }
}>

const schema = {
  id: { type: 'id' },
  title: { type: 'string', required: true, minLength: 1, search: true },
  pages: { type: 'integer', nullable: true },
  status: { type: 'string', required: true, enum: ['draft', 'published'] },
  rating: { type: 'number', enum: [1, 2, 3] },
  price: { type: 'number', precision: 12, scale: 2 },
  visible: { type: 'boolean', defaultTo: true },
  releasedOn: { type: 'date' },
  releasedAt: { type: 'dateTime', temporalPrecision: 3 },
  elapsed: { type: 'epochMilliseconds' },
  reference: { type: 'id' },
  authorId: { belongsTo: 'authors', as: 'author', nullable: true },
  tags: { type: 'array', items: { type: 'string', nullable: true } },
  matrix: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
  counts: { type: 'object', values: { type: 'integer' } },
  preferences: { type: 'object', schema: preferences },
  preferencesByName: { type: 'object', values: preferences },
  preferenceList: { type: 'array', items: preferences },
  metadata: { type: 'object', additionalProperties: true },
  uploadToken: { type: 'file', virtual: true },
  secret: { type: 'string', hidden: true },
  internal: { type: 'string', normallyHidden: true },
  emptyAsNull: { type: 'string', nullOnEmpty: true },
  normalized: { type: 'string', nullable: false, enum: ['one'], uppercase: true },
  titleLength: { type: 'string', getter: (value: string) => value.length },
  transformed: { type: 'string', setter: (value: string) => value.length },
  stored: { type: 'string', storage: { serialize: () => 1 } },
  score: { type: 'number', computed: true, compute: () => 100 }
} as const satisfies ResourceSchema

type Input = InferInput<typeof schema>
type Output = InferOutput<typeof schema>
declare const books: ResourceCoreMethods<Output, Input, 'books'>

await books.post({ data: {} }) // Hooks/defaults can supply required attributes.
await books.patch({ id: '1', data: { title: 'Dune', pages: null, status: 'published', rating: 3 } })
await books.patch({ id: '1', data: { secret: 'accepted input', uploadToken: 'temporary-file' } })
await books.post({ data: {
  id: '2', releasedOn: '2026-09-12', releasedAt: '2026-09-12T12:00:00.000Z', elapsed: 50,
  tags: ['fiction', null], matrix: [[1, 2]], counts: { books: 4 },
  preferences: { emailAlerts: false, theme: 'dark' },
  preferencesByName: { reader: { theme: 'light' } }, preferenceList: [{ emailAlerts: true }]
} })
await books.patch({ id: '1', document: {
  data: { type: 'books', attributes: { title: 'Dune' }, relationships: { author: { data: { type: 'authors', id: '2' } } } }
} })

const book = await books.get({ id: '1' })
const title: string | undefined = book.title
const pages: number | null | undefined = book.pages
const status: 'draft' | 'published' | undefined = book.status
const id: string = book.id
const tags: (string | null)[] | null | undefined = book.tags
const preference: 'light' | 'dark' | undefined = book.preferences?.theme

type RequiredInputsStayOptional = Assert<Equal<Input['title'], string | undefined>>
type EnumNumbers = Assert<Equal<Input['rating'], 1 | 2 | 3 | undefined>>
type PublicIdInput = Assert<Equal<Input['reference'], string | number | undefined>>
type IdAttributeOutput = Assert<Equal<Output['reference'], string | number | null>>
type DecimalOutput = Assert<Equal<Output['price'], string | number | null>>
type NullOnEmptyInput = Assert<Equal<Input['emptyAsNull'], string | undefined>>
type NullOnEmptyOutput = Assert<Equal<Output['emptyAsNull'], string | null>>
type TransformedEnumWidens = Assert<Equal<Output['normalized'], string>>
type GetterOutputNeedsOverride = Assert<Equal<Output['titleLength'], unknown>>
type SetterOutputNeedsOverride = Assert<Equal<Output['transformed'], unknown>>
type SerializerOutputNeedsOverride = Assert<Equal<Output['stored'], unknown>>
type ComputeOutputNeedsOverride = Assert<Equal<Output['score'], unknown>>
type NoBackingField = Assert<Equal<'authorId' extends keyof Output ? true : false, false>>
type NoIdAttribute = Assert<Equal<'id' extends keyof Output ? true : false, false>>
type HiddenOutputRemoved = Assert<Equal<'secret' extends keyof Output ? true : false, false>>
type NormallyHiddenRemainsSelectable = Assert<Equal<Output['internal'], string | null>>
type OptionalStorageCanBeNull = Assert<Equal<Output['visible'], boolean | null>>

const editableInput: Input = { title: 'Before' }
editableInput.title = 'After' // Literal declarations do not make records readonly.
type ExplicitOutput = Omit<Output, 'titleLength' | 'score'> & { titleLength: number; score: number; author: { id: string; name?: string } }
type ExplicitInput = Input & { author: string | number | null }
declare const customBooks: ResourceCoreMethods<ExplicitOutput, ExplicitInput, 'books'>
await customBooks.patch({ id: '1', data: { author: '2' } })
const explicit = await customBooks.get({ id: '1' })
const computed: number | undefined = explicit.score
const authorName: string | undefined = explicit.author?.name

const relationships = {
  chapters: { type: 'hasMany', target: 'chapters', foreignKey: 'bookId', include: { strategy: 'window', limit: 3, orderBy: ['title'] } },
  notes: { type: 'hasMany', target: 'notes', via: 'subject', include: { limit: false } },
  cover: { type: 'hasOne', target: 'covers', foreignKey: 'bookId' },
  tags: { type: 'manyToMany', target: 'tags', through: 'bookTags', foreignKey: 'bookId', otherKey: 'tagId' },
  subject: { belongsToPolymorphic: { types: ['books', 'authors'], typeField: 'subjectType', idField: 'subjectId' } }
} as const satisfies Record<string, ResourceRelationship>

const searchSchema = {
  title: { type: 'string', actualField: 'title', filterOperator: 'contains' },
  words: { type: 'string', oneOf: ['title', 'author.name'], splitBy: ' ', matchAll: true, globalSearch: true },
  prices: { type: 'array', actualField: 'price', filterOperator: 'between', items: { type: 'number' } },
  subject: { type: 'string', polymorphicField: 'subject', targetFields: { books: 'title', authors: 'name' } },
  minimum: { type: 'number', applyFilter: (query, input, { column, value }) => query.where(column('price'), '>=', Number(value('price', input))) }
} as const satisfies ResourceSearchSchema
const inlineSearch = {
  title: { type: 'string', search: { filterOperator: 'contains', minLength: 1, nullable: true } },
  price: { type: 'number', search: { minimum: { filterOperator: '>=' }, maximum: { filterOperator: '<=' } } }
} as const satisfies ResourceSchema

declare const fileStorage: FileStorage
const fileSchema = { cover: { type: 'file', storage: fileStorage } } satisfies ResourceSchema

// @ts-expect-error Misspelled attribute names are rejected.
await books.patch({ id: '1', data: { titel: 'Dune' } })
// @ts-expect-error Canonical application input uses numbers for number fields.
await books.patch({ id: '1', data: { pages: 'many' } })
// @ts-expect-error Only declared enum members are accepted.
await books.patch({ id: '1', data: { status: 'pending' } })
// @ts-expect-error Non-nullable string fields do not accept null.
await books.patch({ id: '1', data: { title: null } })
// @ts-expect-error Temporal public values are strings, not Date instances.
await books.patch({ id: '1', data: { releasedAt: new Date() } })
// @ts-expect-error Computed fields are not writable attributes.
await books.patch({ id: '1', data: { score: 100 } })
// @ts-expect-error Relationship backing fields are not public attributes.
await books.patch({ id: '1', data: { authorId: '1' } })
// @ts-expect-error Nested arrays retain item types.
await books.patch({ id: '1', data: { matrix: [['bad']] } })
// @ts-expect-error Object map values retain their declared type.
await books.patch({ id: '1', data: { counts: { books: 'many' } } })
// @ts-expect-error Nested Schema instances retain their declared fields.
await books.patch({ id: '1', data: { preferences: { theme: 'blue' } } })
// @ts-expect-error Hidden attributes are absent from the inferred output model.
book.secret
// @ts-expect-error Callback results need an explicit model or runtime narrowing.
const unsafeScore: number = book.score
// @ts-expect-error Built-in scalar type names are checked.
const typoType = { type: 'strng' } satisfies ResourceField
// @ts-expect-error Built-in field option names are checked.
const typoOption = { type: 'string', requird: true } satisfies ResourceField
// @ts-expect-error There is no generic readOnly schema option in the runtime.
const inventedReadOnly = { type: 'string', readOnly: true } satisfies ResourceField
// @ts-expect-error belongsTo declarations require their public alias.
const missingAlias = { belongsTo: 'authors' } satisfies ResourceField
// @ts-expect-error Nested object schemas must be actual Schema instances.
const rawNestedSchema = { type: 'object', schema: { name: { type: 'string' } } } satisfies ResourceField
// @ts-expect-error To-many relationships need a foreignKey or polymorphic via.
const missingMapping = { type: 'hasMany', target: 'chapters' } satisfies ResourceRelationship
// @ts-expect-error Many-to-many relationships need both pivot keys.
const missingPivotKey = { type: 'manyToMany', target: 'tags', through: 'bookTags', foreignKey: 'bookId' } satisfies ResourceRelationship
// @ts-expect-error Filter declaration keys are checked too.
const typoSearch = { title: { type: 'string', actualFiled: 'title' } } satisfies ResourceSearchSchema
// @ts-expect-error File adapters belong to file fields, not ordinary scalar storage mappings.
const invalidStorage = { title: { type: 'string', storage: fileStorage } } satisfies ResourceSchema

void [title, pages, status, id, tags, preference, editableInput, computed, authorName, relationships, searchSchema, inlineSearch, fileSchema,
  unsafeScore, typoType, typoOption, inventedReadOnly, missingAlias, rawNestedSchema, missingMapping, missingPivotKey, typoSearch, invalidStorage]
export type SchemaAssertions = [RequiredInputsStayOptional, EnumNumbers, PublicIdInput, IdAttributeOutput, DecimalOutput,
  NullOnEmptyInput, NullOnEmptyOutput, TransformedEnumWidens, GetterOutputNeedsOverride, SetterOutputNeedsOverride,
  SerializerOutputNeedsOverride, ComputeOutputNeedsOverride, NoBackingField, NoIdAttribute,
  HiddenOutputRemoved, NormallyHiddenRemainsSelectable, OptionalStorageCanBeNull]
