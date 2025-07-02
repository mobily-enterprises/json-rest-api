/**
 * Local File Storage Adapter
 * 
 * Stores uploaded files on the local filesystem.
 * 
 * Usage:
 * ```javascript
 * import { LocalStorage } from 'jsonrestapi/lib/storage/local-storage.js';
 * 
 * const storage = new LocalStorage({
 *   directory: './uploads',
 *   baseUrl: 'http://localhost:3000/uploads'
 * });
 * 
 * const schema = {
 *   image: { type: 'file', storage }
 * };
 * ```
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export class LocalStorage {
  constructor(options = {}) {
    this.directory = options.directory || './uploads';
    this.baseUrl = options.baseUrl || '/uploads';
    this.keepOriginalName = options.keepOriginalName || false;
  }
  
  /**
   * Upload a file to local storage
   * @param {Object} file - File object from detector
   * @param {string} file.filename - Original filename
   * @param {string} file.mimetype - MIME type
   * @param {Buffer} file.data - File data
   * @param {Function} file.cleanup - Optional cleanup function
   * @returns {Promise<string>} URL of the uploaded file
   */
  async upload(file) {
    // Ensure upload directory exists
    await fs.mkdir(this.directory, { recursive: true });
    
    // Generate filename
    let filename;
    if (this.keepOriginalName) {
      // Sanitize original filename
      filename = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    } else {
      // Generate unique filename
      const ext = path.extname(file.filename);
      const hash = crypto.randomBytes(16).toString('hex');
      filename = `${hash}${ext}`;
    }
    
    // Full path
    const filepath = path.join(this.directory, filename);
    
    // Write file
    if (file.data) {
      // File is in memory
      await fs.writeFile(filepath, file.data);
    } else if (file.filepath) {
      // File is already on disk (formidable)
      await fs.rename(file.filepath, filepath);
    } else {
      throw new Error('File has no data or filepath');
    }
    
    // Return public URL
    const url = `${this.baseUrl}/${filename}`;
    return url;
  }
  
  /**
   * Delete a file from storage
   * @param {string} url - URL returned by upload()
   * @returns {Promise<void>}
   */
  async delete(url) {
    // Extract filename from URL
    const filename = path.basename(url);
    const filepath = path.join(this.directory, filename);
    
    try {
      await fs.unlink(filepath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}