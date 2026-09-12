import type { StorageFieldDefinition, StorageQuery } from '../plugins/core/lib/storage/storage-types.js'
import type { FileStorage } from './file-storage.js'

export type ResourceFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'id' |
  'date' | 'time' | 'dateTime' | 'epochSeconds' | 'epochMilliseconds' |
  'array' | 'object' | 'file' | 'blob' | 'serialize' | 'none'

// The schema library accepts Schema instances here, not raw nested field maps.
export interface ResourceNestedSchema<Schema extends ResourceSchema = ResourceSchema> {
  structure: Schema
  operations: object
  validateWith(...args: never[]): unknown
  toJsonSchema(...args: never[]): unknown
  cleanup(...args: never[]): unknown
}

export interface ResourceFieldOptions {
  required?: boolean
  nullable?: boolean
  nullOnEmpty?: boolean
  defaultTo?: unknown
  enum?: readonly unknown[]
  setValues?: readonly string[]
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  length?: number
  pattern?: string | RegExp
  notEmpty?: boolean
  noTrim?: boolean
  uppercase?: boolean
  lowercase?: boolean
  strictBoolean?: boolean
  stringTrueWhen?: string
  stringFalseWhen?: string
  unsigned?: boolean
  precision?: number
  scale?: number
  temporalPrecision?: number
  indexed?: boolean
  unique?: boolean
  primary?: boolean
  comment?: string
  hidden?: boolean
  normallyHidden?: boolean
  virtual?: boolean
  computed?: boolean
  include?: ResourceRelationshipOptions['include']
  search?: boolean | ResourceSearchOptions | Record<string, ResourceSearchOptions>
  dependencies?: readonly string[]
  runGetterAfter?: readonly string[]
  runSetterAfter?: readonly string[]
  items?: ResourceField | ResourceNestedSchema
  values?: ResourceField | ResourceNestedSchema
  schema?: ResourceNestedSchema
  additionalProperties?: true
  // Custom callbacks retain their explicit annotations; inference does not run them.
  getter?(value: unknown, context: Record<string, unknown>): unknown
  setter?(value: unknown, context: Record<string, unknown>): unknown
  compute?(context: Record<string, unknown>): unknown
  validator?(value: unknown, object: Record<string, unknown>, context: unknown): string | void
}

export type ResourceField = ResourceFieldOptions & (
  { type: Exclude<ResourceFieldType, 'file'>; belongsTo?: never; as?: never; storage?: StorageFieldDefinition['storage'] } |
  { type: 'file'; belongsTo?: never; as?: never; storage?: StorageFieldDefinition['storage'] | FileStorage } |
  { type?: ResourceFieldType; belongsTo: string; as: string; storage?: StorageFieldDefinition['storage'] }
)
export type ResourceSchema = Readonly<Record<string, ResourceField>>

export interface ResourceSearchOptions extends ResourceFieldOptions {
  type?: ResourceFieldType
  actualField?: string
  filterOperator?: string
  oneOf?: readonly string[]
  splitBy?: string | RegExp
  matchAll?: boolean
  globalSearch?: boolean
  polymorphicField?: string
  targetFields?: Readonly<Record<string, string>>
  applyFilter?(query: StorageQuery, input: unknown, helpers: {
    column(field: string): string
    value(field: string, input: unknown): unknown
    context: Record<string, unknown>
    scopeName: string
  }): unknown
}
export type ResourceSearchField = ResourceField & ResourceSearchOptions
export type ResourceSearchSchema = Readonly<Record<string, ResourceSearchField>>

export interface ResourceRelationshipOptions {
  include?: { strategy?: 'window'; limit?: number | null | false; orderBy?: readonly string[] | null }
}
export type ResourceRelationship = ResourceRelationshipOptions & (
  { type: 'hasMany'; target: string } & (
    { foreignKey: string; via?: string } | { foreignKey?: string; via: string }
  ) |
  { type: 'hasOne'; target: string; foreignKey: string } |
  { type: 'manyToMany'; target: string; through: string; foreignKey: string; otherKey: string } |
  { belongsToPolymorphic: { types: readonly string[]; typeField: string; idField: string } }
)

type Direction = 'input' | 'output'
type NestedValue<Definition, Mode extends Direction> =
  Definition extends ResourceNestedSchema<infer Schema>
    ? { -readonly [Key in keyof Schema]?: FieldValue<Schema[Key], Mode> }
    : FieldValue<Definition, Mode>

type ObjectValue<Field, Mode extends Direction> =
  Field extends { schema: infer Schema }
    ? NestedValue<Schema, Mode> & (Field extends { additionalProperties: true } ? Record<string, unknown> : unknown)
    : Field extends { values: infer Values } ? Record<string, NestedValue<Values, Mode>> : Record<string, unknown>

type BaseValue<Field, Mode extends Direction> =
  Field extends { type: 'string' | 'file' | 'date' | 'time' | 'dateTime' } ? string
  : Field extends { type: 'number'; precision: number; scale: number } ? Mode extends 'output' ? string | number : number
  : Field extends { type: 'number' | 'integer' | 'epochSeconds' | 'epochMilliseconds' } ? number
  : Field extends { type: 'boolean' } ? boolean
  : Field extends { type: 'id' } ? string | number
  : Field extends { type: 'array' } ? Field extends { items: infer Items } ? NestedValue<Items, Mode>[] : unknown[]
  : Field extends { type: 'object' } ? ObjectValue<Field, Mode> : unknown

type EnumValue<Field, Value> = Field extends { enum: readonly (infer Member)[] }
  ? [Member] extends [string | number | boolean] ? Extract<Member, Value> : Value
  : Value

type NullValue<Field, Mode extends Direction> = Field extends { nullable: true } ? null
  : Mode extends 'output' ? Field extends { nullOnEmpty: true } ? null : never : never

type FieldValue<Field, Mode extends Direction> =
  Mode extends 'output'
    ? Field extends { getter: unknown } | { setter: unknown } | { compute: unknown } | { storage: { serialize: unknown } }
      ? unknown
      : Field extends { uppercase: true } | { lowercase: true } | { length: number } |
        { type: 'id' } | { type: 'number'; precision: number; scale: number }
        ? BaseValue<Field, Mode> | NullValue<Field, Mode>
        : EnumValue<Field, BaseValue<Field, Mode>> | NullValue<Field, Mode>
    : EnumValue<Field, BaseValue<Field, Mode>> | NullValue<Field, Mode>

type AttributeKey<Schema, Key extends keyof Schema> = Key extends 'id' ? never
  : Schema[Key] extends { belongsTo: string } ? never : Key

// Optional stored fields without a NOT NULL declaration can read SQL null.
type StoredNull<Field> = Field extends { required: true } | { nullable: false } | { virtual: true } | { computed: true } ? never : null

// Attribute helpers exclude the conventional ID and relationship backing fields.
// Hooks/defaults may supply required values, so caller input stays optional.
export type InferInput<Schema extends object> = {
  -readonly [Key in keyof Schema as Schema[Key] extends { computed: true } ? never : AttributeKey<Schema, Key>]?: FieldValue<Schema[Key], 'input'>
}

// Resource result types add optionality for sparse fields and permissions.
// Use explicit ResourceCoreMethods fields for callbacks, relationships and custom IDs.
export type InferOutput<Schema extends object> = {
  -readonly [Key in keyof Schema as Schema[Key] extends { hidden: true } ? never : AttributeKey<Schema, Key>]: FieldValue<Schema[Key], 'output'> | StoredNull<Schema[Key]>
}
