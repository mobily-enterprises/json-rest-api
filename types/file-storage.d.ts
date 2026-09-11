import type { writeFile } from 'node:fs/promises'

export type FileContents = Parameters<typeof writeFile>[1]
export interface StorageFile {
  filename: string
  mimetype?: string
  size?: number
  data?: FileContents
  filepath?: string
  cleanup?: () => unknown
}
export type UploadFile = StorageFile & ({ data: FileContents } | { filepath: string })
export interface FileStorage<File extends StorageFile = UploadFile> {
  upload(file: File): string | PromiseLike<string>
  delete(url: string): void | PromiseLike<void>
}
export type FileNameGenerator = (file: StorageFile) => string | Promise<string>
export type LocalStorageOptions = {
  directory?: string
  fileBaseUrl?: string
  preserveExtension?: boolean
  allowedExtensions?: string[]
  maxFilenameLength?: number
} & (
  { nameStrategy: 'custom'; nameGenerator: FileNameGenerator } |
  { nameStrategy?: 'hash' | 'timestamp' | 'original'; nameGenerator?: FileNameGenerator }
)

export class LocalStorage implements FileStorage {
  constructor(options?: LocalStorageOptions)
  directory: string
  fileBaseUrl: string
  nameStrategy: 'hash' | 'timestamp' | 'original' | 'custom'
  nameGenerator?: FileNameGenerator
  preserveExtension: boolean
  allowedExtensions?: string[]
  maxFilenameLength: number
  hasPathSegments(filename: string): boolean
  validateCustomBasename(basename: unknown): string
  resolveStoragePath(filename: string): string
  generateFilename(file: StorageFile): Promise<string>
  sanitizeFilename(filename: string): string
  ensureUnique(filename: string): Promise<string>
  fileExists(filepath: string): Promise<boolean>
  getExtensionFromMimeType(mimetype?: string): string
  upload(file: UploadFile): Promise<string>
  delete(url: string): Promise<void>
}

export interface S3StorageOptions {
  bucket: string
  region?: string
  prefix?: string
  acl?: string
  mockMode?: true
}
export class S3Storage implements FileStorage {
  constructor(options: S3StorageOptions)
  bucket: string
  region: string
  prefix: string
  acl: string
  mockMode: boolean
  upload(file: Pick<StorageFile, 'filename'>): Promise<string>
  delete(url: string): Promise<void>
}
