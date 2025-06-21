import { SchemaFieldDefinition, SchemaDefinition } from './schema.types.js';

// Infer the TypeScript type from a schema field definition
type InferSchemaType<T extends SchemaFieldDefinition> = 
  T['type'] extends 'string' ? string :
  T['type'] extends 'number' ? number :
  T['type'] extends 'boolean' ? boolean :
  T['type'] extends 'date' ? Date :
  T['type'] extends 'timestamp' ? Date :
  T['type'] extends 'id' ? string | number :
  T['type'] extends 'array' ? T['items'] extends SchemaFieldDefinition ? InferSchemaType<T['items']>[] : any[] :
  T['type'] extends 'object' ? Record<string, any> :
  T['type'] extends 'blob' ? Buffer | string :
  T['type'] extends 'serialize' ? any :
  any;

// Infer the full TypeScript interface from a schema definition
export type InferSchema<T extends SchemaDefinition> = {
  [K in keyof T]: InferSchemaType<T[K]>;
};

// Extract required fields
export type RequiredFields<T extends SchemaDefinition> = {
  [K in keyof T as T[K]['required'] extends true ? K : never]: InferSchemaType<T[K]>;
};

// Extract optional fields
export type OptionalFields<T extends SchemaDefinition> = {
  [K in keyof T as T[K]['required'] extends true ? never : K]?: InferSchemaType<T[K]>;
};

// Type for insert operations (required fields mandatory, optional fields optional)
export type InferInsert<T extends SchemaDefinition> = RequiredFields<T> & OptionalFields<T>;

// Type for update operations (all fields optional)
export type InferUpdate<T extends SchemaDefinition> = Partial<InferSchema<T>>;

// Type for output (excludes silent fields)
export type InferOutput<T extends SchemaDefinition> = {
  [K in keyof T as T[K]['silent'] extends true ? never : K]: InferSchemaType<T[K]>;
};

// Type for query filters
export type InferFilter<T extends SchemaDefinition> = {
  [K in keyof T as T[K]['searchable'] extends true ? K : never]?: 
    | InferSchemaType<T[K]> 
    | { 
        eq?: InferSchemaType<T[K]>;
        ne?: InferSchemaType<T[K]>;
        gt?: InferSchemaType<T[K]>;
        gte?: InferSchemaType<T[K]>;
        lt?: InferSchemaType<T[K]>;
        lte?: InferSchemaType<T[K]>;
        in?: InferSchemaType<T[K]>[];
        nin?: InferSchemaType<T[K]>[];
        like?: string;
        ilike?: string;
      };
};

// Helper type to extract ref types
export type ExtractRefs<T extends SchemaDefinition> = {
  [K in keyof T as T[K]['refs'] extends object ? K : never]: T[K]['refs'];
};

// Type guards
export function isSchemaFieldDefinition(value: any): value is SchemaFieldDefinition {
  return value && typeof value === 'object' && typeof value.type === 'string';
}

export function hasPermissions(field: SchemaFieldDefinition): field is SchemaFieldDefinition & { permissions: NonNullable<SchemaFieldDefinition['permissions']> } {
  return 'permissions' in field && field.permissions !== undefined;
}

export function hasRef(field: SchemaFieldDefinition): field is SchemaFieldDefinition & { refs: NonNullable<SchemaFieldDefinition['refs']> } {
  return 'refs' in field && field.refs !== undefined;
}

export function isRequired(field: SchemaFieldDefinition): field is SchemaFieldDefinition & { required: true } {
  return field.required === true;
}

export function isSearchable(field: SchemaFieldDefinition): field is SchemaFieldDefinition & { searchable: true } {
  return field.searchable === true;
}

export function isSilent(field: SchemaFieldDefinition): field is SchemaFieldDefinition & { silent: true } {
  return field.silent === true;
}