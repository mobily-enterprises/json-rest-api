import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { S3Storage } from '../index.js'

function createFile (filename = 'photo.png') {
  return {
    filename,
    mimetype: 'image/png',
    data: Buffer.from('file contents')
  }
}

describe('S3Storage', () => {
  it('requires a bucket name', () => {
    assert.throws(() => new S3Storage(), /S3Storage requires a bucket name/)
  })

  it('generates S3-style mock URLs and accepts deleting returned URLs', async () => {
    const storage = new S3Storage({
      bucket: 'my-uploads',
      region: 'ap-southeast-2',
      prefix: 'uploads/'
    })

    const url = await storage.upload(createFile())

    assert.match(url, /^https:\/\/my-uploads\.s3\.ap-southeast-2\.amazonaws\.com\/uploads\/[a-f0-9]{32}\.png$/)
    await assert.doesNotReject(storage.delete(url))
  })

  it('fails clearly when real S3 mode is requested', () => {
    assert.throws(
      () => new S3Storage({ bucket: 'my-uploads', mockMode: false }),
      /S3Storage real S3 mode is not implemented/
    )
  })
})
