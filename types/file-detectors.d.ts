import type { IncomingMessage, ServerResponse } from 'node:http'
import type { StorageFile } from './file-storage.js'

export interface DetectedFile extends StorageFile {
  mimetype: string
  size: number
}
export interface ParsedFiles {
  fields?: Record<string, unknown>
  files?: Record<string, DetectedFile>
}
export interface FileDetector<Params extends object = Record<string, unknown>, Context extends object = object> {
  name: string
  detect(params: Params, context?: Context): boolean | PromiseLike<boolean>
  parse(params: Params, context?: Context): ParsedFiles | null | undefined | PromiseLike<ParsedFiles | null | undefined>
}
export interface ExpressFileParserParams extends Record<string, unknown> {
  _expressReq: IncomingMessage
  _expressRes?: ServerResponse
}
export type ExpressFileParserFactory = (
  options: Record<string, unknown>
) => FileDetector<ExpressFileParserParams> | PromiseLike<FileDetector<ExpressFileParserParams>>
export interface ExpressFileOptions {
  enableFileUploads?: boolean
  fileParser?: 'busboy' | 'formidable' | ExpressFileParserFactory
  // Parser-specific peer options are passed through by the connector.
  fileParserOptions?: Record<string, unknown>
}
export interface FileDetectorRegistry {
  registerFileDetector(detector: FileDetector): void
  fileDetectors: FileDetector[]
}
