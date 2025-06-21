import { runHttpTests, curl, curlCmd, parseResponse, assertStatus, assertJsonApiResponse } from './setup.js'

// Test 5: Query Parameters and Filtering
await runHttpTests('Query Parameters and Filtering', async ({ baseUrl }, storageType) => {
  
  // Setup test data
  const testUsers = []
  console.log('  Setting up test data...')
  
  // Create test users
  const usersToCreate = [
    { name: 'Alice Anderson', email: 'alice@example.com', age: 25, role: 'admin', isActive: true },
    { name: 'Bob Brown', email: 'bob@example.com', age: 30, role: 'user', isActive: true },
    { name: 'Charlie Chen', email: 'charlie@example.com', age: 35, role: 'user', isActive: false },
    { name: 'Diana Davis', email: 'diana@example.com', age: 28, role: 'guest', isActive: true },
    { name: 'Edward Evans', email: 'edward@example.com', age: 45, role: 'admin', isActive: false },
    { name: 'Fiona Foster', email: 'fiona@example.com', age: 22, role: 'user', isActive: true }
  ]
  
  for (const userData of usersToCreate) {
    const cmd = curlCmd(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: userData
        }
      }
    })
    
    const result = await curl(cmd)
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    testUsers.push(response.data.data)
  }
  
  // Create test posts for join tests
  const testPosts = []
  for (let i = 0; i < 3; i++) {
    const postCmd = curlCmd(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        data: {
          attributes: {
            title: `Post ${i + 1}`,
            content: `Content for post ${i + 1}`,
            authorId: testUsers[i].id,
            status: i === 0 ? 'published' : 'draft',
            tags: i === 0 ? ['tech', 'javascript'] : ['general']
          }
        }
      }
    })
    
    const result = await curl(postCmd)
    const response = parseResponse(result.raw)
    assertStatus(response, 201)
    testPosts.push(response.data.data)
  }
  
  // 5.1 Basic filtering by searchable fields
  console.log('  5.1 Basic filtering by searchable fields')
  
  // Filter by name - need to URL encode the space in the name
  const filterNameUrl = `${baseUrl}/api/users?filter[name]=Alice%20Anderson`
  const filterNameCmd = curlCmd(filterNameUrl)
  const filterNameResult = await curl(filterNameCmd)
  
  if (!filterNameResult.success || !filterNameResult.raw) {
    throw new Error(`Filter by name failed: ${filterNameResult.error || 'No response'}`)
  }
  
  const filterNameResponse = parseResponse(filterNameResult.raw)
  
  assertStatus(filterNameResponse, 200)
  assertJsonApiResponse(filterNameResponse)
  
  if (filterNameResponse.data.data.length !== 1) {
    throw new Error(`Expected 1 user with name 'Alice Anderson', got ${filterNameResponse.data.data.length}`)
  }
  
  if (filterNameResponse.data.data[0].attributes.name !== 'Alice Anderson') {
    throw new Error('Filtered user has wrong name')
  }
  
  // Filter by role
  const filterRoleCmd = curlCmd(`${baseUrl}/api/users?filter[role]=admin`)
  const filterRoleResult = await curl(filterRoleCmd)
  const filterRoleResponse = parseResponse(filterRoleResult.raw)
  
  assertStatus(filterRoleResponse, 200)
  
  const adminCount = usersToCreate.filter(u => u.role === 'admin').length
  if (filterRoleResponse.data.data.length !== adminCount) {
    throw new Error(`Expected ${adminCount} admin users, got ${filterRoleResponse.data.data.length}`)
  }
  
  // Filter by boolean
  const filterActiveCmd = curlCmd(`${baseUrl}/api/users?filter[isActive]=true`)
  const filterActiveResult = await curl(filterActiveCmd)
  const filterActiveResponse = parseResponse(filterActiveResult.raw)
  
  assertStatus(filterActiveResponse, 200)
  
  const activeCount = usersToCreate.filter(u => u.isActive).length
  if (filterActiveResponse.data.data.length !== activeCount) {
    throw new Error(`Expected ${activeCount} active users, got ${filterActiveResponse.data.data.length}`)
  }
  
  // 5.2 Multiple filters (AND logic)
  console.log('  5.2 Multiple filters (AND logic)')
  
  const multiFilterCmd = curlCmd(`${baseUrl}/api/users?filter[role]=user&filter[isActive]=true`)
  const multiFilterResult = await curl(multiFilterCmd)
  const multiFilterResponse = parseResponse(multiFilterResult.raw)
  
  assertStatus(multiFilterResponse, 200)
  
  const activeUserCount = usersToCreate.filter(u => u.role === 'user' && u.isActive).length
  if (multiFilterResponse.data.data.length !== activeUserCount) {
    throw new Error(`Expected ${activeUserCount} active users with role 'user', got ${multiFilterResponse.data.data.length}`)
  }
  
  // 5.3 Non-searchable field should fail
  console.log('  5.3 Non-searchable field filtering')
  
  const nonSearchableCmd = curlCmd(`${baseUrl}/api/users?filter[age]=25`)
  const nonSearchableResult = await curl(nonSearchableCmd)
  const nonSearchableResponse = parseResponse(nonSearchableResult.raw)
  
  // Should return 422 because 'age' is not searchable
  assertStatus(nonSearchableResponse, 422)
  
  if (!nonSearchableResponse.data.errors || !nonSearchableResponse.data.errors.some(e => 
    e.detail && e.detail.includes('age') && e.detail.includes('not searchable')
  )) {
    throw new Error('Expected error about age field not being searchable')
  }
  
  // 5.4 Pagination
  console.log('  5.4 Pagination')
  
  // Page size
  const pageSizeCmd = curlCmd(`${baseUrl}/api/users?page[size]=2`)
  console.log('  Page size command:', pageSizeCmd)
  const pageSizeResult = await curl(pageSizeCmd)
  console.log('  Page size result:', pageSizeResult.success ? 'success' : 'failed', pageSizeResult.stderr || '')
  
  if (!pageSizeResult.success || !pageSizeResult.raw) {
    throw new Error(`Page size request failed: ${pageSizeResult.error || 'No response'}`)
  }
  
  const pageSizeResponse = parseResponse(pageSizeResult.raw)
  
  assertStatus(pageSizeResponse, 200)
  
  if (pageSizeResponse.data.data.length !== 2) {
    throw new Error(`Expected page size of 2, got ${pageSizeResponse.data.data.length}`)
  }
  
  if (!pageSizeResponse.data.meta || pageSizeResponse.data.meta.pageSize !== 2) {
    throw new Error('Page size not reflected in meta')
  }
  
  // Page number
  const pageNumberCmd = curlCmd(`${baseUrl}/api/users?page[size]=2&page[number]=2`)
  const pageNumberResult = await curl(pageNumberCmd)
  const pageNumberResponse = parseResponse(pageNumberResult.raw)
  
  assertStatus(pageNumberResponse, 200)
  
  if (pageNumberResponse.data.data.length !== 2) {
    throw new Error(`Expected 2 results on page 2, got ${pageNumberResponse.data.data.length}`)
  }
  
  // Verify it's different data
  const firstPageIds = pageSizeResponse.data.data.map(u => u.id)
  const secondPageIds = pageNumberResponse.data.data.map(u => u.id)
  
  if (firstPageIds.some(id => secondPageIds.includes(id))) {
    throw new Error('Page 2 contains same data as page 1')
  }
  
  // 5.5 Sorting
  console.log('  5.5 Sorting')
  
  // Sort by name ascending
  const sortAscCmd = curlCmd(`${baseUrl}/api/users?sort=name`)
  const sortAscResult = await curl(sortAscCmd)
  const sortAscResponse = parseResponse(sortAscResult.raw)
  
  assertStatus(sortAscResponse, 200)
  
  const names = sortAscResponse.data.data.map(u => u.attributes.name)
  const sortedNames = [...names].sort()
  
  if (JSON.stringify(names) !== JSON.stringify(sortedNames)) {
    throw new Error('Results not sorted by name ascending')
  }
  
  // Sort by name descending
  const sortDescCmd = curlCmd(`${baseUrl}/api/users?sort=-name`)
  const sortDescResult = await curl(sortDescCmd)
  const sortDescResponse = parseResponse(sortDescResult.raw)
  
  assertStatus(sortDescResponse, 200)
  
  const descNames = sortDescResponse.data.data.map(u => u.attributes.name)
  const sortedDescNames = [...descNames].sort().reverse()
  
  if (JSON.stringify(descNames) !== JSON.stringify(sortedDescNames)) {
    throw new Error('Results not sorted by name descending')
  }
  
  // 5.6 Multiple sort fields
  console.log('  5.6 Multiple sort fields')
  
  const multiSortCmd = curlCmd(`${baseUrl}/api/users?sort=role,-name`)
  const multiSortResult = await curl(multiSortCmd)
  const multiSortResponse = parseResponse(multiSortResult.raw)
  
  assertStatus(multiSortResponse, 200)
  
  // Verify sorting by role first, then by name descending within each role
  let lastRole = null
  let lastNameInRole = null
  
  for (const user of multiSortResponse.data.data) {
    const role = user.attributes.role
    const name = user.attributes.name
    
    if (lastRole && role !== lastRole) {
      // Role changed, reset name tracking
      if (role < lastRole) {
        throw new Error(`Roles not sorted ascending: ${lastRole} -> ${role}`)
      }
      lastNameInRole = null
    }
    
    if (lastRole === role && lastNameInRole && name > lastNameInRole) {
      throw new Error(`Names not sorted descending within role ${role}: ${lastNameInRole} -> ${name}`)
    }
    
    lastRole = role
    lastNameInRole = name
  }
  
  // 5.7 Filter with sorting and pagination
  console.log('  5.7 Combined filter, sort, and pagination')
  
  const combinedCmd = curlCmd(`${baseUrl}/api/users?filter[isActive]=true&sort=-name&page[size]=2`)
  const combinedResult = await curl(combinedCmd)
  const combinedResponse = parseResponse(combinedResult.raw)
  
  assertStatus(combinedResponse, 200)
  
  // Should have max 2 results
  if (combinedResponse.data.data.length > 2) {
    throw new Error('Page size not respected with filters')
  }
  
  // All should be active
  if (!combinedResponse.data.data.every(u => u.attributes.isActive === true)) {
    throw new Error('Filter not applied correctly')
  }
  
  // Should be sorted by name descending
  const combinedNames = combinedResponse.data.data.map(u => u.attributes.name)
  const sortedCombinedNames = [...combinedNames].sort().reverse()
  
  if (JSON.stringify(combinedNames) !== JSON.stringify(sortedCombinedNames)) {
    throw new Error('Sort not applied correctly with filters')
  }
  
  // 5.8 Include parameter (joins)
  console.log('  5.8 Include parameter for joins')
  
  const includeCmd = curlCmd(`${baseUrl}/api/posts?include=authorId`)
  const includeResult = await curl(includeCmd)
  const includeResponse = parseResponse(includeResult.raw)
  
  assertStatus(includeResponse, 200)
  
  // Check that author data is included
  for (const post of includeResponse.data.data) {
    if (!post.attributes.author || typeof post.attributes.author !== 'object') {
      throw new Error('Author data not included in post')
    }
    
    if (!post.attributes.author.id || !post.attributes.author.name) {
      throw new Error('Author data incomplete')
    }
  }
  
  // 5.9 Fields parameter
  console.log('  5.9 Fields parameter')
  
  const fieldsCmd = curlCmd(`${baseUrl}/api/users?fields[users]=name,email`)
  const fieldsResult = await curl(fieldsCmd)
  const fieldsResponse = parseResponse(fieldsResult.raw)
  
  assertStatus(fieldsResponse, 200)
  
  // Check that only requested fields are included
  for (const user of fieldsResponse.data.data) {
    const attrs = Object.keys(user.attributes)
    
    // Should have name and email
    if (!attrs.includes('name') || !attrs.includes('email')) {
      throw new Error('Requested fields not included')
    }
    
    // Should not have other fields like age, role, etc.
    const expectedFields = ['name', 'email']
    const extraFields = attrs.filter(f => !expectedFields.includes(f))
    
    if (extraFields.length > 0) {
      throw new Error(`Unexpected fields returned: ${extraFields.join(', ')}`)
    }
  }
  
  // 5.10 Invalid query parameters
  console.log('  5.10 Invalid query parameters')
  
  // Invalid page size (negative)
  const invalidPageSizeCmd = curlCmd(`${baseUrl}/api/users?page[size]=-1`)
  const invalidPageSizeResult = await curl(invalidPageSizeCmd)
  const invalidPageSizeResponse = parseResponse(invalidPageSizeResult.raw)
  
  assertStatus(invalidPageSizeResponse, 400) // BadRequestError returns 400
  
  // Invalid page number (zero)
  const invalidPageNumCmd = curlCmd(`${baseUrl}/api/users?page[number]=0`)
  const invalidPageNumResult = await curl(invalidPageNumCmd)
  const invalidPageNumResponse = parseResponse(invalidPageNumResult.raw)
  
  assertStatus(invalidPageNumResponse, 400) // BadRequestError returns 400
  
  // 5.11 Array field filtering
  console.log('  5.11 Array field filtering')
  
  const arrayFilterCmd = curlCmd(`${baseUrl}/api/posts?filter[tags]=tech`)
  const arrayFilterResult = await curl(arrayFilterCmd)
  const arrayFilterResponse = parseResponse(arrayFilterResult.raw)
  
  assertStatus(arrayFilterResponse, 200)
  
  // Should find posts with 'tech' tag
  if (arrayFilterResponse.data.data.length === 0) {
    throw new Error('No posts found with tech tag')
  }
  
  // Verify all results have the tech tag
  for (const post of arrayFilterResponse.data.data) {
    if (!post.attributes.tags || !post.attributes.tags.includes('tech')) {
      throw new Error('Post without tech tag included in results')
    }
  }
  
  // 5.12 Empty results
  console.log('  5.12 Empty results')
  
  const noResultsCmd = curlCmd(`${baseUrl}/api/users?filter[name]=NonExistentUser`)
  const noResultsResult = await curl(noResultsCmd)
  const noResultsResponse = parseResponse(noResultsResult.raw)
  
  assertStatus(noResultsResponse, 200)
  
  if (noResultsResponse.data.data.length !== 0) {
    throw new Error('Expected empty results')
  }
  
  if (!noResultsResponse.data.meta || noResultsResponse.data.meta.total !== 0) {
    throw new Error('Meta should show total of 0')
  }
  
  // 5.13 Links in response
  console.log('  5.13 Links in response')
  
  const linksCmd = curlCmd(`${baseUrl}/api/users?page[size]=2&page[number]=1`)
  const linksResult = await curl(linksCmd)
  const linksResponse = parseResponse(linksResult.raw)
  
  assertStatus(linksResponse, 200)
  
  if (!linksResponse.data.links) {
    throw new Error('Links section missing from response')
  }
  
  if (!linksResponse.data.links.self) {
    throw new Error('Self link missing')
  }
  
  // Should have next link if there are more pages
  if (linksResponse.data.meta.totalPages > 1 && !linksResponse.data.links.next) {
    throw new Error('Next link missing when there are more pages')
  }
  
  // Cleanup
  console.log('  Cleaning up test data...')
  
  // Delete all test posts
  for (const post of testPosts) {
    await curl(curlCmd(`${baseUrl}/api/posts/${post.id}`, { method: 'DELETE' }))
  }
  
  // Delete all test users
  for (const user of testUsers) {
    await curl(curlCmd(`${baseUrl}/api/users/${user.id}`, { method: 'DELETE' }))
  }
})

console.log('\nAll query and filtering tests passed! ✅')