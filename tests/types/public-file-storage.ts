import { LocalStorage, S3Storage } from '../../types/file-storage.js'
import type { FileStorage } from '../../types/file-storage.js'

const local = new LocalStorage({ nameStrategy: 'custom', nameGenerator: async file => file.filename.replace(/\W/g, '_') })
const memoryUrl: string = await local.upload({ filename: 'photo.png', mimetype: 'image/png', data: Buffer.from('example') })
const pathUrl: string = await local.upload({ filename: 'photo.png', filepath: '/tmp/photo.png' })
await local.upload({ filename: 'chunks.txt', data: (async function* () { yield Buffer.from('chunk') })() })
const adapter: FileStorage = local
const synchronous: FileStorage = { upload: file => `/uploads/${file.filename}`, delete: () => {} }
await synchronous.upload({ filename: 'photo.png', data: Buffer.from('example') })
await adapter.delete(memoryUrl)
await local.delete(pathUrl)
const mock: FileStorage = new S3Storage({ bucket: 'example', mockMode: true })
await mock.upload({ filename: 'photo.png', data: Buffer.from('example') })

// @ts-expect-error Custom naming needs a generator.
new LocalStorage({ nameStrategy: 'custom' })
// @ts-expect-error A generator returns a basename string, not an object.
new LocalStorage({ nameStrategy: 'custom', nameGenerator: () => ({ name: 'photo' }) })
// @ts-expect-error Local uploads need contents or a source path.
await local.upload({ filename: 'photo.png' })
// @ts-expect-error File contents must be accepted by the filesystem writer.
await local.upload({ filename: 'photo.png', data: 42 })
// @ts-expect-error The S3 demo requires a bucket.
new S3Storage({ mockMode: true })
// @ts-expect-error Real S3 upload is explicitly unsupported by this adapter.
new S3Storage({ bucket: 'example', mockMode: false })
