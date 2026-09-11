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
    tempRoot = undefined
    await createTempRoot()
  })

  afterEach(async () => {
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true })
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

  for (const source of ['buffer', 'filepath']) {
    for (const nameStrategy of ['original', 'custom']) {
      it(`isolates concurrent ${source} uploads with ${nameStrategy} names, including later deletion`, async () => {
        const directory = path.join(tempRoot, 'uploads')
        const storage = new LocalStorage({ directory, nameStrategy, nameGenerator: () => 'shared' })
        const ready = Promise.withResolvers()
        const generate = storage.generateFilename.bind(storage)
        let generated = 0
        storage.generateFilename = async file => {
          const filename = await generate(file)
          if (++generated === 3) ready.resolve()
          await ready.promise
          return filename
        }
        const payloads = ['first', 'second', 'third'].map(value => Buffer.from(value.repeat(20000)))
        const files = []
        for (const [index, data] of payloads.entries()) {
          const file = { filename: 'shared.png', mimetype: 'image/png' }
          if (source === 'buffer') file.data = data
          else {
            file.filepath = path.join(tempRoot, `source-${index}`)
            await fs.writeFile(file.filepath, data)
          }
          files.push(file)
        }
        const urls = await Promise.all(files.map(file => storage.upload(file)))
        assert.equal(new Set(urls).size, files.length)
        for (const [index, url] of urls.entries()) {
          assert.deepEqual(await fs.readFile(path.join(directory, path.basename(url))), payloads[index])
          if (source === 'filepath') await assert.rejects(fs.stat(files[index].filepath), { code: 'ENOENT' })
        }
        await storage.delete(urls[0])
        for (const index of [1, 2]) assert.deepEqual(await fs.readFile(path.join(directory, path.basename(urls[index]))), payloads[index])
      })
    }
  }

  it('treats a dangling symlink as an occupied name', async () => {
    const directory = path.join(tempRoot, 'uploads')
    await fs.mkdir(directory)
    const target = path.join(tempRoot, 'must-not-be-created')
    await fs.symlink(target, path.join(directory, 'photo.png'))
    const storage = new LocalStorage({ directory, nameStrategy: 'original' })
    assert.equal(await storage.upload(createFile()), '/uploads/photo_1.png')
    await assert.rejects(fs.stat(target), { code: 'ENOENT' })
    assert.equal((await fs.lstat(path.join(directory, 'photo.png'))).isSymbolicLink(), true)
  })

  it('removes a reserved destination after a missing source fails', async () => {
    const directory = path.join(tempRoot, 'uploads')
    const storage = new LocalStorage({ directory, nameStrategy: 'original' })
    await assert.rejects(storage.upload({ filename: 'photo.png', filepath: path.join(tempRoot, 'missing') }), { code: 'ENOENT' })
    assert.deepEqual(await fs.readdir(directory), [])
  })

  for (const cleanupFails of [false, true]) {
    it(`retains a partial write failure with ${cleanupFails ? 'failed' : 'successful'} destination cleanup`, async t => {
      const directory = path.join(tempRoot, 'uploads')
      const storage = new LocalStorage({ directory, nameStrategy: 'original' })
      const primary = new Error('Injected disk write failure')
      const secondary = new Error('Injected unlink failure')
      const open = fs.open
      t.mock.method(fs, 'open', async (...args) => {
        const handle = await open(...args)
        const write = handle.writeFile.bind(handle)
        handle.writeFile = async () => { await write('partial'); throw primary }
        return handle
      })
      if (cleanupFails) t.mock.method(fs, 'unlink', async () => { throw secondary })
      await assert.rejects(storage.upload(createFile()), error => {
        if (!cleanupFails) assert.equal(error, primary)
        else {
          assert.ok(error instanceof AggregateError)
          assert.equal(error.cause, primary)
          assert.deepEqual(error.errors, [primary, secondary])
        }
        return true
      })
      assert.deepEqual(await fs.readdir(directory), cleanupFails ? ['photo.png'] : [])
    })
  }

  it('preserves a temporary source if its removal fails and cleans the reserved destination', async t => {
    const directory = path.join(tempRoot, 'uploads')
    const filepath = path.join(tempRoot, 'source')
    await fs.writeFile(filepath, 'original bytes')
    const storage = new LocalStorage({ directory, nameStrategy: 'original' })
    const primary = new Error('Source removal failed')
    const unlink = fs.unlink
    t.mock.method(fs, 'unlink', async target => {
      if (target === filepath) throw primary
      return unlink(target)
    })
    await assert.rejects(storage.upload({ filename: 'photo.png', filepath }), error => error === primary)
    assert.equal(await fs.readFile(filepath, 'utf8'), 'original bytes')
    assert.deepEqual(await fs.readdir(directory), [])
  })

  it('propagates filename inspection failures instead of treating them as unused names', async t => {
    const primary = Object.assign(new Error('Cannot inspect destination'), { code: 'EACCES' })
    t.mock.method(fs, 'lstat', async () => { throw primary })
    const storage = new LocalStorage({ directory: path.join(tempRoot, 'uploads'), nameStrategy: 'original' })
    await assert.rejects(storage.upload(createFile()), error => error === primary)
  })
})
