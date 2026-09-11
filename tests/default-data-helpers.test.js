import { it } from 'node:test'
import assert from 'node:assert/strict'
import { defaultDataHelpers } from '../plugins/core/lib/querying-writing/default-data-helpers.js'

for (const [method, operation] of [
  ['dataExists', 'exists'], ['dataGet', 'get'], ['dataGetMinimal', 'getMinimal'],
  ['dataQuery', 'query'], ['dataPost', 'post'], ['dataPatch', 'patch'],
  ['dataPut', 'put'], ['dataDelete', 'delete']
]) {
  it(`${method} rejects missing storage without examining caller data`, async () => {
    const request = new Proxy({}, { get () { throw new Error('Caller data inspected') } })
    await assert.rejects(defaultDataHelpers[method](request), {
      message: `No storage implementation for ${operation}. Install a storage plugin.`
    })
  })
}
