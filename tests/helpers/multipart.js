import { readdir, stat } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import path from 'node:path'

export async function waitForPartialUpload (directory, signal) {
  while (true) {
    signal.throwIfAborted()
    for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.parentPath !== directory && (await stat(path.join(entry.parentPath, entry.name))).size > 0) return
    }
    await setTimeout(10, undefined, { signal })
  }
}

export function multipartBody (parts, boundary = 'library-test-boundary') {
  const chunks = []
  for (const { name, filename, mimetype = 'application/octet-stream', data } of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename === undefined ? '' : `; filename="${filename}"`}\r\n${filename === undefined ? '' : `Content-Type: ${mimetype}\r\n`}\r\n`))
    chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}
