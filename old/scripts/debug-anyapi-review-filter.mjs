import knexLib from 'knex'
import { createCustomIdPropertyApi } from '../tests/fixtures/api-configs.js'
import { createJsonApiDocument } from '../tests/helpers/test-utils.js'

async function run () {
  const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
  const api = await createCustomIdPropertyApi(knex)

  const country = await api.resources.countries.post({
    inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
  })

  const book = await api.resources.books.post({
    inputRecord: createJsonApiDocument('books',
      { title: 'Test Book' },
      { country: { data: { type: 'countries', id: country.data.id } } }
    )
  })

  const author = await api.resources.authors.post({
    inputRecord: createJsonApiDocument('authors', { name: 'Author' })
  })

  await api.resources.reviews.post({
    inputRecord: createJsonApiDocument('reviews', {
      rating: 5,
      title: 'Book review',
      content: 'Great book',
      reviewer_name: 'Reader',
      reviewable_type: 'books',
      reviewable_id: book.data.id
    })
  })

  await api.resources.reviews.post({
    inputRecord: createJsonApiDocument('reviews', {
      rating: 4,
      title: 'Author review',
      content: 'Great author',
      reviewer_name: 'Fan',
      reviewable_type: 'authors',
      reviewable_id: author.data.id
    })
  })

  try {
    const res = await api.resources.reviews.query({
      queryParams: { filters: { reviewable_type: 'books' } }
    })
    console.log('Query succeeded with rows:', res.data.length)
  } catch (error) {
    console.error('Query failed:', error)
    if (error?.sql) {
      console.error('SQL:', error.sql)
    }
  }

  await knex.destroy()
}

run().catch((err) => {
  console.error('Unexpected failure:', err)
})
