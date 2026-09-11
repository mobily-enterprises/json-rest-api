import type { StorageFieldDefinition } from '../plugins/core/lib/storage/storage-types.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'trace' | 'fatal' | 'log'
export type DiagnosticWriter = (...args: unknown[]) => unknown
export type DiagnosticPrimitive = string | number | boolean | null | undefined
export type DiagnosticValue = DiagnosticPrimitive | DiagnosticValue[] | DiagnosticObject
export interface DiagnosticObject { [property: string]: DiagnosticValue }
export type DiagnosticLogger = Partial<Record<LogLevel, DiagnosticWriter>>
export interface DiagnosticFormattingOptions {
  includeStack?: boolean
  maxDepth?: number
  redactFields?: readonly string[]
}
export interface DiagnosticOptions extends Omit<DiagnosticFormattingOptions, 'maxDepth'> {
  logFullErrors?: boolean
  schemaInfo?: { outputFields?: Record<string, StorageFieldDefinition> }
}
export interface EnhancedDiagnosticLogger extends DiagnosticLogger {
  [property: string]: unknown
  logError: (this: EnhancedDiagnosticLogger & { error: DiagnosticWriter }, message: string, error: unknown, additionalData?: Record<string, unknown>) => unknown
  logValidationError: (this: EnhancedDiagnosticLogger & { error: DiagnosticWriter }, message: string, error: unknown, additionalData?: Record<string, unknown>) => unknown
}
