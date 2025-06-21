import { QueryOptions, QueryResult } from '../types/api.types';

export interface ClientOptions {
  baseURL: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface RequestConfig {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  _retry?: number;
  _isRetry?: boolean;
  _originalRequest?: () => Promise<any>;
}

export interface ResponseResult {
  response: Response;
  data: any;
}

export interface ResourceProxy<T = any> {
  get(id: string | number, options?: Pick<QueryOptions, 'include' | 'fields'>): Promise<T>;
  query(options?: QueryOptions): Promise<QueryResult<T>>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T>;
  delete(id: string | number): Promise<void>;
  count(filter?: QueryOptions['filter']): Promise<number>;
}

export interface TypedResourceMap {
  [resourceName: string]: ResourceProxy;
}

export class RestClient<TResources extends TypedResourceMap = TypedResourceMap> {
  constructor(options?: ClientOptions);
  
  baseURL: string;
  headers: Record<string, string>;
  timeout: number;
  resources: TResources;
  
  addRequestInterceptor(interceptor: (config: RequestConfig, url: URL) => Promise<RequestConfig> | RequestConfig): () => void;
  addResponseInterceptor(interceptor: (result: ResponseResult) => Promise<ResponseResult> | ResponseResult): () => void;
  addErrorInterceptor(interceptor: (error: any) => Promise<any> | any): () => void;
  
  setAuthToken(token: string): void;
  clearAuthToken(): void;
}

export function createClient<TResources extends TypedResourceMap = TypedResourceMap>(
  options?: ClientOptions
): RestClient<TResources>;

export function retryInterceptor(maxRetries?: number, retryDelay?: number): (error: any) => Promise<any>;
export function authRefreshInterceptor(refreshToken: string, refreshEndpoint: string): (error: any) => Promise<any>;
export function loggingInterceptor(logger?: Console): {
  request: (config: RequestConfig, url: URL) => Promise<RequestConfig>;
  response: (result: ResponseResult) => Promise<ResponseResult>;
  error: (error: any) => Promise<any>;
};