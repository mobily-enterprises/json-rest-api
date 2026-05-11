/**
 * Local File Storage Adapter
 *
 * Production-ready local storage with secure filename handling
 */

import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'

export class LocalStorage {
  constructor (options = {}) {
    this.directory = path.resolve(options.directory || './uploads')
    this.fileBaseUrl = options.fileBaseUrl || '/uploads'
    this.nameStrategy = options.nameStrategy || 'hash' // 'hash', 'timestamp', 'original', 'custom'
    this.nameGenerator = options.nameGenerator // Custom function
    this.preserveExtension = options.preserveExtension !== false
    this.allowedExtensions = options.allowedExtensions // Whitelist
    this.maxFilenameLength = options.maxFilenameLength || 255
  }

  hasPathSegments (filename) {
    return filename.includes('/') ||
      filename.includes('\\') ||
      path.isAbsolute(filename) ||
      path.win32.isAbsolute(filename) ||
      /^[A-Za-z]:/.test(filename)
  }

  validateCustomBasename (basename) {
    if (typeof basename !== 'string') {
      throw new Error('Custom nameGenerator must return a string')
    }
    if (basename.trim().length === 0) {
      throw new Error('Custom nameGenerator must return a non-empty basename')
    }
    if (this.hasPathSegments(basename)) {
      throw new Error('Custom nameGenerator must return a basename, not a path')
    }
    return basename
  }

  resolveStoragePath (filename) {
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      throw new Error('Invalid file name')
    }
    if (this.hasPathSegments(filename)) {
      throw new Error('Invalid file path')
    }

    const resolvedDir = path.resolve(this.directory)
    const resolvedPath = path.resolve(resolvedDir, filename)
    const relative = path.relative(resolvedDir, resolvedPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid file path')
    }

    return resolvedPath
  }

  /**
   * Generate a safe filename
   */
  async generateFilename (file) {
    let basename, extension

    // Extract and validate extension
    const originalExt = path.extname(file.filename).toLowerCase()
    if (this.preserveExtension && originalExt) {
      // Validate extension against whitelist if provided
      if (this.allowedExtensions && !this.allowedExtensions.includes(originalExt)) {
        throw new Error(`File extension '${originalExt}' is not allowed`)
      }
      extension = originalExt
    } else {
      // Determine extension from MIME type for safety
      extension = this.getExtensionFromMimeType(file.mimetype)
    }

    // Generate basename based on strategy
    switch (this.nameStrategy) {
      case 'hash':
        // Cryptographically secure random name
        basename = crypto.randomBytes(16).toString('hex')
        break

      case 'timestamp':
        // Timestamp + random suffix to prevent collisions
        basename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
        break

      case 'original':
        // Sanitized original filename
        basename = this.sanitizeFilename(
          path.basename(file.filename, originalExt)
        )
        break

      case 'custom':
        if (!this.nameGenerator) {
          throw new Error('nameGenerator function required for custom strategy')
        }
        basename = this.validateCustomBasename(await this.nameGenerator(file))
        break

      default:
        throw new Error(`Unknown name strategy: ${this.nameStrategy}`)
    }

    // Combine basename and extension
    let filename = extension ? `${basename}${extension}` : basename

    // Ensure filename doesn't exceed max length
    if (filename.length > this.maxFilenameLength) {
      // Truncate basename to fit
      const maxBasename = this.maxFilenameLength - (extension?.length || 0)
      basename = basename.substring(0, maxBasename)
      filename = extension ? `${basename}${extension}` : basename
    }

    // Handle duplicates
    filename = await this.ensureUnique(filename)

    return filename
  }

  /**
   * Sanitize filename for safe storage
   */
  sanitizeFilename (filename) {
    return filename
      // Remove path traversal attempts
      .replace(/\.\./g, '')
      .replace(/[/\\]/g, '')
      // Remove control characters and special chars
      .replace(/[^\w\s.-]/g, '_')
      // Remove leading/trailing dots and spaces
      .replace(/^[\s.]+|[\s.]+$/g, '')
      // Collapse multiple underscores
      .replace(/_+/g, '_') ||
      // Default if empty
      'unnamed'
  }

  /**
   * Ensure filename is unique
   */
  async ensureUnique (filename) {
    const filepath = this.resolveStoragePath(filename)

    try {
      await fs.access(filepath)
      // File exists, generate unique name
      const ext = path.extname(filename)
      const base = path.basename(filename, ext)
      let counter = 1
      let newFilename

      do {
        newFilename = `${base}_${counter}${ext}`
        counter++
      } while (await this.fileExists(this.resolveStoragePath(newFilename)))

      return newFilename
    } catch (error) {
      // File doesn't exist, name is unique
      return filename
    }
  }

  /**
   * Check if file exists
   */
  async fileExists (filepath) {
    try {
      await fs.access(filepath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get safe extension from MIME type
   */
  getExtensionFromMimeType (mimetype) {
    // Safe mappings only
    const mimeToExt = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/json': '.json',
      'video/mp4': '.mp4',
      'audio/mpeg': '.mp3',
      'application/zip': '.zip'
    }

    return mimeToExt[mimetype] || '.bin'
  }

  /**
   * Upload file with secure filename
   */
  async upload (file) {
    // Ensure directory exists
    await fs.mkdir(this.directory, { recursive: true })

    // Generate secure filename
    const filename = await this.generateFilename(file)
    const filepath = this.resolveStoragePath(filename)

    // Write file
    if (file.data) {
      await fs.writeFile(filepath, file.data)
    } else if (file.filepath) {
      await fs.rename(file.filepath, filepath)
    } else {
      throw new Error('File has no data or filepath')
    }

    // Return public URL
    return `${this.fileBaseUrl}/${filename}`
  }

  /**
   * Delete a file
   */
  async delete (url) {
    const filename = path.basename(url)
    const filepath = this.resolveStoragePath(filename)

    try {
      await fs.unlink(filepath)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }
}
