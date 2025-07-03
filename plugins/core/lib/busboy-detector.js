/**
 * Busboy File Detector for HTTP Multipart Uploads
 * 
 * This detector handles multipart/form-data uploads using the busboy library.
 * It's suitable for both HTTP and Express connectors.
 * 
 * Features:
 * - Streaming parser (memory efficient)
 * - Configurable file size limits
 * - Automatic field parsing
 * - No temporary files by default (keeps in memory)
 * 
 * Usage:
 * ```javascript
 * import { createBusboyDetector } from 'jsonrestapi/plugins/core/lib/busboy-detector.js';
 * 
 * api.use(HttpPlugin, {
 *   fileParser: 'busboy',
 *   fileParserOptions: {
 *     limits: { fileSize: 10 * 1024 * 1024 } // 10MB
 *   }
 * });
 * ```
 */

import Busboy from 'busboy';
import { Readable } from 'stream';

/**
 * Creates a busboy-based file detector
 * 
 * @param {Object} options - Busboy configuration options
 * @param {Object} options.limits - Size limits
 * @param {number} options.limits.fileSize - Max file size in bytes
 * @param {number} options.limits.files - Max number of files
 * @param {number} options.limits.fields - Max number of fields
 * @returns {Object} Detector object with detect() and parse() methods
 */
export function createBusboyDetector(options = {}) {
  return {
    name: 'busboy-multipart',
    
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
      
      return new Promise((resolve, reject) => {
        const busboy = new Busboy({
          headers: req.headers,
          ...options
        });
        
        const fields = {};
        const files = {};
        const filePromises = [];
        
        // Handle fields
        busboy.on('field', (fieldname, val) => {
          // Handle array notation (field[] or field[0])
          const arrayMatch = fieldname.match(/^(.+)\[\d*\]$/);
          if (arrayMatch) {
            const baseName = arrayMatch[1];
            if (!fields[baseName]) {
              fields[baseName] = [];
            }
            if (Array.isArray(fields[baseName])) {
              fields[baseName].push(val);
            }
          } else {
            fields[fieldname] = val;
          }
        });
        
        // Handle files
        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
          const chunks = [];
          let size = 0;
          
          const filePromise = new Promise((fileResolve, fileReject) => {
            file.on('data', (chunk) => {
              chunks.push(chunk);
              size += chunk.length;
            });
            
            file.on('limit', () => {
              fileReject(new Error(`File size limit exceeded for field '${fieldname}'`));
            });
            
            file.on('end', () => {
              files[fieldname] = {
                filename: filename,
                mimetype: mimetype,
                encoding: encoding,
                size: size,
                data: Buffer.concat(chunks)
              };
              fileResolve();
            });
            
            file.on('error', fileReject);
          });
          
          filePromises.push(filePromise);
        });
        
        // Handle completion
        busboy.on('finish', async () => {
          try {
            // Wait for all files to be fully read
            await Promise.all(filePromises);
            resolve({ fields, files });
          } catch (error) {
            reject(error);
          }
        });
        
        // Handle errors
        busboy.on('error', (error) => {
          reject(error);
        });
        
        // Handle limit errors
        busboy.on('partsLimit', () => {
          reject(new Error('Parts limit exceeded'));
        });
        
        busboy.on('filesLimit', () => {
          reject(new Error('Files limit exceeded'));
        });
        
        busboy.on('fieldsLimit', () => {
          reject(new Error('Fields limit exceeded'));
        });
        
        // Pipe request to busboy
        if (req.pipe) {
          req.pipe(busboy);
        } else if (req.on) {
          // For already buffered requests
          const stream = new Readable();
          stream.push(req.body || req);
          stream.push(null);
          stream.pipe(busboy);
        } else {
          reject(new Error('Request object is not a stream'));
        }
      });
    }
  };
}