export type SchemaType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 
                        'date' | 'timestamp' | 'id' | 'blob' | 'serialize';

export interface SchemaFieldPermissions {
  read?: boolean | string | string[];
  write?: boolean | string | string[];
  include?: boolean | string | string[];
}

export interface SchemaFieldRef {
  resource: string;
  field?: string;
  join?: {
    eager?: boolean;
    fields?: string[];
    preserveId?: boolean;
  };
}

export interface SchemaFieldDefinition {
  type: SchemaType;
  required?: boolean;
  silent?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  defaultValue?: any;
  
  // Validation
  min?: number;
  max?: number;
  enum?: any[];
  format?: string | RegExp;
  validators?: Array<(value: any, context: ValidationContext) => void>;
  
  // Arrays/Objects
  items?: SchemaFieldDefinition;
  maxItems?: number;
  maxKeys?: number;
  maxDepth?: number;
  
  // Relations
  refs?: SchemaFieldRef;
  
  // Permissions
  permissions?: SchemaFieldPermissions;
  
  // Transformations
  transform?: (value: any, context: TransformContext) => any;
  serialize?: (value: any, context: SerializeContext) => any;
}

export interface SchemaDefinition {
  [fieldName: string]: SchemaFieldDefinition;
}

export interface ValidationContext {
  field: string;
  schema: any; // Will be Schema type once converted
  data: Record<string, any>;
  operation: 'insert' | 'update';
  user?: any;
  depth?: number;
  path?: string;
}

export interface TransformContext extends ValidationContext {
  phase: 'input' | 'output';
}

export interface SerializeContext extends ValidationContext {
  include?: string[];
  fields?: string[];
  visitedObjects?: WeakSet<object>;
}