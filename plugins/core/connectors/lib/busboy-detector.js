import { throwMissingPackage } from '../../../../lib/missing-package.js'
import { RestApiPayloadError } from '../../../../lib/rest-api-errors.js'
import { isMultipartContentType } from './transport-http-helpers.js'
import { addMultipartField, multipartLimits } from './multipart-helpers.js'

let busboyFactory
try { busboyFactory = (await import('busboy')).default } catch {
  throwMissingPackage('busboy', 'express-connector', 'Busboy is required for multipart uploads. Install the optional busboy peer.')
}

/** Parse a streamed multipart request into buffered files and text fields. */
export function createBusboyDetector (options = {}) {
  const limits = { ...multipartLimits, ...options.limits }
  return {
    name: 'busboy-multipart',
    detect: params => isMultipartContentType((params._httpReq || params._expressReq)?.headers?.['content-type']),
    parse: async (params) => {
      const req = params._httpReq || params._expressReq
      if (!req?.pipe || req.aborted) throw new RestApiPayloadError('Multipart request is unavailable or aborted')
      return new Promise((resolve, reject) => {
        let parser
        const fields = new Map()
        const files = new Map()
        const fileNames = new Set()
        let failure
        const cleanup = () => {
          req.removeListener('aborted', onAborted)
          req.removeListener('error', onError)
        }
        const fail = error => {
          if (failure) return
          failure = error
          fields.clear()
          files.clear()
          req.unpipe(parser)
          req.resume()
          cleanup()
          // A limit event can run inside Busboy's current write; destroy afterwards.
          queueMicrotask(() => parser?.destroy())
          reject(error)
        }
        const onError = cause => fail(new RestApiPayloadError('Malformed multipart request', { cause }))
        const onAborted = () => fail(new RestApiPayloadError('Multipart request aborted'))
        const limitError = field => new RestApiPayloadError(`Multipart limit exceeded: ${field}`, { path: field, statusCode: 413 })
        try {
          parser = busboyFactory({
            defParamCharset: 'utf8',
            ...options,
            headers: req.headers,
            // Busboy reports truncation when a limit is reached, including exact size.
            limits: { ...limits, fileSize: limits.fileSize + 1, fieldSize: limits.fieldSize + 1, parts: limits.parts + 1 }
          })
        } catch (cause) { reject(new RestApiPayloadError('Invalid multipart headers or boundary', { cause })); return }
        req.once('aborted', onAborted)
        req.once('error', onError)
        parser.on('field', (name, value, info) => {
          if (failure) return
          if (info.valueTruncated || info.nameTruncated || Buffer.byteLength(value) > limits.fieldSize) return fail(limitError(name))
          try { addMultipartField(fields, name, value) } catch (error) { fail(error) }
        })
        parser.on('file', (name, stream, { filename, encoding, mimeType }) => {
          stream.on('error', onError)
          if (failure) { stream.resume(); return }
          if (fileNames.has(name)) {
            stream.resume()
            fail(new RestApiPayloadError(`Multiple files for field '${name}' are not supported`, { path: name }))
            return
          }
          fileNames.add(name)
          const chunks = []
          let size = 0
          stream.on('data', chunk => {
            if (failure) return
            size += chunk.length
            if (size > limits.fileSize) { fail(limitError(name)); return }
            chunks.push(chunk)
          })
          stream.on('limit', () => fail(limitError(name)))
          stream.on('end', () => {
            if (!failure) files.set(name, { filename, encoding, mimetype: mimeType, size, data: Buffer.concat(chunks) })
          })
        })
        for (const event of ['partsLimit', 'filesLimit', 'fieldsLimit']) parser.on(event, () => fail(limitError(event)))
        parser.on('error', onError)
        parser.on('close', () => {
          cleanup()
          if (!failure) resolve({ fields: Object.fromEntries(fields), files: Object.fromEntries(files) })
        })
        req.pipe(parser)
      })
    }
  }
}
