/**
 * Filename Strategy Examples
 * 
 * Different approaches to handling uploaded filenames
 */

import { LocalStorage } from '../plugins/storage/local-storage.js';

// Strategy 1: Random hash (most secure, default)
const hashStorage = new LocalStorage({
  directory: './uploads/images',
  baseUrl: '/uploads/images',
  nameStrategy: 'hash',
  preserveExtension: true
});
// Uploads as: "a7f8d9e2b4c6e1f3.jpg"

// Strategy 2: Timestamp-based (sortable)
const timestampStorage = new LocalStorage({
  directory: './uploads/documents',
  baseUrl: '/uploads/documents',
  nameStrategy: 'timestamp',
  preserveExtension: true
});
// Uploads as: "1672531200000_a8f9.pdf"

// Strategy 3: Sanitized original (user-friendly)
const originalStorage = new LocalStorage({
  directory: './uploads/user-files',
  baseUrl: '/uploads/user-files',
  nameStrategy: 'original',
  preserveExtension: true,
  maxFilenameLength: 100
});
// "My Resume 2024!.pdf" uploads as: "My_Resume_2024_.pdf"
// Duplicates become: "My_Resume_2024_1.pdf", "My_Resume_2024_2.pdf"

// Strategy 4: Custom naming function
const customStorage = new LocalStorage({
  directory: './uploads/profiles',
  baseUrl: '/uploads/profiles',
  nameStrategy: 'custom',
  nameGenerator: async (file) => {
    // Example: user ID + timestamp
    const userId = file.userId || 'anonymous';
    const timestamp = Date.now();
    return `user_${userId}_${timestamp}`;
  }
});
// Uploads as: "user_12345_1672531200000.jpg"

// Strategy 5: High security (no extensions)
const secureStorage = new LocalStorage({
  directory: './uploads/secure',
  baseUrl: '/uploads/secure',
  nameStrategy: 'hash',
  preserveExtension: false  // Store as .bin
});
// All files upload as: "a7f8d9e2b4c6e1f3.bin"

// Strategy 6: Whitelist extensions
const whitelistStorage = new LocalStorage({
  directory: './uploads/images',
  baseUrl: '/uploads/images',
  nameStrategy: 'hash',
  preserveExtension: true,
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp']
});
// Only allows specific image extensions

// Example: Organization by date
const dateOrganizedStorage = new LocalStorage({
  directory: './uploads',
  baseUrl: '/uploads',
  nameStrategy: 'custom',
  nameGenerator: async (file) => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = crypto.randomBytes(8).toString('hex');
    
    // Create date-based subdirectory
    const dateDir = `${year}/${month}/${day}`;
    await fs.mkdir(path.join('./uploads', dateDir), { recursive: true });
    
    return `${dateDir}/${random}`;
  }
});
// Uploads as: "2024/01/15/a7f8d9e2b4c6e1f3.jpg"

// Example: Content-based naming
const contentStorage = new LocalStorage({
  directory: './uploads/media',
  baseUrl: '/uploads/media',
  nameStrategy: 'custom',
  nameGenerator: async (file) => {
    // Generate hash of file content for deduplication
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(file.data);
    const contentHash = hash.digest('hex').substring(0, 16);
    
    // Prefix by type
    const typePrefix = file.mimetype.startsWith('image/') ? 'img' :
                      file.mimetype.startsWith('video/') ? 'vid' :
                      file.mimetype.startsWith('audio/') ? 'aud' : 'doc';
    
    return `${typePrefix}_${contentHash}`;
  }
});
// Uploads as: "img_a7f8d9e2b4c6e1f3.jpg" (same file always gets same name)

// Example usage in schema
api.addScope('products', {
  schema: {
    name: { type: 'string', required: true },
    
    // Product images need user-friendly names
    mainImage: {
      type: 'file',
      storage: originalStorage,
      accepts: ['image/*']
    },
    
    // Technical documents use timestamp
    manual: {
      type: 'file',
      storage: timestampStorage,
      accepts: ['application/pdf']
    },
    
    // User uploads use high security
    attachment: {
      type: 'file',
      storage: secureStorage,
      accepts: ['*']
    }
  }
});