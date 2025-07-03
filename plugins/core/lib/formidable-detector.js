/**
 * Formidable File Detector for HTTP Multipart Uploads
 * 
 * This detector handles multipart/form-data uploads using the formidable library.
 * Unlike busboy, formidable saves files to disk temporarily, which is better
 * for large files.
 * 
 * Features:
 * - Disk-based storage (better for large files)
 * - Automatic temp file cleanup
 * - Progress tracking support
 * - Built-in file type detection
 * 
 * Usage:
 * ```javascript
 * import { createFormidableDetector } from 'jsonrestapi/plugins/core/lib/formidable-detector.js';
 * 
 * api.use(ExpressPlugin, {
 *   fileParser: 'formidable',
 *   fileParserOptions: {
 *     uploadDir: './uploads/temp',
 *     keepExtensions: true,
 *     maxFileSize: 200 * 1024 * 1024 // 200MB
 *   }
 * });
 * ```
 */

import formidable from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Creates a formidable-based file detector
 * 
 * @param {Object} options - Formidable configuration options
 * @param {string} options.uploadDir - Directory for temporary files
 * @param {boolean} options.keepExtensions - Keep file extensions
 * @param {number} options.maxFileSize - Max file size in bytes
 * @param {boolean} options.multiples - Allow multiple files per field
 * @returns {Object} Detector object with detect() and parse() methods
 */
export function createFormidableDetector(options = {}) {
  // Set default upload directory
  const uploadDir = options.uploadDir || path.join(process.cwd(), 'uploads', 'temp');
  
  return {
    name: 'formidable-multipart',
    
    /**
     * Check if this detector can handle the request
     * @param {Object} params - Request parameters
     * @returns {boolean} True if this is a multipart request
     */
    detect: (params) => {
      const req = params._httpReq || params._expressReq;
      if (!req || !req.headers) return false;
      
      const contentType = req.headers['content-type'] || '';
      return contentType.includes('multipart/form-data');
    },
    
    /**
     * Parse multipart data from the request
     * @param {Object} params - Request parameters
     * @returns {Promise<{fields: Object, files: Object}>} Parsed data
     */
    parse: async (params) => {
      const req = params._httpReq || params._expressReq;
      
      // Ensure upload directory exists
      await fs.mkdir(uploadDir, { recursive: true });
      
      // Create form parser
      const form = formidable({
        uploadDir,
        keepExtensions: true,
        ...options
      });
      
      // Parse the request
      const [fields, fileUploads] = await form.parse(req);
      
      // Normalize formidable's file format to our standard format
      const files = {};
      
      for (const [fieldname, uploadedFiles] of Object.entries(fileUploads)) {
        // Formidable returns arrays for multiple files
        const fileArray = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];
        
        // For now, just take the first file (TODO: handle multiple files per field)
        const file = fileArray[0];
        
        if (file) {
          // Read file data into memory (for small files)
          // For large files, you might want to keep them on disk
          const data = await fs.readFile(file.filepath);
          
          files[fieldname] = {
            filename: file.originalFilename || 'unknown',
            mimetype: file.mimetype || 'application/octet-stream',
            size: file.size,
            data: data,
            filepath: file.filepath, // Keep for reference
            
            // Cleanup function to remove temp file
            cleanup: async () => {
              try {
                await fs.unlink(file.filepath);
              } catch (error) {
                // File might already be deleted, ignore
                if (error.code !== 'ENOENT') {
                  throw error;
                }
              }
            }
          };
        }
      }
      
      // Normalize fields (formidable returns arrays for repeated fields)
      const normalizedFields = {};
      for (const [key, value] of Object.entries(fields)) {
        normalizedFields[key] = Array.isArray(value) && value.length === 1 ? value[0] : value;
      }
      
      return { fields: normalizedFields, files };
    }
  };
}