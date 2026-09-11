import { RestApiPayloadError } from '../../../../lib/rest-api-errors.js'

export const multipartLimits = Object.freeze({
  fileSize: 10 * 1024 * 1024,
  files: 10,
  fields: 100,
  fieldSize: 64 * 1024,
  parts: 110
})

export function addMultipartField (fields, name, value) {
  if (typeof name !== 'string' || !name) throw new RestApiPayloadError('Multipart fields must have a name')
  const array = name.match(/^(.+)\[\d*\]$/)
  const key = array ? array[1] : name
  if (fields.has(key)) {
    fields.set(key, [...[].concat(fields.get(key)), value])
  } else fields.set(key, array ? [value] : value)
}
