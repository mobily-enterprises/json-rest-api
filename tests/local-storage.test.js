import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalStorage } from '../plugins/storage/local-storage.js'

let tempRoot

async function createTempRoot () {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'json-rest-api-local-storage-'))
  return tempRoot
}

function createFile (filename = 'photo.png') {
  return {
    filename,
    mimetype: 'image/png',
    data: Buffer.from('x')
  }
}

describe('LocalStorage path containment', () => {
  beforeEach(async () => {
    await createTempRoot()
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('rejects custom generated paths that escape to sibling directories', async () => {
    const directory = path.join(tempRoot, 'uploads')
    const evilDirectory = path.join(tempRoot, 'uploads_evil')
    await fs.mkdir(evilDirectory, { recursive: true })

    const storage = new LocalStorage({
      directory,
      fileBaseUrl: '/uploads',
      nameStrategy: 'custom',
      nameGenerator: async () => '../uploads_evil/pwn'
    })

    await assert.rejects(
      storage.upload(createFile()),
      /Custom nameGenerator must return a basename, not a path/
    )

    await assert.rejects(
      fs.access(path.join(evilDirectory, 'pwn.png')),
      { code: 'ENOENT' }
    )
  })

  it('rejects empty and drive-prefixed custom generated names', async () => {
    const directory = path.join(tempRoot, 'uploads')

    const emptyNameStorage = new LocalStorage({
      directory,
      nameStrategy: 'custom',
      nameGenerator: async () => '   '
    })
    await assert.rejects(
      emptyNameStorage.upload(createFile()),
      /Custom nameGenerator must return a non-empty basename/
    )

    const driveNameStorage = new LocalStorage({
      directory,
      nameStrategy: 'custom',
      nameGenerator: async () => 'C:evil'
    })
    await assert.rejects(
      driveNameStorage.upload(createFile()),
      /Custom nameGenerator must return a basename, not a path/
    )
  })

  it('keeps safe custom basenames inside the configured directory', async () => {
    const directory = path.join(tempRoot, 'uploads')
    const storage = new LocalStorage({
      directory,
      fileBaseUrl: '/uploads',
      nameStrategy: 'custom',
      nameGenerator: async () => 'avatar'
    })

    const firstUrl = await storage.upload(createFile())
    const secondUrl = await storage.upload(createFile())

    assert.equal(firstUrl, '/uploads/avatar.png')
    assert.equal(secondUrl, '/uploads/avatar_1.png')
    assert.equal(await fs.readFile(path.join(directory, 'avatar.png'), 'utf8'), 'x')
    assert.equal(await fs.readFile(path.join(directory, 'avatar_1.png'), 'utf8'), 'x')
  })
})
