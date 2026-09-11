// Read first, let the caller edit, then save against the selected representation.
export async function readForConditionalUpdate (url, { headers = {}, credentials = 'same-origin' } = {}) {
  const selectedHeaders = new Headers(headers)
  selectedHeaders.set('Accept', 'application/vnd.api+json')
  const current = await fetch(url, { headers: selectedHeaders, credentials })
  if (!current.ok) throw new Error(`Read failed: ${current.status}`)
  const etag = current.headers.get('ETag')
  if (!etag) throw new Error('The selected response has no ETag')
  const document = await current.json()

  return {
    document,
    async save (inputRecord) {
      const writeHeaders = new Headers(selectedHeaders)
      writeHeaders.set('Content-Type', 'application/vnd.api+json')
      writeHeaders.set('If-Match', etag)
      // Return the response so the caller can handle 412 without automatic retry.
      return fetch(url, {
        method: 'PATCH',
        credentials,
        headers: writeHeaders,
        body: JSON.stringify(inputRecord)
      })
    }
  }
}
