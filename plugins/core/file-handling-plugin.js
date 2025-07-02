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

import { RestApiValidationError } from '../../lib/rest-api-errors.js';

export const FileHandlingPlugin = {
  name: 'file-handling',
  dependencies: ['rest-api'],
  
  install({ addHook, helpers, scopes, schemas, log }) {
    // Track which scopes have file fields
    const fileScopes = new Map(); // scopeName -> fileField[]
    
    // Registry of file detectors from various protocols
    const detectorRegistry = [];
    
    /**
     * Register a file detector from a protocol plugin
     * 
     * @param {Object} detector - The detector object
     * @param {string} detector.name - Name of the detector (e.g., 'http-multipart')
     * @param {Function} detector.detect - Function to check if this detector applies
     * @param {Function} detector.parse - Function to parse files from the request
     */
    helpers.registerFileDetector = (detector) => {
      if (!detector || !detector.name || !detector.detect || !detector.parse) {
        throw new Error('File detector must have name, detect(), and parse() properties');
      }
      
      detectorRegistry.push(detector);
      log.debug(`Registered file detector: ${detector.name}`);
    };
    
    /**
     * Analyze schemas to find file fields
     */
    const analyzeFileFields = () => {
      for (const [scopeName, schema] of Object.entries(schemas)) {
        if (!schema) continue;
        
        const fileFields = [];
        
        // Look for fields with type: 'file'
        for (const [fieldName, fieldConfig] of Object.entries(schema)) {
          if (fieldConfig.type === 'file') {
            fileFields.push({
              field: fieldName,
              storage: fieldConfig.storage,
              accepts: fieldConfig.accepts || ['*'],
              maxSize: fieldConfig.maxSize,
              required: fieldConfig.required || false
            });
          }
        }
        
        if (fileFields.length > 0) {
          fileScopes.set(scopeName, fileFields);
          log.info(`Scope '${scopeName}' has ${fileFields.length} file field(s): ${fileFields.map(f => f.field).join(', ')}`);
        }
      }
    };
    
    // Analyze existing schemas
    analyzeFileFields();
    
    /**
     * Process files for a scope if it has file fields
     */
    const processFiles = async (scopeName, params) => {
      const fileFields = fileScopes.get(scopeName);
      if (!fileFields || fileFields.length === 0) {
        return; // This scope doesn't have file fields
      }
      
      // Try each detector to see if we have files
      let parsed = null;
      let detectorUsed = null;
      
      for (const detector of detectorRegistry) {
        try {
          if (await detector.detect(params)) {
            log.debug(`Detector '${detector.name}' matched for scope '${scopeName}'`);
            parsed = await detector.parse(params);
            detectorUsed = detector.name;
            break;
          }
        } catch (error) {
          log.warn(`Detector '${detector.name}' failed:`, error);
        }
      }
      
      if (!parsed) {
        // No files detected - check if any were required
        for (const fieldConfig of fileFields) {
          if (fieldConfig.required && !params.inputRecord?.data?.attributes?.[fieldConfig.field]) {
            throw new RestApiValidationError(
              `Required file field '${fieldConfig.field}' is missing`,
              {
                fields: [fieldConfig.field],
                violations: [{
                  field: fieldConfig.field,
                  message: 'This field is required'
                }]
              }
            );
          }
        }
        return;
      }
      
      log.debug(`Processing files with detector '${detectorUsed}'`);
      const { fields, files } = parsed;
      
      // Process each file field defined in schema
      for (const fieldConfig of fileFields) {
        const file = files[fieldConfig.field];
        
        if (!file) {
          if (fieldConfig.required) {
            throw new RestApiValidationError(
              `Required file field '${fieldConfig.field}' is missing`,
              {
                fields: [fieldConfig.field],
                violations: [{
                  field: fieldConfig.field,
                  message: 'This field is required'
                }]
              }
            );
          }
          continue;
        }
        
        // Validate mime type
        if (fieldConfig.accepts[0] !== '*') {
          const acceptable = fieldConfig.accepts.some(pattern => {
            if (pattern.endsWith('/*')) {
              // e.g., 'image/*'
              const prefix = pattern.slice(0, -2);
              return file.mimetype.startsWith(prefix + '/');
            }
            return file.mimetype === pattern;
          });
          
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
            );
          }
        }
        
        // Validate file size
        if (fieldConfig.maxSize) {
          const maxBytes = parseSize(fieldConfig.maxSize);
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
            );
          }
        }
        
        // Upload to storage
        if (!fieldConfig.storage) {
          throw new Error(`No storage configured for file field '${fieldConfig.field}'`);
        }
        
        try {
          const storedUrl = await fieldConfig.storage.upload(file);
          fields[fieldConfig.field] = storedUrl;
          log.debug(`Uploaded file for field '${fieldConfig.field}' to: ${storedUrl}`);
        } catch (error) {
          // Cleanup if file has cleanup function
          if (file.cleanup) {
            try {
              await file.cleanup();
            } catch (cleanupError) {
              log.warn(`Failed to cleanup file after upload error:`, cleanupError);
            }
          }
          
          throw new RestApiValidationError(
            `Failed to upload file for field '${fieldConfig.field}': ${error.message}`,
            {
              fields: [fieldConfig.field],
              violations: [{
                field: fieldConfig.field,
                message: error.message
              }]
            }
          );
        }
      }
      
      // Replace inputRecord with processed data
      if (!params.inputRecord) {
        params.inputRecord = { data: { attributes: {} } };
      }
      if (!params.inputRecord.data) {
        params.inputRecord.data = { attributes: {} };
      }
      if (!params.inputRecord.data.attributes) {
        params.inputRecord.data.attributes = {};
      }
      
      // Merge fields into attributes
      Object.assign(params.inputRecord.data.attributes, fields);
      
      // Cleanup any remaining temp files
      for (const file of Object.values(files)) {
        if (file.cleanup) {
          try {
            await file.cleanup();
          } catch (error) {
            log.warn(`Failed to cleanup temp file:`, error);
          }
        }
      }
    };
    
    /**
     * Hook into REST API methods to process files
     */
    addHook('beforeProcessing', 'fileHandling', 'processFiles', {}, async (context) => {
      // Only process for mutation methods
      if (!['post', 'put', 'patch'].includes(context.method)) {
        return;
      }
      
      // Process files if this scope has file fields
      await processFiles(context.scopeName, context.params);
    });
    
    log.info('File handling plugin initialized successfully');
  }
};

/**
 * Parse size string to bytes
 * @param {string} size - Size string like '10mb', '1.5GB'
 * @returns {number} Size in bytes
 */
function parseSize(size) {
  const units = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  };
  
  const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!match) {
    throw new Error(`Invalid size format: ${size}`);
  }
  
  const [, num, unit] = match;
  const multiplier = units[unit];
  
  if (!multiplier) {
    throw new Error(`Unknown size unit: ${unit}`);
  }
  
  return parseFloat(num) * multiplier;
}

/**
 * Format bytes to human readable size
 * @param {number} bytes - Size in bytes
 * @returns {string} Human readable size
 */
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)}${units[unitIndex]}`;
}