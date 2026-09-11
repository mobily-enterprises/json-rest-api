import { throwMissingPackage } from '../../../../lib/missing-package.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { RestApiPayloadError } from '../../../../lib/rest-api-errors.js'
import { isMultipartContentType } from './transport-http-helpers.js'
import { addMultipartField, multipartLimits } from './multipart-helpers.js'

let formidable
try { formidable = (await import('formidable')).default } catch {
  throwMissingPackage('formidable', 'express-connector', 'Formidable is required for multipart uploads. Install the optional formidable peer.')
}

/** Buffer completed uploads, then remove this request's temporary directory. */
export function createFormidableDetector (options = {}) {
  const uploadDir = path.resolve(options.uploadDir || tmpdir())
  return {
    name: 'formidable-multipart',
    detect: params => isMultipartContentType((params._httpReq || params._expressReq)?.headers?.['content-type']),
    parse: async (params) => {
      const req = params._httpReq || params._expressReq
      if (!req?.on || req.aborted) throw new RestApiPayloadError('Multipart request is unavailable or aborted')
      let directory, failure, rejectParsing, result
      const onAborted = () => rejectParsing?.(new RestApiPayloadError('Multipart request aborted'))
      req.once('aborted', onAborted)
      try {
        await fs.mkdir(uploadDir, { recursive: true })
        directory = await fs.mkdtemp(path.join(uploadDir, 'json-rest-upload-'))
        if (req.aborted) throw new RestApiPayloadError('Multipart request aborted')
        const form = formidable({
          maxFileSize: multipartLimits.fileSize,
          maxTotalFileSize: multipartLimits.fileSize * multipartLimits.files,
          maxFiles: multipartLimits.files,
          maxFields: multipartLimits.fields,
          maxFieldsSize: multipartLimits.fieldSize * multipartLimits.fields,
          allowEmptyFiles: true,
          minFileSize: 0,
          ...options,
          uploadDir: directory
        })
        const entries = []
        const uploads = []
        form.on('field', (name, value) => entries.push([name, value]))
        form.on('file', (name, file) => uploads.push([name, file]))
        await new Promise((resolve, reject) => {
          rejectParsing = reject
          // Callback mode avoids an unobserved internal promise on early abort.
          form.parse(req, error => error ? reject(error) : resolve()).catch(reject)
        })
        const fields = new Map()
        const files = new Map()
        for (const [name, value] of entries) addMultipartField(fields, name, value)
        for (const [name, file] of uploads) {
          if (files.has(name)) throw new RestApiPayloadError(`Multiple files for field '${name}' are not supported`, { path: name })
          files.set(name, {
            filename: file.originalFilename || 'unknown',
            mimetype: file.mimetype || 'application/octet-stream',
            size: file.size,
            data: await fs.readFile(file.filepath)
          })
        }
        result = { fields: Object.fromEntries(fields), files: Object.fromEntries(files) }
      } catch (error) {
        failure = [400, 413].includes(error.httpCode)
          ? new RestApiPayloadError(error.message, { statusCode: error.httpCode, cause: error })
          : error
      } finally {
        req.removeListener('aborted', onAborted)
        if (failure) req.resume()
        if (directory) {
          try { await fs.rm(directory, { recursive: true, force: true }) } catch (error) {
            if (failure) failure.cleanupError = error
            else failure = error
          }
        }
      }
      if (failure) throw failure
      return result
    }
  }
}
