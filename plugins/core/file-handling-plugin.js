/**
 * File Handling Plugin for JSON REST API
 *
 * This plugin provides automatic file upload handling based on schema definitions.
 * It works with any protocol connector (HTTP, Express, WebSocket, etc.) by using
 * a detector registry pattern.
 *
 * Features:
 * - Schema-driven: Detects file fields from type: 'file' in schemas
 * - Protocol-agnostic: Works with any connector that registers a detector
 * - Storage pluggable: Different fields can use different storage backends
 * - Zero configuration: Just define file fields in your schema
 *
 * Usage:
 * ```javascript
 * // 1. Define schema with file fields
 * const imageSchema = {
 *   title: { type: 'string' },
 *   uploadedImage: {
 *     type: 'file',
 *     storage: S3Storage,
 *     accepts: ['image/jpeg', 'image/png']
 *   }
 * };
 *
 * // 2. Use plugins (order matters - file-handling depends on rest-api)
 * api.use(RestApiPlugin);
 * api.use(FileHandlingPlugin);
 * api.use(ExpressPlugin); // Or any other connector
 *
 * // 3. Files are automatically handled!
 * ```
 */

import { RestApiValidationError } from '../../lib/rest-api-errors.js'
import { getOperationDiagnosticContext, wrapUnexpectedError } from '../../lib/error-context.js'
import { createEnhancedLogger } from '../../lib/enhanced-logger.js'

export const FileHandlingPlugin = {
  name: 'file-handling',
  dependencies: ['rest-api'],

  install ({ addHook, scopes, log, api }) {
    // Track which scopes have file fields
    const fileScopes = new WeakMap() // compiled schema -> fileField[]

    // Registry of file detectors from various protocols
    const detectorRegistry = []

    /**
     * Register a file detector from a protocol plugin
     *
     * @param {Object} detector - The detector object
     * @param {string} detector.name - Name of the detector (e.g., 'http-multipart')
     * @param {Function} detector.detect - Function to check if this detector applies
     * @param {Function} detector.parse - Function to parse files from the request
     */
    api.rest.registerFileDetector = (detector) => {
      if (!detector || !detector.name || !detector.detect || !detector.parse) {
        throw new Error('File detector must have name, detect(), and parse() properties')
      }

      detectorRegistry.push(detector)
      log.debug(`Registered file detector: ${detector.name}`)
    }

    // Store detectors array for inspection
    api.rest.fileDetectors = detectorRegistry

    const trackUploadedFile = (context, upload) => {
      if (!context.fileHandlingUploads) {
        context.fileHandlingUploads = []
      }
      context.fileHandlingUploads.push({ ...upload, transaction: context.transaction })
    }

    const recordCleanupFailure = async (context, phase, field, error) => {
      const errors = context.cleanupErrors ||= []
      errors.push({ phase, field, error })
      try {
        await createEnhancedLogger(log, { schemaInfo: context.schemaInfo }).warn('File cleanup failed', {
          ...getOperationDiagnosticContext(context, { phase }), field, error
        })
      } catch (error) {
        errors.push({ phase: 'logging', during: phase, field, error })
      }
    }

    const cleanupParsedFiles = async (files = {}, context) => {
      for (const [field, file] of Object.entries(files)) {
        if (!file?.cleanup) continue

        try {
          await file.cleanup()
        } catch (error) {
          await recordCleanupFailure(context, 'temporaryFileCleanup', field, error)
        }
      }
    }

    const cleanupUploadedFiles = async (context) => {
      const uploads = context.fileHandlingUploads
      if (!uploads || uploads.length === 0) return

      const remaining = []
      for (const upload of uploads) {
        if (upload.transaction !== context.transaction || !upload.url || typeof upload.storage?.delete !== 'function') {
          remaining.push(upload)
          continue
        }

        try {
          await upload.storage.delete(upload.url)
        } catch (error) {
          remaining.push(upload)
          await recordCleanupFailure(context, 'uploadedFileCleanup', upload.field, error)
        }
      }
      context.fileHandlingUploads = remaining
    }

    const getFileFields = scopeName => {
      const schemaInfo = scopes[scopeName]?.vars?.schemaInfo
      if (!schemaInfo) return []
      const cached = fileScopes.get(schemaInfo)
      if (cached) return cached

      const fileFields = []
      for (const [fieldName, fieldConfig] of Object.entries(schemaInfo.schemaStructure)) {
        if (fieldConfig?.type === 'file') {
          fileFields.push({
            field: fieldName,
            storage: fieldConfig.storage,
            accepts: fieldConfig.accepts || ['*'],
            maxSize: fieldConfig.maxSize
          })
        }
      }
      fileScopes.set(schemaInfo, fileFields)
      return fileFields
    }

    /**
     * Process files for a scope if it has file fields
     */
    const processFiles = async (scopeName, params, context) => {
      const fileFields = getFileFields(scopeName)
      if (!fileFields || fileFields.length === 0) {
        return // This scope doesn't have file fields
      }

      // Try each detector to see if we have files
      let parsed = null
      let detectorUsed = null

      for (const detector of detectorRegistry) {
        let matched
        try {
          matched = await detector.detect(params, context)
        } catch (error) {
          throw wrapUnexpectedError(error, {
            message: `File detector '${detector.name}' failed`,
            context: { scopeName, detector: detector.name, phase: 'fileDetection' }
          })
        }
        if (matched) {
          log.debug(`Detector '${detector.name}' matched for scope '${scopeName}'`)
          try {
            parsed = await detector.parse(params, context)
          } catch (error) {
            throw wrapUnexpectedError(error, {
              message: `File parser '${detector.name}' failed`,
              context: { scopeName, detector: detector.name, phase: 'fileParsing' }
            })
          }
          detectorUsed = detector.name
          break
        }
      }

      if (!parsed) return

      const { fields = {}, files = {} } = parsed

      try {
        log.debug(`Processing files with detector '${detectorUsed}'`)
        const fileNames = new Set(fileFields.map(config => config.field))
        for (const name of Object.keys(files)) {
          if (!fileNames.has(name)) throw new RestApiValidationError(`Unknown file field '${name}'`, { fields: [name] })
        }
        // Process each file field defined in schema
        for (const fieldConfig of fileFields) {
          const file = files[fieldConfig.field]

          if (!file) continue

          // Validate mime type
          if (fieldConfig.accepts[0] !== '*') {
            const acceptable = fieldConfig.accepts.some(pattern => {
              if (pattern.endsWith('/*')) {
                // e.g., 'image/*'
                const prefix = pattern.slice(0, -2)
                return file.mimetype.startsWith(prefix + '/')
              }
              return file.mimetype === pattern
            })

            if (!acceptable) {
              throw new RestApiValidationError(
                `Invalid file type for field '${fieldConfig.field}'`,
                {
                  fields: [fieldConfig.field],
                  violations: [{
                    field: fieldConfig.field,
                    message: `Expected ${fieldConfig.accepts.join(' or ')}, got ${file.mimetype}`
                  }]
                }
              )
            }
          }

          // Validate file size
          if (fieldConfig.maxSize !== undefined) {
            const maxBytes = parseSize(fieldConfig.maxSize)
            if (file.size > maxBytes) {
              throw new RestApiValidationError(
                `File too large for field '${fieldConfig.field}'`,
                {
                  fields: [fieldConfig.field],
                  violations: [{
                    field: fieldConfig.field,
                    message: `Maximum size is ${fieldConfig.maxSize}, got ${formatSize(file.size)}`
                  }]
                }
              )
            }
          }

          // Upload to storage
          if (!fieldConfig.storage) {
            throw new Error(`No storage configured for file field '${fieldConfig.field}'`)
          }

          try {
            const storedUrl = await fieldConfig.storage.upload(file)
            Object.defineProperty(fields, fieldConfig.field, { value: storedUrl, enumerable: true, writable: true, configurable: true })
            trackUploadedFile(context, {
              field: fieldConfig.field,
              storage: fieldConfig.storage,
              url: storedUrl
            })
            log.debug(`Uploaded file for field '${fieldConfig.field}'`)
          } catch (error) {
            throw wrapUnexpectedError(error, {
              message: `Failed to upload file for field '${fieldConfig.field}'`,
              context: { scopeName, field: fieldConfig.field, phase: 'fileUpload' }
            })
          }
        }

        // Work on the canonical document, including calls using the plain format.
        context.inputRecord.data ||= { attributes: {} }
        context.inputRecord.data.attributes = { ...context.inputRecord.data.attributes, ...fields }
      } finally {
        await cleanupParsedFiles(files, context)
      }
    }

    /**
     * Hook into REST API methods to process files
     */
    addHook('beforeProcessing', 'processFiles', {}, async ({ context }) => {
      const method = context.method
      const scopeName = context.scopeName
      const params = context.params

      // Only process for mutation methods
      if (!['post', 'put', 'patch'].includes(method)) {
        return
      }

      // Process files if this scope has file fields
      await processFiles(scopeName, params, context)
    })

    addHook('afterRollback', 'cleanupUploadedFiles', {}, async ({ context }) => {
      await cleanupUploadedFiles(context)
    })

    addHook('afterCommit', 'releaseUploadedFiles', {}, ({ context }) => {
      if (context.fileHandlingUploads) {
        context.fileHandlingUploads = context.fileHandlingUploads.filter(upload => upload.transaction !== context.transaction)
      }
    })

    log.info('File handling plugin initialized successfully')
  }
}

/**
 * Parse size string to bytes
 * @param {string} size - Size string like '10mb', '1.5GB'
 * @returns {number} Size in bytes
 */
function parseSize (size) {
  if (typeof size === 'number' && Number.isFinite(size) && size >= 0) return size
  const units = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  }

  const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/)
  if (!match) {
    throw new Error(`Invalid size format: ${size}`)
  }

  const [, num, unit] = match
  const multiplier = units[unit]

  if (!multiplier) {
    throw new Error(`Unknown size unit: ${unit}`)
  }

  return parseFloat(num) * multiplier
}

/**
 * Format bytes to human readable size
 * @param {number} bytes - Size in bytes
 * @returns {string} Human readable size
 */
function formatSize (bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)}${units[unitIndex]}`
}
