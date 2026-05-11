/**
 * S3 Storage Adapter (mock/demo)
 *
 * Generates S3-style URLs without uploading files to Amazon S3.
 *
 * Usage:
 * ```javascript
 * import { S3Storage } from 'json-rest-api';
 *
 * const storage = new S3Storage({
 *   bucket: 'my-uploads',
 *   region: 'us-east-1',
 *   prefix: 'uploads/',
 *   mockMode: true
 * });
 *
 * const schema = {
 *   image: { type: 'file', storage }
 * };
 * ```
 */

import crypto from 'crypto'
import path from 'path'

const REAL_S3_NOT_IMPLEMENTED_MESSAGE = 'S3Storage real S3 mode is not implemented. The included adapter only supports mockMode: true; provide a production storage adapter or add an AWS SDK-backed implementation.'

function createRealS3NotImplementedError () {
  return new Error(REAL_S3_NOT_IMPLEMENTED_MESSAGE)
}

export class S3Storage {
  constructor (options = {}) {
    this.bucket = options.bucket
    this.region = options.region || 'us-east-1'
    this.prefix = options.prefix || ''
    this.acl = options.acl || 'public-read'

    if (!this.bucket) {
      throw new Error('S3Storage requires a bucket name')
    }

    this.mockMode = options.mockMode !== false // Default to mock mode

    if (!this.mockMode) {
      throw createRealS3NotImplementedError()
    }
  }

  /**
   * Upload a file to mock S3 storage.
   * @param {Object} file - File object from detector
   * @returns {Promise<string>} URL of the uploaded file
   */
  async upload (file) {
    // Generate S3 key
    const ext = path.extname(file.filename)
    const hash = crypto.randomBytes(16).toString('hex')
    const key = `${this.prefix}${hash}${ext}`

    if (this.mockMode) {
      // Mock mode - just return a fake URL
      const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`

      // Simulate upload delay
      await new Promise(resolve => setTimeout(resolve, 100))

      return url
    }

    throw createRealS3NotImplementedError()
  }

  /**
   * Delete a file from mock S3 storage.
   * @param {string} url - URL returned by upload()
   * @returns {Promise<void>}
   */
  async delete (url) {
    if (!this.mockMode) {
      throw createRealS3NotImplementedError()
    }

    const urlObj = new URL(url)

    if (urlObj.pathname.length === 0) {
      throw new Error('Invalid S3 object URL')
    }

    // Mock mode - just simulate deletion
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
