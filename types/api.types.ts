import { SchemaDefinition } from './schema.types.js';

export interface ApiOptions {
  debug?: boolean;
  strict?: boolean;
  pageSize?: number;
  maxPageSize?: number;
  idGenerator?: () => string | number;
}

export interface HookContext<T = any> {
  resource: string;
  operation: 'insert' | 'update' | 'delete' | 'get' | 'query';
  data?: T;
  id?: string | number;
  query?: QueryOptions;
  result?: any;
  user?: any;
  meta?: Record<string, any>;
  api?: any; // Will be Api type once converted
  transaction?: any;
  error?: Error;
}

export type HookFunction<T = any> = (context: HookContext<T>) => Promise<void> | void;

export interface Hook {
  name: string;
  handler: HookFunction;
  priority?: number;
}

export interface ResourceOptions {
  schema: any; // Will be Schema type once converted
  searchableFields?: string[] | Record<string, string>;
  hooks?: {
    beforeInsert?: HookFunction[];
    afterInsert?: HookFunction[];
    beforeUpdate?: HookFunction[];
    afterUpdate?: HookFunction[];
    beforeDelete?: HookFunction[];
    afterDelete?: HookFunction[];
    beforeGet?: HookFunction[];
    afterGet?: HookFunction[];
    beforeQuery?: HookFunction[];
    afterQuery?: HookFunction[];
  };
}

export interface QueryOptions {
  filter?: Record<string, any>;
  sort?: string | string[];
  page?: {
    size?: number;
    number?: number;
  };
  include?: string | string[];
  fields?: Record<string, string | string[]>;
}

export interface QueryResult<T = any> {
  data: T[];
  meta: {
    total: number;
    page: {
      size: number;
      number: number;
      total: number;
    };
  };
  included?: any[];
  links?: {
    self?: string;
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
}

export interface ResourceProxy<T = any> {
  get(id: string | number, options?: { include?: string | string[]; fields?: string | string[] }): Promise<T>;
  query(options?: QueryOptions): Promise<QueryResult<T>>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T>;
  delete(id: string | number): Promise<void>;
  count(filter?: Record<string, any>): Promise<number>;
}